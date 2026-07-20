# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是宁（Poppy）的个人 AI 生活助理系统「财财团队」，通过 Claude Code 子代理 + 飞书 API 实现每日新闻简报、任务管理、食谱规划、反思教练、雅思备考、读书影片管理和每日综合记录。

## 核心架构

### 多 Agent 系统

项目基于 7 个 specialized agents，定义在 `.claude/agents/`：

| Agent | 模型 | 触发方式 | 功能 |
|-------|------|----------|------|
| 新闻财 | Sonnet | 用户说「早上好」或类似问候 | 搜集 AI/互联网/车企新闻 → 生成 HTML 简报 → 打开浏览器 |
| 日报财 | Sonnet | 新闻财完成后（已暂停）或用户说「今天做什么」 | 对话了解今日计划 → 飞书创建任务 → 发送通知 |
| 美味财 | Sonnet | 用户说「这周吃什么」 | 小红书搜索一人食食谱 → 生成 HTML → 打开浏览器 |
| 反思财 | Opus | 用户说「工作结束了」 | 深度对话 → 生成反思 Markdown |
| 雅思财 | Opus | 用户说「雅思财」或雅思相关 | 维护 ielts-plan.html → 部署到 surge.sh |
| 阅读财 | Sonnet | 用户说「阅读财」「记本书」「我的书架」 | 维护 reading-tracker.html → 管理书籍/电影 |
| 记录财 | Sonnet | 用户说「记录财」「今天过得怎么样」 | 维护 daily-tracker.html → 每日综合记录 |

### 数据流与存储

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户数据存储                              │
├─────────────────────────────────────────────────────────────────┤
│ localStorage (浏览器端)                                         │
│  ├─ reading_fortune_data (阅读财数据)                           │
│  ├─ reading_fortune_theme (阅读财主题)                          │
│  ├─ daily_tracker_data (记录财数据)                            │
│  ├─ daily_tracker_theme (记录财主题)                           │
│  └─ ielts_plan_v2 / ielts_plan_custom_v2 (雅思财数据)          │
├─────────────────────────────────────────────────────────────────┤
│ Firebase Realtime Database (多设备同步)                         │
│  ├─ https://poppy-reading-default-rtdb.firebaseio.com/         │
│  │  ├─ daily-records.json (记录财数据)                         │
│  │  └─ (阅读财数据也在此)                                      │
├─────────────────────────────────────────────────────────────────┤
│ 文件系统存档                                                    │
│  ├─ news/{YYYY-MM-DD}/新闻简报.html                            │
│  ├─ meals/{YYYY-MM-DD}/本周食谱.html                           │
│  └─ reflections/{YYYY-MM-DD}/反思.md                           │
└─────────────────────────────────────────────────────────────────┘
```

### 飞书集成

**核心文件**：`feishu_token.ps1` - 自动管理 token 刷新

**Token 使用规则**：
- 创建/删除文档 → user_access_token（归属用户）
- 创建/管理任务 → user_access_token（设为负责人）
- 创建日历事件 → user_access_token（写入主日历）
- 发送飞书消息 → app_access_token（应用发消息即可）

**任务创建流程（v2 API）**：
1. `POST /task/v2/tasks` 创建任务（含 `start.timestamp` 毫秒 + `start.is_all_day:false`）
2. `POST /task/v2/tasks/{guid}/add_members` 设宁为负责人
3. `POST /task/v2/tasks/{guid}/add_tasklist` 移入 poppy 清单

**关键 ID（硬编码）**：
- open_id: `ou_5803e3d7fc534d734a77a4040a78f778`
- poppy 任务清单 guid: `56599780-fced-437a-9462-030fc88c0685`
- 日历 ID: `feishu.cn_BoFPTTs1pt0RrZyGnXyQQe@group.calendar.feishu.cn`
- poppy 文件夹 token: `CRnXfoy3ulpV2Jdbx8OcqFMUnFg`

### 豆瓣代理（阅读财用）

**文件**：`author-proxy.mjs` - Node.js 服务，监听 localhost:3456

| 端点 | 功能 |
|------|------|
| `GET /book-info?title=书名` | 返回 `{ author, cover_url, title }` |
| `GET /movie-info?title=片名` | 返回 `{ cover_url, title }` |
| `GET /cover?url=URL` | 中转下载图片（绕过豆瓣防盗链） |
| `GET /health` | 返回 `{ status, tunnel_url }` |

**启动方式**：`node author-proxy.mjs`（已配置开机自启 start-proxy.vbs）

### 公共网页部署

所有 HTML 页面都部署到 surge.sh（国内直连）：

| 页面 | 本地文件 | 生产地址 | 部署命令 |
|------|----------|----------|----------|
| 阅读财 | reading-tracker.html | https://poppy-reading.surge.sh | copy 到 E:\reading-deploy → npx surge |
| 记录财 | daily-tracker.html | https://poppy-daily-tracker.surge.sh | copy 到 E:\daily-deploy → npx surge |
| 雅思财 | ielts-plan.html | https://poppy-ielts-plan.surge.sh | copy 到 E:\ielts-deploy → npx surge |

## 常用命令

### PowerShell 中文编码（重要！）

```powershell
# 所有飞书 API 调用必须使用无 BOM UTF-8
$utf8 = New-Object System.Text.UTF8Encoding $false
$bytes = $utf8.GetBytes($json)
Invoke-RestMethod -Uri $uri -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
```

### 日期时间处理

```powershell
# 获取当前毫秒时间戳（飞书任务用）
$cst = [TimeSpan]::FromHours(8)
$now = [DateTimeOffset]::Now.ToOffset($cst)
$timestamp = $now.ToUnixTimeMilliseconds()

