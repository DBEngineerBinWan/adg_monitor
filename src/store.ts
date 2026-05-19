import { StandbyDatabase, StandbyStatus, HistoryRecord, AppSettings, CollectionConfig, MRPStatus, HealthStatus, ManagedStandbyProcess, DataguardStats, DatabaseInfo } from './types';

const STORAGE_KEYS = {
  DATABASES: 'adg_databases',
  HISTORY: 'adg_history',
  SETTINGS: 'adg_settings',
  AUTH: 'adg_auth',
  LAST_ACTIVITY: 'adg_last_activity',
  STATUSES: 'adg_statuses',
  PASSWORD: 'adg_password',
};

const DEFAULT_PASSWORD = 'admin123';

const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 0,
  idleTimeoutMinutes: 30,
  backendUrl: 'http://localhost:5000',
  useBackend: true,
  collectionConfig: {
    intervalSeconds: 30,
    enabled: true,
    yellowThresholdSeconds: 300,
    redThresholdSeconds: 1800,
  },
  alertConfig: {
    enabled: false,
    webhookUrl: '',
    cooldownMinutes: 30,
  },
};

// Password management
export function getPassword(): string {
  return localStorage.getItem(STORAGE_KEYS.PASSWORD) || DEFAULT_PASSWORD;
}

export function setPassword(pwd: string): void {
  localStorage.setItem(STORAGE_KEYS.PASSWORD, pwd);
}

export function checkAuth(): boolean {
  const auth = localStorage.getItem(STORAGE_KEYS.AUTH);
  if (!auth) return false;
  const lastActivity = getLastActivity();
  const settings = getSettings();
  const timeout = settings.idleTimeoutMinutes * 60 * 1000;
  if (Date.now() - lastActivity > timeout) {
    logout();
    return false;
  }
  return true;
}

export async function login(password: string): Promise<boolean> {
  // 后端模式下优先使用 API 验证
  const settings = getSettings();
  if (settings.useBackend && settings.backendUrl) {
    try {
      const result = await loginViaBackend(settings.backendUrl, password);
      if (result) return true;
      // 后端验证失败，降级到本地密码
    } catch { /* 降级 */ }
  }
  // 本地验证 (演示模式或后端不可用时的回退)
  if (password === getPassword()) {
    localStorage.setItem(STORAGE_KEYS.AUTH, 'true');
    updateLastActivity();
    return true;
  }
  return false;
}

export function logout(): void {
  localStorage.removeItem(STORAGE_KEYS.AUTH);
}

// ==================== Backend Auth API ====================

