# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Oracle DataGuard ADG 监控平台 — 监控 Oracle 11g/19c Active Data Guard 备库状态的 Web 应用。前端 React 19 + TypeScript + Tailwind CSS 4，后端 Python Flask + oracledb，数据持久化到 Oracle 数据库，前端构建为单文件 HTML。

## 常用命令

```bash
# 前端开发
npm run dev          # Vite 开发服务器 → http://localhost:5173
npm run build        # 构建单文件 HTML → dist/index.html
npm run preview      # 预览构建产物

# 后端
python backend/adg_backend.py --init-db \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"          # 初始化表结构 (12c+，含密码迁移)

python backend/adg_backend.py --port 5000 \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"          # 启动后端 (默认 5000 端口)

python backend/adg_backend.py ... --no-auto-collect       # 禁用后端自动采集，由前端触发
python backend/adg_backend.py ... --init-db-11g ...       # Oracle 11g 兼容 DDL
python backend/adg_backend.py ... --debug ...             # Flask 调试模式
python backend/adg_backend.py ... --instant-client /path/to/instantclient  # Oracle 11g thick 模式

# 环境变量 (备选配置方式)
# ADG_LOCAL_DSN, ADG_LOCAL_USER, ADG_LOCAL_PASSWORD  # 本地Oracle连接
# ORACLE_INSTANT_CLIENT                                # Instant Client路径
```

## 架构概览

### 运行模式

系统强制使用后端模式 (`useBackend: true`)，不再有演示/本地模式切换。前端通过 REST API 与 Flask 后端通信，后端连接远程 Oracle 备库执行 SQL 查询，结果持久化到本地 Oracle 的四张 `ADG_*` 表中。

构建时 `vite-plugin-singlefile` 将所有资源 (JS/CSS/图片) 内联为单个 `dist/index.html` 文件，可直接用浏览器打开或部署到任意静态服务器。

`store.ts` 中的 `simulateStandbyQuery()` 仅作为后端不可用时的降级方案保留。前端路径别名 `@` 映射到 `src/`，配置在 `vite.config.ts` 和 `tsconfig.json`。

### 前端结构 (`src/`)

```
App.tsx                    # 认证守卫 → Login | Dashboard
store.ts                   # 核心状态层: localStorage 操作 + 后端 API 调用 + 健康状态判断
                           # login() 改为 async，后端模式下调用 /api/auth/login
types.ts                   # TypeScript 类型 + Oracle SQL 查询常量
utils/cn.ts                # Tailwind 类名合并 (clsx + tailwind-merge)
components/
  Login.tsx                # 登录页，支持后端 API 验证
  Dashboard.tsx            # 主面板: Tab 切换、采集/刷新定时器、状态筛选、搜索
  Header.tsx               # 顶栏: 状态概览、刷新间隔选择器、设置/登出
  StandbyCard.tsx          # 备库卡片: MRP 状态、延时、健康状态 (红>黄>绿排序)
  DataTable.tsx            # 延时表格: 全宽表格，列含异常原因，点击行打开详情
  DetailModal.tsx          # 备库详情: V$DATABASE / V$MANAGED_STANDBY / V$DATAGUARD_STATS
  SettingsModal.tsx        # 4 Tab (备库管理 / 采集配置 / 后端配置 / 安全设置)
  OverviewChart.tsx        # 全局趋势图: 所有备库延时折线图 (Recharts)
  TrendChart.tsx           # 单库趋势图: 面积图 + 传输延时折线 + 告警参考线
```

Dashboard 关键 state: `activeTab` (cards/table), `healthFilter` (green/yellow/red/null), `searchQuery`。搜索同时匹配备库名称和 IP 地址。状态数字可点击筛选（再次点击取消）。

数据流（重要）:
- **自动定时器** → 调用 `refreshData()`，只拉 `GET /api/statuses` + `GET /api/history`，不触发后端采集
- **手动"采集 & 刷新"按钮** → 调用 `collectData()`，触发 `POST /api/collect` + 拉取数据
- **并发守卫** → `fetchingRef` 防止同一 Tab 重复请求
- SettingsModal 批量操作后通过 `onDatabasesChanged` 回调刷新备库列表

### 后端结构 (`backend/`)

```
adg_backend.py             # 单文件 Flask 应用
requirements.txt           # flask, flask-cors, oracledb (cryptography 是 oracledb 的依赖)
```

