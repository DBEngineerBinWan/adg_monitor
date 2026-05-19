import { StandbyStatus, HealthStatus } from '../types';
import { formatLag } from '../store';
import { Server, Clock } from 'lucide-react';

interface DataTableProps {
  databases: { id: string; name: string; host: string; enabled: boolean }[];
  statuses: Record<string, StandbyStatus>;
  healthFilter: HealthStatus | null;
  searchQuery: string;
  onSelectDb: (dbId: string) => void;
}

const statusOrder: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 };

const statusConfig: Record<HealthStatus, { bg: string; text: string; dot: string }> = {
  green:  { bg: 'rgba(34,197,94,0.1)',  text: 'text-green-400',  dot: 'bg-green-500' },
  yellow: { bg: 'rgba(234,179,8,0.1)',  text: 'text-yellow-400', dot: 'bg-yellow-500' },
  red:    { bg: 'rgba(239,68,68,0.1)',  text: 'text-red-400',    dot: 'bg-red-500' },
};

export default function DataTable({ databases, statuses, healthFilter, searchQuery, onSelectDb }: DataTableProps) {
  const entries = databases
    .filter(d => d.enabled)
    .map(d => ({ db: d, status: statuses[d.id] }))
    .filter(e => e.status)
    .filter(e => !healthFilter || e.status.healthStatus === healthFilter)
    .filter(e => !searchQuery || e.db.name.toLowerCase().includes(searchQuery.toLowerCase())
      || e.db.host.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const oa = statusOrder[a.status.healthStatus] ?? 3;
      const ob = statusOrder[b.status.healthStatus] ?? 3;
      return oa - ob;
    });

  const getStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      'APPLYING_LOG': '正在应用日志',
      'WAIT_FOR_LOG': '等待日志',
      'WAIT_FOR_GAP': '等待GAP',
      'NOT_FOUND': 'MRP未运行',
    };
    return labels[s] || s;
  };

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        {healthFilter ? '没有匹配的备库' : '暂无数据'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl" style={{
      background: 'var(--bg-card-alt)',
      border: '1px solid var(--border-default)',
    }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
            <Th>DB名称</Th>
            <Th>主机地址</Th>
            <Th>角色</Th>
            <Th>MRP状态</Th>
            <Th>应用延时</Th>
            <Th>传输延时</Th>
            <Th>健康</Th>
            <Th>异常原因</Th>
            <Th>最后检查</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ db, status }) => {
            const cfg = statusConfig[status.healthStatus];
            return (
              <tr
                key={db.id}
                onClick={() => onSelectDb(db.id)}
                className="cursor-pointer transition-colors hover:bg-white/5"
                style={{ borderBottom: '1px solid var(--border-white-subtle)' }}
              >
                <Td>
                  <div className="flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="font-semibold text-white">{status.dbName}</span>
                  </div>
                </Td>
                <Td className="font-mono text-gray-400">{status.host}:{status.port}</Td>
                <Td>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-cyan-500/10 text-cyan-400">
                    {status.databaseInfo.databaseRole}
                  </span>
                </Td>
                <Td>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                    {getStatusLabel(status.mrpStatus)}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-gray-500" />
                    <span className={`font-mono font-semibold ${
                      status.applyLagSeconds < 300 ? 'text-green-400' :
                      status.applyLagSeconds < 1800 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {formatLag(status.applyLagSeconds)}
                    </span>
                  </div>
                </Td>
                <Td className="font-mono text-gray-300">{formatLag(status.transportLagSeconds)}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className={`text-xs font-semibold ${cfg.text}`}>
                      {status.healthStatus === 'green' ? '正常' :
                       status.healthStatus === 'yellow' ? '警告' : '异常'}
                    </span>
                  </div>
                </Td>
                <Td className="text-xs max-w-[200px] truncate" title={status.error || ''}>
                  {status.error ? (
                    <span className="text-red-400/80">{status.error}</span>
                  ) : (
                    <span className="text-gray-600">-</span>
                  )}
                </Td>
                <Td className="text-gray-500 text-xs">
                  {new Date(status.lastChecked).toLocaleTimeString('zh-CN', { hour12: false })}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`py-2.5 px-4 ${className}`}>
      {children}
    </td>
  );
}
