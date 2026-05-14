# Oracle DataGuard ADG 监控平台 - 完整部署指南

## 📋 项目架构

```
┌─────────────────┐         ┌─────────────────────┐        ┌──────────────────┐
│   Web 浏览器     │ ──HTTP──▷│  Python Flask 后端   │──SQL──▷│  本地 Oracle DB   │
│  (前端 HTML)     │         │  (adg_backend.py)   │        │  (持久化存储)     │
└─────────────────┘         └─────────┬───────────┘        │  ADG_STANDBY_    │
                                      │                    │  CONFIG          │
                                      │ SQL                │  ADG_MONITOR_    │
                                      ▼                    │  STATUS          │
                            ┌─────────────────────┐        │  ADG_MONITOR_    │
                            │  Oracle 11g/19c     │        │  HISTORY         │
                            │  备库 1 (远程)       │        │  ADG_SYSTEM_     │
                            │  备库 2 (远程)       │        │  SETTINGS        │
                            │  备库 N (远程)       │        └──────────────────┘
                            └─────────────────────┘
```

## 📦 项目文件清单

| 文件 | 说明 | 部署目标 |
|------|------|---------|
| `dist/index.html` | 前端页面 (单文件, ~700KB) | `/opt/adg-monitor/frontend/` |
| `backend/adg_backend.py` | Python Flask 后端 | `/opt/adg-monitor/backend/` |
| `backend/requirements.txt` | Python 依赖清单 | `/opt/adg-monitor/backend/` |

---

## 🚀 一步步部署

### 第 1 步：准备Oracle持久化数据库用户

在你的**本地Oracle数据库**（后端所在服务器的Oracle，用来存储监控数据）上执行：

```sql
-- 以DBA身份连接
sqlplus / as sysdba

-- 创建持久化存储用户 (用来存配置和历史数据)
CREATE USER adg_admin IDENTIFIED BY Admin123
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CREATE SESSION TO adg_admin;
GRANT CREATE TABLE TO adg_admin;
GRANT CREATE SEQUENCE TO adg_admin;
GRANT CREATE TRIGGER TO adg_admin;
```

### 第 2 步：在每个Oracle备库上创建监控用户

在**每个需要监控的备库**上执行（需要DBA权限）：

```sql
-- 以DBA身份连接到备库
sqlplus / as sysdba

-- 创建监控用户
CREATE USER monitor IDENTIFIED BY Monitor123;

-- 授权 (只读权限)
GRANT CREATE SESSION TO monitor;
GRANT SELECT ON V_$DATABASE TO monitor;
GRANT SELECT ON V_$MANAGED_STANDBY TO monitor;
GRANT SELECT ON V_$DATAGUARD_STATS TO monitor;
GRANT SELECT ON V_$INSTANCE TO monitor;
```

### 第 3 步：上传文件到Linux服务器

```bash
# 在Linux服务器上创建目录
mkdir -p /opt/adg-monitor/{frontend,backend}

# 方法1: 使用scp上传
scp dist/index.html       root@服务器IP:/opt/adg-monitor/frontend/
scp backend/adg_backend.py root@服务器IP:/opt/adg-monitor/backend/
scp backend/requirements.txt root@服务器IP:/opt/adg-monitor/backend/

# 方法2: 如果无法SCP，可以用U盘或者直接复制粘贴文件内容
```

### 第 4 步：安装Python依赖

#### 方式A：在线安装（服务器能上网）

```bash
cd /opt/adg-monitor/backend

# 创建Python虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install flask flask-cors oracledb
```

#### 方式B：离线安装（服务器无法上网）

```bash
# ---- 在能上网的机器上执行 ----
mkdir packages
pip download flask flask-cors oracledb -d ./packages
# 把 packages 目录复制到服务器

# ---- 在服务器上执行 ----
cd /opt/adg-monitor/backend
python3 -m venv venv
source venv/bin/activate
pip install --no-index --find-links=/path/to/packages flask flask-cors oracledb
```

#### Oracle 11g 特别说明

如果你连接的是 **Oracle 11g** 数据库，`oracledb` 的 thin 模式不支持，需要安装 **Oracle Instant Client**：

