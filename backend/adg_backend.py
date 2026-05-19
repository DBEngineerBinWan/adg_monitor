#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Oracle DataGuard ADG 监控平台 - Python Flask 后端
================================================

功能:
  - 连接Oracle 11g/19c备库，查询V$DATABASE, V$MANAGED_STANDBY, V$DATAGUARD_STATS
  - 持久化监控数据到Oracle数据库表中
  - 备库配置信息持久化到Oracle数据库表中
  - 提供REST API供前端调用
  - 连接测试功能
  - 历史趋势数据查询
  - 完全离线部署

依赖:
  pip install flask flask-cors oracledb
  (如需连接Oracle 11g，需安装Oracle Instant Client并启用thick模式)

用法:
  # 首次运行 - 自动创建表结构:
  python3 adg_backend.py --init-db

  # 启动服务:
  python3 adg_backend.py --port 5000

  # 指定本地Oracle连接 (用于持久化存储):
  python3 adg_backend.py --local-dsn "127.0.0.1:1521/ORCL" --local-user "adg_admin" --local-password "YourPassword"

作者: ADG Monitor
"""

import os
import sys
import json
import re
import time
import traceback
import threading
import argparse
import hashlib
import secrets
import base64
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

from cryptography.fernet import Fernet

from flask import Flask, request, jsonify
from flask_cors import CORS

# ============================================================================
# Oracle客户端选择
# ============================================================================
try:
    import oracledb
    ORACLE_MODULE = 'oracledb'
    print("[INFO] 使用 oracledb 模块")
except ImportError:
    try:
        import cx_Oracle as oracledb
        ORACLE_MODULE = 'cx_Oracle'
        print("[INFO] 使用 cx_Oracle 模块 (需要Oracle Instant Client)")
    except ImportError:
        print("[ERROR] 未找到 oracledb 或 cx_Oracle 模块!")
        print("[ERROR] 请执行: pip install oracledb")
        sys.exit(1)

# ============================================================================
# Flask应用初始化
# ============================================================================
app = Flask(__name__)
CORS(app)

# ============================================================================
# 密码哈希工具 (PBKDF2 + 随机盐)
# ============================================================================

def hash_password(password: str, salt: str = None) -> tuple:
    """
    使用 PBKDF2-HMAC-SHA256 对密码进行哈希
    返回 (hash_hex, salt_hex) 元组
    """
    if salt is None:
        salt = secrets.token_hex(32)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 200000)
    return dk.hex(), salt


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """验证密码是否匹配存储的哈希值"""
    if not stored_hash or not salt:
        return False
    computed, _ = hash_password(password, salt)
    return secrets.compare_digest(computed, stored_hash)


def migrate_plain_password(cursor):
    """
    将数据库中明文 login_password 迁移为 PBKDF2 哈希格式。
    格式: pbkdf2:sha256:200000$salt_hex$hash_hex
    """
    try:
        cursor.execute("SELECT SETTING_VALUE FROM ADG_SYSTEM_SETTINGS WHERE SETTING_KEY = 'login_password'")
        row = cursor.fetchone()
        if not row:
            return
        stored = str(row[0])
        # 已经是哈希格式则跳过
        if stored.startswith('pbkdf2:sha256:'):
            return
        # 明文密码 → 哈希
        hashed, salt = hash_password(stored)
        new_value = f'pbkdf2:sha256:200000${salt}${hashed}'
        cursor.execute("""
            UPDATE ADG_SYSTEM_SETTINGS
            SET SETTING_VALUE = :val, UPDATED_AT = SYSTIMESTAMP
            WHERE SETTING_KEY = 'login_password'
        """, {'val': new_value})
        print(f"  [INFO] 密码已从明文迁移为 PBKDF2 哈希")
    except Exception as e:
        print(f"  [WARN] 密码迁移失败: {e}")


def get_stored_password_data(cursor):
    """
    从数据库读取密码哈希数据，返回 (hash_hex, salt_hex)。
    自动检测并迁移明文密码。
    """
    cursor.execute("SELECT SETTING_VALUE FROM ADG_SYSTEM_SETTINGS WHERE SETTING_KEY = 'login_password'")
    row = cursor.fetchone()
    if not row:
        return None, None
    stored = str(row[0])
    # 检查是否为 PBKDF2 格式: pbkdf2:sha256:iterations$salt$hash
    if stored.startswith('pbkdf2:sha256:'):
        try:
            parts = stored.split('$')
            if len(parts) == 3:
                salt = parts[1]
                hash_hex = parts[2]
                return hash_hex, salt
        except Exception:
            pass
    # 明文密码 → 自动迁移
    hashed, salt = hash_password(stored)
    new_value = f'pbkdf2:sha256:200000${salt}${hashed}'
    try:
        cursor.execute("""
            UPDATE ADG_SYSTEM_SETTINGS
            SET SETTING_VALUE = :val, UPDATED_AT = SYSTIMESTAMP
            WHERE SETTING_KEY = 'login_password'
        """, {'val': new_value})
        cursor.connection.commit()
        print(f"  [INFO] 明文密码已自动迁移为 PBKDF2 哈希")
    except Exception:
        pass
    return hashed, salt


def get_or_create_fernet_key():
    """
    从数据库获取或创建 Fernet 加密密钥。
    用于加解密备库连接密码 (ADG_STANDBY_CONFIG.PASSWORD)。
    """
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT SETTING_VALUE FROM ADG_SYSTEM_SETTINGS WHERE SETTING_KEY = 'encryption_key'")
        row = cursor.fetchone()
        if row and row[0]:
            cursor.close()
            conn.close()
            return row[0]
        # 生成新密钥并存储
        key = Fernet.generate_key().decode('utf-8')
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'encryption_key' AS SETTING_KEY, :val AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """, {'val': key})
        conn.commit()
        cursor.close()
        conn.close()
        return key
    except Exception as e:
        print(f"[ERROR] 获取加密密钥失败: {e}")


def encrypt_standby_password(plain_text: str) -> str:
    """加密备库密码，返回 'FERN:base64_ciphertext' 格式"""
    if not plain_text:
        return plain_text
    try:
        key = get_or_create_fernet_key()
        if not key:
            return plain_text  # 无法获取密钥时回退明文
        f = Fernet(key.encode('utf-8'))
        encrypted = f.encrypt(plain_text.encode('utf-8'))
        return 'FERN:' + base64.urlsafe_b64encode(encrypted).decode('utf-8')
    except Exception as e:
        print(f"[ERROR] 加密密码失败: {e}")
        return plain_text


def decrypt_standby_password(stored: str) -> str:
    """解密备库密码，兼容旧明文格式"""
    if not stored:
        return stored
    if not stored.startswith('FERN:'):
        return stored  # 旧明文格式
    try:
        key = get_or_create_fernet_key()
        if not key:
            return stored
        encrypted = base64.urlsafe_b64decode(stored[5:].encode('utf-8'))
        f = Fernet(key.encode('utf-8'))
        return f.decrypt(encrypted).decode('utf-8')
    except Exception as e:
        print(f"[ERROR] 解密密码失败: {e}")
        return stored  # 解密失败返回原始值


def migrate_plain_passwords_in_config(cursor):
    """将 ADG_STANDBY_CONFIG 中的明文密码加密"""
    try:
        cursor.execute("SELECT ID, PASSWORD FROM ADG_STANDBY_CONFIG")
        rows = cursor.fetchall()
        migrated = 0
        for row in rows:
            db_id = row[0]
            pwd = str(row[1]) if row[1] else ''
            if not pwd or pwd.startswith('FERN:'):
                continue
            encrypted = encrypt_standby_password(pwd)
            cursor.execute("UPDATE ADG_STANDBY_CONFIG SET PASSWORD = :pwd WHERE ID = :id",
                          {'pwd': encrypted, 'id': db_id})
            migrated += 1
        if migrated > 0:
            print(f"  [INFO] 已加密 {migrated} 个备库密码")
    except Exception as e:
        print(f"  [WARN] 备库密码迁移失败: {e}")


# ============================================================================
# 全局配置 - 本地Oracle数据库连接 (用于持久化存储)
# ============================================================================
LOCAL_DB_CONFIG = {
    'dsn': os.environ.get('ADG_LOCAL_DSN', '127.0.0.1:1521/ORCL'),
    'user': os.environ.get('ADG_LOCAL_USER', 'adg_admin'),
    'password': os.environ.get('ADG_LOCAL_PASSWORD', 'Admin123'),
}

# Oracle Instant Client路径 (Oracle 11g需要)
INSTANT_CLIENT_DIR = os.environ.get('ORACLE_INSTANT_CLIENT', None)

