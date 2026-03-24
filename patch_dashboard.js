const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/Dashboard.tsx', 'utf8');

// 1. Add interface for Order
const interfaceInsert = `
interface Order {
  id: string;
  asset: string;
  side: string;
  order_type: string;
  price: number;
  quantity: number;
  status: string;
  executed_quantity: number;
}
`;
code = code.replace(/interface PortfolioItem/g, interfaceInsert + '\ninterface PortfolioItem');

// 2. Add state for activeTab and orders
const stateInsert = `
  const [activeTab, setActiveTab] = useState<'SPOT' | 'POSITION'>('SPOT');
  const [orders, setOrders] = useState<Order[]>([]);
`;
code = code.replace(/const \[orderQuantity.*?;/g, match => match + '\n' + stateInsert);

// 3. Add fetchOrders function and hook
const fetchOrdersInsert = `
  const fetchOrders = useCallback(async (id: string) => {
    try {
      const res = await axios.get(\`/api/users/\${id}/orders\`);
      setOrders(res.data);
    } catch (e) {
      console.error("Failed to fetch orders", e);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      fetchOrders(userId);
      const interval = setInterval(() => fetchOrders(userId), 2000);
      return () => clearInterval(interval);
    }
  }, [userId, fetchOrders]);
`;
code = code.replace(/const fetchPortfolio.*?(?=const handleLogin)/s, match => match + fetchOrdersInsert + '\n  ');

// 4. Update TradingChart with openOrders
code = code.replace(/<TradingChart symbol=\{\`\$\{orderAsset\}USDT\`\} \/>/g,
  `<TradingChart symbol={\`\${orderAsset}USDT\`} openOrders={orders.filter(o => o.asset === orderAsset && o.status === 'OPEN')} />`);

// 5. Update the "Spot Trade" header with tabs
const headerOld = `
            <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-100">Spot Trade</h2>
              <div className="text-xs text-zinc-500">
                Wallet Balance: <span className="font-mono text-zinc-300">{portfolio.find(p => p.asset === 'USDT')?.balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) || '0.00'} USDT</span>
              </div>
            </div>`;
const headerNew = `
            <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('SPOT')}
                  className={\`text-sm font-bold pb-1 border-b-2 transition-colors \${activeTab === 'SPOT' ? 'text-zinc-100 border-yellow-500' : 'text-zinc-500 border-transparent hover:text-zinc-300'}\`}
                >
                  Spot Trade
                </button>
                <button
                  onClick={() => setActiveTab('POSITION')}
                  className={\`text-sm font-bold pb-1 border-b-2 transition-colors \${activeTab === 'POSITION' ? 'text-zinc-100 border-yellow-500' : 'text-zinc-500 border-transparent hover:text-zinc-300'}\`}
                >
                  Position
                </button>
              </div>
              {activeTab === 'SPOT' && (
                <div className="text-xs text-zinc-500">
                  Wallet Balance: <span className="font-mono text-zinc-300">{portfolio.find(p => p.asset === 'USDT')?.balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) || '0.00'} USDT</span>
                </div>
              )}
            </div>`;
code = code.replace(headerOld, headerNew);

// 6. Wrap the form in conditional rendering and add Position view
const formOld = `<form onSubmit={submitOrder} className="flex gap-6 max-w-3xl mx-auto">`;
const formNew = `
              {activeTab === 'SPOT' && (
                <form onSubmit={submitOrder} className="flex gap-6 max-w-3xl mx-auto">`;
code = code.replace(formOld, formNew);

// Find the closing form tag and insert the POSITION view
const formCloseOld = `                </div>
              </form>`;
const formCloseNew = `                </div>
              </form>
              )}
              {activeTab === 'POSITION' && (
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-sm text-left text-zinc-400">
                    <thead className="text-xs uppercase bg-zinc-800/50 text-zinc-400 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium">Symbol</th>
                        <th className="px-4 py-2 font-medium">Side</th>
                        <th className="px-4 py-2 font-medium">Entry Price</th>
                        <th className="px-4 py-2 font-medium">Amount</th>
                        <th className="px-4 py-2 font-medium text-right">Filled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.filter(o => o.status === 'OPEN').length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                            No open positions
                          </td>
                        </tr>
                      ) : (
                        orders.filter(o => o.status === 'OPEN').map(order => (
                          <tr key={order.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                            <td className="px-4 py-2 font-medium text-zinc-200">{order.asset}/USDT</td>
                            <td className={\`px-4 py-2 font-medium \${order.side === 'BUY' ? 'text-green-500' : 'text-red-500'}\`}>
                              {order.side} {order.order_type === 'MARKET' ? '(MKT)' : ''}
                            </td>
                            <td className="px-4 py-2 font-mono">{order.order_type === 'MARKET' ? 'Market' : order.price.toLocaleString()}</td>
                            <td className="px-4 py-2 font-mono">{order.quantity.toLocaleString()}</td>
                            <td className="px-4 py-2 font-mono text-right">{order.executed_quantity.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}`;
code = code.replace(formCloseOld, formCloseNew);

fs.writeFileSync('frontend/src/pages/Dashboard.tsx', code);
