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

python backend/adg_backend.py ... --no-auto-collect       # 禁用后端自动采集
python backend/adg_backend.py ... --init-db-11g ...       # Oracle 11g 兼容 DDL
python backend/adg_backend.py ... --debug ...             # Flask 调试模式

# Webhook 告警测试
python tools/webhook_test_server.py                       # 启动本地 Webhook 接收器 → http://127.0.0.1:9999/webhook

# 环境变量 (备选配置方式)
# ADG_LOCAL_DSN, ADG_LOCAL_USER, ADG_LOCAL_PASSWORD  # 本地Oracle连接
# ORACLE_INSTANT_CLIENT                                # Instant Client路径
```

## 架构概览

### 运行模式

系统强制使用后端模式 (`useBackend: true`)。前端通过 REST API 与 Flask 后端通信，后端连接远程 Oracle 备库执行 SQL 查询，结果持久化到本地 Oracle 的四张 `ADG_*` 表中。

构建时 `vite-plugin-singlefile` 将所有资源 (JS/CSS/图片) 内联为单个 `dist/index.html` 文件。`store.ts` 中的 `simulateStandbyQuery()` 仅作为后端不可用时的降级方案。前端路径别名 `@` 映射到 `src/`，配置在 `vite.config.ts` 和 `tsconfig.json`。

### 主题系统

深色/浅色双主题 (Redwood 暖纸风格)，通过 `data-theme` 属性切换：

- `src/index.css` — `:root` 定义 25 个 CSS 变量 (深色默认)，`[data-theme="light"]` 覆盖为 Redwood 暖纸色（象牙白底 `#f5f0e8`、赤陶强调 `#c04000`、暖棕文字 `#3d3229`）
- `src/utils/theme.tsx` — `ThemeProvider` + `useTheme`，状态持久化到 `localStorage('adg_theme')`
- `src/utils/useChartTheme.ts` — `useChartTheme` hook，通过 `MutationObserver` 监听 `data-theme` 变化，返回 Recharts 颜色对象
- 浅色模式下通过 `[data-theme="light"]` 覆盖 Tailwind 硬编码类 (`text-white` → `var(--text-primary)`)
- `StatusDot` 组件 — 环状脉冲状态指示器 (外环+内芯 + CSS 动画: 呼吸/闪烁/脉冲)

### 前端结构 (`src/`)

```
App.tsx                    # 认证守卫 → Login | Dashboard
store.ts                   # 核心状态层: localStorage 操作 + 后端 API 调用 + 健康状态判断
types.ts                   # TypeScript 类型 + AlertConfig / CollectionConfig
utils/
  cn.ts                    # Tailwind 类名合并 (clsx + tailwind-merge)
  theme.tsx                # ThemeProvider + useTheme
  useChartTheme.ts         # 图表颜色 hook
components/
  Login.tsx                # 登录页
  Dashboard.tsx            # 主面板: Tab 切换、定时器、状态筛选、搜索
  Header.tsx               # 顶栏: 状态概览、主题切换、刷新间隔、设置/登出
  StandbyCard.tsx          # 备库卡片 (红>黄>绿排序)
  StatusDot.tsx            # 环状脉冲状态指示器
  DataTable.tsx            # 延时表格
  DetailModal.tsx          # 备库详情 + 趋势图
  SettingsModal.tsx        # 4 Tab (备库管理 / 采集配置 / 后端配置+告警推送 / 安全设置)
  OverviewChart.tsx        # 全局趋势图 (Recharts)
  TrendChart.tsx           # 单库趋势图 (面积图+Brush)
```

### 后端结构 (`backend/`)

```
adg_backend.py             # 单文件 Flask 应用
requirements.txt           # flask, flask-cors, oracledb
tools/
  webhook_test_server.py   # Webhook 本地测试接收器
```

## 关键设计点

### 定时器架构 (Dashboard)

- **`refreshTimerRef`**: 用户自定义刷新间隔 (Header 下拉选择)，只拉 `GET /api/statuses` + `GET /api/history`，不触发后端采集。`refreshInterval = 0` 时完全手动
- **`idleTimerRef`**: 会话超时检测，每 10 秒检查空闲时间，超时自动登出
- 后端 `AutoCollector` 线程独立处理数据采集 (daemon)

数据流:
- Header 定时器 → `refreshData()` → 只拉数据，不采集
- 手动"采集 & 刷新"按钮 → `collectData()` → `POST /api/collect` + 拉数据
- 并发守卫 `fetchingRef` 防止重复请求
- DetailModal 打开时每 30 秒自动刷新趋势图数据

### 后端性能红线