# 自动采集线程控制
auto_collector = None
auto_collector_lock = threading.Lock()

# 本地Oracle连接池（避免每次查询都新建连接）
_local_pool = None
_local_pool_lock = threading.Lock()

# 设置缓存（避免频繁 get_setting 建连查询）
_settings_cache = {}
_settings_cache_time = 0
_settings_cache_lock = threading.Lock()

# 采集互斥锁（防止自动采集和手动采集并发执行）
_collecting = False
_collecting_lock = threading.Lock()

# 告警冷却（db_id → 上次告警时间戳）
_alert_cooldown = {}
_alert_cooldown_lock = threading.Lock()


def init_oracle_client():
    """初始化Oracle客户端 (Oracle 11g需要thick模式)"""
    if ORACLE_MODULE == 'oracledb' and INSTANT_CLIENT_DIR:
        try:
            oracledb.init_oracle_client(lib_dir=INSTANT_CLIENT_DIR)
            print(f"[INFO] 已初始化Oracle Instant Client: {INSTANT_CLIENT_DIR}")
        except Exception as e:
            print(f"[WARN] Oracle Instant Client初始化失败: {e}")
            print("[WARN] 将使用thin模式 (仅支持Oracle 12c+)")


# ============================================================================
# 本地Oracle数据库连接 (持久化存储)
# ============================================================================

def get_local_connection():
    """获取本地Oracle数据库连接 (从连接池获取)"""
    global _local_pool
    if _local_pool is None:
        with _local_pool_lock:
            if _local_pool is None:
                _local_pool = oracledb.create_pool(
                    user=LOCAL_DB_CONFIG['user'],
                    password=LOCAL_DB_CONFIG['password'],
                    dsn=LOCAL_DB_CONFIG['dsn'],
                    min=1,
                    max=10,
                    increment=1,
                )
    return _local_pool.acquire()


def get_remote_connection(host, port, service_name, username, password):
    """获取远程Oracle备库连接 (用于查询备库状态)"""
    dsn = f"{host}:{port}/{service_name}"
    conn = oracledb.connect(
        user=username,
        password=password,
        dsn=dsn
    )
    return conn


# ============================================================================
# 表结构定义 + 初始化
# ============================================================================

DDL_STATEMENTS = [
    # ---- 1. 备库配置表 ----
    """
    CREATE TABLE ADG_STANDBY_CONFIG (
        ID              VARCHAR2(64)   PRIMARY KEY,
        NAME            VARCHAR2(128)  NOT NULL,
        HOST            VARCHAR2(256)  NOT NULL,
        PORT            NUMBER(5)      DEFAULT 1521,
        SERVICE_NAME    VARCHAR2(128)  NOT NULL,
        USERNAME        VARCHAR2(128)  NOT NULL,
        PASSWORD        VARCHAR2(256)  NOT NULL,
        ENABLED         NUMBER(1)      DEFAULT 1,
        CREATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP,
        UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP
    )
    """,

    # ---- 2. 监控快照表 (最新状态) ----
    """
    CREATE TABLE ADG_MONITOR_STATUS (
        DB_ID               VARCHAR2(64)   PRIMARY KEY,
        DB_NAME             VARCHAR2(128),
        HOST                VARCHAR2(256),
        PORT                NUMBER(5),
        SERVICE_NAME        VARCHAR2(128),
        DB_UNIQUE_NAME      VARCHAR2(128),
        DATABASE_ROLE       VARCHAR2(64),
        OPEN_MODE           VARCHAR2(64),
        PROTECTION_MODE     VARCHAR2(64),
        SWITCHOVER_STATUS   VARCHAR2(64),
        MRP_STATUS          VARCHAR2(32),
        APPLY_LAG           VARCHAR2(64),
        APPLY_LAG_SECONDS   NUMBER(10)     DEFAULT 0,
        TRANSPORT_LAG       VARCHAR2(64),
        TRANSPORT_LAG_SECONDS NUMBER(10)   DEFAULT 0,
        HEALTH_STATUS       VARCHAR2(10),
        LAST_CHECKED        TIMESTAMP,
        ERROR_MSG           VARCHAR2(2000),
        MANAGED_STANDBY_JSON CLOB,
        DATAGUARD_STATS_JSON CLOB
    )
    """,

    # ---- 3. 历史记录表 (趋势图数据) ----
    """
    CREATE TABLE ADG_MONITOR_HISTORY (
        ID                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        DB_ID                 VARCHAR2(64)   NOT NULL,
        COLLECT_TIME          TIMESTAMP      DEFAULT SYSTIMESTAMP,
        APPLY_LAG_SECONDS     NUMBER(10)     DEFAULT 0,
        TRANSPORT_LAG_SECONDS NUMBER(10)     DEFAULT 0,
        MRP_STATUS            VARCHAR2(32),
        HEALTH_STATUS         VARCHAR2(10),
        APPLY_LAG             VARCHAR2(64),
        TRANSPORT_LAG         VARCHAR2(64)
    )
    """,

    # ---- 4. 系统设置表 ----
    """
    CREATE TABLE ADG_SYSTEM_SETTINGS (
        SETTING_KEY     VARCHAR2(128)  PRIMARY KEY,
        SETTING_VALUE   VARCHAR2(2000),
        UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP
    )
    """,

    # ---- 5. 历史表索引 ----
    """
    CREATE INDEX IDX_HISTORY_DBID_TIME ON ADG_MONITOR_HISTORY(DB_ID, COLLECT_TIME DESC)
    """,

    """
    CREATE INDEX IDX_HISTORY_TIME ON ADG_MONITOR_HISTORY(COLLECT_TIME DESC)
    """,
]

# Oracle 11g 不支持 IDENTITY 列，提供兼容的建表语句
DDL_STATEMENTS_11G = [
    # ---- 1. 备库配置表 ----
    """
    CREATE TABLE ADG_STANDBY_CONFIG (
        ID              VARCHAR2(64)   PRIMARY KEY,
        NAME            VARCHAR2(128)  NOT NULL,
        HOST            VARCHAR2(256)  NOT NULL,
        PORT            NUMBER(5)      DEFAULT 1521,
        SERVICE_NAME    VARCHAR2(128)  NOT NULL,
        USERNAME        VARCHAR2(128)  NOT NULL,
        PASSWORD        VARCHAR2(256)  NOT NULL,
        ENABLED         NUMBER(1)      DEFAULT 1,
        CREATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP,
        UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP
    )
    """,

    # ---- 2. 监控快照表 ----
    """
    CREATE TABLE ADG_MONITOR_STATUS (
        DB_ID               VARCHAR2(64)   PRIMARY KEY,
        DB_NAME             VARCHAR2(128),
        HOST                VARCHAR2(256),
        PORT                NUMBER(5),
        SERVICE_NAME        VARCHAR2(128),
        DB_UNIQUE_NAME      VARCHAR2(128),
        DATABASE_ROLE       VARCHAR2(64),
        OPEN_MODE           VARCHAR2(64),
        PROTECTION_MODE     VARCHAR2(64),
        SWITCHOVER_STATUS   VARCHAR2(64),
        MRP_STATUS          VARCHAR2(32),
        APPLY_LAG           VARCHAR2(64),
        APPLY_LAG_SECONDS   NUMBER(10)     DEFAULT 0,
        TRANSPORT_LAG       VARCHAR2(64),
        TRANSPORT_LAG_SECONDS NUMBER(10)   DEFAULT 0,
        HEALTH_STATUS       VARCHAR2(10),
        LAST_CHECKED        TIMESTAMP,
        ERROR_MSG           VARCHAR2(2000),
        MANAGED_STANDBY_JSON CLOB,
        DATAGUARD_STATS_JSON CLOB
    )
    """,

    # ---- 3. 历史记录表 (Oracle 11g 使用序列+触发器) ----
    """
    CREATE SEQUENCE SEQ_ADG_HISTORY START WITH 1 INCREMENT BY 1 NOCACHE
    """,

    """
    CREATE TABLE ADG_MONITOR_HISTORY (
        ID                    NUMBER         PRIMARY KEY,
        DB_ID                 VARCHAR2(64)   NOT NULL,
        COLLECT_TIME          TIMESTAMP      DEFAULT SYSTIMESTAMP,
        APPLY_LAG_SECONDS     NUMBER(10)     DEFAULT 0,
        TRANSPORT_LAG_SECONDS NUMBER(10)     DEFAULT 0,
        MRP_STATUS            VARCHAR2(32),
        HEALTH_STATUS         VARCHAR2(10),
        APPLY_LAG             VARCHAR2(64),
        TRANSPORT_LAG         VARCHAR2(64)
    )
    """,

    """
    CREATE OR REPLACE TRIGGER TRG_ADG_HISTORY_ID
    BEFORE INSERT ON ADG_MONITOR_HISTORY
    FOR EACH ROW
    BEGIN
        SELECT SEQ_ADG_HISTORY.NEXTVAL INTO :NEW.ID FROM DUAL;
    END;
    """,

    # ---- 4. 系统设置表 ----
    """
    CREATE TABLE ADG_SYSTEM_SETTINGS (
        SETTING_KEY     VARCHAR2(128)  PRIMARY KEY,
        SETTING_VALUE   VARCHAR2(2000),
        UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP
    )
    """,

    # ---- 5. 索引 ----
    """
    CREATE INDEX IDX_HISTORY_DBID_TIME ON ADG_MONITOR_HISTORY(DB_ID, COLLECT_TIME DESC)
    """,

    """
    CREATE INDEX IDX_HISTORY_TIME ON ADG_MONITOR_HISTORY(COLLECT_TIME DESC)
    """,
]


