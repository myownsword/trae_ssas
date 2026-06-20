# 🏪 门店换班审批小系统 (SSAS)

Store Shift Approval System — 一个基于 Express + SQLite + EJS 的门店员工换班审批管理系统。

## ✨ 功能特性

### 核心业务流程
1. **员工提交换班申请** — 选择原班次、接班人、（可选）互换班次和申请原因
2. **接班人确认/拒绝** — 接班人先确认是否愿意接班，拒绝时必须填写原因
3. **店长审批** — 店长批准（班表自动同步）或驳回（必须填写驳回原因）
4. **班表同步** — 审批通过后，班次归属自动变更到新员工

### 角色功能
| 功能 | 员工 | 店长 |
|------|------|------|
| 发起换班申请 | ✅ | - |
| 处理待我确认的接班 | ✅ | - |
| 撤回进行中的申请 | ✅ | - |
| 审批换班申请 | - | ✅ |
| 查看本周待处理统计 | - | ✅ |
| 查看风险班次预警 | - | ✅ |
| 查看班表 | ✅ | ✅ |
| 查看全部换班申请 | 仅本人相关 | 全部 |

### 页面功能
- **登录页** — 账号密码登录（含测试账号提示）
- **店长首页** — 本周待审批数、待确认数、风险班次列表、最近申请
- **员工首页** — 待我确认的申请、我发起的申请
- **班表页** — 周视图班表，上/下周切换，已完成换班的调整前后对比
- **申请列表页** — 按状态筛选（待确认/待审批/已通过/已驳回/已撤回）
- **申请详情页** — 班次调整对比、审批操作按钮、完整时间线
- **新建申请页** — 选择班次、接班人、原因提交

### 边界与异常处理
| 场景 | 处理方式 |
|------|----------|
| 班次时间重叠 | 提交、确认、审批三个环节均实时校验，冲突则拦截并提示 |
| 接班人不存在 | 提交时校验员工身份，无效则报错 |
| 申请人撤回 | 仅在"待确认"或"待审批"状态允许撤回，已终态的不可撤回 |
| 重复审批 | 审批前校验当前状态，非法状态操作被拦截 |
| 驳回原因为空 | 前端+后端双重校验，驳回原因不能为空 |
| 同一班次重复申请 | 检查该班次是否已有进行中申请，避免重复提交 |
| 数据持久化 | SQLite 文件存储，刷新/重启服务数据不丢失 |

---

## 🏗️ 技术栈

| 类别 | 技术 |
|------|------|
| 后端框架 | Express 4.x |
| 模板引擎 | EJS 3.x |
| 数据库 | SQLite (better-sqlite3) |
| 会话管理 | express-session |
| 日期处理 | date-fns |
| 前端样式 | 原生 CSS (无框架依赖) |

---

## 📁 项目结构

```
ssas/
├── app.js                      # 应用入口，Express 配置与路由注册
├── db.js                       # SQLite 数据库连接与表结构初始化
├── seed.js                     # 种子数据脚本（测试用户+班次）
├── utils.js                    # 工具函数（班次校验、时间处理等）
├── package.json                # 项目依赖与脚本
├── middleware/
│   └── auth.js                 # 登录/角色权限中间件
├── routes/
│   ├── auth.js                 # 登录/登出路由
│   ├── shifts.js               # 班表路由
│   └── swap.js                 # 换班申请核心路由（CRUD+审批流程）
├── views/
│   ├── login.ejs               # 登录页
│   ├── error.ejs               # 错误页
│   ├── partials/
│   │   ├── header.ejs          # 公共头部（导航+用户信息）
│   │   └── footer.ejs          # 公共尾部
│   ├── manager/
│   │   └── dashboard.ejs       # 店长首页
│   ├── staff/
│   │   └── dashboard.ejs       # 员工首页
│   ├── shifts/
│   │   └── index.ejs           # 班表（周视图）
│   └── swap/
│       ├── list.ejs            # 换班申请列表
│       ├── new.ejs             # 新建换班申请
│       └── detail.ejs          # 申请详情（含时间线+操作）
├── public/
│   └── css/
│       └── style.css           # 全站样式
└── data/
    └── ssas.db                 # SQLite 数据库文件（运行后自动生成）
```

---

## 🗄️ 数据库设计

### `users` — 用户表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 用户ID |
| username | TEXT UNIQUE | 登录用户名 |
| password | TEXT | 密码（演示用明文，生产环境请加密） |
| name | TEXT | 姓名 |
| role | TEXT | 角色：`staff`（员工）/ `manager`（店长） |

### `shifts` — 班次表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 班次ID |
| user_id | INTEGER FK | 所属员工ID |
| shift_date | TEXT | 班次日期（YYYY-MM-DD） |
| start_time | TEXT | 开始时间（HH:MM） |
| end_time | TEXT | 结束时间（HH:MM） |
| status | TEXT | `active` / `swapped` / `cancelled` |
| swap_request_id | INTEGER | 关联换班申请ID |

### `swap_requests` — 换班申请表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 申请ID |
| requester_id | INTEGER FK | 申请人ID |
| successor_id | INTEGER FK | 接班人ID |
| original_shift_id | INTEGER FK | 原班次ID |
| new_shift_id | INTEGER FK | 互换班次ID（可选） |
| reason | TEXT | 申请原因 |
| status | TEXT | 状态：见下方状态机 |
| reject_reason | TEXT | 驳回/拒绝原因 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### `approval_timeline` — 审批时间线
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 时间线条目ID |
| swap_request_id | INTEGER FK | 换班申请ID |
| actor_id | INTEGER FK | 操作人ID |
| action | TEXT | 操作类型：submit / successor_confirm / successor_reject / approve / reject / withdraw |
| comment | TEXT | 操作意见/原因 |
| created_at | TEXT | 操作时间 |