export async function loginViaBackend(backendUrl: string, password: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (data.success) {
      localStorage.setItem(STORAGE_KEYS.AUTH, 'true');
      updateLastActivity();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function changePasswordViaBackend(
  backendUrl: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${backendUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    return await response.json();
  } catch (err: any) {
    return { success: false, message: `连接后端失败: ${err.message}` };
  }
}

export function updateLastActivity(): void {
  localStorage.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
}

export function getLastActivity(): number {
  return parseInt(localStorage.getItem(STORAGE_KEYS.LAST_ACTIVITY) || '0');
}

// Settings
export function getSettings(): AppSettings {
  const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  if (stored) {
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_SETTINGS, ...parsed };
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

// Database CRUD (local fallback)
export function getDatabases(): StandbyDatabase[] {
  const stored = localStorage.getItem(STORAGE_KEYS.DATABASES);
  if (stored) return JSON.parse(stored);
  return [];
}

export function saveDatabaseLocal(db: StandbyDatabase): void {
  const dbs = getDatabases();
  const idx = dbs.findIndex(d => d.id === db.id);
  if (idx >= 0) {
    dbs[idx] = db;
  } else {
    dbs.push(db);
  }
  localStorage.setItem(STORAGE_KEYS.DATABASES, JSON.stringify(dbs));
}

export function deleteDatabaseLocal(id: string): void {
  const dbs = getDatabases().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEYS.DATABASES, JSON.stringify(dbs));
  const history = getHistory().filter(h => h.dbId !== id);
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  const statuses = getStatuses();
  delete statuses[id];
  localStorage.setItem(STORAGE_KEYS.STATUSES, JSON.stringify(statuses));
}

// Status (local)
export function getStatuses(): Record<string, StandbyStatus> {
  const stored = localStorage.getItem(STORAGE_KEYS.STATUSES);
  if (stored) return JSON.parse(stored);
  return {};
}

export function saveStatus(status: StandbyStatus): void {
  const statuses = getStatuses();
  statuses[status.dbId] = status;
  localStorage.setItem(STORAGE_KEYS.STATUSES, JSON.stringify(statuses));
}

// History (local)
export function getHistory(): HistoryRecord[] {
  const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
  if (stored) return JSON.parse(stored);
  return [];
}

export function addHistory(record: HistoryRecord): void {
  const history = getHistory();
  history.push(record);
  if (history.length > 10000) {
    history.splice(0, history.length - 10000);
  }
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
}

export function getHistoryForDb(dbId: string): HistoryRecord[] {
  return getHistory().filter(h => h.dbId === dbId);
}

// Determine health status
export function determineHealthStatus(
  mrpStatus: MRPStatus,
  applyLagSeconds: number,
  config: CollectionConfig,
  hasError: boolean,
  mrp0WaitBlockZero: boolean = false
): HealthStatus {
  if (hasError) return 'red';
  const mrpNormal = mrpStatus === 'APPLYING_LOG' || mrpStatus === 'WAIT_FOR_LOG';
  if (!mrpNormal) return 'red';
  // MRP0 WAIT_FOR_LOG + BLOCK#=0 → 黄色
  if (mrp0WaitBlockZero) return 'yellow';
  if (applyLagSeconds <= config.yellowThresholdSeconds) {
    return 'green';
  } else if (applyLagSeconds <= config.redThresholdSeconds) {
    return 'yellow';
  } else {
    return 'red';
  }
}

export function parseLagToSeconds(lag: string): number {
  if (!lag || lag === '' || lag === 'N/A') return 0;
  const match = lag.match(/\+?(\d+)\s+(\d+):(\d+):(\d+)/);
  if (match) {
    const days = parseInt(match[1]);
    const hours = parseInt(match[2]);
    const minutes = parseInt(match[3]);
    const seconds = parseInt(match[4]);
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

export function formatLag(seconds: number): string {
  if (seconds <= 0) return '0 秒';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}时`);
  if (m > 0) parts.push(`${m}分`);
  if (s > 0 || parts.length === 0) parts.push(`${s}秒`);
  return parts.join(' ');
}

// ==================== Backend API calls (Persistent Mode) ====================

// Load databases from backend
export async function loadDatabasesFromBackend(backendUrl: string): Promise<StandbyDatabase[]> {
  try {
    const response = await fetch(`${backendUrl}/api/databases`);
    const data = await response.json();
    if (data.success) {
      const dbs = data.databases.map((d: any) => ({
        id: d.id,
        name: d.name,
        host: d.host,
        port: d.port,
        serviceName: d.serviceName,
        username: d.username,
        password: d.password,
        enabled: d.enabled,
        createdAt: d.createdAt ? new Date(d.createdAt).getTime() : Date.now(),
      }));
      // Sync to localStorage for offline display
      localStorage.setItem(STORAGE_KEYS.DATABASES, JSON.stringify(dbs));
      return dbs;
    }
    return getDatabases();
  } catch {
    return getDatabases();
  }
}

// Save database to backend
export async function saveDatabaseToBackend(backendUrl: string, db: StandbyDatabase): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/api/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(db),
    });
    const data = await response.json();
    if (data.success) {
      saveDatabaseLocal(db); // sync local
      return true;
    }
    // 后端保存失败时降级到 localStorage
    saveDatabaseLocal(db);
    return false;
  } catch {
    saveDatabaseLocal(db);
    return false;
  }
}

// Delete database from backend
export async function deleteDatabaseFromBackend(backendUrl: string, id: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/api/databases/${id}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (data.success) {
      deleteDatabaseLocal(id);
    }
    return data.success;
  } catch {
    deleteDatabaseLocal(id);
    return false;
  }
}

// Batch import databases to backend
export async function batchImportDatabases(
  backendUrl: string,
  databases: Array<{
    id?: string;
    name: string;
    host: string;
    port: number;
    serviceName: string;
    username: string;
    password: string;
  }>
): Promise<{ success: boolean; imported?: number; skipped?: number; errors?: Array<{row: number; name: string; error: string}>; message?: string }> {
  try {
    const response = await fetch(`${backendUrl}/api/databases/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databases }),
    });
    return await response.json();
  } catch (err: any) {
    return { success: false, message: `批量导入失败: ${err.message}` };
  }
}

