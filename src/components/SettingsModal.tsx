import { useState, useEffect } from 'react';
import { AppSettings, StandbyDatabase } from '../types';
import { generateId, getPassword, setPassword, testConnectionViaBackend, getSettings, changePasswordViaBackend } from '../store';
import { X, Plus, Trash2, Settings, Database, Shield, Clock, Save, Server, Edit2, Wifi, CheckCircle, XCircle, Loader2, Globe, HardDrive, BarChart3 } from 'lucide-react';

interface SettingsModalProps {
  settings: AppSettings;
  databases: StandbyDatabase[];
  onSaveSettings: (settings: AppSettings) => void;
  onSaveDatabase: (db: StandbyDatabase) => void;
  onDeleteDatabase: (id: string) => void;
  onClose: () => void;
}

export default function SettingsModal({
  settings,
  databases,
  onSaveSettings,
  onSaveDatabase,
  onDeleteDatabase,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'databases' | 'collection' | 'backend' | 'security'>('databases');
  const [editingDb, setEditingDb] = useState<StandbyDatabase | null>(null);
  const [localSettings, setLocalSettings] = useState(settings);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  
  // Connection test state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  // Backend test state
  const [testingBackend, setTestingBackend] = useState(false);
  const [backendResult, setBackendResult] = useState<{
    success: boolean;
    message: string;
    tables?: any[];
  } | null>(null);

  // History stats
  const [historyStats, setHistoryStats] = useState<any>(null);

  const tabs = [
    { key: 'databases' as const, label: '备库管理', icon: Database },
    { key: 'collection' as const, label: '采集配置', icon: Clock },
    { key: 'backend' as const, label: '后端配置', icon: Globe },
    { key: 'security' as const, label: '安全设置', icon: Shield },
  ];

  // Load history stats when backend tab is active
  useEffect(() => {
    if (activeTab === 'backend' && localSettings.useBackend && localSettings.backendUrl) {
      fetchHistoryStats();
    }
  }, [activeTab]);

  const fetchHistoryStats = async () => {
    try {
      const resp = await fetch(`${localSettings.backendUrl}/api/history/stats`);
      const data = await resp.json();
      if (data.success) {
        setHistoryStats(data);
      }
    } catch {}
  };

  const handleSaveDb = () => {
    if (!editingDb) return;
    if (!editingDb.name || !editingDb.host || !editingDb.serviceName || !editingDb.username) {
      alert('请填写所有必填字段');
      return;
    }
    onSaveDatabase(editingDb);
    setEditingDb(null);
    setConnectionResult(null);
  };

  const handleNewDb = () => {
    setEditingDb({
      id: generateId(),
      name: '',
      host: '',
      port: 1521,
      serviceName: '',
      username: 'monitor',
      password: '',
      enabled: true,
      createdAt: Date.now(),
    });
    setConnectionResult(null);
  };

  const handleTestConnection = async () => {
    if (!editingDb) return;
    if (!editingDb.host || !editingDb.serviceName || !editingDb.username || !editingDb.password) {
      setConnectionResult({
        success: false,
        message: '请先填写完整的连接信息（主机、服务名、用户名、密码）',
      });
      return;
    }

    const currentSettings = getSettings();
    if (!currentSettings.useBackend || !currentSettings.backendUrl) {
      setConnectionResult({
        success: false,
        message: '请先在"后端配置"页签中启用后端模式并填写后端地址',
      });
      return;
    }

    setTestingConnection(true);
    setConnectionResult(null);

    try {
      const result = await testConnectionViaBackend(currentSettings.backendUrl, {
        host: editingDb.host,
        port: editingDb.port,
        serviceName: editingDb.serviceName,
        username: editingDb.username,
        password: editingDb.password,
      });
      setConnectionResult(result);
    } catch (err: any) {
      setConnectionResult({
        success: false,
        message: err.message || '测试失败',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestBackend = async () => {
    if (!localSettings.backendUrl) {
      setBackendResult({ success: false, message: '请填写后端地址' });
      return;
    }

    setTestingBackend(true);
    setBackendResult(null);

    try {
      // Test health
      const healthResp = await fetch(`${localSettings.backendUrl}/api/health`);
      const healthData = await healthResp.json();

      if (healthData.status !== 'ok') {
        setBackendResult({ success: false, message: '后端服务异常' });
        return;
      }

      // Test local db
      const dbResp = await fetch(`${localSettings.backendUrl}/api/test_local_db`);
      const dbData = await dbResp.json();

      setBackendResult({
        success: dbData.success,
        message: dbData.success
          ? `后端连接正常! Oracle模块: ${healthData.oracle_module}, 本地数据库: ${dbData.dsn || 'OK'}`
          : `后端服务正常，但本地数据库连接失败: ${dbData.message}`,
        tables: dbData.tables || [],
      });
    } catch (err: any) {
      setBackendResult({
        success: false,
        message: `无法连接到后端: ${err.message}`,
      });
    } finally {
      setTestingBackend(false);
    }
  };

  const handleCleanupHistory = async () => {
    if (!localSettings.backendUrl) return;
    const days = prompt('清理多少天前的历史数据？', '30');
    if (!days) return;
    try {
      const resp = await fetch(`${localSettings.backendUrl}/api/history/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_days: parseInt(days) }),
      });
      const data = await resp.json();
      alert(data.message || '清理完成');
      fetchHistoryStats();
    } catch (err: any) {
      alert(`清理失败: ${err.message}`);
    }
  };

  const handleSaveSettings = () => {
    if (localSettings.collectionConfig.intervalSeconds < 10) {
      alert('采集间隔最低10秒');
      return;
    }
    onSaveSettings({ ...localSettings, useBackend: true });
  };

  const handleChangePassword = async () => {
    if (!oldPassword) {
      setPasswordMsg('请输入当前密码');
      return;
    }
    if (!newPassword) {
      setPasswordMsg('请输入新密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg('两次密码输入不一致');
      return;
    }
    if (newPassword.length < 4) {
      setPasswordMsg('新密码至少4位');
      return;
    }

    setChangingPassword(true);
    setPasswordMsg('');

    // 后端模式下通过 API 修改密码
    const currentSettings = getSettings();
    if (currentSettings.useBackend && currentSettings.backendUrl) {
      const result = await changePasswordViaBackend(
        currentSettings.backendUrl, oldPassword, newPassword
      );
      if (result.success) {
        setPassword(newPassword); // 同步本地
        setPasswordMsg('密码修改成功！（已同步到数据库）');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordMsg(result.message || '修改失败');
      }
    } else {
      // 演示模式：本地验证旧密码
      if (oldPassword !== getPassword()) {
        setPasswordMsg('当前密码错误');
        setChangingPassword(false);
        return;
      }
      setPassword(newPassword);
      setPasswordMsg('密码修改成功！');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setChangingPassword(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(135deg, rgba(10,14,39,0.98), rgba(13,27,62,0.95))',
          border: '1px solid rgba(0,212,255,0.2)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(0,212,255,0.1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid rgba(0,212,255,0.1)' }}>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">系统设置</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-3 gap-1" style={{ borderBottom: '1px solid rgba(0,212,255,0.08)' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all ${
                activeTab === tab.key
                  ? 'text-cyan-400 bg-cyan-400/10 border-b-2 border-cyan-400'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'databases' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-400">
                  管理Oracle备库连接信息
                  {settings.useBackend && (
                    <span className="ml-2 text-green-400 text-xs">
                      (📦 配置已持久化到Oracle数据库)
                    </span>
                  )}
                </p>
                <button
                  onClick={handleNewDb}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-cyan-400 transition-all hover:scale-105"
                  style={{
                    background: 'rgba(0,212,255,0.1)',
                    border: '1px solid rgba(0,212,255,0.2)',
                  }}
                >
                  <Plus className="w-4 h-4" />
                  添加备库
                </button>
              </div>

              {/* Edit form */}
              {editingDb && (
                <div className="rounded-xl p-4 mb-4" style={{
                  background: 'rgba(0,212,255,0.05)',
                  border: '1px solid rgba(0,212,255,0.15)',
                }}>
                  <h4 className="text-sm font-bold text-cyan-400 mb-3">
                    {databases.find(d => d.id === editingDb.id) ? '编辑备库' : '添加备库'}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <InputField label="名称 *" value={editingDb.name}
                      onChange={v => setEditingDb({ ...editingDb, name: v })} placeholder="例: ORCL_DR" />
                    <InputField label="主机地址 *" value={editingDb.host}
                      onChange={v => setEditingDb({ ...editingDb, host: v })} placeholder="10.0.2.30" />
                    <InputField label="端口" value={editingDb.port.toString()} type="number"
                      onChange={v => setEditingDb({ ...editingDb, port: parseInt(v) || 1521 })} placeholder="1521" />
                    <InputField label="服务名 *" value={editingDb.serviceName}
                      onChange={v => setEditingDb({ ...editingDb, serviceName: v })} placeholder="ORCL" />
                    <InputField label="用户名 *" value={editingDb.username}
                      onChange={v => setEditingDb({ ...editingDb, username: v })} placeholder="monitor" />
                    <InputField label="密码 *" value={editingDb.password} type="password"
                      onChange={v => setEditingDb({ ...editingDb, password: v })} placeholder="****" />
                  </div>
                  
                  {/* Connection test result */}
                  {connectionResult && (
                    <div className={`mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
                      connectionResult.success
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                      {connectionResult.success ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">{connectionResult.success ? '连接成功' : '连接失败'}</p>
                        <p className="mt-0.5 opacity-80">{connectionResult.message}</p>
                        {connectionResult.details && (
                          <div className="mt-1 space-y-0.5 font-mono text-[10px] opacity-70">
                            {connectionResult.details.db_unique_name && (
                              <p>DB_UNIQUE_NAME: {connectionResult.details.db_unique_name}</p>
                            )}
                            {connectionResult.details.database_role && (
                              <p>DATABASE_ROLE: {connectionResult.details.database_role}</p>
                            )}
                            {connectionResult.details.open_mode && (
                              <p>OPEN_MODE: {connectionResult.details.open_mode}</p>
                            )}
                            {connectionResult.details.version && (
                              <p>VERSION: {connectionResult.details.version}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-3 mt-3">
                    <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingDb.enabled}
                        onChange={e => setEditingDb({ ...editingDb, enabled: e.target.checked })}
                        className="accent-cyan-500"
                      />
                      启用监控
                    </label>
                    <div className="flex-1" />
                    
                    {/* Connection Test Button */}
                    <button
                      onClick={handleTestConnection}
                      disabled={testingConnection}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                      style={{
                        background: 'rgba(34,197,94,0.1)',
                        border: '1px solid rgba(34,197,94,0.2)',
                        color: '#22c55e',
                      }}
                    >
                      {testingConnection ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wifi className="w-4 h-4" />
                      )}
                      {testingConnection ? '测试中...' : '连接测试'}
                    </button>
                    
                    <button onClick={() => { setEditingDb(null); setConnectionResult(null); }}
                      className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-all"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                      取消
                    </button>
                    <button onClick={handleSaveDb}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                      style={{ background: 'linear-gradient(135deg, #0891b2, #6366f1)' }}>
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                  </div>
                </div>
              )}

              {/* Database list */}
              <div className="space-y-2">
                {databases.map(db => (
                  <div key={db.id} className="flex items-center justify-between rounded-lg p-3 group hover:bg-white/5 transition-all"
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(0,212,255,0.06)' }}>
                    <div className="flex items-center gap-3">
                      <Server className={`w-4 h-4 ${db.enabled ? 'text-cyan-400' : 'text-gray-600'}`} />
                      <div>
                        <div className="text-sm font-semibold text-white">{db.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{db.host}:{db.port}/{db.serviceName} · {db.username}</div>
                      </div>
                      {!db.enabled && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-gray-600/20 text-gray-500">已禁用</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingDb({ ...db }); setConnectionResult(null); }}
                        className="p-1.5 rounded text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (confirm(`确认删除 ${db.name}？`)) onDeleteDatabase(db.id); }}
                        className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {databases.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    暂无备库，点击"添加备库"开始
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'collection' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-4">配置数据采集参数和告警阈值</p>

              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,212,255,0.08)',
              }}>
                <h4 className="text-sm font-bold text-white mb-3">采集设置</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">采集间隔 (秒, 最低10秒)</label>
                    <input
                      type="number"
                      min={10}
                      value={localSettings.collectionConfig.intervalSeconds}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        collectionConfig: {
                          ...localSettings.collectionConfig,
                          intervalSeconds: Math.max(10, parseInt(e.target.value) || 10),
                        }
                      })}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localSettings.collectionConfig.enabled}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          collectionConfig: { ...localSettings.collectionConfig, enabled: e.target.checked }
                        })}
                        className="accent-cyan-500"
                      />
                      启用自动采集
                    </label>
                  </div>
                </div>
                {settings.useBackend && (
                  <p className="text-[10px] text-green-400/60 mt-2">
                    📦 后端模式下，采集由后端自动执行并持久化到Oracle数据库，此处间隔同步到后端
                  </p>
                )}
              </div>

              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,212,255,0.08)',
              }}>
                <h4 className="text-sm font-bold text-white mb-3">告警阈值设置</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1" />
                      黄色警告阈值 (秒)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={localSettings.collectionConfig.yellowThresholdSeconds}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        collectionConfig: {
                          ...localSettings.collectionConfig,
                          yellowThresholdSeconds: parseInt(e.target.value) || 300,
                        }
                      })}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(234,179,8,0.2)' }}
                    />
                    <p className="text-[10px] text-gray-600 mt-1">MRP正常且延时超过此值显示黄色</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />
                      红色危险阈值 (秒)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={localSettings.collectionConfig.redThresholdSeconds}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        collectionConfig: {
                          ...localSettings.collectionConfig,
                          redThresholdSeconds: parseInt(e.target.value) || 1800,
                        }
                      })}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(239,68,68,0.2)' }}
                    />
                    <p className="text-[10px] text-gray-600 mt-1">MRP正常且延时超过此值显示红色</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,212,255,0.08)',
              }}>
                <h4 className="text-sm font-bold text-white mb-3">会话设置</h4>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">空闲超时退出 (分钟)</label>
                  <input
                    type="number"
                    min={1}
                    value={localSettings.idleTimeoutMinutes}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      idleTimeoutMinutes: Math.max(1, parseInt(e.target.value) || 30),
                    })}
                    className="w-full max-w-xs px-3 py-2 rounded-lg text-sm text-white outline-none"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                  />
                  <p className="text-[10px] text-gray-600 mt-1">页面无操作超过此时间将自动退出到登录界面</p>
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={handleSaveSettings}
                  className="flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #0891b2, #6366f1)' }}>
                  <Save className="w-4 h-4" />
                  保存配置
                </button>
              </div>

              {/* Status color explanation */}
              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.15)',
                border: '1px solid rgba(0,212,255,0.05)',
              }}>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">状态颜色说明</h4>
                <div className="space-y-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="font-semibold text-green-400">绿色</span>
                    <span>- MRP状态为APPLYING_LOG或WAIT_FOR_LOG，且延时 ≤ 黄色阈值</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="font-semibold text-yellow-400">黄色</span>
                    <span>- MRP状态正常，但延时 &gt; 黄色阈值 且 ≤ 红色阈值</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="font-semibold text-red-400">红色</span>
                    <span>- MRP状态异常(ERROR/NOT_FOUND/WAIT_FOR_GAP等) 或延时 &gt; 红色阈值</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backend' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-4">配置Python Flask后端连接，启用数据持久化到Oracle数据库</p>

              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,212,255,0.08)',
              }}>
                <h4 className="text-sm font-bold text-white mb-3">运行模式</h4>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <div>
                      <span className="text-green-400 font-semibold">后端持久化模式</span>
                      <p className="text-[10px] text-gray-500 mt-0.5">连接Python Flask后端，数据持久化到Oracle数据库</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.2)',
                border: `1px solid ${localSettings.useBackend ? 'rgba(34,197,94,0.15)' : 'rgba(0,212,255,0.08)'}`,
              }}>
                <h4 className="text-sm font-bold text-white mb-3">后端地址</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={localSettings.backendUrl}
                    onChange={e => setLocalSettings({ ...localSettings, backendUrl: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg text-sm text-white outline-none"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                    placeholder="http://your-server:5000"
                  />
                  <button
                    onClick={handleTestBackend}
                    disabled={testingBackend}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105 disabled:opacity-50"
                    style={{
                      background: 'rgba(0,212,255,0.1)',
                      border: '1px solid rgba(0,212,255,0.2)',
                      color: '#00d4ff',
                    }}
                  >
                    {testingBackend ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                    测试
                  </button>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                  Python Flask后端的完整URL地址，例如: http://10.0.2.100:5000
                </p>

                {/* Backend test result */}
                {backendResult && (
                  <div className={`mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
                    backendResult.success
                      ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                      : 'bg-red-500/10 border border-red-500/20 text-red-400'
                  }`}>
                    {backendResult.success ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-semibold">{backendResult.success ? '连接成功' : '连接失败'}</p>
                      <p className="mt-0.5 opacity-80">{backendResult.message}</p>
                      {backendResult.tables && backendResult.tables.length > 0 && (
                        <div className="mt-1 space-y-0.5 font-mono text-[10px] opacity-70">
                          <p className="font-semibold">数据库表状态:</p>
                          {backendResult.tables.map((t: any, i: number) => (
                            <p key={i}>
                              {t.exists ? '✅' : '❌'} {t.name}: {t.exists ? `${t.rows} 行` : '未创建'}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Persistence info */}
              {localSettings.useBackend && (
                <div className="rounded-xl p-4" style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(34,197,94,0.1)',
                }}>
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-green-400" />
                    数据持久化信息
                  </h4>
                  <div className="space-y-2 text-xs text-gray-400">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.2)' }}>
                        <p className="text-gray-500 mb-1">持久化表</p>
                        <p className="font-mono text-[10px] text-cyan-400">ADG_STANDBY_CONFIG</p>
                        <p className="font-mono text-[10px] text-cyan-400">ADG_MONITOR_STATUS</p>
                        <p className="font-mono text-[10px] text-cyan-400">ADG_MONITOR_HISTORY</p>
                        <p className="font-mono text-[10px] text-cyan-400">ADG_SYSTEM_SETTINGS</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.2)' }}>
                        <p className="text-gray-500 mb-1">历史数据统计</p>
                        {historyStats ? (
                          <>
                            <p className="font-mono text-[10px]">总记录: <span className="text-cyan-400">{historyStats.total_records?.toLocaleString()}</span></p>
                            <p className="font-mono text-[10px]">最早: <span className="text-cyan-400">{historyStats.earliest || 'N/A'}</span></p>
                            <p className="font-mono text-[10px]">最新: <span className="text-cyan-400">{historyStats.latest || 'N/A'}</span></p>
                            <p className="font-mono text-[10px]">保留: <span className="text-cyan-400">{historyStats.retention_days}天</span></p>
                          </>
                        ) : (
                          <p className="text-[10px] text-gray-600">点击"测试"加载...</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={fetchHistoryStats}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-semibold text-cyan-400 hover:bg-cyan-400/10 transition-all"
                        style={{ border: '1px solid rgba(0,212,255,0.15)' }}
                      >
                        <BarChart3 className="w-3 h-3" />
                        刷新统计
                      </button>
                      <button
                        onClick={handleCleanupHistory}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-semibold text-orange-400 hover:bg-orange-400/10 transition-all"
                        style={{ border: '1px solid rgba(249,115,22,0.15)' }}
                      >
                        <Trash2 className="w-3 h-3" />
                        清理历史
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={handleSaveSettings}
                  className="flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #0891b2, #6366f1)' }}>
                  <Save className="w-4 h-4" />
                  保存配置
                </button>
              </div>

              {/* Deployment info */}
              <div className="rounded-xl p-4" style={{
                background: 'rgba(0,0,0,0.15)',
                border: '1px solid rgba(0,212,255,0.05)',
              }}>
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">后端部署步骤</h4>
                <div className="space-y-1.5 text-[10px] text-gray-500 font-mono">
                  <p># 1. 创建Oracle持久化用户和表结构:</p>
                  <p className="text-cyan-400/60">   python3 adg_backend.py --init-db --local-dsn "IP:PORT/SID" --local-user "adg_admin" --local-password "password"</p>
                  <p># 2. Oracle 11g使用:</p>
                  <p className="text-cyan-400/60">   python3 adg_backend.py --init-db-11g --local-dsn "IP:PORT/SID" ...</p>
                  <p># 3. 启动后端:</p>
                  <p className="text-cyan-400/60">   python3 adg_backend.py --port 5000 --local-dsn "IP:PORT/SID" ...</p>
                  <p># 后端会自动：</p>
                  <p className="text-green-400/60">   · 定时采集所有备库状态</p>
                  <p className="text-green-400/60">   · 持久化到ADG_MONITOR_STATUS和ADG_MONITOR_HISTORY表</p>
                  <p className="text-green-400/60">   · 自动清理过期历史数据</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-4">
                修改访问密码
                {localSettings.useBackend && (
                  <span className="ml-2 text-green-400 text-xs">(密码已持久化到Oracle数据库)</span>
                )}
              </p>

              <div className="rounded-xl p-4 max-w-md" style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,212,255,0.08)',
              }}>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">当前密码</label>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={e => { setOldPassword(e.target.value); setPasswordMsg(''); }}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                      placeholder="输入当前密码..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">新密码</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setPasswordMsg(''); }}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                      placeholder="输入新密码 (至少4位)..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">确认密码</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setPasswordMsg(''); }}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
                      placeholder="再次输入新密码..."
                    />
                  </div>
                  {passwordMsg && (
                    <p className={`text-xs ${passwordMsg.includes('成功') ? 'text-green-400' : 'text-red-400'}`}>
                      {passwordMsg}
                    </p>
                  )}
                  <button
                    onClick={handleChangePassword}
                    disabled={changingPassword}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #0891b2, #6366f1)' }}
                  >
                    <Shield className="w-4 h-4" />
                    {changingPassword ? '修改中...' : '修改密码'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none transition-all focus:ring-1 focus:ring-cyan-500/50"
        style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.15)' }}
      />
    </div>
  );
}
