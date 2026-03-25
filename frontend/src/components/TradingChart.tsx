import React, { useEffect, useRef, memo, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, PriceLineOptions, Time } from 'lightweight-charts';

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

interface TradingChartProps {
  symbol: string;
  openOrders?: Order[];
}

const TradingChart: React.FC<TradingChartProps> = ({ symbol, openOrders = [] }) => {
  const mainChartContainerRef = useRef<HTMLDivElement>(null);
  const volumeChartContainerRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const priceLinesRef = useRef<import('lightweight-charts').IPriceLine[]>([]);

  // State to track if user is hovering the chart
  const [isHovering, setIsHovering] = useState(false);
  // State to track the latest candle data
  const latestDataRef = useRef<{ open: number; high: number; low: number; close: number; volume: number } | null>(null);

  useEffect(() => {
    if (!mainChartContainerRef.current || !volumeChartContainerRef.current) return;

    // Initialize Main Candlestick chart
    const mainChart = createChart(mainChartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#18181b' }, // zinc-950
        textColor: '#a1a1aa', // zinc-400
      },
      grid: {
        vertLines: { color: '#27272a' }, // zinc-800
        horzLines: { color: '#27272a' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#27272a',
        visible: false, // Hide time axis on main chart as it will be shown on volume chart
      },
      rightPriceScale: {
        borderColor: '#27272a',
        autoScale: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: '#52525b', style: 3 },
        horzLine: { width: 1, color: '#52525b', style: 3 },
      },
      width: mainChartContainerRef.current.clientWidth,
      height: mainChartContainerRef.current.clientHeight,
    });

    mainChartRef.current = mainChart;

    const candlestickSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', // green-500
      downColor: '#ef4444', // red-500
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });
    seriesRef.current = candlestickSeries;

    // Initialize Volume chart
    const volumeChart = createChart(volumeChartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#18181b' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { visible: false }, // Hide horizontal grid lines for volume
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#27272a',
      },
      rightPriceScale: {
        borderColor: '#27272a',
        autoScale: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: '#52525b', style: 3 },
        horzLine: { visible: false, labelVisible: false }, // Hide horizontal line on volume
      },
      width: volumeChartContainerRef.current.clientWidth,
      height: volumeChartContainerRef.current.clientHeight,
    });

    volumeChartRef.current = volumeChart;

    const volumeSeries = volumeChart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
    });
    volumeSeriesRef.current = volumeSeries;

    const updateTooltip = (data: { open: number; high: number; low: number; close: number; volume?: number }) => {
      if (!tooltipRef.current) return;

      tooltipRef.current.style.display = 'block';
      const isUp = data.close >= data.open;
      const colorClass = isUp ? 'text-green-500' : 'text-red-500';

      let html = `<div class="font-bold mb-1">${symbol.replace('USDT', ' / USDT')} · 1h · Binance</div>`;
      html += `<div class="flex gap-2 text-xs">
        <span>O <span class="${colorClass}">${data.open.toFixed(2)}</span></span>
        <span>H <span class="${colorClass}">${data.high.toFixed(2)}</span></span>
        <span>L <span class="${colorClass}">${data.low.toFixed(2)}</span></span>
        <span>C <span class="${colorClass}">${data.close.toFixed(2)}</span></span>
      </div>`;

      if (data.volume !== undefined) {
        html += `<div class="text-xs mt-1 text-zinc-400">Vol <span class="text-zinc-300">${Number(data.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
      }

      tooltipRef.current.innerHTML = html;
    };

    // Sync Crosshairs
    mainChart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || param.point.x < 0 || param.point.x > mainChartContainerRef.current!.clientWidth || param.point.y < 0 || param.point.y > mainChartContainerRef.current!.clientHeight) {
        volumeChart.clearCrosshairPosition();
        setIsHovering(false);
        if (latestDataRef.current) {
          updateTooltip(latestDataRef.current);
        } else if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      } else {
        setIsHovering(true);
        // Sync volume crosshair
        volumeChart.setCrosshairPosition(0, param.time, volumeSeries);

        const data = param.seriesData.get(candlestickSeries) as { open: number; high: number; low: number; close: number; time: import('lightweight-charts').Time } | undefined;
        // Since we hover over main chart, we need to find the corresponding volume data by time
        if (data) {
          // Find matching volume - workaround since param.seriesData won't have it (it's a different chart)
          // A better approach is caching the volume data or relying on the volume chart crosshair event.
          // For simplicity, we can fetch the volume if needed or just skip it on historical hover if it's too complex,
          // but we can also sync from volume to main chart.
          updateTooltip({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
          });
        }
      }
    });

    volumeChart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || param.point.x < 0 || param.point.x > volumeChartContainerRef.current!.clientWidth || param.point.y < 0 || param.point.y > volumeChartContainerRef.current!.clientHeight) {
        mainChart.clearCrosshairPosition();
        setIsHovering(false);
      } else {
        setIsHovering(true);
        // Sync main crosshair
        // Note: price is required but we can just pass a dummy price and mainChart will show the vertical line
        mainChart.setCrosshairPosition(0, param.time, candlestickSeries);
      }
    });


    // Fetch initial historical data from Binance
    const fetchHistory = async () => {
      try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=500`);
        const data = await response.json();
        const formattedData = data.map((d: (string | number)[]) => ({
          time: (d[0] as number) / 1000 as Time,
          open: parseFloat(d[1] as string),
          high: parseFloat(d[2] as string),
          low: parseFloat(d[3] as string),
          close: parseFloat(d[4] as string),
        }));
        candlestickSeries.setData(formattedData);

        const volumeData = data.map((d: (string | number)[]) => {
          const open = parseFloat(d[1] as string);
          const close = parseFloat(d[4] as string);
          return {
            time: (d[0] as number) / 1000 as Time,
            value: parseFloat(d[5] as string), // volume is index 5
            color: close >= open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
          };
        });
        volumeSeries.setData(volumeData);

        // Update latest data ref and tooltip if not hovering
        if (formattedData.length > 0) {
          const latestCandle = formattedData[formattedData.length - 1];
          const latestVol = volumeData[volumeData.length - 1];
          latestDataRef.current = {
            ...latestCandle,
            volume: latestVol.value
          };

          if (!isHovering && tooltipRef.current) {
             if (latestDataRef.current) updateTooltip(latestDataRef.current);
          }
        }
      } catch (e) {
        console.error('Failed to fetch historical data for chart', e);
      }
    };
    fetchHistory();

    // Connect to Binance WebSocket for real-time updates
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1h`);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.k) {
        const kline = message.k;
        candlestickSeries.update({
          time: kline.t / 1000 as Time,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
        });

        volumeSeriesRef.current?.update({
          time: kline.t / 1000 as Time,
          value: parseFloat(kline.v),
          color: parseFloat(kline.c) >= parseFloat(kline.o) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
        } as import('lightweight-charts').HistogramData);

        // Update latest data ref and tooltip if not hovering
        latestDataRef.current = {
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
        };
      }
    };

    // Sync Logical Range
    mainChart.timeScale().subscribeVisibleLogicalRangeChange((timeRange) => {
      if (timeRange) {
        volumeChart.timeScale().setVisibleLogicalRange(timeRange);
      }
    });

    volumeChart.timeScale().subscribeVisibleLogicalRangeChange((timeRange) => {
      if (timeRange) {
        mainChart.timeScale().setVisibleLogicalRange(timeRange);
      }
    });


    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0) return;

      for (const entry of entries) {
         if (entry.target === mainChartContainerRef.current) {
            mainChart.applyOptions({
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            });
         } else if (entry.target === volumeChartContainerRef.current) {
            volumeChart.applyOptions({
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            });
         }
      }
    });

    resizeObserver.observe(mainChartContainerRef.current);
    resizeObserver.observe(volumeChartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      mainChart.remove();
      volumeChart.remove();
      mainChartRef.current = null;
      volumeChartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [symbol]); // removed isHovering dependency so we don't recreate chart

  // Need a separate effect to update tooltip when WS data arrives and not hovering
  useEffect(() => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1h`);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.k) {
        const kline = message.k;
        const latestData = {
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
        };
        latestDataRef.current = latestData;

        if (!isHovering && tooltipRef.current) {
            tooltipRef.current.style.display = 'block';
            const isUp = latestData.close >= latestData.open;
            const colorClass = isUp ? 'text-green-500' : 'text-red-500';

            let html = `<div class="font-bold mb-1">${symbol.replace('USDT', ' / USDT')} · 1h · Binance</div>`;
            html += `<div class="flex gap-2 text-xs">
              <span>O <span class="${colorClass}">${latestData.open.toFixed(2)}</span></span>
              <span>H <span class="${colorClass}">${latestData.high.toFixed(2)}</span></span>
              <span>L <span class="${colorClass}">${latestData.low.toFixed(2)}</span></span>
              <span>C <span class="${colorClass}">${latestData.close.toFixed(2)}</span></span>
            </div>`;

            if (latestData.volume !== undefined) {
              html += `<div class="text-xs mt-1 text-zinc-400">Vol <span class="text-zinc-300">${Number(latestData.volume).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
            }

            tooltipRef.current.innerHTML = html;
        }
      }
    };
    return () => {
      ws.close();
    };
  }, [symbol, isHovering]);


  // Handle open orders update
  useEffect(() => {
    if (!seriesRef.current) return;

    // Remove existing price lines
    priceLinesRef.current.forEach(line => {
      try {
        seriesRef.current?.removePriceLine(line);
      } catch {
        // Ignore if already removed
      }
    });
    priceLinesRef.current = [];

    // Add new price lines for open orders
    openOrders.forEach(order => {
      // Create price line
      const options: PriceLineOptions = {
        price: order.price,
        color: '#eab308', // yellow-500
        lineWidth: 2,
        lineStyle: 2, // Dashed line
        axisLabelVisible: true,
        title: `${order.side} ${order.quantity} @ ${order.price.toLocaleString()}`,
        lineVisible: true,
        axisLabelColor: '#eab308',
        axisLabelTextColor: '#000000',
      };

      const priceLine = seriesRef.current?.createPriceLine(options);
      if (priceLine) {
        priceLinesRef.current.push(priceLine);
      }
    });

  }, [openOrders, symbol]);

  return (
    <div className="w-full h-full relative flex flex-col" style={{ overflow: 'hidden' }}>
      <div
        ref={mainChartContainerRef}
        className="w-full"
        style={{ flex: '1 1 80%' }}
      />
      <div
        ref={volumeChartContainerRef}
        className="w-full border-t border-zinc-800"
        style={{ flex: '0 0 20%' }}
      />

      <div
        ref={tooltipRef}
        className="absolute top-3 left-3 z-10 pointer-events-none text-sm text-zinc-300 bg-zinc-900/80 p-2 rounded border border-zinc-800 backdrop-blur-sm hidden"
      />
    </div>
  );
};

export default memo(TradingChart);