```bash
# 下载 Oracle Instant Client (从Oracle官网或内部镜像)
# https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html

# 例如安装到 /opt/oracle/instantclient_11_2
unzip instantclient-basic-linux.x64-11.2.0.4.0.zip -d /opt/oracle/

# 配置库路径
echo "/opt/oracle/instantclient_11_2" > /etc/ld.so.conf.d/oracle.conf
ldconfig

# 设置环境变量
export LD_LIBRARY_PATH=/opt/oracle/instantclient_11_2:$LD_LIBRARY_PATH
export ORACLE_HOME=/opt/oracle/instantclient_11_2

# 启动时指定Instant Client路径:
python3 adg_backend.py --instant-client /opt/oracle/instantclient_11_2
```

### 第 5 步：初始化数据库表结构

```bash
cd /opt/adg-monitor/backend
source venv/bin/activate

# === Oracle 19c / 12c ===
python3 adg_backend.py --init-db \
  --local-dsn "127.0.0.1:1521/ORCL" \
  --local-user "adg_admin" \
  --local-password "Admin123"

# === Oracle 11g (使用兼容的DDL) ===
python3 adg_backend.py --init-db-11g \
  --local-dsn "127.0.0.1:1521/ORCL" \
  --local-user "adg_admin" \
  --local-password "Admin123" \
  --instant-client /opt/oracle/instantclient_11_2
```

你会看到类似输出：
```
============================================================
  初始化数据库表结构
============================================================
  [OK] CREATE TABLE ADG_STANDBY_CONFIG ...
  [OK] CREATE TABLE ADG_MONITOR_STATUS ...
  [OK] CREATE TABLE ADG_MONITOR_HISTORY ...
  [OK] CREATE TABLE ADG_SYSTEM_SETTINGS ...
  [OK] CREATE INDEX IDX_HISTORY_DBID_TIME ...
  [OK] CREATE INDEX IDX_HISTORY_TIME ...
  [OK] 默认设置已初始化
  [INFO] 密码已从明文迁移为 PBKDF2 哈希
  [INFO] 已加密 N 个备库密码
============================================================
  数据库初始化完成!
============================================================
```

> **安全说明**: 首次 `--init-db` 会自动：
> - 将默认登录密码 `admin123` 以 PBKDF2-HMAC-SHA256 哈希存储
> - 生成 Fernet 加密密钥用于加密备库连接密码
> - 迁移已有的明文密码（如有）为加密格式

### 第 6 步：启动后端服务

```bash
cd /opt/adg-monitor/backend
source venv/bin/activate

# 前台启动 (测试用)
python3 adg_backend.py \
  --port 5000 \
  --local-dsn "127.0.0.1:1521/ORCL" \
  --local-user "adg_admin" \
  --local-password "Admin123"

# 后台启动 (生产用)
nohup python3 adg_backend.py \
  --port 5000 \
  --local-dsn "127.0.0.1:1521/ORCL" \
  --local-user "adg_admin" \
  --local-password "Admin123" \
  > /opt/adg-monitor/backend/backend.log 2>&1 &

# 如果是Oracle 11g，加上:
# --instant-client /opt/oracle/instantclient_11_2
```

你会看到：
```
============================================================
  Oracle DataGuard ADG 监控平台 - 后端服务
============================================================
  Oracle模块:     oracledb
  本地数据库DSN:  127.0.0.1:1521/ORCL
  本地数据库用户: adg_admin
  监听地址:       0.0.0.0:5000
  自动采集:       启用
  API接口:
    GET  /api/health            - 健康检查
    GET  /api/test_local_db     - 测试本地DB连接
    POST /api/test_connection   - 测试备库连接
    POST /api/auth/login        - 登录验证
    POST /api/auth/change-password - 修改密码
    GET  /api/databases         - 获取备库列表
    POST /api/databases         - 添加/更新备库
    DEL  /api/databases/<id>    - 删除备库
    POST /api/collect           - 手动触发采集
    GET  /api/statuses          - 获取最新状态
    GET  /api/history           - 获取历史数据
    GET  /api/history/stats     - 历史数据统计
    POST /api/history/cleanup   - 清理历史数据
    GET  /api/settings          - 获取设置
    POST /api/settings          - 更新设置
============================================================
```

> **生产部署建议**: 使用 `--no-auto-collect` 禁用后端自动采集，由前端定时器通过 API 触发采集。这样采集频率由前端统一控制。

### 第 7 步：启动前端HTTP服务