def init_database(use_11g=False):
    """初始化数据库表结构"""
    print("=" * 60)
    print("  初始化数据库表结构")
    print("=" * 60)

    conn = get_local_connection()
    cursor = conn.cursor()

    ddl_list = DDL_STATEMENTS_11G if use_11g else DDL_STATEMENTS

    for ddl in ddl_list:
        ddl_clean = ddl.strip()
        # 提取对象名用于显示
        obj_name = ddl_clean.split('\n')[0].strip() if ddl_clean else ''
        try:
            cursor.execute(ddl_clean)
            print(f"  [OK] {obj_name[:60]}...")
        except Exception as e:
            err_str = str(e)
            if 'ORA-00955' in err_str:
                # 对象已存在
                print(f"  [SKIP] 已存在: {obj_name[:60]}...")
            elif 'ORA-01408' in err_str:
                # 索引已存在
                print(f"  [SKIP] 索引已存在: {obj_name[:60]}...")
            elif 'ORA-02260' in err_str:
                print(f"  [SKIP] 约束已存在: {obj_name[:60]}...")
            elif 'ORA-02261' in err_str:
                print(f"  [SKIP] 唯一约束已存在: {obj_name[:60]}...")
            elif 'ORA-04088' in err_str:
                print(f"  [SKIP] 触发器已存在: {obj_name[:60]}...")
            else:
                print(f"  [ERROR] {obj_name[:60]}...")
                print(f"          {err_str}")

    conn.commit()

    # 插入默认设置
    try:
        # 密码使用 PBKDF2 哈希存储 (仅首次插入)
        default_password = 'admin123'
        hashed, salt = hash_password(default_password)
        hash_value = f'pbkdf2:sha256:200000${salt}${hashed}'
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'login_password' AS SETTING_KEY, :hash_val AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """, {'hash_val': hash_value})
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'collection_interval' AS SETTING_KEY, '30' AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """)
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'yellow_threshold' AS SETTING_KEY, '300' AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """)
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'red_threshold' AS SETTING_KEY, '1800' AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """)
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'auto_collect_enabled' AS SETTING_KEY, '1' AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """)
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'history_retention_days' AS SETTING_KEY, '30' AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """)
        conn.commit()
        print("  [OK] 默认设置已初始化")
        # 迁移已有的明文密码为哈希格式
        migrate_plain_password(cursor)
        # 初始化加密密钥并迁移旧明文备库密码
        get_or_create_fernet_key()
        migrate_plain_passwords_in_config(cursor)
        conn.commit()
    except Exception as e:
        print(f"  [WARN] 设置初始化: {e}")

    cursor.close()
    conn.close()
    print("=" * 60)
    print("  数据库初始化完成!")
    print("=" * 60)


# ============================================================================
# 辅助函数
# ============================================================================

def parse_lag_to_seconds(lag_str):
    """解析Oracle延时字符串为秒数 (来自V$DATAGUARD_STATS的VALUE列)"""
    if not lag_str or lag_str.strip() == '':
        return 0
    lag_str = lag_str.strip()
    # 格式: +DD HH:MI:SS
    match = re.match(r'\+?(\d+)\s+(\d+):(\d+):(\d+)', lag_str)
    if match:
        days = int(match.group(1))
        hours = int(match.group(2))
        minutes = int(match.group(3))
        seconds = int(match.group(4))
        return days * 86400 + hours * 3600 + minutes * 60 + seconds
    # 格式: HH:MI:SS
    match = re.match(r'(\d+):(\d+):(\d+)', lag_str)
    if match:
        hours = int(match.group(1))
        minutes = int(match.group(2))
        seconds = int(match.group(3))
        return hours * 3600 + minutes * 60 + seconds
    try:
        return int(float(lag_str))
    except (ValueError, TypeError):
        return 0


def determine_health_status(mrp_status, apply_lag_seconds, yellow_threshold, red_threshold, has_error,
                            mrp0_wait_for_log_block_zero=False):
    """判断健康状态"""
    if has_error:
        return 'red'
    mrp_normal = mrp_status in ('APPLYING_LOG', 'WAIT_FOR_LOG')
    if not mrp_normal:
        return 'red'
    # 新增: MRP0 WAIT_FOR_LOG 且 BLOCK#=0 → 黄色
    if mrp0_wait_for_log_block_zero:
        return 'yellow'
    if apply_lag_seconds <= yellow_threshold:
        return 'green'
    elif apply_lag_seconds <= red_threshold:
        return 'yellow'
    else:
        return 'red'


def _refresh_settings_cache():
    """刷新设置缓存（从数据库加载所有设置到内存）"""
    global _settings_cache, _settings_cache_time
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT SETTING_KEY, SETTING_VALUE FROM ADG_SYSTEM_SETTINGS")
        rows = cursor.fetchall()
        _settings_cache = {row[0]: row[1] for row in rows}
        _settings_cache_time = time.time()
        cursor.close()
        conn.close()
    except Exception:
        pass  # 保持旧缓存


def get_setting(key, default=None):
    """从缓存读取系统设置，每30秒自动刷新"""
    now = time.time()
    if now - _settings_cache_time > 30:
        _refresh_settings_cache()
    return _settings_cache.get(key, default)


def set_setting(key, value):
    """保存系统设置到数据库"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT :skey AS SETTING_KEY, :sval AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN MATCHED THEN UPDATE SET SETTING_VALUE = s.SETTING_VALUE, UPDATED_AT = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """, {'skey': key, 'sval': str(value)})
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"[ERROR] 保存设置失败: {e}")


# ============================================================================
# 告警推送
# ============================================================================

def get_alert_config():
    """获取告警配置（60秒缓存）"""
    raw = get_setting('alert_config', None)
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return {'enabled': False, 'webhook_url': '', 'cooldown_minutes': 30}


def send_webhook_alert(db_id, db_name, db_config, old_status, new_status, result):
    """发送 Webhook 告警（带冷却，不阻塞采集）"""
    config = get_alert_config()
    url = config.get('webhookUrl') or config.get('webhook_url', '')
    if not config.get('enabled') or not url:
        return

    cooldown = int(config.get('cooldown_minutes', 30))
    with _alert_cooldown_lock:
        key = f"{db_id}:{new_status}"
        last_time = _alert_cooldown.get(key)
        now_ts = time.time()
        if last_time and (now_ts - last_time) < cooldown * 60:
            return  # 冷却中，跳过
        _alert_cooldown[key] = now_ts

    payload = {
        'event': 'health_change',
        'db_name': db_name,
        'db_host': db_config.get('host', ''),
        'old_status': old_status,
        'new_status': new_status,
        'apply_lag_seconds': result.get('apply_lag_seconds', 0),
        'transport_lag_seconds': result.get('transport_lag_seconds', 0),
        'mrp_status': result.get('mrp_status', 'NOT_FOUND'),
        'error': result.get('error'),
        'timestamp': datetime.now().isoformat(),
    }

    try:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/json; charset=utf-8'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=5)
        print(f"[ALERT] 告警已发送: {db_name} {old_status} → {new_status}")
    except Exception as e:
        print(f"[ALERT] 告警发送失败 ({db_name}): {e}")


# ============================================================================
# SQL查询 - 严格基于Oracle官方文档
# ============================================================================

SQL_DATABASE_INFO = """
SELECT 
    DB_UNIQUE_NAME,
    DATABASE_ROLE,
    OPEN_MODE,
    PROTECTION_MODE,
    SWITCHOVER_STATUS
FROM V$DATABASE
"""

