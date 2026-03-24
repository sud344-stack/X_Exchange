import React, { useEffect, useRef, memo } from 'react';
import { createChart } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, PriceLineOptions } from 'lightweight-charts';

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
  const priceLinesRef = useRef<import('lightweight-charts').IPriceLine[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid' as const, color: '#18181b' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries({
      type: 'Candlestick',
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    } as Parameters<typeof chart.addSeries>[0]) as ISeriesApi<"Candlestick">;

    seriesRef.current = candlestickSeries;

    // Fetch initial historical data from Binance
    const fetchHistory = async () => {
      try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=500`);
        const data = await response.json();
        const formattedData = data.map((d: (string | number)[]) => ({
          time: d[0] / 1000,
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
        }));
        candlestickSeries.setData(formattedData);
      } catch {
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
          time: kline.t / 1000 as import('lightweight-charts').Time,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
        });
      }
    };

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
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
    <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />
  );
};

export default memo(TradingChart);