// Batch delete databases from backend
export async function batchDeleteDatabases(
  backendUrl: string,
  ids: string[]
): Promise<{ success: boolean; deleted?: number; message?: string }> {
  try {
    const response = await fetch(`${backendUrl}/api/databases/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    return await response.json();
  } catch (err: any) {
    return { success: false, message: `批量删除失败: ${err.message}` };
  }
}

// Load statuses from backend
export async function loadStatusesFromBackend(backendUrl: string): Promise<Record<string, StandbyStatus>> {
  try {
    const response = await fetch(`${backendUrl}/api/statuses`);
    const data = await response.json();
    if (data.success && data.statuses) {
      // Save to localStorage for display
      localStorage.setItem(STORAGE_KEYS.STATUSES, JSON.stringify(data.statuses));
      return data.statuses;
    }
    return getStatuses();
  } catch {
    return getStatuses();
  }
}

// Trigger backend collection
export async function triggerBackendCollect(backendUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return data.success;
  } catch {
    return false;
  }
}

// Load history from backend
export async function loadHistoryFromBackend(
  backendUrl: string,
  dbId?: string,
  hours: number = 24,
  limit: number = 2000
): Promise<HistoryRecord[]> {
  try {
    let url = `${backendUrl}/api/history?hours=${hours}&limit=${limit}`;
    if (dbId) url += `&db_id=${dbId}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.success && data.history) {
      return data.history.map((h: any) => ({
        dbId: h.dbId,
        timestamp: h.timestamp ? new Date(h.timestamp).getTime() : Date.now(),
        applyLagSeconds: h.applyLagSeconds || 0,
        transportLagSeconds: h.transportLagSeconds || 0,
        mrpStatus: h.mrpStatus || 'NOT_FOUND',
        healthStatus: h.healthStatus || 'red',
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// Save settings to backend
export async function saveSettingsToBackend(backendUrl: string, settings: AppSettings): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          collection_interval: settings.collectionConfig.intervalSeconds.toString(),
          yellow_threshold: settings.collectionConfig.yellowThresholdSeconds.toString(),
          red_threshold: settings.collectionConfig.redThresholdSeconds.toString(),
          auto_collect_enabled: settings.collectionConfig.enabled ? '1' : '0',
          alert_config: JSON.stringify(settings.alertConfig),
        }
      }),
    });
    const data = await response.json();
    return data.success;
  } catch {
    return false;
  }
}

