-- ============================================================================
-- ADG_MONITOR_HISTORY 分区清理 — 查找并 DROP 过期分区
-- ============================================================================
-- 比 DELETE 高效 N 倍: DDL 直接释放 extent，不产生 undo，不触发触发器
-- ============================================================================

-- ====================================
-- 1. 查看所有分区及其边界
-- ====================================
SELECT PARTITION_NAME,
       PARTITION_POSITION,
       HIGH_VALUE,
       NUM_ROWS,
       BLOCKS,
       LAST_ANALYZED
FROM ALL_TAB_PARTITIONS
WHERE TABLE_NAME = 'ADG_MONITOR_HISTORY'
  AND TABLE_OWNER = USER
ORDER BY PARTITION_POSITION;


-- ====================================
-- 2. 查看分区中的实际数据分布 (确认哪些分区可安全删除)
-- ====================================
SELECT PARTITION_NAME,
       COUNT(*) AS ROW_COUNT,
       MIN(COLLECT_TIME) AS EARLIEST_RECORD,
       MAX(COLLECT_TIME) AS LATEST_RECORD
FROM ADG_MONITOR_HISTORY
GROUP BY PARTITION_NAME
ORDER BY PARTITION_NAME;


-- ====================================
-- 3. DROP 指定过期分区 (请根据步骤 1-2 的结果选择)
-- ====================================
-- 例如: 当前保留 30 天，今天是 2026-05-21，截止日期 = 2026-04-21
-- 可以 DROP HIGH_VALUE <= '2026-04-21' 的分区

-- ALTER TABLE ADG_MONITOR_HISTORY DROP PARTITION p_202603 UPDATE GLOBAL INDEXES;
-- ALTER TABLE ADG_MONITOR_HISTORY DROP PARTITION p_202604 UPDATE GLOBAL INDEXES;

-- 注: UPDATE GLOBAL INDEXES 确保全局 PK 索引在 DROP 后保持有效


-- ====================================
-- 4. 对边界分区用 DELETE 清理部分过期数据
-- ====================================
-- 当分区跨越保留边界时 (部分数据过期, 部分还在保留期内), 使用 DELETE
-- 例如: 保留 30 天, 当前分区 p_202605 包含 5 月全月数据

-- DELETE FROM ADG_MONITOR_HISTORY
-- WHERE COLLECT_TIME < SYSTIMESTAMP - NUMTODSINTERVAL(30, 'DAY');
-- COMMIT;


-- ====================================
-- 5. 11g 维护: 拆分 p_maxval 添加新分区
-- ====================================
-- 在 24 个月预创建分区用尽前, 拆分 MAXVALUE 分区:

-- ALTER TABLE ADG_MONITOR_HISTORY SPLIT PARTITION p_maxval
-- AT (TIMESTAMP '2028-06-01 00:00:00')
-- INTO (PARTITION p_202805, PARTITION p_maxval);


-- ====================================
-- 6. 更新统计信息
-- ====================================
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        ownname => USER,
        tabname => 'ADG_MONITOR_HISTORY',
        granularity => 'PARTITION',
        cascade => TRUE
    );
END;
/