# V$MANAGED_STANDBY - 备库管理进程信息
# 参考Oracle官方文档:
# PROCESS: RFS, MRP0, MR(fg), ARCH, FGRD, LGWR, RFS(FAL), RFS(NEXP), LNS
# STATUS: UNUSED, ALLOCATED, CONNECTED, ATTACHED, IDLE, ERROR, OPENING, CLOSING,
#         WRITING, RECEIVING, ANNOUNCING, REGISTERING, WAIT_FOR_LOG, WAIT_FOR_GAP, APPLYING_LOG
SQL_MANAGED_STANDBY = """
SELECT 
    PROCESS,
    PID,
    STATUS,
    CLIENT_PROCESS,
    THREAD#,
    SEQUENCE#,
    BLOCK#,
    BLOCKS,
    DELAY_MINS
FROM V$MANAGED_STANDBY
"""

SQL_DATAGUARD_STATS = """
SELECT 
    NAME,
    VALUE,
    UNIT,
    DATUM_TIME
FROM V$DATAGUARD_STATS
"""

SQL_VERSION = "SELECT VERSION FROM V$INSTANCE"


# ============================================================================
# 核心采集函数
# ============================================================================

def query_single_standby(db_config, yellow_threshold=300, red_threshold=1800):
    """
    查询单个备库的完整状态
    
    参数:
        db_config: dict with host, port, service_name, username, password
        yellow_threshold: 黄色告警阈值(秒)
        red_threshold: 红色告警阈值(秒)
    
    返回:
        dict: 完整的监控状态数据
    """
    result = {
        'database_info': {},
        'managed_standby': [],
        'dataguard_stats': [],
        'mrp_status': 'NOT_FOUND',
        'apply_lag': 'N/A',
        'apply_lag_seconds': 0,
        'transport_lag': 'N/A',
        'transport_lag_seconds': 0,
        'health_status': 'red',
        'error': None,
    }

    try:
        conn = get_remote_connection(
            db_config['host'],
            db_config['port'],
            db_config['service_name'],
            db_config['username'],
            db_config['password']
        )
        cursor = conn.cursor()

        # ---- 1. V$DATABASE ----
        try:
            cursor.execute(SQL_DATABASE_INFO)
            row = cursor.fetchone()
            if row:
                result['database_info'] = {
                    'db_unique_name': str(row[0]) if row[0] else '',
                    'database_role': str(row[1]) if row[1] else '',
                    'open_mode': str(row[2]) if row[2] else '',
                    'protection_mode': str(row[3]) if row[3] else '',
                    'switchover_status': str(row[4]) if row[4] else '',
                }
        except Exception as e:
            result['error'] = f'V$DATABASE查询失败: {str(e)}'

        # ---- 2. V$MANAGED_STANDBY ----
        try:
            cursor.execute(SQL_MANAGED_STANDBY)
            rows = cursor.fetchall()
            mrp_found = False
            for row in rows:
                process = str(row[0]).strip() if row[0] else ''
                pid = int(row[1]) if row[1] else 0
                status = str(row[2]).strip() if row[2] else 'UNUSED'
                client_process = str(row[3]).strip() if row[3] else 'N/A'
                thread = int(row[4]) if row[4] else 0
                sequence = int(row[5]) if row[5] else 0
                block = int(row[6]) if row[6] else 0
                blocks = int(row[7]) if row[7] else 0
                delay_mins = int(row[8]) if row[8] else 0

                result['managed_standby'].append({
                    'process': process,
                    'pid': pid,
                    'status': status,
                    'client_process': client_process,
                    'thread': thread,
                    'sequence': sequence,
                    'block': block,
                    'blocks': blocks,
                    'delay_mins': delay_mins,
                })

                if process in ('MRP0', 'MR(fg)'):
                    mrp_found = True
                    result['mrp_status'] = status

            if not mrp_found:
                result['mrp_status'] = 'NOT_FOUND'

        except Exception as e:
            err_msg = f'V$MANAGED_STANDBY查询失败: {str(e)}'
            result['error'] = (result['error'] + '; ' + err_msg) if result['error'] else err_msg

        # ---- 3. V$DATAGUARD_STATS ----
        try:
            cursor.execute(SQL_DATAGUARD_STATS)
            rows = cursor.fetchall()
            for row in rows:
                name = str(row[0]).strip().lower() if row[0] else ''
                value = str(row[1]).strip() if row[1] else ''
                unit = str(row[2]).strip() if row[2] else ''
                datum_time = str(row[3]) if row[3] else ''

                result['dataguard_stats'].append({
                    'name': name,
                    'value': value,
                    'unit': unit,
                    'datum_time': datum_time,
                })

                if name == 'apply lag':
                    result['apply_lag'] = value
                    result['apply_lag_seconds'] = parse_lag_to_seconds(value)
                elif name == 'transport lag':
                    result['transport_lag'] = value
                    result['transport_lag_seconds'] = parse_lag_to_seconds(value)

        except Exception as e:
            err_msg = f'V$DATAGUARD_STATS查询失败: {str(e)}'
            result['error'] = (result['error'] + '; ' + err_msg) if result['error'] else err_msg

        cursor.close()
        conn.close()

    except Exception as e:
        error_msg = str(e)
        if 'ORA-12541' in error_msg:
            result['error'] = '无法连接(ORA-12541): 检查主机和端口及监听'
        elif 'ORA-12514' in error_msg:
            result['error'] = '服务名不存在(ORA-12514)'
        elif 'ORA-01017' in error_msg:
            result['error'] = '用户名/密码错误(ORA-01017)'
        elif 'ORA-01031' in error_msg:
            result['error'] = '权限不足(ORA-01031)'
        else:
            result['error'] = f'连接失败: {error_msg}'

    # 检测 MRP0 WAIT_FOR_LOG + BLOCK#=0
    mrp0_wait_block_zero = any(
        p.get('process') in ('MRP0', 'MR(fg)') and
        p.get('status') == 'WAIT_FOR_LOG' and
        p.get('block') == 0
        for p in result.get('managed_standby', [])
    )

    # 计算健康状态
    has_error = bool(result['error'])
    result['health_status'] = determine_health_status(
        result['mrp_status'],
        result['apply_lag_seconds'],
        yellow_threshold,
        red_threshold,
        has_error,
        mrp0_wait_for_log_block_zero=mrp0_wait_block_zero
    )

    return result