// Test connection via backend
export async function testConnectionViaBackend(
  backendUrl: string,
  db: { host: string; port: number; serviceName: string; username: string; password: string }
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const response = await fetch(`${backendUrl}/api/test_connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: db.host,
        port: db.port,
        service_name: db.serviceName,
        username: db.username,
        password: db.password,
      }),
    });
    const data = await response.json();
    return {
      success: data.success || false,
      message: data.message || '未知错误',
      details: data.details || null,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `无法连接到后端服务: ${err.message}`,
    };
  }
}

// Query a standby database via backend (for simulation fallback)
export async function queryStandbyViaBackend(
  backendUrl: string,
  db: StandbyDatabase,
  config: CollectionConfig
): Promise<StandbyStatus> {
  try {
    const response = await fetch(`${backendUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: db.host,
        port: db.port,
        service_name: db.serviceName,
        username: db.username,
        password: db.password,
        yellow_threshold: config.yellowThresholdSeconds,
        red_threshold: config.redThresholdSeconds,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const mrpStatus: MRPStatus = data.mrp_status || 'NOT_FOUND';
    const applyLagSeconds = data.apply_lag_seconds || 0;
    const transportLagSeconds = data.transport_lag_seconds || 0;
    const hasError = !!data.error;
    const mrp0WaitBlockZero = (data.managed_standby || []).some(
      (p: any) => (p.process === 'MRP0' || p.process === 'MR(fg)') &&
        p.status === 'WAIT_FOR_LOG' && p.block === 0
    );
    const healthStatus = determineHealthStatus(mrpStatus, applyLagSeconds, config, hasError, mrp0WaitBlockZero);

    const databaseInfo: DatabaseInfo = {
      dbUniqueName: data.database_info?.db_unique_name || db.name,
      databaseRole: data.database_info?.database_role || 'UNKNOWN',
      openMode: data.database_info?.open_mode || 'UNKNOWN',
      protectionMode: data.database_info?.protection_mode || 'UNKNOWN',
      switchoverStatus: data.database_info?.switchover_status || 'UNKNOWN',
    };

    const mrpProcesses: ManagedStandbyProcess[] = (data.managed_standby || []).map((p: any) => ({
      process: p.process || '',
      pid: p.pid || 0,
      status: p.status || 'UNUSED',
      clientProcess: p.client_process || 'N/A',
      thread: p.thread || 0,
      sequence: p.sequence || 0,
      block: p.block || 0,
      blocks: p.blocks || 0,
      delayMins: p.delay_mins || 0,
    }));

    const dataguardStats: DataguardStats[] = (data.dataguard_stats || []).map((s: any) => ({
      name: s.name || '',
      value: s.value || '',
      unit: s.unit || '',
      datum_time: s.datum_time || '',
    }));

    return {
      dbId: db.id,
      dbName: db.name,
      host: db.host,
      port: db.port,
      serviceName: db.serviceName,
      databaseInfo,
      mrpProcesses,
      dataguardStats,
      mrpStatus,
      applyLag: data.apply_lag || '+00 00:00:00',
      applyLagSeconds,
      transportLag: data.transport_lag || '+00 00:00:00',
      transportLagSeconds,
      healthStatus,
      lastChecked: Date.now(),
      error: data.error || undefined,
    };
  } catch (err: any) {
    return {
      dbId: db.id,
      dbName: db.name,
      host: db.host,
      port: db.port,
      serviceName: db.serviceName,
      databaseInfo: {
        dbUniqueName: db.name,
        databaseRole: 'UNKNOWN',
        openMode: 'UNKNOWN',
        protectionMode: 'UNKNOWN',
        switchoverStatus: 'UNKNOWN',
      },
      mrpProcesses: [],
      dataguardStats: [],
      mrpStatus: 'NOT_FOUND',
      applyLag: 'N/A',
      applyLagSeconds: 0,
      transportLag: 'N/A',
      transportLagSeconds: 0,
      healthStatus: 'red',
      lastChecked: Date.now(),
      error: `后端连接失败: ${err.message}`,
    };
  }
}

// ==================== Simulation mode ====================
export function simulateStandbyQuery(db: StandbyDatabase, config: CollectionConfig): StandbyStatus {
  const now = Date.now();
  const scenario = Math.random();
  let mrpStatus: MRPStatus;
  let applyLagSeconds: number;
  let transportLagSeconds: number;
  let hasError = false;
  let errorMsg: string | undefined;

  if (scenario < 0.60) {
    mrpStatus = 'APPLYING_LOG';
    applyLagSeconds = Math.floor(Math.random() * 120);
    transportLagSeconds = Math.floor(Math.random() * 30);
  } else if (scenario < 0.80) {
    mrpStatus = 'WAIT_FOR_LOG';
    applyLagSeconds = Math.floor(Math.random() * 600);
    transportLagSeconds = Math.floor(Math.random() * 60);
  } else if (scenario < 0.90) {
    mrpStatus = 'APPLYING_LOG';
    applyLagSeconds = 300 + Math.floor(Math.random() * 1800);
    transportLagSeconds = Math.floor(Math.random() * 120);
  } else if (scenario < 0.95) {
    mrpStatus = 'WAIT_FOR_GAP';
    applyLagSeconds = 1800 + Math.floor(Math.random() * 3600);
    transportLagSeconds = 600 + Math.floor(Math.random() * 600);
  } else {
    mrpStatus = 'NOT_FOUND';
    applyLagSeconds = 0;
    transportLagSeconds = 0;
    hasError = true;
    errorMsg = 'MRP进程未找到，备库可能未启动日志应用';
  }

  const prevStatuses = getStatuses();
  const prevStatus = prevStatuses[db.id];
  if (prevStatus) {
    const prevLag = prevStatus.applyLagSeconds;
    const diff = applyLagSeconds - prevLag;
    applyLagSeconds = Math.max(0, prevLag + Math.floor(diff * 0.3) + Math.floor(Math.random() * 10) - 5);
    if (Math.random() < 0.85) {
      mrpStatus = prevStatus.mrpStatus;
      hasError = !!prevStatus.error;
      errorMsg = prevStatus.error;
    }
  }

  const formatLagStr = (secs: number): string => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `+${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const mrpProcesses: ManagedStandbyProcess[] = [];
  for (let i = 0; i < 4; i++) {
    mrpProcesses.push({
      process: 'ARCH', pid: 10000 + i,
      status: Math.random() > 0.5 ? 'CONNECTED' : 'IDLE',
      clientProcess: 'ARCH', thread: 1,
      sequence: 100 + Math.floor(Math.random() * 50),
      block: 0, blocks: 0, delayMins: 0,
    });
  }
  for (let i = 0; i < 2; i++) {
    mrpProcesses.push({
      process: 'RFS', pid: 20000 + i, status: 'IDLE',
      clientProcess: 'LGWR', thread: 1, sequence: 0,
      block: 0, blocks: 0, delayMins: 0,
    });
  }
  if (!hasError) {
    mrpProcesses.push({
      process: 'MRP0', pid: 30000, status: mrpStatus,
      clientProcess: 'N/A', thread: 1,
      sequence: 100 + Math.floor(Math.random() * 50),
      block: Math.floor(Math.random() * 100000),
      blocks: Math.floor(Math.random() * 50000),
      delayMins: Math.floor(applyLagSeconds / 60),
    });
  }

  const mrp0WaitBlockZero = mrpProcesses.some(
    p => (p.process === 'MRP0' || p.process === 'MR(fg)') &&
      p.status === 'WAIT_FOR_LOG' && p.block === 0
  );
  const healthStatus = determineHealthStatus(mrpStatus, applyLagSeconds, config, hasError, mrp0WaitBlockZero);

  const dataguardStats: DataguardStats[] = [
    { name: 'apply lag', value: formatLagStr(applyLagSeconds), unit: 'day(2) to second(0) interval', datum_time: new Date().toISOString() },
    { name: 'transport lag', value: formatLagStr(transportLagSeconds), unit: 'day(2) to second(0) interval', datum_time: new Date().toISOString() },
    { name: 'apply finish time', value: formatLagStr(Math.floor(applyLagSeconds * 0.8)), unit: 'day(2) to second(0) interval', datum_time: new Date().toISOString() },
    { name: 'estimated startup time', value: '25', unit: 'second', datum_time: new Date().toISOString() },
  ];

  const databaseInfo: DatabaseInfo = {
    dbUniqueName: db.name,
    databaseRole: 'PHYSICAL STANDBY',
    openMode: mrpStatus === 'APPLYING_LOG' ? 'READ ONLY WITH APPLY' : 'MOUNTED',
    protectionMode: 'MAXIMUM PERFORMANCE',
    switchoverStatus: 'NOT ALLOWED',
  };

  return {
    dbId: db.id, dbName: db.name, host: db.host, port: db.port,
    serviceName: db.serviceName, databaseInfo, mrpProcesses, dataguardStats,
    mrpStatus, applyLag: formatLagStr(applyLagSeconds), applyLagSeconds,
    transportLag: formatLagStr(transportLagSeconds), transportLagSeconds,
    healthStatus, lastChecked: now, error: errorMsg,
  };
}

// Generate ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
