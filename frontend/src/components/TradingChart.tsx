import React, { useEffect, useRef, memo } from 'react';
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
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const priceLinesRef = useRef<import('lightweight-charts').IPriceLine[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
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
      },
      rightPriceScale: {
        borderColor: '#27272a',
        autoScale: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: '#52525b', // zinc-600
          style: 3, // dashed
        },
        horzLine: {
          width: 1,
          color: '#52525b',
          style: 3,
        },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
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

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // set as an overlay by setting a blank priceScaleId
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8, // highest point of the series will be at 80% of the chart height
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Add Tooltip logic
    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current) return;
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        tooltipRef.current.style.display = 'none';
      } else {
        // dateStr removed to fix linting
        const data = param.seriesData.get(candlestickSeries) as { open: number; high: number; low: number; close: number; time: import('lightweight-charts').Time } | undefined;
        const volData = param.seriesData.get(volumeSeries) as { value: number; time: import('lightweight-charts').Time } | undefined;

        if (data) {
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

          if (volData) {
            html += `<div class="text-xs mt-1 text-zinc-400">Vol <span class="text-zinc-300">${Number(volData.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>`;
          }

          tooltipRef.current.innerHTML = html;
        }
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
      }
    };

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({
        width: newRect.width,
        height: newRect.height,
      });
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [symbol]);

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
    <div className="w-full h-full relative" style={{ overflow: 'hidden' }}>
      <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />
      <div
        ref={tooltipRef}
        className="absolute top-3 left-3 z-10 pointer-events-none text-sm text-zinc-300 bg-zinc-900/80 p-2 rounded border border-zinc-800 backdrop-blur-sm hidden"
      />
    </div>
  );
};

export default memo(TradingChart);
