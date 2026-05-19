import { StandbyStatus } from '../types';
import { formatLag } from '../store';
import { Server, Activity, Clock, AlertTriangle, CheckCircle, XCircle, Eye } from 'lucide-react';

interface StandbyCardProps {
  status: StandbyStatus;
  onClick: () => void;
}

const statusColors = {
  green: {
    border: 'rgba(34,197,94,0.4)',
    glow: 'rgba(34,197,94,0.15)',
    badge: 'bg-green-500',
    text: 'text-green-400',
    icon: CheckCircle,
  },
  yellow: {
    border: 'rgba(234,179,8,0.4)',
    glow: 'rgba(234,179,8,0.15)',
    badge: 'bg-yellow-500',
    text: 'text-yellow-400',
    icon: AlertTriangle,
  },
  red: {
    border: 'rgba(239,68,68,0.4)',
    glow: 'rgba(239,68,68,0.15)',
    badge: 'bg-red-500',
    text: 'text-red-400',
    icon: XCircle,
  },
};

export default function StandbyCard({ status, onClick }: StandbyCardProps) {
  const colors = statusColors[status.healthStatus];
  const StatusIcon = colors.icon;

  const getMrpStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      'APPLYING_LOG': '正在应用日志',
      'WAIT_FOR_LOG': '等待日志',
      'WAIT_FOR_GAP': '等待GAP',
      'IDLE': '空闲',
      'ERROR': '错误',
      'NOT_FOUND': 'MRP未运行',
      'UNUSED': '未使用',
      'ALLOCATED': '已分配',
      'CONNECTED': '已连接',
      'ATTACHED': '已附加',
      'OPENING': '正在打开',
      'CLOSING': '正在关闭',
      'WRITING': '正在写入',
      'RECEIVING': '正在接收',
      'ANNOUNCING': '正在通告',
      'REGISTERING': '正在注册',
    };
    return labels[s] || s;
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 group"
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${colors.border}`,
        boxShadow: `0 4px 20px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.03)`,
      }}
    >
      {/* Top status indicator bar */}
      <div className="h-1 w-full" style={{
        background: status.healthStatus === 'green'
          ? 'linear-gradient(90deg, #22c55e, #10b981)'
          : status.healthStatus === 'yellow'
          ? 'linear-gradient(90deg, #eab308, #f59e0b)'
          : 'linear-gradient(90deg, #ef4444, #dc2626)',
      }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Server className={`w-4 h-4 ${colors.text}`} />
            <h3 className="text-white font-bold text-base">{status.dbName}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusIcon className={`w-4 h-4 ${colors.text}`} />
            <div className={`w-2.5 h-2.5 rounded-full ${colors.badge} ${status.healthStatus === 'green' ? 'animate-pulse' : status.healthStatus === 'red' ? 'animate-pulse' : ''}`} />
          </div>
        </div>

        {/* Connection info */}
        <div className="text-xs text-gray-500 mb-3 space-y-0.5 font-mono">
          <div>{status.host}:{status.port}</div>
          <div className="text-gray-400">{status.databaseInfo.openMode}</div>
        </div>

        {/* MRP Status */}
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">MRP状态:</span>
          <span className={`text-xs font-semibold ${colors.text}`}>
            {getMrpStatusLabel(status.mrpStatus)}
          </span>
        </div>

        {/* Apply Lag */}
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">应用延时:</span>
          <span className={`text-xs font-mono font-semibold ${
            status.applyLagSeconds < 300 ? 'text-green-400' :
            status.applyLagSeconds < 1800 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {formatLag(status.applyLagSeconds)}
          </span>
        </div>

        {/* Transport Lag */}
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">传输延时:</span>
          <span className="text-xs font-mono text-gray-300">
            {formatLag(status.transportLagSeconds)}
          </span>
        </div>

        {/* Error message */}
        {status.error && (
          <div className="mb-3 px-2 py-1.5 rounded-lg text-xs text-red-400 bg-red-500/10 border border-red-500/20">
            {status.error}
          </div>
        )}

        {/* Last checked */}
        <div className="text-[10px] text-gray-600 mb-3">
          上次检查: {new Date(status.lastChecked).toLocaleTimeString('zh-CN', { hour12: false })}
        </div>

        {/* View details button */}
        <button
          className="w-full py-2 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 group-hover:scale-[1.02]"
          style={{
            background: 'linear-gradient(135deg, var(--accent-cyan-light), var(--accent-purple-light))',
            border: '1px solid var(--border-strong)',
            color: 'var(--accent-primary)',
          }}
        >
          <Eye className="w-3.5 h-3.5" />
          查看详情
        </button>
      </div>
    </div>
  );
}
