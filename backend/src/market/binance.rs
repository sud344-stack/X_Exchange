use dashmap::DashMap;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{error, info, warn};

#[derive(Debug, Deserialize)]
struct CombinedStreamMessage {
    stream: String,
    data: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct BinanceTickerMessage {
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "c")]
    price: String,
}

#[derive(Debug, Deserialize)]
struct BinanceDepthMessage {
    #[serde(rename = "lastUpdateId")]
    _last_update_id: u64,
    bids: Vec<[String; 2]>,
    asks: Vec<[String; 2]>,
}

#[derive(Debug, Deserialize)]
struct BinanceAggTradeMessage {
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "p")]
    price: String,
    #[serde(rename = "q")]
    quantity: String,
    #[serde(rename = "m")]
    _is_buyer_maker: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct OrderBookEntry {
    pub price: f64,
    pub quantity: f64,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct OrderBook {
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
}

#[derive(Debug, Clone)]
pub struct AggTrade {
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
}

pub struct MarketData {
    pub prices: Arc<DashMap<String, f64>>,
    pub orderbooks: Arc<DashMap<String, OrderBook>>,
    pub agg_trade_tx: broadcast::Sender<AggTrade>,
}

impl MarketData {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(10000); // Buffer of up to 10k trades
        Self {
            prices: Arc::new(DashMap::new()),
            orderbooks: Arc::new(DashMap::new()),
            agg_trade_tx: tx,
        }
    }

    pub async fn start_binance_websocket(&self) {
        let prices = self.prices.clone();
        let orderbooks = self.orderbooks.clone();
        let agg_trade_tx = self.agg_trade_tx.clone();

        let coins = [
            "btcusdt", "xrpusdt", "bnbusdt", "ethusdt", "solusdt", "polusdt", "xmrusdt", "zecusdt",
            "pepeusdt",
        ];

        let mut streams = Vec::new();
        for coin in coins.iter() {
            streams.push(format!("{}@ticker", coin));
            streams.push(format!("{}@depth20@100ms", coin));
            streams.push(format!("{}@aggTrade", coin));
        }

        let streams_str = streams.join("/");
        // Use combined stream endpoint
        let url = format!(
            "wss://data-stream.binance.vision:9443/stream?streams={}",
            streams_str
        );

        tokio::spawn(async move {
            loop {
                info!("Connecting to Binance WebSocket: {}", url);
                match connect_async(&url).await {
                    Ok((ws_stream, _)) => {
                        info!("Connected to Binance WebSocket");
                        let (_, mut read) = ws_stream.split();

                        while let Some(msg) = read.next().await {
                            match msg {
                                Ok(Message::Text(text)) => {
                                    if let Ok(combined) =
                                        serde_json::from_str::<CombinedStreamMessage>(&text)
                                    {
                                        if combined.stream.ends_with("@ticker") {
                                            if let Ok(ticker) =
                                                serde_json::from_value::<BinanceTickerMessage>(
                                                    combined.data,
                                                )
                                            {
                                                if let Ok(price) = ticker.price.parse::<f64>() {
                                                    prices.insert(ticker.symbol, price);
                                                }
                                            }
                                        } else if combined.stream.ends_with("@depth20@100ms") {
                                            if let Ok(depth) =
                                                serde_json::from_value::<BinanceDepthMessage>(
                                                    combined.data,
                                                )
                                            {
                                                let symbol = combined
                                                    .stream
                                                    .split('@')
                                                    .next()
                                                    .unwrap()
                                                    .to_uppercase();

                                                let mut bids = Vec::new();
                                                for bid in depth.bids {
                                                    if let (Ok(price), Ok(quantity)) = (
                                                        bid[0].parse::<f64>(),
                                                        bid[1].parse::<f64>(),
                                                    ) {
                                                        bids.push(OrderBookEntry {
                                                            price,
                                                            quantity,
                                                        });
                                                    }
                                                }
                                                let mut asks = Vec::new();
                                                for ask in depth.asks {
                                                    if let (Ok(price), Ok(quantity)) = (
                                                        ask[0].parse::<f64>(),
                                                        ask[1].parse::<f64>(),
                                                    ) {
                                                        asks.push(OrderBookEntry {
                                                            price,
                                                            quantity,
                                                        });
                                                    }
                                                }

                                                orderbooks.insert(symbol, OrderBook { bids, asks });
                                            }
                                        } else if combined.stream.ends_with("@aggTrade") {
                                            if let Ok(trade) =
                                                serde_json::from_value::<BinanceAggTradeMessage>(
                                                    combined.data,
                                                )
                                            {
                                                if let (Ok(price), Ok(quantity)) = (
                                                    trade.price.parse::<f64>(),
                                                    trade.quantity.parse::<f64>(),
                                                ) {
                                                    let agg_trade = AggTrade {
                                                        symbol: trade.symbol,
                                                        price,
                                                        quantity,
                                                    };
                                                    // Broadcast to matching engine
                                                    let _ = agg_trade_tx.send(agg_trade);
                                                }
                                            }
                                        }
                                    } else {
                                        if let Ok(ticker) =
                                            serde_json::from_str::<BinanceTickerMessage>(&text)
                                        {
                                            if let Ok(price) = ticker.price.parse::<f64>() {
                                                prices.insert(ticker.symbol, price);
                                            }
                                        }
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    warn!("Binance WebSocket closed, reconnecting...");
                                    break;
                                }
                                Err(e) => {
                                    error!("Binance WebSocket error: {:?}", e);
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to connect to Binance WebSocket: {:?}. Retrying in 5 seconds...",
                            e
                        );
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });
    }
}
