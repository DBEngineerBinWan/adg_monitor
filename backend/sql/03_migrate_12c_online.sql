-- ============================================================================
-- ADG_MONITOR_HISTORY 在线分区转换 (Oracle 12.2+)
-- 将已存在的非分区表在线转为按月 RANGE 分区表，无需停服
-- ============================================================================
-- 警告:
--   1. 执行前请备份!
--   2. 在线转换需要 Oracle 12.2+ (12.1 请用 04_migrate_manual.sql)
--   3. 执行过程中会对表加共享锁，DML 仍可正常进行
--   4. 请将 &initial_boundary 改为下个月第一天
-- ============================================================================

DEFINE initial_boundary = '2026-06-01'

-- 1. 确保分区键列 NOT NULL (分区表强制要求)
ALTER TABLE ADG_MONITOR_HISTORY MODIFY (COLLECT_TIME NOT NULL);

-- 2. 在线转换为分区表
--    ONLINE: 允许并发 DML
--    INTERVAL: 新数据自动创建月度分区
ALTER TABLE ADG_MONITOR_HISTORY MODIFY
    PARTITION BY RANGE (COLLECT_TIME)
    INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))
    (PARTITION p_hist_init VALUES LESS THAN (TIMESTAMP '&initial_boundary 00:00:00'))
    ONLINE;

-- 3. 将旧全局索引重建为 LOCAL
--    分区表 + LOCAL 索引 = DROP PARTITION 时无需 UPDATE GLOBAL INDEXES
DROP INDEX IDX_HISTORY_DBID_TIME;
CREATE INDEX IDX_HISTORY_DBID_TIME ON ADG_MONITOR_HISTORY(DB_ID, COLLECT_TIME DESC) LOCAL;

DROP INDEX IDX_HISTORY_TIME;
CREATE INDEX IDX_HISTORY_TIME ON ADG_MONITOR_HISTORY(COLLECT_TIME DESC) LOCAL;

-- 4. 验证
SELECT TABLE_NAME, PARTITIONING_TYPE, INTERVAL
FROM ALL_PART_TABLES
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY';

SELECT PARTITION_NAME, HIGH_VALUE, NUM_ROWS
FROM ALL_TAB_PARTITIONS
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY'
ORDER BY PARTITION_POSITION;

SELECT INDEX_NAME, PARTITIONED
FROM ALL_INDEXES
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY';
