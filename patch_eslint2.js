const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/TradingChart.tsx', 'utf8');

code = code.replace(/} catch \(_e\) {/g, `} catch {`);

fs.writeFileSync('frontend/src/components/TradingChart.tsx', code);