def persist_status(db_id, db_name, db_config, query_result):
    """将查询结果持久化到Oracle数据库"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()

        now = datetime.now()
        di = query_result.get('database_info', {})

        # ---- 查询旧状态（用于告警检测） ----
        old_health = None
        try:
            cursor.execute(
                "SELECT HEALTH_STATUS FROM ADG_MONITOR_STATUS WHERE DB_ID = :1",
                [db_id]
            )
            old_row = cursor.fetchone()
            if old_row and old_row[0]:
                old_health = str(old_row[0])
        except Exception:
            pass

        # ---- MERGE到状态表 ----
        cursor.execute("""
            MERGE INTO ADG_MONITOR_STATUS t
            USING (SELECT :db_id AS DB_ID FROM DUAL) s
            ON (t.DB_ID = s.DB_ID)
            WHEN MATCHED THEN UPDATE SET
                DB_NAME = :db_name,
                HOST = :host,
                PORT = :port,
                SERVICE_NAME = :sname,
                DB_UNIQUE_NAME = :unique_name,
                DATABASE_ROLE = :db_role,
                OPEN_MODE = :open_mode,
                PROTECTION_MODE = :prot_mode,
                SWITCHOVER_STATUS = :sw_status,
                MRP_STATUS = :mrp_status,
                APPLY_LAG = :apply_lag,
                APPLY_LAG_SECONDS = :apply_lag_sec,
                TRANSPORT_LAG = :transport_lag,
                TRANSPORT_LAG_SECONDS = :transport_lag_sec,
                HEALTH_STATUS = :health,
                LAST_CHECKED = :last_checked,
                ERROR_MSG = :err_msg,
                MANAGED_STANDBY_JSON = :ms_json,
                DATAGUARD_STATS_JSON = :ds_json
            WHEN NOT MATCHED THEN INSERT (
                DB_ID, DB_NAME, HOST, PORT, SERVICE_NAME,
                DB_UNIQUE_NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE, SWITCHOVER_STATUS,
                MRP_STATUS, APPLY_LAG, APPLY_LAG_SECONDS, TRANSPORT_LAG, TRANSPORT_LAG_SECONDS,
                HEALTH_STATUS, LAST_CHECKED, ERROR_MSG, MANAGED_STANDBY_JSON, DATAGUARD_STATS_JSON
            ) VALUES (
                :db_id, :db_name, :host, :port, :sname,
                :unique_name, :db_role, :open_mode, :prot_mode, :sw_status,
                :mrp_status, :apply_lag, :apply_lag_sec, :transport_lag, :transport_lag_sec,
                :health, :last_checked, :err_msg, :ms_json, :ds_json
            )
        """, {
            'db_id': db_id,
            'db_name': db_name,
            'host': db_config.get('host', ''),
            'port': int(db_config.get('port', 1521)),
            'sname': db_config.get('service_name', ''),
            'unique_name': di.get('db_unique_name', ''),
            'db_role': di.get('database_role', ''),
            'open_mode': di.get('open_mode', ''),
            'prot_mode': di.get('protection_mode', ''),
            'sw_status': di.get('switchover_status', ''),
            'mrp_status': query_result.get('mrp_status', 'NOT_FOUND'),
            'apply_lag': query_result.get('apply_lag', 'N/A'),
            'apply_lag_sec': query_result.get('apply_lag_seconds', 0),
            'transport_lag': query_result.get('transport_lag', 'N/A'),
            'transport_lag_sec': query_result.get('transport_lag_seconds', 0),
            'health': query_result.get('health_status', 'red'),
            'last_checked': now,
            'err_msg': query_result.get('error', None),
            'ms_json': json.dumps(query_result.get('managed_standby', []), ensure_ascii=False),
            'ds_json': json.dumps(query_result.get('dataguard_stats', []), ensure_ascii=False),
        })

        # ---- INSERT到历史表 ----
        cursor.execute("""
            INSERT INTO ADG_MONITOR_HISTORY (
                DB_ID, COLLECT_TIME, APPLY_LAG_SECONDS, TRANSPORT_LAG_SECONDS,
                MRP_STATUS, HEALTH_STATUS, APPLY_LAG, TRANSPORT_LAG
            ) VALUES (
                :1, :2, :3, :4, :5, :6, :7, :8
            )
        """, [
            db_id,
            now,
            query_result.get('apply_lag_seconds', 0),
            query_result.get('transport_lag_seconds', 0),
            query_result.get('mrp_status', 'NOT_FOUND'),
            query_result.get('health_status', 'red'),
            query_result.get('apply_lag', 'N/A'),
            query_result.get('transport_lag', 'N/A'),
        ])

        conn.commit()
        cursor.close()
        conn.close()

        # ---- 检测状态变化并发送告警 ----
        new_health = query_result.get('health_status', 'red')
        if old_health and old_health != new_health:
            send_webhook_alert(db_id, db_name, db_config, old_health, new_health, query_result)

    except Exception as e:
        print(f"[ERROR] 持久化失败 ({db_name}): {e}")
        traceback.print_exc()


def collect_single_standby(row, yellow_threshold, red_threshold):
    """采集单个备库（线程池工作函数，在线程中执行）"""
    db_id, db_name, host, port, service_name, username, encrypted_pwd = row
    db_config = {
        'host': host,
        'port': int(port) if port else 1521,
        'service_name': service_name,
        'username': username,
        'password': decrypt_standby_password(str(encrypted_pwd) if encrypted_pwd else ''),
    }
    result = query_single_standby(db_config, yellow_threshold, red_threshold)
    persist_status(db_id, db_name, db_config, result)
    return db_name, result


def collect_all_standbys():
    """采集所有已启用的备库状态（并行采集，避免串行阻塞）"""
    yellow = int(get_setting('yellow_threshold', '300'))
    red = int(get_setting('red_threshold', '1800'))

    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ID, NAME, HOST, PORT, SERVICE_NAME, USERNAME, PASSWORD
            FROM ADG_STANDBY_CONFIG WHERE ENABLED = 1
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"[ERROR] 读取备库配置失败: {e}")
        return

    if not rows:
        return

    # 并行采集，最多10个并发线程
    max_workers = min(len(rows), 10)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(collect_single_standby, row, yellow, red): row for row in rows}
        for future in as_completed(futures):
            try:
                db_name, result = future.result()
                health = result.get('health_status', 'red')
                symbol = '🟢' if health == 'green' else ('🟡' if health == 'yellow' else '🔴')
                print(f"  {symbol} {db_name}: MRP={result['mrp_status']}, "
                      f"ApplyLag={result['apply_lag_seconds']}s, "
                      f"TransportLag={result['transport_lag_seconds']}s")
            except Exception as e:
                row = futures[future]
                print(f"  🔴 {row[1]}: 采集异常 - {e}")


def cleanup_old_history():
    """清理过期历史数据"""
    retention_days = int(get_setting('history_retention_days', '30'))
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM ADG_MONITOR_HISTORY WHERE COLLECT_TIME < SYSTIMESTAMP - NUMTODSINTERVAL(:1, 'DAY')",
            [retention_days]
        )
        deleted = cursor.rowcount
        conn.commit()
        cursor.close()
        conn.close()
        if deleted > 0:
            print(f"[INFO] 清理了 {deleted} 条过期历史数据 (保留{retention_days}天)")
    except Exception as e:
        print(f"[WARN] 清理历史数据失败: {e}")


# ============================================================================
# 自动采集线程
# ============================================================================

class AutoCollector(threading.Thread):
    """自动采集线程"""
    def __init__(self):
        super().__init__(daemon=True)
        self.running = True
        self.cleanup_counter = 0

    def run(self):
        print("[INFO] 自动采集线程已启动")
        while self.running:
            # 使用缓存读取设置，避免每次建连查询
            enabled = get_setting('auto_collect_enabled', '1')
            interval = int(get_setting('collection_interval', '30'))
            interval = max(10, interval)

            if enabled == '1':
                print(f"\n[COLLECT] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} 开始采集...")
                try:
                    # 使用互斥锁，避免与手动采集并发
                    global _collecting
                    with _collecting_lock:
                        if _collecting:
                            print("[COLLECT] 上一次采集尚未完成，跳过本轮")
                            should_collect = False
                        else:
                            _collecting = True
                            should_collect = True
                    if should_collect:
                        try:
                            collect_all_standbys()
                        finally:
                            with _collecting_lock:
                                _collecting = False
                except Exception as e:
                    print(f"[ERROR] 采集异常: {e}")

                # 每100次采集清理一次历史
                self.cleanup_counter += 1
                if self.cleanup_counter >= 100:
                    cleanup_old_history()
                    self.cleanup_counter = 0

            # 等待间隔时间(分段等待，方便停止)
            for _ in range(interval):
                if not self.running:
                    break
                time.sleep(1)

        print("[INFO] 自动采集线程已停止")

    def stop(self):
        self.running = False


# ============================================================================
# API路由
# ============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查"""
    db_ok = False
    try:
        conn = get_local_connection()
        conn.close()
        db_ok = True
    except:
        pass

    return jsonify({
        'status': 'ok',
        'oracle_module': ORACLE_MODULE,
        'local_db_connected': db_ok,
        'timestamp': datetime.now().isoformat(),
    })


# ---------- 认证 ----------

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    """验证登录密码"""
    try:
        data = request.get_json()
        password = data.get('password', '')

        if not password:
            return jsonify({'success': False, 'message': '密码不能为空'}), 400

        conn = get_local_connection()
        cursor = conn.cursor()
        stored_hash, salt = get_stored_password_data(cursor)
        cursor.close()
        conn.close()

        if stored_hash and verify_password(password, stored_hash, salt):
            return jsonify({'success': True, 'message': '登录成功'})
        else:
            return jsonify({'success': False, 'message': '密码错误'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'认证服务异常: {str(e)}'})


@app.route('/api/auth/change-password', methods=['POST'])
def auth_change_password():
    """修改登录密码 (PBKDF2 哈希存储)"""
    try:
        data = request.get_json()
        old_password = data.get('old_password', '')
        new_password = data.get('new_password', '')

        if not old_password or not new_password:
            return jsonify({'success': False, 'message': '旧密码和新密码不能为空'}), 400

        if len(new_password) < 4:
            return jsonify({'success': False, 'message': '新密码至少4位'}), 400

        conn = get_local_connection()
        cursor = conn.cursor()

        # 验证旧密码
        stored_hash, salt = get_stored_password_data(cursor)
        if stored_hash and not verify_password(old_password, stored_hash, salt):
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': '旧密码错误'})

        # 哈希新密码并存储
        new_hashed, new_salt = hash_password(new_password)
        new_value = f'pbkdf2:sha256:200000${new_salt}${new_hashed}'

        cursor.execute("""
            MERGE INTO ADG_SYSTEM_SETTINGS t
            USING (SELECT 'login_password' AS SETTING_KEY, :val AS SETTING_VALUE FROM DUAL) s
            ON (t.SETTING_KEY = s.SETTING_KEY)
            WHEN MATCHED THEN UPDATE SET SETTING_VALUE = s.SETTING_VALUE, UPDATED_AT = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
        """, {'val': new_value})

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': '密码修改成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'修改密码失败: {str(e)}'})


