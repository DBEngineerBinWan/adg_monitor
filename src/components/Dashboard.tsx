import { useState, useEffect, useCallback, useRef } from 'react';
import { StandbyDatabase, StandbyStatus, HistoryRecord, AppSettings, HealthStatus } from '../types';
import {
  getDatabases, getStatuses, getSettings, saveSettings, saveDatabaseLocal,
  deleteDatabaseLocal, saveStatus, addHistory, getHistoryForDb, getHistory,
  simulateStandbyQuery, updateLastActivity, checkAuth, logout,
  loadDatabasesFromBackend, loadStatusesFromBackend, triggerBackendCollect,
  loadHistoryFromBackend, saveDatabaseToBackend, deleteDatabaseFromBackend,
  saveSettingsToBackend,
} from '../store';
import Header from './Header';
import StandbyCard from './StandbyCard';
import DetailModal from './DetailModal';
import SettingsModal from './SettingsModal';
import OverviewChart from './OverviewChart';
import DataTable from './DataTable';
import { RefreshCw, LayoutGrid, List, Search, X } from 'lucide-react';

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [databases, setDatabases] = useState<StandbyDatabase[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StandbyStatus>>({});
  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [allHistory, setAllHistory] = useState<HistoryRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'cards' | 'table'>('cards');
  const [healthFilter, setHealthFilter] = useState<HealthStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const collectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial data - supports backend persistent mode
  useEffect(() => {
    const loadData = async () => {
      const currentSettings = getSettings();
      if (currentSettings.useBackend && currentSettings.backendUrl) {
        // Backend persistent mode - load from Oracle database
        const dbs = await loadDatabasesFromBackend(currentSettings.backendUrl);
        setDatabases(dbs);
        const sts = await loadStatusesFromBackend(currentSettings.backendUrl);
        setStatuses(sts);
        const hist = await loadHistoryFromBackend(currentSettings.backendUrl);
        setAllHistory(hist);
      } else {
        // Local/simulation mode
        setDatabases(getDatabases());
        setStatuses(getStatuses());
        setAllHistory(getHistory());
      }
    };
    loadData();
  }, []);

  // Idle timeout check
  useEffect(() => {
    const handleActivity = () => updateLastActivity();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    idleTimerRef.current = setInterval(() => {
      if (!checkAuth()) {
        logout();
        onLogout();
      }
    }, 10000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [onLogout]);

  // Collection function - backend persistent or local simulation
  const collectData = useCallback(async () => {
    const dbs = getDatabases();
    const currentSettings = getSettings();
    if (dbs.length === 0 && !currentSettings.useBackend) return;

    setCollecting(true);

    if (currentSettings.useBackend && currentSettings.backendUrl) {
      // ===== Backend persistent mode =====
      // Trigger backend to collect and persist to Oracle
      await triggerBackendCollect(currentSettings.backendUrl);
      // Then load fresh data from backend
      const sts = await loadStatusesFromBackend(currentSettings.backendUrl);
      setStatuses(sts);
      const hist = await loadHistoryFromBackend(currentSettings.backendUrl);
      setAllHistory(hist);
      // Refresh database list too
      const freshDbs = await loadDatabasesFromBackend(currentSettings.backendUrl);
      setDatabases(freshDbs);
    } else {
      // ===== Simulation mode =====
      const enabledDbs = dbs.filter(d => d.enabled);
      enabledDbs.forEach(db => {
        const status = simulateStandbyQuery(db, currentSettings.collectionConfig);
        saveStatus(status);
        const record: HistoryRecord = {
          dbId: db.id,
          timestamp: status.lastChecked,
          applyLagSeconds: status.applyLagSeconds,
          transportLagSeconds: status.transportLagSeconds,
          mrpStatus: status.mrpStatus,
          healthStatus: status.healthStatus,
        };
        addHistory(record);
      });
      setStatuses(getStatuses());
      setAllHistory(getHistory());
    }

    setTimeout(() => setCollecting(false), 500);
  }, []);

  // Auto collection timer
  useEffect(() => {
    if (collectionTimerRef.current) {
      clearInterval(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }

    if (settings.collectionConfig.enabled && settings.collectionConfig.intervalSeconds >= 10) {
      collectData();
      collectionTimerRef.current = setInterval(
        collectData,
        settings.collectionConfig.intervalSeconds * 1000
      );
    }

    return () => {
      if (collectionTimerRef.current) clearInterval(collectionTimerRef.current);
    };
  }, [settings.collectionConfig.enabled, settings.collectionConfig.intervalSeconds, collectData]);

  // Auto refresh timer
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (settings.refreshInterval > 0) {
      refreshTimerRef.current = setInterval(() => {
        collectData();
      }, settings.refreshInterval * 1000);
    }

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [settings.refreshInterval, collectData]);

  const handleManualRefresh = () => {
    collectData();
  };

  const handleRefreshIntervalChange = (interval: number) => {
    const newSettings = { ...settings, refreshInterval: interval };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    // Also save to backend if in backend mode
    if (newSettings.useBackend && newSettings.backendUrl) {
      await saveSettingsToBackend(newSettings.backendUrl, newSettings);
    }
  };

  const handleSaveDatabase = async (db: StandbyDatabase) => {
    const currentSettings = getSettings();
    if (currentSettings.useBackend && currentSettings.backendUrl) {
      await saveDatabaseToBackend(currentSettings.backendUrl, db);
      const freshDbs = await loadDatabasesFromBackend(currentSettings.backendUrl);
      setDatabases(freshDbs);
    } else {
      saveDatabaseLocal(db);
      setDatabases(getDatabases());
    }
  };

  const handleDeleteDatabase = async (id: string) => {
    const currentSettings = getSettings();
    if (currentSettings.useBackend && currentSettings.backendUrl) {
      await deleteDatabaseFromBackend(currentSettings.backendUrl, id);
      const freshDbs = await loadDatabasesFromBackend(currentSettings.backendUrl);
      setDatabases(freshDbs);
      const sts = await loadStatusesFromBackend(currentSettings.backendUrl);
      setStatuses(sts);
      const hist = await loadHistoryFromBackend(currentSettings.backendUrl);
      setAllHistory(hist);
    } else {
      deleteDatabaseLocal(id);
      setDatabases(getDatabases());
      setStatuses(getStatuses());
      setAllHistory(getHistory());
    }
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  const selectedStatus = selectedDb ? statuses[selectedDb] : null;
  // For detail modal, load specific db history
  const [selectedHistory, setSelectedHistory] = useState<HistoryRecord[]>([]);
  useEffect(() => {
    if (!selectedDb) {
      setSelectedHistory([]);
      return;
    }
    const loadSelectedHist = async () => {
      const currentSettings = getSettings();
      if (currentSettings.useBackend && currentSettings.backendUrl) {
        const hist = await loadHistoryFromBackend(currentSettings.backendUrl, selectedDb, 48);
        setSelectedHistory(hist);
      } else {
        setSelectedHistory(getHistoryForDb(selectedDb));
      }
    };
    loadSelectedHist();
  }, [selectedDb]);

  const dbNames: Record<string, string> = {};
  databases.forEach(db => { dbNames[db.id] = db.name; });

  const statusList = Object.values(statuses);
  const greenCount = statusList.filter(s => s.healthStatus === 'green').length;
  const yellowCount = statusList.filter(s => s.healthStatus === 'yellow').length;
  const redCount = statusList.filter(s => s.healthStatus === 'red').length;

  return (
    <div className="min-h-screen" style={{
      background: 'linear-gradient(135deg, #0a0e27 0%, #0d1b3e 30%, #0a1628 60%, #060b1a 100%)',
    }}>
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,212,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.4) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent 70%)' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #7b61ff, transparent 70%)' }} />
      </div>

      <div className="relative z-10">
        <Header
          settings={settings}
          statuses={statuses}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettings(true)}
          onManualRefresh={handleManualRefresh}
          onRefreshIntervalChange={handleRefreshIntervalChange}
          collecting={collecting}
        />

        {/* Tab bar */}
        <div className="px-6" style={{
          background: 'linear-gradient(180deg, rgba(10,14,39,0.8), rgba(13,27,62,0.5))',
          borderBottom: '1px solid rgba(0,212,255,0.08)',
        }}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('cards')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all ${
                activeTab === 'cards'
                  ? 'text-cyan-400 bg-cyan-400/10 border-b-2 border-cyan-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              卡片概览
            </button>
            <button
              onClick={() => setActiveTab('table')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all ${
                activeTab === 'table'
                  ? 'text-cyan-400 bg-cyan-400/10 border-b-2 border-cyan-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <List className="w-4 h-4" />
              延时表格
            </button>
          </div>
        </div>

        <main className="px-6 py-5">
          {/* Title section */}
          <div className="mb-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-cyan-400 flex items-center gap-2">
                  <span className="w-1 h-5 rounded-full bg-cyan-400" />
                  DataGuard 数据库状态概览
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-6 text-sm">
                  {(['green', 'yellow', 'red'] as HealthStatus[]).map(status => {
                    const count = status === 'green' ? greenCount : status === 'yellow' ? yellowCount : redCount;
                    const colors: Record<HealthStatus, { dot: string; text: string; label: string }> = {
                      green:  { dot: 'bg-green-500 shadow-green-500/30',  text: 'text-green-400',  label: '正常' },
                      yellow: { dot: 'bg-yellow-500 shadow-yellow-500/30', text: 'text-yellow-400', label: '警告' },
                      red:    { dot: 'bg-red-500 shadow-red-500/30',    text: 'text-red-400',    label: '异常' },
                    };
                    const c = colors[status];
                    const isActive = healthFilter === status;
                    return (
                      <button
                        key={status}
                        onClick={() => setHealthFilter(isActive ? null : status)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                          isActive ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full ${c.dot} shadow-lg`} />
                        <span className="text-gray-400">{c.label}</span>
                        <span className={`text-xl font-bold font-mono ${c.text}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索备库名称..."
                    className="w-48 pl-8 pr-8 py-2 rounded-lg text-sm text-white outline-none transition-all focus:ring-1 focus:ring-cyan-500/50"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={handleManualRefresh}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105"
                  style={{
                    background: 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(123,97,255,0.15))',
                    border: '1px solid rgba(0,212,255,0.2)',
                    color: '#00d4ff',
                  }}
                >
                  <RefreshCw className={`w-4 h-4 ${collecting ? 'animate-spin' : ''}`} />
                  {settings.useBackend ? '采集 & 刷新' : '查询全部'}
                </button>
              </div>
            </div>
          </div>

          {/* Content: cards or table */}
          {activeTab === 'cards' && (
            databases.length === 0 && Object.keys(statuses).length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-4 opacity-20">🗄️</div>
                <p className="text-gray-400 text-lg mb-2">尚未添加任何备库</p>
                <p className="text-gray-500 text-sm mb-4">点击右上角设置按钮添加Oracle备库信息</p>
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #0891b2, #6366f1)' }}
                >
                  添加备库
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 mb-6">
                {databases.filter(d => d.enabled).filter(db => {
                  const s = statuses[db.id];
                  if (healthFilter && s && s.healthStatus !== healthFilter) return false;
                  if (searchQuery && !db.name.toLowerCase().includes(searchQuery.toLowerCase())
                    && !db.host.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                  return true;
                }).sort((a, b) => {
                  const order = { red: 0, yellow: 1, green: 2 };
                  const sa = statuses[a.id];
                  const sb = statuses[b.id];
                  return (order[sa?.healthStatus as keyof typeof order] ?? 3) - (order[sb?.healthStatus as keyof typeof order] ?? 3);
                }).map(db => {
                  const status = statuses[db.id];
                  if (!status) {
                    return (
                      <div key={db.id} className="rounded-xl p-4 flex items-center justify-center" style={{
                        background: 'linear-gradient(135deg, rgba(13,27,62,0.6), rgba(10,22,40,0.8))',
                        border: '1px solid rgba(255,255,255,0.05)',
                        minHeight: '200px',
                      }}>
                        <div className="text-center text-gray-500 text-sm">
                          <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin opacity-30" />
                          <p>{db.name}</p>
                          <p className="text-xs">等待采集...</p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <StandbyCard
                      key={db.id}
                      status={status}
                      onClick={() => setSelectedDb(db.id)}
                    />
                  );
                })}
              </div>
            )
          )}

          {activeTab === 'table' && (
            <div className="mb-6">
              <DataTable
                databases={databases}
                statuses={statuses}
                healthFilter={healthFilter}
                searchQuery={searchQuery}
                onSelectDb={(id) => setSelectedDb(id)}
              />
            </div>
          )}

          {/* Overview trend chart */}
          {allHistory.length > 0 && (
            <div className="mb-6">
              <OverviewChart
                history={allHistory}
                statuses={statuses}
                dbNames={dbNames}
              />
            </div>
          )}

          {/* Footer info */}
          <div className="text-center py-4">
            <p className="text-[10px] text-gray-700">
              Oracle DataGuard ADG 监控平台
            </p>
          </div>
        </main>
      </div>

      {/* Detail Modal */}
      {selectedStatus && (
        <DetailModal
          status={selectedStatus}
          history={selectedHistory}
          onClose={() => setSelectedDb(null)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          databases={databases}
          onSaveSettings={handleSaveSettings}
          onSaveDatabase={handleSaveDatabase}
          onDeleteDatabase={handleDeleteDatabase}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
