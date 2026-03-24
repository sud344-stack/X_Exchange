use crate::AppState;
use crate::models::Order;
use bigdecimal::{BigDecimal, FromPrimitive, ToPrimitive};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;
use tracing::{debug, error, info};

pub struct MatchingEngine {
    state: AppState,
    // Symbol -> Map of OrderID -> Order
    // Used to track limit orders in memory. Market orders will still be executed instantly
    // when they arrive from the create_order API, but since this system relies on the engine process,
    // we'll fetch open orders on start and update them in memory.
    active_orders: Arc<DashMap<String, dashmap::DashMap<uuid::Uuid, Order>>>,
}

impl MatchingEngine {
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            active_orders: Arc::new(DashMap::new()),
        }
    }

    pub async fn load_initial_orders(&self) -> Result<(), sqlx::Error> {
        let orders: Vec<Order> = sqlx::query_as::<_, Order>(
            r#"
            SELECT id, user_id, asset, side, type as order_type, price, quantity, status, queue_ahead, executed_quantity, created_at, updated_at
            FROM orders
            WHERE status = 'OPEN'
            "#
        )
        .fetch_all(&*self.state.db)
        .await?;

        for order in orders {
            let symbol = format!("{}USDT", order.asset);
            let symbol_orders = self
                .active_orders
                .entry(symbol)
                .or_insert_with(dashmap::DashMap::new);
            symbol_orders.insert(order.id, order);
        }

        info!("Loaded initial OPEN orders into memory");
        Ok(())
    }

    pub async fn run(&self) {
        if let Err(e) = self.load_initial_orders().await {
            error!("Failed to load initial orders: {}", e);
        }

        let mut agg_trade_rx = self.state.market_data.agg_trade_tx.subscribe();

        // Also spawn a task to sync new orders from the DB periodically to avoid
        // losing new orders since we don't have a pubsub from api.rs to engine.rs
        let active_orders_clone = self.active_orders.clone();
        let db_clone = self.state.db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
            loop {
                interval.tick().await;
                if let Ok(orders) = sqlx::query_as::<_, Order>(
                    r#"
                    SELECT id, user_id, asset, side, type as order_type, price, quantity, status, queue_ahead, executed_quantity, created_at, updated_at
                    FROM orders
                    WHERE status = 'OPEN'
                    "#
                )
                .fetch_all(&*db_clone)
                .await {
                    for order in orders {
                        let symbol = format!("{}USDT", order.asset);
                        let symbol_orders = active_orders_clone.entry(symbol).or_insert_with(dashmap::DashMap::new);
                        // Only insert if not already there, to avoid overriding queue progress
                        if !symbol_orders.contains_key(&order.id) {
                            symbol_orders.insert(order.id, order);
                        }
                    }
                }
            }
        });

        info!("Starting Matching Engine aggregate trade listener");
        loop {
            match agg_trade_rx.recv().await {
                Ok(trade) => {
                    self.process_trade(&trade).await;
                }
                Err(RecvError::Lagged(n)) => {
                    error!("Matching Engine lagged behind by {} messages", n);
                }
                Err(RecvError::Closed) => {
                    error!("Aggregate trade channel closed");
                    break;
                }
            }
        }
    }

    async fn process_trade(&self, trade: &crate::market::binance::AggTrade) {
        let symbol_orders = match self.active_orders.get(&trade.symbol) {
            Some(orders) => orders,
            None => return,
        };

        let mut executed_updates = Vec::new();
        let mut fully_filled = Vec::new();

        for mut order_entry in symbol_orders.iter_mut() {
            let order = order_entry.value_mut();

            // For MARKET orders, immediately fill them with the next available trade price.
            if order.order_type == "MARKET" {
                let target_qty = order.quantity.to_f64().unwrap_or(0.0);
                let executed = order.executed_quantity.to_f64().unwrap_or(0.0);
                let remaining = target_qty - executed;

                if remaining > 0.0 {
                    // Fill completely
                    order.executed_quantity = BigDecimal::from_f64(target_qty).unwrap_or_default();
                    executed_updates.push((order.clone(), trade.price, remaining));
                    fully_filled.push(order.id);
                }
                continue;
            }

            if order.order_type != "LIMIT" {
                continue;
            }

            let order_price = order.price.to_f64().unwrap_or(0.0);

            // Check if trade price hits the limit order
            // Buy: Real price drops to or below limit
            // Sell: Real price rises to or above limit
            let is_at_price = if order.side == "BUY" {
                trade.price <= order_price
            } else {
                trade.price >= order_price
            };

            if is_at_price {
                let mut queue = order.queue_ahead.to_f64().unwrap_or(0.0);
                let mut executed = order.executed_quantity.to_f64().unwrap_or(0.0);
                let target_qty = order.quantity.to_f64().unwrap_or(0.0);
                let mut trade_vol_remaining = trade.quantity;

                // 1. Deplete queue if any
                if queue > 0.0 {
                    if trade_vol_remaining >= queue {
                        trade_vol_remaining -= queue;
                        queue = 0.0;
                    } else {
                        queue -= trade_vol_remaining;
                        trade_vol_remaining = 0.0;
                    }
                    order.queue_ahead = BigDecimal::from_f64(queue).unwrap_or_default();
                }

                // 2. Fill order if queue is 0 and there's remaining volume
                if queue <= 0.0 && trade_vol_remaining > 0.0 {
                    let fill_amount = trade_vol_remaining.min(target_qty - executed);
                    if fill_amount > 0.0 {
                        executed += fill_amount;
                        order.executed_quantity =
                            BigDecimal::from_f64(executed).unwrap_or_default();

                        executed_updates.push((order.clone(), trade.price, fill_amount));

                        if executed >= target_qty {
                            fully_filled.push(order.id);
                        }
                    }
                }
            }
        }

        // Remove fully filled orders from active memory
        for id in fully_filled {
            symbol_orders.remove(&id);
        }

        // Execute the DB updates concurrently without blocking the main event loop
        for (order, execute_price, fill_qty) in executed_updates {
            let state = self.state.clone();
            tokio::spawn(async move {
                if let Err(e) = execute_partial_trade(&state, &order, execute_price, fill_qty).await
                {
                    error!(
                        "Error executing partial trade for order {}: {}",
                        order.id, e
                    );
                }
            });
        }
    }
}

