import { useState, useEffect } from 'react';
import { AppSettings, StandbyStatus } from '../types';
import { useTheme } from '../utils/theme';
import StatusDot from './StatusDot';
import { Database, LogOut, Settings, RefreshCw, Clock, Activity, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  settings: AppSettings;
  statuses: Record<string, StandbyStatus>;
  onLogout: () => void;
  onOpenSettings: () => void;
  onManualRefresh: () => void;
  onRefreshIntervalChange: (interval: number) => void;
  collecting: boolean;
}

export default function Header({
  settings,
  statuses,
  onLogout,
  onOpenSettings,
  onManualRefresh,
  onRefreshIntervalChange,
  collecting,
}: HeaderProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const statusList = Object.values(statuses);
  const greenCount = statusList.filter(s => s.healthStatus === 'green').length;
  const yellowCount = statusList.filter(s => s.healthStatus === 'yellow').length;
  const redCount = statusList.filter(s => s.healthStatus === 'red').length;

  const refreshOptions = [
    { label: '手动刷新', value: 0 },
    { label: '10秒', value: 10 },
    { label: '30秒', value: 30 },
    { label: '1分钟', value: 60 },
    { label: '5分钟', value: 300 },
    { label: '10分钟', value: 600 },
  ];

  return (
    <header className="relative z-20">
      <div className="px-4 py-2"
        style={{
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-card)',
        }}>
        {/* Top status bar */}
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1 px-1">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <StatusDot status="green" size="sm" />
              监控中
            </span>
            <span>备库总数: <span className="text-cyan-400 font-mono">{statusList.length}</span></span>
            <span>
              <span className="text-green-400">●</span> 正常: {greenCount} |{' '}
              <span className="text-yellow-400">●</span> 警告: {yellowCount} |{' '}
              <span className="text-red-400">●</span> 异常: {redCount}
            </span>
            {settings.collectionConfig.enabled && (
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-cyan-400" />
                采集间隔: {settings.collectionConfig.intervalSeconds}秒
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-3 h-3" />
            <span className="font-mono">{currentTime.toLocaleString('zh-CN', { hour12: false })}</span>
          </div>
        </div>

        {/* Main header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(123,97,255,0.2))',
                border: '1px solid rgba(0,212,255,0.3)',
                boxShadow: '0 0 15px rgba(0,212,255,0.15)',
              }}>
              <Database className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide"
                style={{ textShadow: '0 0 15px rgba(0,212,255,0.4)' }}>
                Oracle DataGuard 监控系统
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh interval selector */}
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg"
              style={{
                background: 'var(--bg-surface-dim)',
                border: '1px solid var(--border-default)',
              }}>
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${collecting ? 'animate-spin' : ''}`} />
              <select
                value={settings.refreshInterval}
                onChange={(e) => onRefreshIntervalChange(parseInt(e.target.value))}
                className="bg-transparent text-sm text-gray-300 outline-none cursor-pointer"
                style={{ WebkitAppearance: 'none' }}
              >
                {refreshOptions.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-gray-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Manual refresh button */}
            <button
              onClick={onManualRefresh}
              className="p-2 rounded-lg text-gray-400 hover:text-cyan-400 transition-all duration-200 hover:scale-105"
              style={{
                background: 'var(--bg-surface-dim)',
                border: '1px solid var(--border-default)',
              }}
              title="手动刷新"
            >
              <RefreshCw className={`w-4 h-4 ${collecting ? 'animate-spin' : ''}`} />
            </button>

            {/* Settings button */}
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-gray-400 hover:text-cyan-400 transition-all duration-200 hover:scale-105"
              style={{
                background: 'var(--bg-surface-dim)',
                border: '1px solid var(--border-default)',
              }}
              title="设置"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-400 hover:text-cyan-400 transition-all duration-200 hover:scale-105"
              style={{
                background: 'var(--bg-surface-dim)',
                border: '1px solid var(--border-default)',
              }}
              title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Logout button */}
            <button
              onClick={onLogout}
              className="p-2 rounded-lg text-gray-400 hover:text-red-400 transition-all duration-200 hover:scale-105"
              style={{
                background: 'var(--bg-surface-dim)',
                border: '1px solid rgba(255,100,100,0.15)',
              }}
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