# ---------- 连接测试 ----------

@app.route('/api/test_connection', methods=['POST'])
def test_connection():
    """测试Oracle备库连接"""
    try:
        data = request.get_json()
        host = data.get('host', '')
        port = int(data.get('port', 1521))
        service_name = data.get('service_name', '')
        username = data.get('username', '')
        password = data.get('password', '')

        if not all([host, service_name, username, password]):
            return jsonify({'success': False, 'message': '缺少必要参数'}), 400

        conn = get_remote_connection(host, port, service_name, username, password)
        cursor = conn.cursor()

        details = {}
        try:
            cursor.execute(SQL_DATABASE_INFO)
            row = cursor.fetchone()
            if row:
                details['db_unique_name'] = str(row[0]) if row[0] else ''
                details['database_role'] = str(row[1]) if row[1] else ''
                details['open_mode'] = str(row[2]) if row[2] else ''
                details['protection_mode'] = str(row[3]) if row[3] else ''
                details['switchover_status'] = str(row[4]) if row[4] else ''
        except Exception as e:
            details['v_database_error'] = str(e)

        try:
            cursor.execute(SQL_VERSION)
            row = cursor.fetchone()
            if row:
                details['version'] = str(row[0])
        except Exception as e:
            details['version_error'] = str(e)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': f'连接成功! 数据库: {details.get("db_unique_name", "N/A")}, '
                       f'角色: {details.get("database_role", "N/A")}, '
                       f'模式: {details.get("open_mode", "N/A")}',
            'details': details,
        })

    except Exception as e:
        error_msg = str(e)
        if 'ORA-12541' in error_msg:
            friendly = '无法连接(ORA-12541): 检查主机/端口/监听'
        elif 'ORA-12514' in error_msg:
            friendly = '服务名不存在(ORA-12514)'
        elif 'ORA-01017' in error_msg:
            friendly = '用户名/密码错误(ORA-01017)'
        elif 'ORA-28000' in error_msg:
            friendly = '账户被锁定(ORA-28000)'
        elif 'ORA-01031' in error_msg:
            friendly = '权限不足(ORA-01031)'
        elif 'DPI-1047' in error_msg or 'DPI-1072' in error_msg:
            friendly = 'Oracle客户端未安装或配置错误'
        else:
            friendly = f'连接失败: {error_msg}'
        return jsonify({'success': False, 'message': friendly})


# ---------- 测试本地数据库连接 ----------

@app.route('/api/test_local_db', methods=['GET'])
def test_local_db():
    """测试本地Oracle数据库连接（持久化存储用）"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM DUAL")
        cursor.close()

        # 检查表是否存在
        cursor2 = conn.cursor()
        tables = []
        for tbl in ['ADG_STANDBY_CONFIG', 'ADG_MONITOR_STATUS', 'ADG_MONITOR_HISTORY', 'ADG_SYSTEM_SETTINGS']:
            try:
                cursor2.execute(f"SELECT COUNT(*) FROM {tbl}")
                cnt = cursor2.fetchone()[0]
                tables.append({'name': tbl, 'rows': cnt, 'exists': True})
            except:
                tables.append({'name': tbl, 'exists': False, 'rows': 0})

        cursor2.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': '本地数据库连接成功',
            'dsn': LOCAL_DB_CONFIG['dsn'],
            'user': LOCAL_DB_CONFIG['user'],
            'tables': tables,
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'本地数据库连接失败: {str(e)}',
        })


# ---------- 备库配置CRUD ----------

@app.route('/api/databases', methods=['GET'])
def list_databases():
    """获取所有备库配置"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ID, NAME, HOST, PORT, SERVICE_NAME, USERNAME, PASSWORD, ENABLED, 
                   TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI:SS')
            FROM ADG_STANDBY_CONFIG 
            ORDER BY CREATED_AT
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        databases = []
        for row in rows:
            databases.append({
                'id': row[0],
                'name': row[1],
                'host': row[2],
                'port': int(row[3]) if row[3] else 1521,
                'serviceName': row[4],
                'username': row[5],
                'password': decrypt_standby_password(str(row[6]) if row[6] else ''),
                'enabled': bool(row[7]),
                'createdAt': row[8],
            })
        return jsonify({'success': True, 'databases': databases})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e), 'databases': []})


