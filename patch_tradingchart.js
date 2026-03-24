const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/TradingChart.tsx', 'utf8');

const interfaceOld = `interface TradingChartProps {
  symbol: string;
}`;
const interfaceNew = `interface Order {
  id: string;
  asset: string;
  side: string;
  order_type: string;
  price: number;
  quantity: number;
  status: string;
  executed_quantity: number;
}

interface TradingChartProps {
  symbol: string;
  openOrders?: Order[];
}`;
code = code.replace(interfaceOld, interfaceNew);

const compOld = `const TradingChart: React.FC<TradingChartProps> = ({ symbol }) => {`;
const compNew = `const TradingChart: React.FC<TradingChartProps> = ({ symbol, openOrders = [] }) => {`;
code = code.replace(compOld, compNew);

// Add state to store widget
code = code.replace(/const idStr = useId\(\)\.replace\(\/:\/g, ''\);/g, `const idStr = useId().replace(/:/g, '');
  const widgetRef = useRef<any>(null);`);

const tvWidgetCreationOld = `new window.TradingView.widget({`;
const tvWidgetCreationNew = `widgetRef.current = new window.TradingView.widget({`;
code = code.replace(new RegExp(tvWidgetCreationOld.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'), 'g'), tvWidgetCreationNew);

// Actually, the TradingView Advanced Charts widget doesn't allow drawing lines easily via `new window.TradingView.widget`.
// It requires `onChartReady` and `createOrderLine`. The Advanced Charts library provides `createOrderLine()`.
// Wait, the standard basic `tv.js` widget doesn't support `createOrderLine`.
// I need to use `tv.js` and see if `createOrderLine` is available.
// The prompt says "It also will be show in the graph by drawing yellow line across the graph window at the price where the user placing the buying or selling."
// Let's implement an overlay layer over the chart. Wait, we don't know the exact Y scale in the iframe.
// Let's check if the basic widget supports drawing a shape.
// Basic widget has `createShape` or something? No, it's very limited.
// Let's check `Advanced Charts`. `tv.js` is the basic widget.
// If I can't draw a line, I might need to write a simple overlay but we can't sync the y-axis easily.
// Is there a way to pass studies to `tv.js`? `studies: ["Moving Average@tv-basicstudies"]` but we can't create custom horizontal lines with dynamic values easily through basic config.
// Wait, TradingView has `createOrderLine` but it might be only in the `charting_library` (paid) not the basic `tv.js`.
// Let me look at TradingView Widget API. Maybe I can use pine script? basic widget supports `studies` but not custom pine script directly via config.
// Wait, I can't do that easily.
// But we must "draw a yellow line across the graph window at the price".
// Let's look for how people draw horizontal lines on `tv.js` free widget.