- 本地连接走连接池 `oracledb.create_pool` (min=1, max=10)，`conn.close()` 归还
- 并行采集 `ThreadPoolExecutor` (max 10 workers)，不可改回串行
- 设置走内存缓存 `_settings_cache` (30s TTL)，`get_setting()` 不走 DB
- 采集互斥锁 `_collecting_lock` 防止并发
- CLOB 延迟读取: `fetchall()` 后必须先读 CLOB 再 `close()`，否则定位器失效
- Oracle 11g 兼容: `FETCH FIRST` 不支持时自动回退 `ROWNUM` 子查询

### 健康状态判断

1. **红色**: 有错误 OR MRP 非 `APPLYING_LOG`/`WAIT_FOR_LOG` OR apply lag > 红色阈值
2. **黄色**: lag 在黄-红阈值之间 OR MRP0 `STATUS=WAIT_FOR_LOG AND BLOCK#=0`
3. **绿色**: MRP 正常且 lag ≤ 黄色阈值

### 告警推送

- `persist_status()` 在 MERGE 前查询旧状态，INSERT 后检测变化，触发 `send_webhook_alert()`
- Webhook 冷却: 同 DB 同状态在 `cooldown_minutes` 内不重复推送 (内存 dict `_alert_cooldown`)
- 前端配置在 SettingsModal 后端配置 Tab 底部: 启用开关 / Webhook URL / 冷却时间 / 测试推送按钮
- `POST /api/alert/test` — 发送测试告警，key 兼容 `webhookUrl`(驼峰) 和 `webhook_url`(下划线)
- `tools/webhook_test_server.py` — 本地测试接收器，浏览器打开 `http://127.0.0.1:9999/webhook` 每 3 秒自动刷新显示

### Webhook JSON 格式

```json
{"event":"health_change","db_name":"orcl2","db_host":"10.10.10.56","old_status":"green","new_status":"yellow","apply_lag_seconds":420,"transport_lag_seconds":15,"mrp_status":"APPLYING_LOG","error":null,"timestamp":"2026-05-19T18:21:11"}
```

### Oracle 持久化表

| 表名 | 用途 |
|------|------|
| `ADG_STANDBY_CONFIG` | 备库连接配置 (密码 Fernet 加密) |
| `ADG_MONITOR_STATUS` | 最新监控快照 (MERGE INTO 更新，含 CLOB) |
| `ADG_MONITOR_HISTORY` | 历史记录 (每次采集 INSERT，按月 RANGE 分区) |
| `ADG_SYSTEM_SETTINGS` | 系统设置 (含 login_password、encryption_key、alert_config JSON) |

### ADG_MONITOR_HISTORY 分区设计

历史表按 `COLLECT_TIME` 做 **RANGE 按月分区**：

- **12c+**: 使用 `INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))` 自动创建月度分区，初始分区 `p_hist_init` 作为过渡点
- **11g**: 预创建 24 个月命名分区 `p_YYYYMM` + `p_maxval` 兜底，需定期维护添加新分区
- **PK/索引**: `ID` 为全局主键，`IDX_HISTORY_DBID_TIME` 和 `IDX_HISTORY_TIME` 为 LOCAL 分区索引
- **新安装**: `--init-db` 直接创建分区表（COLLECT_TIME 有 NOT NULL 约束）
- **已有安装**: 手动执行 `backend/sql/03_migrate_12c_online.sql` 在线转换
- **历史清理**: `cleanup_old_history()` 先尝试 `DROP PARTITION ... UPDATE GLOBAL INDEXES`（整月删除），再对边界分区用 DELETE — 比全表 DELETE 高效数个数量级
- **独立 SQL 脚本**: 见 `backend/sql/` — `01_create_history_12c.sql` / `02_create_history_11g.sql` / `03_migrate_12c_online.sql` / `04_migrate_manual.sql` / `05_cleanup_partitions.sql`

### REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/test_local_db` | 测试本地持久化数据库连接 |
| POST | `/api/test_connection` | 测试备库连接 |
| POST | `/api/auth/login` | 登录验证 (PBKDF2 哈希比对) |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/databases` | 获取备库列表 (密码解密) |
| POST | `/api/databases` | 添加/更新备库 |
| DELETE | `/api/databases/<id>` | 删除备库及关联数据 |
| POST | `/api/databases/batch` | 批量导入备库 |
| POST | `/api/databases/batch-delete` | 批量删除备库 |
| POST | `/api/collect` | 手动触发全量采集 |
| GET | `/api/statuses` | 获取所有备库最新状态 |
| POST | `/api/query` | 查询单个备库状态 |
| GET | `/api/history` | 历史数据 (参数: db_id, hours, limit) |
| GET | `/api/history/stats` | 历史数据统计 |
| POST | `/api/history/cleanup` | 清理过期历史数据 |
| POST | `/api/alert/test` | 发送测试告警 |
| GET | `/api/settings` | 获取系统设置 |
| POST | `/api/settings` | 批量更新系统设置 |