async fn execute_partial_trade(
    state: &AppState,
    order: &Order,
    execute_price: f64,
    fill_qty: f64,
) -> Result<(), sqlx::Error> {
    if fill_qty <= 0.0 {
        return Ok(());
    }

    let mut tx = state.db.begin().await?;

    let executed_qty_bd = BigDecimal::from_f64(fill_qty).unwrap_or_default();
    let target_qty_f64 = order.quantity.to_f64().unwrap_or(0.0);
    let total_executed_f64 = order.executed_quantity.to_f64().unwrap_or(0.0);

    let new_status = if total_executed_f64 >= target_qty_f64 {
        "FILLED"
    } else {
        "OPEN"
    };

    // 1. Update order
    sqlx::query(
        r#"
        UPDATE orders
        SET status = $1, queue_ahead = $2, executed_quantity = $3, updated_at = NOW()
        WHERE id = $4
        "#,
    )
    .bind(new_status)
    .bind(&order.queue_ahead)
    .bind(&order.executed_quantity)
    .bind(order.id)
    .execute(&mut *tx)
    .await?;

    // 2. Update user portfolio for the Asset (BTC, ETH, etc)
    let quantity_change = if order.side == "BUY" {
        executed_qty_bd.clone()
    } else {
        -executed_qty_bd.clone()
    };

    sqlx::query(
        r#"
        INSERT INTO portfolios (id, user_id, asset, balance)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, asset)
        DO UPDATE SET balance = portfolios.balance + EXCLUDED.balance, updated_at = NOW()
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(order.user_id)
    .bind(&order.asset)
    .bind(&quantity_change)
    .execute(&mut *tx)
    .await?;

    // 3. Update USDT balance
    let execute_price_bd = BigDecimal::from_f64(execute_price).unwrap_or_default();
    let usdt_change = if order.side == "BUY" {
        -(execute_price_bd * executed_qty_bd.clone())
    } else {
        execute_price_bd * executed_qty_bd.clone()
    };

    sqlx::query(
        r#"
        INSERT INTO portfolios (id, user_id, asset, balance)
        VALUES ($1, $2, 'USDT', $3)
        ON CONFLICT (user_id, asset)
        DO UPDATE SET balance = portfolios.balance + EXCLUDED.balance, updated_at = NOW()
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(order.user_id)
    .bind(&usdt_change)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    info!(
        "Executed trade for order {} at price {}, qty {}, total executed {}, target {}, new status {}",
        order.id, execute_price, fill_qty, total_executed_f64, target_qty_f64, new_status
    );

    Ok(())
}