```bash
cd /opt/adg-monitor/frontend

# 方法1: Python简单HTTP (最简单)
nohup python3 -m http.server 8080 > /dev/null 2>&1 &

# 方法2: Nginx (推荐生产环境)
cat > /etc/nginx/conf.d/adg-monitor.conf << 'EOF'
server {
    listen 8080;
    server_name _;
    root /opt/adg-monitor/frontend;
    index index.html;
    gzip on;
    gzip_types text/html application/javascript text/css;
    
    # 反向代理后端API (可选，避免跨域)
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

nginx -t && systemctl restart nginx
```

### 第 8 步：开放防火墙端口

```bash
# 前端端口
firewall-cmd --zone=public --add-port=8080/tcp --permanent
# 后端端口 (如果前端直连后端)
firewall-cmd --zone=public --add-port=5000/tcp --permanent
firewall-cmd --reload
```

### 第 9 步：浏览器访问

```
http://你的服务器IP:8080
默认密码: admin123
```

### 第 10 步：前端页面配置

1. 打开浏览器访问 `http://你的服务器IP:8080`，默认密码 `admin123`
2. 点击右上角 **⚙ 设置** → **"后端配置"** 页签
3. 填写后端地址: `http://你的服务器IP:5000`（Nginx 反向代理则填 `http://你的服务器IP:8080`）
4. 点击 **"测试"** 验证后端和数据库表连接
5. 点击 **"保存配置"**
6. 切换到 **"备库管理"** 页签 → **"添加备库"**
7. 填写备库连接信息，点击 **"🔗 连接测试"** 验证 Oracle 连通性
8. 点击 **"保存"**
9. 回到主页，点击 **"采集 & 刷新"** 获取首次数据

> **安全设置**: 在 **"安全设置"** 页签可修改登录密码。密码会通过 PBKDF2 哈希存储到 Oracle 数据库，所有浏览器共享同一密码。备库连接密码使用 Fernet (AES-128) 加密存储。

---

## 🔧 设置为开机自启

```bash
# ---- 后端服务 ----
cat > /etc/systemd/system/adg-backend.service << 'EOF'
[Unit]
Description=Oracle ADG Monitor Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/adg-monitor/backend
Environment=LD_LIBRARY_PATH=/opt/oracle/instantclient_11_2
ExecStart=/opt/adg-monitor/backend/venv/bin/python3 adg_backend.py \
  --port 5000 \
  --local-dsn "127.0.0.1:1521/ORCL" \
  --local-user "adg_admin" \
  --local-password "Admin123"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable adg-backend
systemctl start adg-backend
systemctl status adg-backend

# ---- 前端服务 (如果不用Nginx) ----
cat > /etc/systemd/system/adg-frontend.service << 'EOF'
[Unit]
Description=Oracle ADG Monitor Frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/adg-monitor/frontend
ExecStart=/usr/bin/python3 -m http.server 8080
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable adg-frontend
systemctl start adg-frontend
```

---

## 📊 Oracle持久化表结构说明

### ADG_STANDBY_CONFIG (备库配置表)
| 列名 | 类型 | 说明 |
|------|------|------|
| ID | VARCHAR2(64) | 主键 |
| NAME | VARCHAR2(128) | 备库名称 |
| HOST | VARCHAR2(256) | 主机地址 |
| PORT | NUMBER(5) | 端口 |
| SERVICE_NAME | VARCHAR2(128) | Oracle服务名 |
| USERNAME | VARCHAR2(128) | 用户名 |
| PASSWORD | VARCHAR2(256) | 密码 (Fernet AES-128 加密存储) |
| ENABLED | NUMBER(1) | 是否启用 |
| CREATED_AT | TIMESTAMP | 创建时间 |
| UPDATED_AT | TIMESTAMP | 更新时间 |

### ADG_MONITOR_STATUS (最新状态表)
| 列名 | 类型 | 说明 |
|------|------|------|
| DB_ID | VARCHAR2(64) | 主键，关联CONFIG表 |
| DB_UNIQUE_NAME | VARCHAR2(128) | V$DATABASE.DB_UNIQUE_NAME |
| DATABASE_ROLE | VARCHAR2(64) | V$DATABASE.DATABASE_ROLE |
| OPEN_MODE | VARCHAR2(64) | V$DATABASE.OPEN_MODE |
| MRP_STATUS | VARCHAR2(32) | V$MANAGED_STANDBY中MRP0状态 |
| APPLY_LAG | VARCHAR2(64) | V$DATAGUARD_STATS apply lag原始值 |
| APPLY_LAG_SECONDS | NUMBER(10) | 应用延时(秒) |
| TRANSPORT_LAG_SECONDS | NUMBER(10) | 传输延时(秒) |
| HEALTH_STATUS | VARCHAR2(10) | green/yellow/red |
| LAST_CHECKED | TIMESTAMP | 最后检查时间 |
| ERROR_MSG | VARCHAR2(2000) | 错误信息 |
| MANAGED_STANDBY_JSON | CLOB | V$MANAGED_STANDBY完整JSON |
| DATAGUARD_STATS_JSON | CLOB | V$DATAGUARD_STATS完整JSON |

