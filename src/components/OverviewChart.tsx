import { useState, useMemo, useRef, useCallback } from 'react';
import { HistoryRecord, StandbyStatus } from '../types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush, Legend
} from 'recharts';
import { formatLag } from '../store';
import { ZoomIn, ZoomOut, Maximize2, TrendingUp } from 'lucide-react';

interface OverviewChartProps {
  history: HistoryRecord[];
  statuses: Record<string, StandbyStatus>;
  dbNames: Record<string, string>;
}

const COLORS = [
  '#00d4ff', '#a855f7', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#10b981', '#f97316', '#ec4899',
  '#14b8a6', '#6366f1', '#84cc16', '#e11d48', '#0ea5e9',
];

export default function OverviewChart({ history, statuses, dbNames }: OverviewChartProps) {
  const [brushRange, setBrushRange] = useState<{ startIndex?: number; endIndex?: number }>({});
  const [chartKey, setChartKey] = useState(0);
  const btnZoomRef = useRef(false);

  const dbIds = Object.keys(statuses);

  const chartData = useMemo(() => {
    if (history.length === 0) return [];

    // Group by timestamp (rounded to nearest 10 seconds)
    const timeMap = new Map<number, Record<string, number>>();
    history.forEach(h => {
      const roundedTime = Math.floor(h.timestamp / 10000) * 10000;
      if (!timeMap.has(roundedTime)) {
        timeMap.set(roundedTime, {});
      }
      const entry = timeMap.get(roundedTime)!;
      entry[h.dbId] = h.applyLagSeconds;
    });

    const sorted = Array.from(timeMap.entries()).sort((a, b) => a[0] - b[0]);
    return sorted.map(([ts, values]) => ({
      timestamp: ts,
      time: new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ...values,
    }));
  }, [history]);

  const handleZoomIn = useCallback(() => {
    if (chartData.length === 0) return;
    const start = brushRange.startIndex ?? 0;
    const end = brushRange.endIndex ?? chartData.length - 1;
    const range = end - start;
    const newRange = Math.max(Math.floor(range * 0.5), 5);
    const mid = Math.floor((start + end) / 2);
    btnZoomRef.current = true;
    setBrushRange({
      startIndex: Math.max(0, mid - Math.floor(newRange / 2)),
      endIndex: Math.min(chartData.length - 1, mid + Math.ceil(newRange / 2)),
    });
    setChartKey(k => k + 1);
  }, [chartData.length, brushRange.startIndex, brushRange.endIndex]);

  const handleZoomOut = useCallback(() => {
    if (chartData.length === 0) return;
    const start = brushRange.startIndex ?? 0;
    const end = brushRange.endIndex ?? chartData.length - 1;
    const range = end - start;
    const newRange = Math.min(range * 2, chartData.length - 1);
    const mid = Math.floor((start + end) / 2);
    btnZoomRef.current = true;
    setBrushRange({
      startIndex: Math.max(0, mid - Math.floor(newRange / 2)),
      endIndex: Math.min(chartData.length - 1, mid + Math.ceil(newRange / 2)),
    });
    setChartKey(k => k + 1);
  }, [chartData.length, brushRange.startIndex, brushRange.endIndex]);

  const handleResetZoom = useCallback(() => {
    btnZoomRef.current = true;
    setBrushRange({});
    setChartKey(k => k + 1);
  }, []);

  const handleBrushChange = useCallback((range: any) => {
    if (btnZoomRef.current) {
      btnZoomRef.current = false;
      return;
    }
    setBrushRange(range);
  }, []);

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl p-6" style={{
        background: 'linear-gradient(135deg, rgba(13,27,62,0.6), rgba(10,22,40,0.8))',
        border: '1px solid rgba(0,212,255,0.1)',
      }}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">全局延时趋势</h3>
        </div>
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          等待数据采集...
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg p-3 text-xs" style={{
          background: 'rgba(10,14,39,0.95)',
          border: '1px solid rgba(0,212,255,0.3)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          maxWidth: '250px',
        }}>
          <p className="text-gray-400 mb-1.5 font-mono">
            {payload[0]?.payload?.time}
          </p>
          <div className="space-y-0.5">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: p.stroke }} />
                <span className="text-gray-400 truncate max-w-[80px]">{dbNames[p.dataKey] || p.dataKey}:</span>
                <span className="font-bold font-mono" style={{ color: p.stroke }}>{formatLag(p.value || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl p-4" style={{
      background: 'linear-gradient(135deg, rgba(13,27,62,0.6), rgba(10,22,40,0.8))',
      border: '1px solid rgba(0,212,255,0.1)',
    }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">全局应用延时趋势</h3>
          <span className="text-xs text-gray-500">{chartData.length} 数据点</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomIn}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all" title="放大">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={handleZoomOut}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all" title="缩小">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={handleResetZoom}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all" title="重置">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData} key={chartKey}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickFormatter={v => {
              if (v >= 3600) return Math.floor(v / 3600) + 'h';
              if (v >= 60) return Math.floor(v / 60) + 'm';
              return v + 's';
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value: string) => (
              <span className="text-xs text-gray-400">{dbNames[value] || value}</span>
            )}
          />
          {dbIds.map((dbId, i) => (
            <Line
              key={dbId}
              type="monotone"
              dataKey={dbId}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              name={dbId}
              connectNulls
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
          ))}
          <Brush
            dataKey="time"
            height={30}
            stroke="rgba(0,212,255,0.3)"
            fill="rgba(0,0,0,0.5)"
            travellerWidth={8}
            startIndex={brushRange.startIndex}
            endIndex={brushRange.endIndex}
            onChange={handleBrushChange}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