---

## 🔄 状态流转图

```
              ┌─────────────────┐
              │  pending_confirm │ ←── 提交申请
              │  （待接班人确认）│
              └────────┬────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
    successor_confirm        successor_reject
           │                       │
           ▼                       ▼
  ┌──────────────────┐      successor_rejected
  │ pending_approve  │      （终态：接班人拒绝）
  │  （待店长审批）  │
  └────────┬─────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
  approve       reject
    │             │
    ▼             ▼
 approved      rejected
（终态：已通过）（终态：已驳回）
```

**说明：**
- 在 `pending_confirm` 和 `pending_approve` 状态，申请人可随时 `withdraw`（撤回）
- `approved`、`rejected`、`successor_rejected`、`withdrawn` 均为终态，不可再操作

---

## 🚀 快速开始

### 环境要求
- Node.js >= 14.x
- npm 或 yarn

### 安装步骤

```bash
# 1. 进入项目目录
cd ssas

# 2. 安装依赖
npm install

# 3. 初始化种子数据（首次运行必选）
npm run seed

# 4. 启动服务
npm start
```

服务启动后访问：**http://localhost:3000**

### 测试账号
| 用户名 | 密码 | 角色 | 姓名 |
|--------|------|------|------|
| manager | 123456 | 店长 | 张店长 |
| staff1 | 123456 | 员工 | 李小明 |
| staff2 | 123456 | 员工 | 王小红 |
| staff3 | 123456 | 员工 | 赵小强 |

---

## ✅ 功能验证指南

以下为启动系统后的完整验证流程，覆盖"成功换班"、"冲突失败"、"状态持久化"三个场景。

### 场景一：成功完成一次换班

1. **登录 staff1（李小明）** → 员工首页
2. 点击 **「+ 发起换班申请」**
3. 选择：
   - 原班次：选一个李小明的有效班次（如明天 09:00-17:00）
   - 接班人：王小红（staff2）
   - 换班原因：有事需调班
4. 提交，提示"已提交，等待接班人确认"，状态为 `待接班人确认`
5. **退出登录**，用 **staff2（王小红）** 登录
6. 员工首页可见"需要我确认的换班"，点击「处理」进入详情
7. 点击 **「✓ 确认接班」**，状态变为 `待店长审批`
8. **退出登录**，用 **manager（张店长）** 登录
9. 店长首页可见"待审批申请"数量增加，点击进入详情
10. 点击 **「✓ 批准」**，状态变为 `已通过`
11. 进入 **班表** 页面，可看到：
    - 原班次已从李小明行移到王小红行
    - 页面底部显示"本周已完成的换班（调整前后对比）"

### 场景二：班次冲突导致失败

1. **登录 staff1（李小明）** → 发起换班
2. 选择原班次：李小明某天的班次
3. **接班人选择当天已有冲突班次的员工**（例如李小明选 09:00-17:00，而王小红当天已有 09:00-17:00）
4. 提交后系统提示：**"接班人在 YYYY-MM-DD 已有班次 HH:MM-HH:MM，时间冲突"**
5. 换班申请不会被创建

### 场景三：刷新/重启后状态不丢失

1. 按场景一流程操作到"待店长审批"状态（或任意中间状态）
2. **刷新浏览器页面** → 申请状态保持不变
3. 在终端按 `Ctrl+C` 停止服务
4. 重新运行 `npm start`
5. 再次访问系统，重新登录
6. 进入换班申请详情 → 状态、时间线、审批意见均完整保留
7. 班表数据与之前完全一致

---

## 🔌 API 路由一览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/login` | 公开 | 登录页 |
| POST | `/auth/login` | 公开 | 登录提交 |
| POST | `/auth/logout` | 已登录 | 退出登录 |
| GET | `/` | 已登录 | 首页（根据角色跳转不同仪表盘） |
| GET | `/shifts` | 已登录 | 班表（支持 `?date=YYYY-MM-DD` 指定周） |
| GET | `/swap` | 已登录 | 换班申请列表（支持 `?filter=pending_confirm` 等） |
| GET | `/swap/new` | 员工 | 新建换班申请页 |
| POST | `/swap` | 员工 | 提交换班申请 |
| GET | `/swap/:id` | 相关人/店长 | 申请详情 |
| POST | `/swap/:id/successor-confirm` | 接班人 | 接班人确认 |
| POST | `/swap/:id/successor-reject` | 接班人 | 接班人拒绝（需 comment） |
| POST | `/swap/:id/approve` | 店长 | 批准换班（同步班表） |
| POST | `/swap/:id/reject` | 店长 | 驳回（需 comment） |
| POST | `/swap/:id/withdraw` | 申请人 | 撤回申请 |

---

## ⚙️ 配置说明

- **端口**：默认 3000，可通过环境变量 `PORT` 修改
- **会话密钥**：`app.js` 中 `session.secret`，生产环境请更换
- **数据库路径**：`data/ssas.db`，可在 `db.js` 中修改

---

## 📝 开发说明

### 核心校验逻辑位置
- 班次重叠校验：[utils.js](file:///e:/jianzhiworkspace/ssas/utils.js) 中 `checkShiftOverlap()` 与 `timesOverlap()`
- 提交申请校验：[routes/swap.js](file:///e:/jianzhiworkspace/ssas/routes/swap.js) `POST /swap`
- 审批二次校验：[routes/swap.js](file:///e:/jianzhiworkspace/ssas/routes/swap.js) `approve` 与 `successor-confirm` 路由内均再次校验

### 新增功能建议
- 密码加密（bcrypt）
- 换班成功后的邮件/站内信通知
- 导出班表为 Excel/PDF
- 移动端适配
- 更多角色（如 HR、区域经理）

---

## 📄 License

MIT