# 或者指定时间
$start = [DateTimeOffset]::new(2026, 7, 20, 9, 0, 0, $cst)
$ts = $start.ToUnixTimeMilliseconds()
```

### 飞书 Token 管理

```powershell
# 加载并获取有效 token
. .\feishu_token.ps1
$token = Get-ValidToken  # 自动刷新过期的 token

# 手动保存 token 状态
Save-TokenState -Token $tokenResponse
```

### 部署网页

```powershell
# 阅读财
Copy-Item "E:\claude code\connect feishu\reading-tracker.html" "E:\reading-deploy\index.html" -Force
npx surge "E:\reading-deploy" poppy-reading.surge.sh

# 记录财
Copy-Item "E:\claude code\connect feishu\daily-tracker.html" "E:\daily-deploy\index.html" -Force
npx surge "E:\daily-deploy" poppy-daily-tracker.surge.sh

# 雅思财
Copy-Item "E:\claude code\connect feishu\ielts-plan.html" "E:\ielts-deploy\index.html" -Force
npx surge "E:\ielts-deploy" poppy-ielts-plan.surge.sh
```

## 文件结构速查

```
connect feishu/
├── .claude/agents/          # Agent 定义（不要随便改触发逻辑）
│   ├── 新闻财.md
│   ├── 日报财.md
│   ├── 美味财.md
│   ├── 反思财.md
│   ├── 雅思财.md
│   ├── 阅读财.md
│   └── 记录财.md
├── context/
│   └── poppy-profile.md     # Poppy 个人档案（所有 agent 共享）
├── news/{YYYY-MM-DD}/       # 新闻简报存档
├── meals/{YYYY-MM-DD}/      # 食谱存档
├── reflections/{YYYY-MM-DD}/ # 反思存档
├── reading-tracker.html     # 阅读财单页应用
├── daily-tracker.html       # 记录财单页应用
├── ielts-plan.html          # 雅思备考页面
├── feishu_token.ps1         # 飞书 token 管理（核心）
├── author-proxy.mjs         # 豆瓣代理服务
└── CLAUDE.md                # 本文件
```

## 开发原则（重要！）

1. **数据安全第一**：
   - 修改现有页面时，**禁止清空或覆盖**用户已有的 localStorage/Firebase 数据
   - 新增字段必须向后兼容（`|| []` / `|| {}` 降级）
   - 数据结构变更必须写迁移逻辑

2. **编码规范**：
   - PowerShell 5.1 不能用 `&&` / `||`，用 `; if ($?) { ... }`
   - 所有中文输出必须用无 BOM UTF-8
   - HTML/CSS/JS 保持一致的风格（参考现有页面）

3. **交付前自测**：
   - 本地打开页面测试核心流程（新增→保存→刷新验证→编辑→删除）
   - 确认无报错后再部署到 surge.sh

4. **敏感信息保护**：
   - .claude/settings.local.json 已 gitignore（含 App Secret）
   - .token_state.json 已 gitignore（含 access_token）
   - feishu_token.ps1 谨慎提交（含 App Secret）

## 当前状态

- 日报财自动触发已暂停（2026-07-20），需要用户主动召唤
- 其他 agents 正常工作
