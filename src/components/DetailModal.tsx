import { StandbyStatus, HistoryRecord } from '../types';
import { formatLag } from '../store';
import { X, Server, Database, Activity, Clock, Shield, TrendingUp } from 'lucide-react';
import TrendChart from './TrendChart';

interface DetailModalProps {
  status: StandbyStatus;
  history: HistoryRecord[];
  historyHours: number;
  onHistoryHoursChange: (hours: number) => void;
  onClose: () => void;
}

export default function DetailModal({ status, history, historyHours, onHistoryHoursChange, onClose }: DetailModalProps) {
  const getMrpStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      'APPLYING_LOG': '正在应用日志 (APPLYING_LOG)',
      'WAIT_FOR_LOG': '等待日志 (WAIT_FOR_LOG)',
      'WAIT_FOR_GAP': '等待GAP (WAIT_FOR_GAP)',
      'IDLE': '空闲 (IDLE)',
      'ERROR': '错误 (ERROR)',
      'NOT_FOUND': 'MRP进程未找到',
      'UNUSED': '未使用 (UNUSED)',
      'ALLOCATED': '已分配 (ALLOCATED)',
      'CONNECTED': '已连接 (CONNECTED)',
      'ATTACHED': '已附加 (ATTACHED)',
      'OPENING': '正在打开 (OPENING)',
      'CLOSING': '正在关闭 (CLOSING)',
      'WRITING': '正在写入 (WRITING)',
      'RECEIVING': '正在接收 (RECEIVING)',
      'ANNOUNCING': '正在通告 (ANNOUNCING)',
      'REGISTERING': '正在注册 (REGISTERING)',
    };
    return labels[s] || s;
  };

  const statusColor = status.healthStatus === 'green' ? '#22c55e' :
    status.healthStatus === 'yellow' ? '#eab308' : '#ef4444';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(135deg, rgba(10,14,39,0.98), rgba(13,27,62,0.95))',
          border: '1px solid rgba(0,212,255,0.2)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(0,212,255,0.1)',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-5 rounded-t-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(10,14,39,0.98), rgba(13,27,62,0.95))',
            borderBottom: '1px solid rgba(0,212,255,0.1)',
          }}>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />
            <Server className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">{status.dbName} - 详细信息</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Database Info - V$DATABASE */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(0,212,255,0.1)',
          }}>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                数据库信息 (V$DATABASE)
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <InfoItem label="DB_UNIQUE_NAME" value={status.databaseInfo.dbUniqueName} />
              <InfoItem label="DATABASE_ROLE" value={status.databaseInfo.databaseRole} />
              <InfoItem label="OPEN_MODE" value={status.databaseInfo.openMode} />
              <InfoItem label="PROTECTION_MODE" value={status.databaseInfo.protectionMode} />
              <InfoItem label="SWITCHOVER_STATUS" value={status.databaseInfo.switchoverStatus} />
              <InfoItem label="连接信息" value={`${status.host}:${status.port}/${status.serviceName}`} />
            </div>
          </div>

          {/* MRP Status - V$MANAGED_STANDBY */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(0,212,255,0.1)',
          }}>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                管理进程 (V$MANAGED_STANDBY)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-white/5">
                    <th className="text-left py-2 px-2 font-semibold">PROCESS</th>
                    <th className="text-left py-2 px-2 font-semibold">PID</th>
                    <th className="text-left py-2 px-2 font-semibold">STATUS</th>
                    <th className="text-left py-2 px-2 font-semibold">CLIENT_PROCESS</th>
                    <th className="text-left py-2 px-2 font-semibold">THREAD#</th>
                    <th className="text-left py-2 px-2 font-semibold">SEQUENCE#</th>
                    <th className="text-left py-2 px-2 font-semibold">BLOCK#</th>
                    <th className="text-left py-2 px-2 font-semibold">BLOCKS</th>
                    <th className="text-left py-2 px-2 font-semibold">DELAY_MINS</th>
                  </tr>
                </thead>
                <tbody>
                  {status.mrpProcesses.map((proc, i) => (
                    <tr key={i} className="border-b border-white/3 hover:bg-white/5 transition-colors">
                      <td className={`py-1.5 px-2 font-mono font-bold ${proc.process === 'MRP0' ? 'text-cyan-400' : 'text-gray-300'}`}>
                        {proc.process}
                      </td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.pid}</td>
                      <td className="py-1.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          proc.status === 'APPLYING_LOG' ? 'bg-green-500/20 text-green-400' :
                          proc.status === 'WAIT_FOR_LOG' ? 'bg-blue-500/20 text-blue-400' :
                          proc.status === 'IDLE' ? 'bg-gray-500/20 text-gray-400' :
                          proc.status === 'CONNECTED' ? 'bg-purple-500/20 text-purple-400' :
                          proc.status === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {proc.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.clientProcess}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.thread}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.sequence}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.block}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.blocks}</td>
                      <td className="py-1.5 px-2 font-mono text-gray-400">{proc.delayMins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-gray-500">MRP综合状态:</span>
              <span className={`text-xs font-bold ${
                status.healthStatus === 'green' ? 'text-green-400' :
                status.healthStatus === 'yellow' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {getMrpStatusLabel(status.mrpStatus)}
              </span>
            </div>
          </div>

          {/* DataGuard Stats - V$DATAGUARD_STATS */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(0,212,255,0.1)',
          }}>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                DataGuard 统计 (V$DATAGUARD_STATS)
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {status.dataguardStats.map((stat, i) => (
                <div key={i} className="rounded-lg p-3" style={{
                  background: 'rgba(0,212,255,0.05)',
                  border: '1px solid rgba(0,212,255,0.08)',
                }}>
                  <div className="text-[10px] text-gray-500 uppercase mb-1">{stat.name}</div>
                  <div className="text-sm font-mono font-bold text-white">{stat.value}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{stat.unit}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="rounded-lg p-3" style={{
                background: status.applyLagSeconds < 300 ? 'rgba(34,197,94,0.1)' :
                  status.applyLagSeconds < 1800 ? 'rgba(234,179,8,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${status.applyLagSeconds < 300 ? 'rgba(34,197,94,0.2)' :
                  status.applyLagSeconds < 1800 ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">应用延时</span>
                </div>
                <div className={`text-2xl font-bold font-mono mt-1 ${
                  status.applyLagSeconds < 300 ? 'text-green-400' :
                  status.applyLagSeconds < 1800 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {formatLag(status.applyLagSeconds)}
                </div>
              </div>
              <div className="rounded-lg p-3" style={{
                background: 'rgba(0,212,255,0.05)',
                border: '1px solid rgba(0,212,255,0.1)',
              }}>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">传输延时</span>
                </div>
                <div className="text-2xl font-bold font-mono mt-1 text-cyan-400">
                  {formatLag(status.transportLagSeconds)}
                </div>
              </div>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(0,212,255,0.1)',
          }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                  延时趋势图
                </h3>
                <span className="text-xs text-gray-500">({history.length} 条记录)</span>
              </div>
              <div className="flex items-center gap-1">
                {[{ label: '1小时', h: 1 }, { label: '6小时', h: 6 }, { label: '24小时', h: 24 }, { label: '48小时', h: 48 }, { label: '7天', h: 168 }, { label: '30天', h: 720 }].map(opt => (
                  <button
                    key={opt.h}
                    onClick={() => onHistoryHoursChange(opt.h)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      historyHours === opt.h
                        ? 'text-cyan-400 bg-cyan-400/10 border border-cyan-400/30'
                        : 'text-gray-500 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart history={history} dbName={status.dbName} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{
      background: 'rgba(0,212,255,0.03)',
      border: '1px solid rgba(0,212,255,0.06)',
    }}>
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-xs font-mono text-white font-semibold truncate" title={value}>{value}</div>
    </div>
  );
}
