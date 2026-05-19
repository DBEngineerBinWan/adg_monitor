import { useState, useMemo, useCallback, useRef } from 'react';
import { HistoryRecord } from '../types';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush, ReferenceLine
} from 'recharts';
import { formatLag } from '../store';
import { useChartTheme } from '../utils/useChartTheme';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface TrendChartProps {
  history: HistoryRecord[];
  dbName: string;
}

export default function TrendChart({ history, dbName }: TrendChartProps) {
  const [brushRange, setBrushRange] = useState<{ startIndex?: number; endIndex?: number }>({});
  const [chartKey, setChartKey] = useState(0);
  const btnZoomRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const c = useChartTheme();

  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    return [...history].reverse().map(h => ({
      timestamp: h.timestamp,
      time: new Date(h.timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      fullTime: new Date(h.timestamp).toLocaleString('zh-CN', { hour12: false }),
      applyLag: h.applyLagSeconds,
      transportLag: h.transportLagSeconds,
      status: h.healthStatus,
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
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        <div className="text-center">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>暂无历史数据</p>
          <p className="text-xs text-gray-600 mt-1">开始采集后将显示趋势图</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg p-3 text-xs" style={{
          background: c.tooltipBg,
          border: `1px solid ${c.tooltipBorder}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <p className="text-gray-400 mb-1.5 font-mono">{payload[0]?.payload?.fullTime}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: c.applyStroke }} />
              <span className="text-gray-400">应用延时:</span>
              <span className="font-bold font-mono" style={{ color: c.applyStroke }}>{formatLag(payload[0]?.value || 0)}</span>
            </div>
            {payload[1] && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c.transportStroke }} />
                <span className="text-gray-400">传输延时:</span>
                <span className="font-bold font-mono" style={{ color: c.transportStroke }}>{formatLag(payload[1]?.value || 0)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div ref={containerRef}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          {dbName} · 共 {chartData.length} 条记录
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all"
            title="重置"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} key={chartKey}>
          <defs>
            <linearGradient id={`applyGrad_${dbName}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={c.applyStopColor1} stopOpacity={1} />
              <stop offset="95%" stopColor={c.applyStopColor2} stopOpacity={1} />
            </linearGradient>
            <linearGradient id={`transportGrad_${dbName}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={c.transportStopColor1} stopOpacity={1} />
              <stop offset="95%" stopColor={c.transportStopColor2} stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={c.gridStroke} />
          <XAxis
            dataKey="time"
            tick={{ fill: c.axisTickFill, fontSize: 10 }}
            tickLine={{ stroke: c.axisLineStroke }}
            axisLine={{ stroke: c.axisLineStroke }}
          />
          <YAxis
            tick={{ fill: c.axisTickFill, fontSize: 10 }}
            tickLine={{ stroke: c.axisLineStroke }}
            axisLine={{ stroke: c.axisLineStroke }}
            tickFormatter={(v) => {
              if (v >= 3600) return Math.floor(v / 3600) + 'h';
              if (v >= 60) return Math.floor(v / 60) + 'm';
              return v + 's';
            }}
            label={{ value: '延时(秒)', angle: -90, position: 'insideLeft', fill: c.axisTickFill, fontSize: 10 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={300} stroke={c.warningLineStroke} strokeDasharray="5 5" label={{ value: '警告线', fill: '#eab308', fontSize: 10, position: 'right' }} />
          <ReferenceLine y={1800} stroke={c.dangerLineStroke} strokeDasharray="5 5" label={{ value: '危险线', fill: '#ef4444', fontSize: 10, position: 'right' }} />
          <Area
            type="monotone"
            dataKey="applyLag"
            stroke={c.applyStroke}
            strokeWidth={2}
            fill={`url(#applyGrad_${dbName})`}
            name="应用延时"
            dot={false}
            activeDot={{ r: 4, stroke: c.applyStroke, strokeWidth: 2, fill: c.activeDotFill }}
          />
          <Line
            type="monotone"
            dataKey="transportLag"
            stroke={c.transportStroke}
            strokeWidth={1.5}
            dot={false}
            name="传输延时"
            activeDot={{ r: 3, stroke: c.transportStroke, strokeWidth: 2, fill: c.activeDotFill }}
          />
          <Brush
            dataKey="time"
            height={30}
            stroke={c.brushStroke}
            fill={c.brushFill}
            travellerWidth={8}
            startIndex={brushRange.startIndex}
            endIndex={brushRange.endIndex}
            onChange={handleBrushChange}
          >
            <ComposedChart>
              <Area
                type="monotone"
                dataKey="applyLag"
                stroke={c.applyStroke}
                fill={c.accentBg}
                strokeWidth={1}
                dot={false}
              />
            </ComposedChart>
          </Brush>
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-2 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-cyan-400" />
          应用延时 (Apply Lag)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-full bg-purple-400" />
          传输延时 (Transport Lag)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-t border-dashed border-yellow-500" />
          警告阈值
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 border-t border-dashed border-red-500" />
          危险阈值
        </div>
      </div>
    </div>
  );
}

function Activity(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  );
}