@app.route('/api/databases', methods=['POST'])
def save_database():
    """添加或更新备库配置"""
    try:
        data = request.get_json()
        db_id = data.get('id', '')
        name = data.get('name', '')
        host = data.get('host', '')
        port = int(data.get('port', 1521))
        service_name = data.get('serviceName', '')
        username = data.get('username', '')
        password = data.get('password', '')
        enabled = 1 if data.get('enabled', True) else 0

        # 加密密码 (已加密格式不重复加密)
        if password and not password.startswith('FERN:'):
            password = encrypt_standby_password(password)

        if not all([db_id, name, host, service_name, username]):
            return jsonify({'success': False, 'message': '缺少必要字段'}), 400

        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("""
            MERGE INTO ADG_STANDBY_CONFIG t
            USING (SELECT :db_id AS ID FROM DUAL) s
            ON (t.ID = s.ID)
            WHEN MATCHED THEN UPDATE SET
                NAME = :name, HOST = :host, PORT = :port, SERVICE_NAME = :sname,
                USERNAME = :uname, PASSWORD = :pwd, ENABLED = :enabled, UPDATED_AT = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (
                ID, NAME, HOST, PORT, SERVICE_NAME, USERNAME, PASSWORD, ENABLED
            ) VALUES (:db_id, :name, :host, :port, :sname, :uname, :pwd, :enabled)
        """, {'db_id': db_id, 'name': name, 'host': host, 'port': port,
              'sname': service_name, 'uname': username, 'pwd': password, 'enabled': enabled})
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': f'备库 {name} 保存成功'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/databases/<db_id>', methods=['DELETE'])
def delete_database(db_id):
    """删除备库配置及关联数据"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM ADG_MONITOR_HISTORY WHERE DB_ID = :1", [db_id])
        cursor.execute("DELETE FROM ADG_MONITOR_STATUS WHERE DB_ID = :1", [db_id])
        cursor.execute("DELETE FROM ADG_STANDBY_CONFIG WHERE ID = :1", [db_id])
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': '已删除'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/databases/batch', methods=['POST'])
def batch_import():
    """批量导入备库配置"""
    try:
        data = request.get_json()
        databases = data.get('databases', [])
        if not databases:
            return jsonify({'success': False, 'message': '没有要导入的数据'}), 400

        imported = 0
        skipped = 0
        errors = []

        conn = get_local_connection()
        cursor = conn.cursor()

        for i, db in enumerate(databases):
            db_id = db.get('id', '').strip()
            name = db.get('name', '').strip()
            host = db.get('host', '').strip()
            port = int(db.get('port', 1521))
            service_name = db.get('serviceName', '').strip()
            username = db.get('username', '').strip()
            password = db.get('password', '')

            # 校验必填字段
            if not all([name, host, service_name, username]):
                errors.append({'row': i + 1, 'name': name or '(空)', 'error': '缺少必填字段'})
                skipped += 1
                continue

            # 自动生成ID
            if not db_id:
                import hashlib
                db_id = hashlib.md5(f"{name}{host}{service_name}".encode()).hexdigest()[:32]

            # 加密密码
            if password and not password.startswith('FERN:'):
                password = encrypt_standby_password(password)

            try:
                cursor.execute("""
                    MERGE INTO ADG_STANDBY_CONFIG t
                    USING (SELECT :db_id AS ID FROM DUAL) s
                    ON (t.ID = s.ID)
                    WHEN MATCHED THEN UPDATE SET
                        NAME = :name, HOST = :host, PORT = :port, SERVICE_NAME = :sname,
                        USERNAME = :uname, PASSWORD = :pwd, ENABLED = :enabled, UPDATED_AT = SYSTIMESTAMP
                    WHEN NOT MATCHED THEN INSERT (
                        ID, NAME, HOST, PORT, SERVICE_NAME, USERNAME, PASSWORD, ENABLED
                    ) VALUES (:db_id, :name, :host, :port, :sname, :uname, :pwd, :enabled)
                """, {'db_id': db_id, 'name': name, 'host': host, 'port': port,
                      'sname': service_name, 'uname': username, 'pwd': password, 'enabled': 1})
                imported += 1
            except Exception as e:
                errors.append({'row': i + 1, 'name': name, 'error': str(e)})
                skipped += 1

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': f'导入完成: {imported} 成功, {skipped} 跳过',
            'imported': imported,
            'skipped': skipped,
            'errors': errors,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/api/databases/batch-delete', methods=['POST'])
def batch_delete():
    """批量删除备库配置及关联数据"""
    try:
        data = request.get_json()
        ids = data.get('ids', [])
        if not ids:
            return jsonify({'success': False, 'message': '没有要删除的备库'}), 400

        conn = get_local_connection()
        cursor = conn.cursor()

        deleted = 0
        for db_id in ids:
            try:
                cursor.execute("DELETE FROM ADG_MONITOR_HISTORY WHERE DB_ID = :1", [db_id])
                cursor.execute("DELETE FROM ADG_MONITOR_STATUS WHERE DB_ID = :1", [db_id])
                cursor.execute("DELETE FROM ADG_STANDBY_CONFIG WHERE ID = :1", [db_id])
                deleted += 1
            except Exception as e:
                print(f"[WARN] 批量删除 {db_id} 失败: {e}")

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': f'已删除 {deleted} 台备库', 'deleted': deleted})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ---------- 监控数据查询 ----------

@app.route('/api/query', methods=['POST'])
def query_standby():
    """查询单个备库状态（供前端手动查询或添加时使用）"""
    try:
        data = request.get_json()
        host = data.get('host', '')
        port = int(data.get('port', 1521))
        service_name = data.get('service_name', '')
        username = data.get('username', '')
        password = data.get('password', '')
        yellow = int(data.get('yellow_threshold', 300))
        red = int(data.get('red_threshold', 1800))

        if not all([host, service_name, username, password]):
            return jsonify({'error': '缺少必要参数'}), 400

        db_config = {
            'host': host, 'port': port, 'service_name': service_name,
            'username': username, 'password': password,
        }
        result = query_single_standby(db_config, yellow, red)
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'mrp_status': 'NOT_FOUND',
                        'apply_lag_seconds': 0, 'transport_lag_seconds': 0,
                        'health_status': 'red', 'database_info': {},
                        'managed_standby': [], 'dataguard_stats': []})


@app.route('/api/collect', methods=['POST'])
def trigger_collect():
    """手动触发一次全量采集（与自动采集互斥）"""
    global _collecting
    with _collecting_lock:
        if _collecting:
            return jsonify({'success': False, 'message': '采集正在进行中，请稍后再试'})
        _collecting = True
    try:
        collect_all_standbys()
        return jsonify({'success': True, 'message': '采集完成', 'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        with _collecting_lock:
            _collecting = False


@app.route('/api/statuses', methods=['GET'])
def get_all_statuses():
    """获取所有备库最新状态"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                s.DB_ID, s.DB_NAME, s.HOST, s.PORT, s.SERVICE_NAME,
                s.DB_UNIQUE_NAME, s.DATABASE_ROLE, s.OPEN_MODE, s.PROTECTION_MODE, s.SWITCHOVER_STATUS,
                s.MRP_STATUS, s.APPLY_LAG, s.APPLY_LAG_SECONDS, s.TRANSPORT_LAG, s.TRANSPORT_LAG_SECONDS,
                s.HEALTH_STATUS, TO_CHAR(s.LAST_CHECKED, 'YYYY-MM-DD HH24:MI:SS'), s.ERROR_MSG,
                s.MANAGED_STANDBY_JSON, s.DATAGUARD_STATS_JSON
            FROM ADG_MONITOR_STATUS s
            JOIN ADG_STANDBY_CONFIG c ON s.DB_ID = c.ID AND c.ENABLED = 1
            ORDER BY s.DB_NAME
        """)
        rows = cursor.fetchall()

        statuses = {}
        for row in rows:
            db_id = row[0]
            managed_standby = []
            dataguard_stats = []
            try:
                if row[18]:
                    ms_str = row[18]
                    if hasattr(ms_str, 'read'):
                        ms_str = ms_str.read()
                    managed_standby = json.loads(ms_str)
            except:
                pass
            try:
                if row[19]:
                    ds_str = row[19]
                    if hasattr(ds_str, 'read'):
                        ds_str = ds_str.read()
                    dataguard_stats = json.loads(ds_str)
            except:
                pass

            statuses[db_id] = {
                'dbId': db_id,
                'dbName': row[1] or '',
                'host': row[2] or '',
                'port': int(row[3]) if row[3] else 1521,
                'serviceName': row[4] or '',
                'databaseInfo': {
                    'dbUniqueName': row[5] or '',
                    'databaseRole': row[6] or '',
                    'openMode': row[7] or '',
                    'protectionMode': row[8] or '',
                    'switchoverStatus': row[9] or '',
                },
                'mrpStatus': row[10] or 'NOT_FOUND',
                'applyLag': row[11] or 'N/A',
                'applyLagSeconds': int(row[12]) if row[12] else 0,
                'transportLag': row[13] or 'N/A',
                'transportLagSeconds': int(row[14]) if row[14] else 0,
                'healthStatus': row[15] or 'red',
                'lastChecked': row[16] or '',
                'error': row[17] or None,
                'mrpProcesses': managed_standby,
                'dataguardStats': dataguard_stats,
            }

        cursor.close()
        conn.close()
        return jsonify({'success': True, 'statuses': statuses})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e), 'statuses': {}})


# ---------- 历史数据查询 ----------

@app.route('/api/history', methods=['GET'])
def get_history():
    """
    获取历史数据
    参数:
        db_id: 备库ID (可选，不传返回所有)
        hours: 查询最近几小时 (默认24)
        limit: 最大返回条数 (默认5000)
    """
    try:
        db_id = request.args.get('db_id', '')
        hours = int(request.args.get('hours', 24))
        limit = int(request.args.get('limit', 5000))

        conn = get_local_connection()
        cursor = conn.cursor()

        if db_id:
            cursor.execute("""
                SELECT DB_ID,
                       TO_CHAR(COLLECT_TIME, 'YYYY-MM-DD HH24:MI:SS') AS COLLECT_TIME,
                       APPLY_LAG_SECONDS, TRANSPORT_LAG_SECONDS,
                       MRP_STATUS, HEALTH_STATUS
                FROM ADG_MONITOR_HISTORY
                WHERE DB_ID = :1
                  AND COLLECT_TIME >= SYSTIMESTAMP - NUMTODSINTERVAL(:2, 'HOUR')
                ORDER BY COLLECT_TIME DESC
                FETCH FIRST :3 ROWS ONLY
            """, [db_id, hours, limit])
        else:
            cursor.execute("""
                SELECT DB_ID,
                       TO_CHAR(COLLECT_TIME, 'YYYY-MM-DD HH24:MI:SS') AS COLLECT_TIME,
                       APPLY_LAG_SECONDS, TRANSPORT_LAG_SECONDS,
                       MRP_STATUS, HEALTH_STATUS
                FROM ADG_MONITOR_HISTORY
                WHERE COLLECT_TIME >= SYSTIMESTAMP - NUMTODSINTERVAL(:1, 'HOUR')
                ORDER BY COLLECT_TIME DESC
                FETCH FIRST :2 ROWS ONLY
            """, [hours, limit])

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        history = []
        for row in rows:
            history.append({
                'dbId': row[0],
                'timestamp': row[1],
                'applyLagSeconds': int(row[2]) if row[2] else 0,
                'transportLagSeconds': int(row[3]) if row[3] else 0,
                'mrpStatus': row[4] or 'NOT_FOUND',
                'healthStatus': row[5] or 'red',
            })

        return jsonify({'success': True, 'history': history, 'count': len(history)})
    except Exception as e:
        # Oracle 11g 不支持 FETCH FIRST, 使用 ROWNUM 回退
        try:
            conn2 = get_local_connection()
            cursor2 = conn2.cursor()

            if db_id:
                cursor2.execute("""
                    SELECT * FROM (
                        SELECT DB_ID,
                               TO_CHAR(COLLECT_TIME, 'YYYY-MM-DD HH24:MI:SS') AS COLLECT_TIME,
                               APPLY_LAG_SECONDS, TRANSPORT_LAG_SECONDS,
                               MRP_STATUS, HEALTH_STATUS
                        FROM ADG_MONITOR_HISTORY
                        WHERE DB_ID = :1
                          AND COLLECT_TIME >= SYSTIMESTAMP - NUMTODSINTERVAL(:2, 'HOUR')
                        ORDER BY COLLECT_TIME DESC
                    ) WHERE ROWNUM <= :3
                """, [db_id, hours, limit])
            else:
                cursor2.execute("""
                    SELECT * FROM (
                        SELECT DB_ID,
                               TO_CHAR(COLLECT_TIME, 'YYYY-MM-DD HH24:MI:SS') AS COLLECT_TIME,
                               APPLY_LAG_SECONDS, TRANSPORT_LAG_SECONDS,
                               MRP_STATUS, HEALTH_STATUS
                        FROM ADG_MONITOR_HISTORY
                        WHERE COLLECT_TIME >= SYSTIMESTAMP - NUMTODSINTERVAL(:1, 'HOUR')
                        ORDER BY COLLECT_TIME DESC
                    ) WHERE ROWNUM <= :2
                """, [hours, limit])

            rows = cursor2.fetchall()
            cursor2.close()
            conn2.close()

            history = []
            for row in rows:
                history.append({
                    'dbId': row[0],
                    'timestamp': row[1],
                    'applyLagSeconds': int(row[2]) if row[2] else 0,
                    'transportLagSeconds': int(row[3]) if row[3] else 0,
                    'mrpStatus': row[4] or 'NOT_FOUND',
                    'healthStatus': row[5] or 'red',
                })

            return jsonify({'success': True, 'history': history, 'count': len(history)})
        except Exception as e2:
            return jsonify({'success': False, 'message': str(e2), 'history': [], 'count': 0})


@app.route('/api/history/stats', methods=['GET'])
def get_history_stats():
    """获取历史数据统计信息"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM ADG_MONITOR_HISTORY")
        total = cursor.fetchone()[0]

        cursor.execute("""
            SELECT TO_CHAR(MIN(COLLECT_TIME), 'YYYY-MM-DD HH24:MI:SS'),
                   TO_CHAR(MAX(COLLECT_TIME), 'YYYY-MM-DD HH24:MI:SS')
            FROM ADG_MONITOR_HISTORY
        """)
        row = cursor.fetchone()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'total_records': total,
            'earliest': row[0] if row else None,
            'latest': row[1] if row else None,
            'retention_days': int(get_setting('history_retention_days', '30')),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ---------- 系统设置 ----------

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """获取所有系统设置"""
    try:
        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT SETTING_KEY, SETTING_VALUE FROM ADG_SYSTEM_SETTINGS")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        settings = {}
        for row in rows:
            settings[row[0]] = row[1]

        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e), 'settings': {}})


