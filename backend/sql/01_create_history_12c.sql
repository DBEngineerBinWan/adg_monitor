-- ============================================================================
-- ADG_MONITOR_HISTORY 建表 (Oracle 12c+)
-- 按月 RANGE 分区 + INTERVAL 自动创建
-- ============================================================================
-- 使用前提:
--   1. Oracle 12c+ (支持 IDENTITY + INTERVAL 分区)
--   2. 数据库用户已具备 CREATE TABLE 权限
--
-- 运行方式:
--   sqlplus user/pass@tns @01_create_history_12c.sql
--
-- 或后端一键初始化:
--   python backend/adg_backend.py --init-db --local-dsn "..." --local-user "..." --local-password "..."
-- ============================================================================

-- 修改此行：下个月第一天作为初始分区的分界点
-- 例如当前是 2026-05 月，则设为 2026-06-01
DEFINE initial_boundary = '2026-06-01'

CREATE TABLE ADG_MONITOR_HISTORY (
    ID                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DB_ID                 VARCHAR2(64)   NOT NULL,
    COLLECT_TIME          TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
    APPLY_LAG_SECONDS     NUMBER(10)     DEFAULT 0,
    TRANSPORT_LAG_SECONDS NUMBER(10)     DEFAULT 0,
    MRP_STATUS            VARCHAR2(32),
    HEALTH_STATUS         VARCHAR2(10),
    APPLY_LAG             VARCHAR2(64),
    TRANSPORT_LAG         VARCHAR2(64)
) PARTITION BY RANGE (COLLECT_TIME)
INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))
(
    PARTITION p_hist_init VALUES LESS THAN (TIMESTAMP '&initial_boundary 00:00:00')
);

-- LOCAL 分区索引 (随分区自动维护)
CREATE INDEX IDX_HISTORY_DBID_TIME ON ADG_MONITOR_HISTORY(DB_ID, COLLECT_TIME DESC) LOCAL;

CREATE INDEX IDX_HISTORY_TIME ON ADG_MONITOR_HISTORY(COLLECT_TIME DESC) LOCAL;

-- ============================================================================
-- 验证
-- ============================================================================

SELECT TABLE_NAME, PARTITIONING_TYPE, INTERVAL
FROM ALL_PART_TABLES
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY';

SELECT PARTITION_NAME, HIGH_VALUE, NUM_ROWS
FROM ALL_TAB_PARTITIONS
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY'
ORDER BY PARTITION_POSITION;