关键设计点：
- **本地 Oracle 连接池** (`get_local_connection`): `oracledb.create_pool` (min=1, max=10)，`conn.close()` 归还池中，不要改为每次新建
- **远程 Oracle 连接** (`get_remote_connection`): 每次按需创建，备库侧无需连接池
- **并行采集** (`collect_all_standbys`): `ThreadPoolExecutor` (max 10 workers)，不要改回串行 for 循环
- **设置缓存** (`_settings_cache`): 内存字典，30s TTL 自动刷新，`get_setting()` 不走 DB
- **采集互斥锁** (`_collecting_lock`): 防止自动采集与手动 `/api/collect` 并发
- **自动采集线程** (`AutoCollector`): daemon 线程，可通过 `--no-auto-collect` 禁用
- **双版本 DDL**: 12c+ 用 `IDENTITY`，11g 用 `SEQUENCE` + `TRIGGER`
- **密码哈希**: PBKDF2-HMAC-SHA256 (20万迭代 + 随机盐)，存储格式 `pbkdf2:sha256:200000$salt$hash`
- **备库密码加密**: Fernet (AES-128-CBC)，密钥存于 `ADG_SYSTEM_SETTINGS.encryption_key`，密文格式 `FERN:base64`
- **CLOB 延迟读取**: `fetchall()` 后必须先读 CLOB 再 `close()` 连接，否则 CLOB 定位器失效
- **Oracle 11g 兼容**: `FETCH FIRST` 在 11g 不支持，`/api/history` 在异常时自动回退到 `ROWNUM` 子查询
- **历史数据自动清理**: 每 100 次采集清理过期历史 (默认保留 30 天)
- **默认密码**: `admin123`，首次 --init-db 时写入 PBKDF2 哈希

### Oracle 持久化表

| 表名 | 用途 |
|------|------|
| `ADG_STANDBY_CONFIG` | 备库连接配置 (密码 Fernet 加密存储) |
| `ADG_MONITOR_STATUS` | 最新监控快照 (MERGE INTO 更新，含 CLOB) |
| `ADG_MONITOR_HISTORY` | 历史记录 (每次采集 INSERT 一行) |
| `ADG_SYSTEM_SETTINGS` | 系统设置 (含 login_password 哈希、encryption_key) |

### 监控数据来源 (Oracle 视图)

- `V$DATABASE`: DB_UNIQUE_NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE, SWITCHOVER_STATUS
- `V$MANAGED_STANDBY`: PROCESS, PID, STATUS, CLIENT_PROCESS, THREAD#, SEQUENCE#, BLOCK#, BLOCKS, DELAY_MINS
- `V$DATAGUARD_STATS`: NAME, VALUE, UNIT, DATUM_TIME

### 健康状态判断逻辑

三个层级，按优先级：

1. **红色**: 有错误信息 OR MRP 状态非 `APPLYING_LOG`/`WAIT_FOR_LOG` OR apply lag > 红色阈值
2. **黄色** (满足任一): apply lag 介于黄-红阈值之间 **OR** MRP0 进程 `STATUS=WAIT_FOR_LOG AND BLOCK#=0`
3. **绿色**: MRP 正常且 apply lag ≤ 黄色阈值

`BLOCK#=0` 条件下 MRP0 虽然是 WAIT_FOR_LOG 但实际已追平，应提示警告而非显示正常。

### 性能红线 (不要退化)

- **前端定时器不触发后端采集**: `refreshData()` 只拉 `GET /api/statuses` + `GET /api/history`。只有手动按钮和初始加载调 `POST /api/collect`。否则多个 Tab 会 API 洪水冲垮 Flask 单线程服务器。
- **后端采集保持并行**: `collect_all_standbys()` 使用 `ThreadPoolExecutor`，不可改回串行 for 循环。
- **本地连接走连接池**: `get_local_connection()` 从 `oracledb.create_pool` 获取，`conn.close()` 归还。
- **设置走内存缓存**: `get_setting()` 从 `_settings_cache` 读，不要每次建连查库。
- **采集有互斥锁**: `_collecting_lock` 防止并发写入。

### REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/test_local_db` | 测试本地持久化数据库连接及表状态 |
| POST | `/api/test_connection` | 测试备库连接 |
| POST | `/api/auth/login` | 登录验证 (PBKDF2 哈希比对) |
| POST | `/api/auth/change-password` | 修改密码 (需旧密码验证) |
| GET | `/api/databases` | 获取备库列表 (密码解密后返回) |
| POST | `/api/databases` | 添加/更新备库 (密码加密后存储) |
| DELETE | `/api/databases/<id>` | 删除备库及关联数据 |
| POST | `/api/databases/batch` | 批量导入备库 (数组 `{databases: [...]}`，自动生成 ID 并加密密码) |
| POST | `/api/databases/batch-delete` | 批量删除备库 (数组 `{ids: [...]}`，含关联数据) |
| POST | `/api/collect` | 手动触发全量采集 (与自动采集互斥) |
| GET | `/api/statuses` | 获取所有备库最新状态 |
| POST | `/api/query` | 查询单个备库状态 |
| GET | `/api/history` | 历史数据 (参数: db_id, hours, limit) |
| GET | `/api/history/stats` | 历史数据统计 |
| POST | `/api/history/cleanup` | 清理过期历史数据 |
| GET | `/api/settings` | 获取系统设置 |
| POST | `/api/settings` | 批量更新系统设置 |
