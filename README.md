# Oracle DataGuard ADG 监控平台

基于 Oracle 11g/19c V$ 视图的 Active Data Guard 备库实时监控系统。

## 技术栈

- **前端**: React 19 + TypeScript + Tailwind CSS 4 + Recharts
- **后端**: Python Flask + oracledb
- **持久化**: Oracle 数据库

## 快速开始

```bash
# 前端
npm install
npm run dev          # 开发服务器 → http://localhost:5173

# 后端
pip install flask flask-cors oracledb

# 初始化表结构
python backend/adg_backend.py --init-db \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"

# 启动后端
python backend/adg_backend.py --port 5000 \
  --local-dsn "10.10.10.56:1521/orcl" \
  --local-user "hnnx" --local-password "oracle"
```

访问 `http://localhost:5173`，默认密码 `admin123`。在设置中将后端地址配置为 `http://localhost:5000`。

## 功能特性

- **备库状态监控**: 基于 V$DATABASE / V$MANAGED_STANDBY / V$DATAGUARD_STATS 实时采集
- **健康状态**: 红/黄/绿三色判断 — MRP 状态 + apply lag + BLOCK#=0 综合评估
- **卡片 + 表格双视图**: Tab 切换，支持健康状态筛选、名称/IP 搜索
- **延时趋势图**: 全局折线图 + 单库面积图，支持缩放
- **密码加密**: PBKDF2 哈希登录密码，Fernet AES 加密备库连接密码
- **后端自动采集**: daemon 线程独立运行，无需前端页面保持打开

## 数据来源

| Oracle 视图 | 采集内容 |
|------------|---------|
| V$DATABASE | DB_UNIQUE_NAME, DATABASE_ROLE, OPEN_MODE, PROTECTION_MODE, SWITCHOVER_STATUS |
| V$MANAGED_STANDBY | PROCESS, PID, STATUS, CLIENT_PROCESS, THREAD#, SEQUENCE#, BLOCK#, BLOCKS, DELAY_MINS |
| V$DATAGUARD_STATS | NAME, VALUE, UNIT, DATUM_TIME |

## 项目结构

```
├── index.html              # 入口 HTML
├── src/
│   ├── App.tsx             # 根组件: 认证守卫
│   ├── store.ts            # 状态层: API 调用 + 健康判断
│   ├── types.ts            # 类型定义 + Oracle SQL 常量
│   └── components/
│       ├── Dashboard.tsx    # 主面板: Tab + 筛选 + 搜索
│       ├── StandbyCard.tsx  # 备库卡片
│       ├── DataTable.tsx    # 延时表格
│       ├── DetailModal.tsx  # 备库详情弹窗
│       ├── SettingsModal.tsx # 系统设置
│       ├── OverviewChart.tsx # 全局趋势图
│       ├── TrendChart.tsx   # 单库趋势图
│       ├── Header.tsx       # 顶栏
│       └── Login.tsx        # 登录页
├── backend/
│   ├── adg_backend.py      # Flask API 服务
│   └── requirements.txt    # Python 依赖
├── dist/
│   └── index.html          # 构建产物 (单文件)
└── redwood-demo.html       # RedwoodJS 风格 Demo
```

## 部署

完整部署指南见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)。
