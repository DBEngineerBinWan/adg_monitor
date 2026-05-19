# Oracle DataGuard ADG 监控平台

监控 Oracle 11g/19c Active Data Guard 备库状态的 Web 应用。前端 React 19 + TypeScript + Tailwind CSS 4，后端 Python Flask + oracledb，数据持久化到 Oracle 数据库，前端构建为单文件 HTML。

## 功能特性

- **备库状态监控** — 实时查询 V$DATABASE / V$MANAGED_STANDBY / V$DATAGUARD_STATS
- **健康状态判断** — 红/黄/绿三色：MRP 状态 + apply lag + BLOCK#=0 综合评估
- **卡片 + 表格双视图** — Tab 切换，健康状态筛选，名称/IP 搜索
- **延时趋势图** — 全局折线图 + 单库面积图，1h~30d 时间范围，Brush 缩放
- **告警推送** — 健康状态变化时 Webhook POST JSON 到第三方监控平台
- **双主题** — 深色 / Redwood 暖纸浅色，一键切换，偏好持久化
- **批量管理** — 批量导入/删除备库配置
- **密码安全** — PBKDF2 哈希登录密码，Fernet AES 加密备库连接密码

## 快速开始

### 环境要求

- Python 3.9+（Oracle 11g 需要 Instant Client）
- Node.js 18+
- Oracle 数据库（持久化存储）

### 安装

```bash
# 前端
npm install

# 后端
pip install flask flask-cors oracledb
```

### 初始化数据库

```bash
# Oracle 12c+
python backend/adg_backend.py --init-db \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"

# Oracle 11g
python backend/adg_backend.py --init-db-11g \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"
```

### 启动

```bash
# 后端 (端口 5000)
python backend/adg_backend.py --port 5000 \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"

# 前端开发 (端口 5173)
npm run dev

# 生产构建 → dist/index.html (单文件)
npm run build
```

访问 `http://localhost:5173`，默认密码 `admin123`。在设置中确保后端地址为 `http://localhost:5000`。

## 告警推送

健康状态变化时自动 POST JSON 到配置的 Webhook URL：

```json
{
  "event": "health_change",
  "db_name": "orcl2",
  "db_host": "10.10.10.56",
  "old_status": "green",
  "new_status": "yellow",
  "apply_lag_seconds": 420,
  "transport_lag_seconds": 15,
  "mrp_status": "APPLYING_LOG",
  "error": null,
  "timestamp": "2026-05-19T18:21:11"
}
```

**本地测试**: `python tools/webhook_test_server.py` → 浏览器打开 `http://127.0.0.1:9999/webhook`（每 3 秒自动刷新，实时显示收到的告警）。

## 项目结构

```
├── index.html
├── src/
│   ├── App.tsx                 # 根组件: 认证守卫
│   ├── store.ts                # 状态管理 + API 调用 + 健康判断
│   ├── types.ts                # 类型定义 + AlertConfig
│   ├── index.css               # Tailwind + CSS 变量 + 双主题
│   ├── utils/
│   │   ├── cn.ts               # 类名合并
│   │   ├── theme.tsx           # ThemeProvider + useTheme
│   │   └── useChartTheme.ts    # 图表颜色 hook
│   └── components/
│       ├── Login.tsx           # 登录页
│       ├── Dashboard.tsx       # 主面板
│       ├── Header.tsx          # 顶栏 (主题切换)
│       ├── StandbyCard.tsx     # 备库卡片
│       ├── StatusDot.tsx       # 环状脉冲状态指示器
│       ├── DataTable.tsx       # 延时表格
│       ├── DetailModal.tsx     # 备库详情 + 趋势图
│       ├── SettingsModal.tsx   # 系统设置 + 告警配置
│       ├── OverviewChart.tsx   # 全局趋势图
│       └── TrendChart.tsx      # 单库趋势图
├── backend/
│   ├── adg_backend.py          # Flask API 服务
│   └── requirements.txt
├── tools/
│   └── webhook_test_server.py  # Webhook 测试接收器
├── dist/
│   └── index.html              # 构建产物 (单文件)
├── package.json
└── vite.config.ts
```

## 数据来源

| Oracle 视图 | 采集内容 |
|------------|---------|
| V$DATABASE | DB_UNIQUE_NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE, SWITCHOVER_STATUS |
| V$MANAGED_STANDBY | PROCESS, PID, STATUS, CLIENT_PROCESS, THREAD#, SEQUENCE#, BLOCK#, BLOCKS, DELAY_MINS |
| V$DATAGUARD_STATS | NAME, VALUE, UNIT, DATUM_TIME |

## Oracle 持久化表

| 表名 | 用途 |
|------|------|
| ADG_STANDBY_CONFIG | 备库连接配置 (密码 Fernet 加密) |
| ADG_MONITOR_STATUS | 最新监控快照 (MERGE INTO) |
| ADG_MONITOR_HISTORY | 历史记录 |
| ADG_SYSTEM_SETTINGS | 系统设置 (含告警配置) |

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/databases` | 备库列表 |
| POST | `/api/databases` | 添加/更新备库 |
| DELETE | `/api/databases/<id>` | 删除备库 |
| POST | `/api/databases/batch` | 批量导入 |
| POST | `/api/databases/batch-delete` | 批量删除 |
| POST | `/api/collect` | 手动采集 |
| GET | `/api/statuses` | 最新状态 |
| GET | `/api/history` | 历史数据 (db_id, hours, limit) |
| POST | `/api/alert/test` | 测试告警 |
| GET/POST | `/api/settings` | 系统设置 |

## 部署

完整部署指南见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)。