### ADG_MONITOR_HISTORY (历史记录表)
| 列名 | 类型 | 说明 |
|------|------|------|
| ID | NUMBER | 自增主键 |
| DB_ID | VARCHAR2(64) | 备库ID |
| COLLECT_TIME | TIMESTAMP | 采集时间 |
| APPLY_LAG_SECONDS | NUMBER(10) | 应用延时(秒) |
| TRANSPORT_LAG_SECONDS | NUMBER(10) | 传输延时(秒) |
| MRP_STATUS | VARCHAR2(32) | MRP进程状态 |
| HEALTH_STATUS | VARCHAR2(10) | 健康状态 |

### ADG_SYSTEM_SETTINGS (系统设置表)
| 列名 | 类型 | 说明 |
|------|------|------|
| SETTING_KEY | VARCHAR2(128) | 设置键 |
| SETTING_VALUE | VARCHAR2(2000) | 设置值 |

主要设置项：

| SETTING_KEY | 说明 |
|-------------|------|
| `login_password` | PBKDF2-SHA256 哈希格式: `pbkdf2:sha256:200000$salt$hash` |
| `encryption_key` | Fernet 密钥，用于加解密备库连接密码 |
| `collection_interval` | 采集间隔(秒)，默认 30 |
| `yellow_threshold` | 黄色告警阈值(秒)，默认 300 |
| `red_threshold` | 红色告警阈值(秒)，默认 1800 |
| `auto_collect_enabled` | 自动采集开关 (1/0) |
| `history_retention_days` | 历史数据保留天数，默认 30 |

---

## 🛠 环境变量 (可选)

后端支持通过环境变量配置，避免命令行参数：

```bash
export ADG_LOCAL_DSN="127.0.0.1:1521/ORCL"
export ADG_LOCAL_USER="adg_admin"
export ADG_LOCAL_PASSWORD="Admin123"
export ORACLE_INSTANT_CLIENT="/opt/oracle/instantclient_11_2"

python3 adg_backend.py --port 5000
```

---

## ❓ 常见问题

### Q1: ORA-12541 无法连接
```
检查:
1. 目标数据库监听是否启动: lsnrctl status
2. 防火墙是否开放了1521端口
3. 检查IP和端口是否正确
```

### Q2: ORA-01017 用户名/密码错误
```
确认用户名和密码正确，注意Oracle密码区分大小写(11g默认不区分)
```

### Q3: ORA-01031 权限不足
```
确保已执行授权SQL:
GRANT SELECT ON V_$DATABASE TO monitor;
GRANT SELECT ON V_$MANAGED_STANDBY TO monitor;
GRANT SELECT ON V_$DATAGUARD_STATS TO monitor;
GRANT SELECT ON V_$INSTANCE TO monitor;
```

### Q4: DPI-1047 Oracle客户端未找到
```
Oracle 11g需要安装Instant Client:
1. 下载Instant Client Basic包
2. 解压到/opt/oracle/instantclient_11_2
3. 设置 LD_LIBRARY_PATH 
4. 启动时指定 --instant-client 路径
```

### Q5: 前端显示"后端连接失败"
```
1. 确认后端已启动: curl http://localhost:5000/api/health
2. 检查防火墙端口
3. 检查前端设置中的后端地址是否正确
4. 如有跨域问题，使用Nginx反向代理
```

### Q6: 历史数据太多，空间不够
```
1. 在设置中调整"历史保留天数" (默认30天)
2. 手动清理: 设置 → 后端配置 → 清理历史
3. 或直接SQL: DELETE FROM ADG_MONITOR_HISTORY WHERE COLLECT_TIME < SYSDATE - 7
```

### Q7: 如何查看后端日志
```bash
# 查看systemd日志
journalctl -u adg-backend -f

# 或查看日志文件
tail -f /opt/adg-monitor/backend/backend.log
```