@app.route('/api/settings', methods=['POST'])
def update_settings():
    """批量更新系统设置"""
    try:
        data = request.get_json()
        settings = data.get('settings', {})

        conn = get_local_connection()
        cursor = conn.cursor()

        for key, value in settings.items():
            cursor.execute("""
                MERGE INTO ADG_SYSTEM_SETTINGS t
                USING (SELECT :skey AS SETTING_KEY, :sval AS SETTING_VALUE FROM DUAL) s
                ON (t.SETTING_KEY = s.SETTING_KEY)
                WHEN MATCHED THEN UPDATE SET SETTING_VALUE = s.SETTING_VALUE, UPDATED_AT = SYSTIMESTAMP
                WHEN NOT MATCHED THEN INSERT (SETTING_KEY, SETTING_VALUE) VALUES (s.SETTING_KEY, s.SETTING_VALUE)
            """, {'skey': key, 'sval': str(value)})

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': '设置已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ---------- 清理历史 ----------

@app.route('/api/alert/test', methods=['POST'])
def test_alert():
    """发送测试告警"""
    config = get_alert_config()
    url = config.get('webhookUrl') or config.get('webhook_url', '')
    if not config.get('enabled') or not url:
        return jsonify({'success': False, 'message': '告警未启用或未配置 Webhook URL'})
    payload = {
        'event': 'test',
        'db_name': 'TEST_DB',
        'db_host': 'localhost',
        'old_status': 'green',
        'new_status': 'red',
        'apply_lag_seconds': 3600,
        'transport_lag_seconds': 300,
        'mrp_status': 'APPLYING_LOG',
        'error': None,
        'timestamp': datetime.now().isoformat(),
    }
    try:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/json; charset=utf-8'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=5)
        return jsonify({'success': True, 'message': '测试告警已发送'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'测试告警发送失败: {e}'})


@app.route('/api/history/cleanup', methods=['POST'])
def manual_cleanup():
    """手动清理历史数据"""
    try:
        data = request.get_json() or {}
        days = int(data.get('retention_days', get_setting('history_retention_days', '30')))

        conn = get_local_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM ADG_MONITOR_HISTORY WHERE COLLECT_TIME < SYSTIMESTAMP - NUMTODSINTERVAL(:1, 'DAY')",
            [days]
        )
        deleted = cursor.rowcount
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'deleted': deleted, 'message': f'已清理 {deleted} 条记录'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# ============================================================================
# 启动服务
# ============================================================================
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Oracle ADG 监控后端服务')
    parser.add_argument('--host', default='0.0.0.0', help='监听地址 (默认: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=5000, help='监听端口 (默认: 5000)')
    parser.add_argument('--debug', action='store_true', help='调试模式')
    parser.add_argument('--init-db', action='store_true', help='初始化数据库表结构')
    parser.add_argument('--init-db-11g', action='store_true', help='初始化数据库表结构(Oracle 11g兼容)')
    parser.add_argument('--local-dsn', help='本地Oracle DSN (例: 127.0.0.1:1521/ORCL)')
    parser.add_argument('--local-user', help='本地Oracle用户名')
    parser.add_argument('--local-password', help='本地Oracle密码')
    parser.add_argument('--instant-client', help='Oracle Instant Client路径')
    parser.add_argument('--no-auto-collect', action='store_true', help='禁用自动采集')

    args = parser.parse_args()

    # 更新配置
    if args.local_dsn:
        LOCAL_DB_CONFIG['dsn'] = args.local_dsn
    if args.local_user:
        LOCAL_DB_CONFIG['user'] = args.local_user
    if args.local_password:
        LOCAL_DB_CONFIG['password'] = args.local_password
    if args.instant_client:
        INSTANT_CLIENT_DIR = args.instant_client

    # 初始化Oracle客户端
    init_oracle_client()

    # 初始化数据库
    if args.init_db:
        init_database(use_11g=False)
        sys.exit(0)
    if args.init_db_11g:
        init_database(use_11g=True)
        sys.exit(0)

    # 启动自动采集线程
    if not args.no_auto_collect:
        try:
            # 先测试本地数据库连接
            test_conn = get_local_connection()
            test_conn.close()
            auto_collector = AutoCollector()
            auto_collector.start()
        except Exception as e:
            print(f"[WARN] 无法连接本地数据库，自动采集未启动: {e}")
            print("[WARN] 请检查本地数据库配置并运行 --init-db 初始化表结构")

    print("=" * 60)
    print("  Oracle DataGuard ADG 监控平台 - 后端服务")
    print("=" * 60)
    print(f"  Oracle模块:     {ORACLE_MODULE}")
    print(f"  本地数据库DSN:  {LOCAL_DB_CONFIG['dsn']}")
    print(f"  本地数据库用户: {LOCAL_DB_CONFIG['user']}")
    print(f"  监听地址:       {args.host}:{args.port}")
    print(f"  自动采集:       {'启用' if not args.no_auto_collect else '禁用'}")
    print(f"  API接口:")
    print(f"    GET  /api/health            - 健康检查")
    print(f"    GET  /api/test_local_db     - 测试本地DB连接")
    print(f"    POST /api/test_connection   - 测试备库连接")
    print(f"    GET  /api/databases         - 获取备库列表")
    print(f"    POST /api/databases         - 添加/更新备库")
    print(f"    DEL  /api/databases/<id>    - 删除备库")
    print(f"    POST /api/collect           - 手动触发采集")
    print(f"    GET  /api/statuses          - 获取最新状态")
    print(f"    GET  /api/history           - 获取历史数据")
    print(f"    GET  /api/history/stats     - 历史数据统计")
    print(f"    POST /api/history/cleanup   - 清理历史数据")
    print(f"    GET  /api/settings          - 获取设置")
    print(f"    POST /api/settings          - 更新设置")
    print("=" * 60)

    app.run(host=args.host, port=args.port, debug=args.debug)
