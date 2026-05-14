// Oracle ADG Monitor Platform Types

export interface StandbyDatabase {
  id: string;
  name: string;
  host: string;
  port: number;
  serviceName: string;
  username: string;
  password: string;
  enabled: boolean;
  createdAt: number;
}

// MRP Process status values from V$MANAGED_STANDBY (Oracle Official Doc)
// PROCESS: RFS, MRP0, MR(fg), ARCH, FGRD, LGWR, RFS(FAL), RFS(NEXP), LNS
// STATUS: UNUSED, ALLOCATED, CONNECTED, ATTACHED, IDLE, ERROR, OPENING, CLOSING,
//         WRITING, RECEIVING, ANNOUNCING, REGISTERING, WAIT_FOR_LOG, WAIT_FOR_GAP, APPLYING_LOG

export type MRPStatus =
  | 'APPLYING_LOG'
  | 'WAIT_FOR_LOG'
  | 'WAIT_FOR_GAP'
  | 'IDLE'
  | 'ERROR'
  | 'UNUSED'
  | 'ALLOCATED'
  | 'CONNECTED'
  | 'ATTACHED'
  | 'OPENING'
  | 'CLOSING'
  | 'WRITING'
  | 'RECEIVING'
  | 'ANNOUNCING'
  | 'REGISTERING'
  | 'NOT_FOUND';

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface ManagedStandbyProcess {
  process: string;   // RFS, MRP0, MR(fg), ARCH, etc.
  pid: number;
  status: MRPStatus;
  clientProcess: string; // Archival, ARCH, LGWR
  thread: number;
  sequence: number;
  block: number;
  blocks: number;
  delayMins: number;
}

export interface DataguardStats {
  name: string;    // from V$DATAGUARD_STATS.NAME
  value: string;   // from V$DATAGUARD_STATS.VALUE
  unit: string;    // from V$DATAGUARD_STATS.UNIT
  datum_time: string;
}

export interface DatabaseInfo {
  dbUniqueName: string;
  databaseRole: string;    // PHYSICAL STANDBY
  openMode: string;        // READ ONLY, READ ONLY WITH APPLY, MOUNTED
  protectionMode: string;  // MAXIMUM PERFORMANCE, MAXIMUM AVAILABILITY, MAXIMUM PROTECTION
  switchoverStatus: string;
}

export interface StandbyStatus {
  dbId: string;
  dbName: string;
  host: string;
  port: number;
  serviceName: string;
  databaseInfo: DatabaseInfo;
  mrpProcesses: ManagedStandbyProcess[];
  dataguardStats: DataguardStats[];
  mrpStatus: MRPStatus;
  applyLag: string;       // e.g. "+00 00:00:05"
  applyLagSeconds: number;
  transportLag: string;
  transportLagSeconds: number;
  healthStatus: HealthStatus;
  lastChecked: number;
  error?: string;
}

export interface HistoryRecord {
  dbId: string;
  timestamp: number;
  applyLagSeconds: number;
  transportLagSeconds: number;
  mrpStatus: MRPStatus;
  healthStatus: HealthStatus;
}

export interface CollectionConfig {
  intervalSeconds: number;
  enabled: boolean;
  yellowThresholdSeconds: number;  // lag > this => yellow
  redThresholdSeconds: number;     // lag > this => red
}

export interface AppSettings {
  refreshInterval: number; // 0 = manual, otherwise seconds
  idleTimeoutMinutes: number;
  collectionConfig: CollectionConfig;
  backendUrl: string; // Backend API URL
  useBackend: boolean; // Whether to use real backend
}

// SQL Queries based on Oracle Official Documentation
export const ORACLE_QUERIES = {
  // V$DATABASE - Database information
  DATABASE_INFO: `SELECT DB_UNIQUE_NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE, SWITCHOVER_STATUS FROM V$DATABASE`,

  // V$MANAGED_STANDBY - Physical standby database processes
  MANAGED_STANDBY: `SELECT PROCESS, PID, STATUS, CLIENT_PROCESS, THREAD#, SEQUENCE#, BLOCK#, BLOCKS, DELAY_MINS FROM V$MANAGED_STANDBY`,

  // V$DATAGUARD_STATS - Data Guard statistics including lag
  DATAGUARD_STATS: `SELECT NAME, VALUE, UNIT, DATUM_TIME FROM V$DATAGUARD_STATS`,

  // V$ARCHIVE_DEST_STATUS - Archive destination status
  ARCHIVE_DEST_STATUS: `SELECT DEST_ID, STATUS, TYPE, DATABASE_MODE, RECOVERY_MODE, GAP_STATUS FROM V$ARCHIVE_DEST_STATUS WHERE STATUS != 'INACTIVE'`,
};
