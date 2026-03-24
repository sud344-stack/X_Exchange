const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/TradingChart.tsx', 'utf8');

code = code.replace(/const priceLinesRef = useRef<any\[\]>\(\[\]\);/g, `const priceLinesRef = useRef<import('lightweight-charts').IPriceLine[]>([]);`);
code = code.replace(/background: \{ type: 'solid' as any, color: '#18181b' \}/g, `background: { type: 'solid' as const, color: '#18181b' }`);
code = code.replace(/\} as any\) as any;/g, `} as Parameters<typeof chart.addSeries>[0]) as ISeriesApi<"Candlestick">;`);
code = code.replace(/const formattedData = data\.map\(\(d: any\) => \(\{/g, `const formattedData = data.map((d: (string | number)[]) => ({`);
code = code.replace(/time: kline\.t \/ 1000 as any,/g, `time: kline.t / 1000 as import('lightweight-charts').Time,`);
code = code.replace(/\} catch \(e\) \{/g, `} catch (_e) {`);

fs.writeFileSync('frontend/src/components/TradingChart.tsx', code);
