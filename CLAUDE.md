# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是宁（Poppy）的个人 AI 生活助理系统「财财团队」，通过 Claude Code 子代理 + 飞书 API 实现每日新闻简报、任务管理、食谱规划、反思教练、雅思备考、读书影片管理和每日综合记录。完整设计文档见 `agent设计.md`。

## 核心架构

### 7 个 Agent（Subagent）

所有 agent 定义在 `.claude/agents/`，通过 frontmatter 指定 model：

| Agent | 模型 | 触发 | 输出 |
|-------|------|------|------|
| 新闻财 | Sonnet | 「早上好」 | `news/{date}/新闻简报.html` → 浏览器打开 |
| 日报财 | Sonnet | 新闻完了 / 「今天做什么」 | 飞书任务（v2 API）→ 飞书卡片通知 |
| 美味财 | Sonnet | 「这周吃什么」 | `meals/{date}/本周食谱.html` → 浏览器打开 |
| 反思财 | Opus | 「工作结束了」 | `reflections/{date}/反思.md` |
| 雅思财 | Opus | 「雅思财」/ 雅思相关 | `ielts-plan.html` 维护 + surge.sh 发布 |
| 阅读财 | Sonnet | 「阅读财」「记本书」「我的书架」 | `reading-tracker.html` 维护 |
| 记录财 | Sonnet | 「记录财」「今天过得怎么样」 | `daily-tracker.html` 维护 |

### 数据和存档目录

```
news/{YYYY-MM-DD}/        # 新闻简报 HTML（日报）
meals/{YYYY-MM-DD}/       # 本周食谱 HTML（周刊）
reflections/{YYYY-MM-DD}/ # 反思 Markdown（日报）
context/poppy-profile.md  # Poppy 个人档案（所有 agent 共享）
reading-tracker.html      # 读书影片管理（单页应用，localStorage）
daily-tracker.html        # 每日综合记录（单页应用，localStorage）
```
context/poppy-profile.md  # Poppy 个人档案（所有 agent 共享）

### 飞书集成

- **API 调用**：全部通过 PowerShell `Invoke-RestMethod` 直接调用飞书 HTTP API，不通过 MCP
- **Token 管理**：`feishu_token.ps1` 提供自动刷新，用法：
  ```powershell
  . .\feishu_token.ps1; $token = Get-ValidToken
  ```

**Token 分身份使用**：

| 操作 | Token | 原因 |
|------|-------|------|
| 创建/迁移/删除文档 | user_access_token | 归属用户宁 |
| 创建/管理任务 | user_access_token | 归属宁 + 设宁为负责人 |
| 创建日历事件 | user_access_token | 写入宁主日历 |
| 发送飞书消息 | app_access_token | 应用发消息即可 |

**任务创建三步流程**（v2 API）：
1. `POST /task/v2/tasks` — 创建（含 `start.timestamp` 毫秒时间戳 + `start.is_all_day:false`）
2. `POST /task/v2/tasks/{guid}/add_members` — 设宁为 assignee
3. `POST /task/v2/tasks/{guid}/add_tasklist` — 移入 poppy 清单

**消息发送**：`POST /im/v1/messages?receive_id_type=open_id`，使用 `app_access_token`

**关键 ID**：
- `open_id`：`ou_5803e3d7fc534d734a77a4040a78f778`
- `poppy 任务清单 guid`：`56599780-fced-437a-9462-030fc88c0685`
- `日历 ID`：`feishu.cn_BoFPTTs1pt0RrZyGnXyQQe@group.calendar.feishu.cn`
- `poppy 文件夹 token`：`CRnXfoy3ulpV2Jdbx8OcqFMUnFg`

### OAuth 授权流程

```
1. 打开授权页（自动用 Start-Process 打开浏览器）
   URL: https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=cli_aac667dbd539dbed&redirect_uri=http://127.0.0.1:8080&scope=...
2. 用户获取地址栏 code 参数
3. 用 code 兑换 user_access_token
4. 调用 feishu_token.ps1 的 Save-TokenState 保存到 .token_state.json
```

## 关键编码规范

### PowerShell 中文编码（核心）
```powershell
$utf8 = New-Object System.Text.UTF8Encoding $false   # 无 BOM！
$bytes = $utf8.GetBytes($json)
Invoke-RestMethod -Uri $uri -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
```
- ❌ PowerShell 5.1 `ConvertTo-Json` 直接输出中文乱码
- ❌ `System.IO.File::WriteAllText` 默认写 BOM → 飞书报 9499
- ❌ 不能用 `&&` / `||` 链式操作（PS 5.1 不支持），用 `; if ($?) { }`
- ✅ 必须用无 BOM UTF-8

### 时间戳计算
```powershell
$cst = [TimeSpan]::FromHours(8)
$start = [DateTimeOffset]::new(2026,7,8,18,0,0,$cst)
$ts = $start.ToUnixTimeSeconds()  # 禁止手动计算！不同年份闰年差异易出错
```

### HTML 模板规范
- 全部使用 `.news/2026-07-09/新闻简报.html` 的 CSS 风格作为模板
- 卡片布局 + 亮/暗色模式 (`prefers-color-scheme: dark`) + 响应式
- 所有来源链接 `target="_blank"` 可点击打开原文
- 美味财的食谱 HTML 须包含：刷新换菜按钮 + JS 备选食谱库（31+ 道）

### 飞书 Token 生命周期
- `user_access_token`：2 小时，过期自动用 refresh_token 刷新
- `refresh_token`：30 天，过期需重新 OAuth 授权
- 已设置 Cron 任务每 25 天提醒续期
- Token 本地缓存在 `.token_state.json`（gitignore 已排除）

## 阅读财 — 读书影片管理

### 产品
**生产地址**：https://poppy-reading.surge.sh（国内直连）

**更新命令**：
```powershell
copy "E:\claude code\connect feishu\reading-tracker.html" "E:\reading-deploy\index.html" /Y
npx surge "E:\reading-deploy" poppy-reading.surge.sh
```

### 豆瓣代理（作者 + 封面自动搜索）
**`author-proxy.mjs`** — Node.js 零依赖，侦听 `localhost:3456`，启动时自动开启 Cloudflare Tunnel 获得公网地址。

| 端点 | 功能 |
|------|------|
| `GET /book-info?title=书名` | 返回 `{ author, cover_url, title }` |
| `GET /movie-info?title=片名` | 返回 `{ cover_url, title }` |
| `GET /cover?url=URL` | 中转下载图片（绕过豆瓣防盗链） |
| `GET /health` | 返回 `{ status, tunnel_url }` |

**启动**：`node "E:\claude code\connect feishu\author-proxy.mjs"`
- `cloudflared.exe` 位于 `E:\cloudflared.exe`（从 GitHub Releases 下载）
- 已配置开机自启：`start-proxy.vbs` 在 Windows 启动文件夹
- 页面启动时自动调用 `/health` 发现最新 tunnel URL，**tunnel 地址变化无需手动更新**

### 网页技术架构
- 纯 HTML + CSS + Vanilla JS，localStorage 持久化（key: `reading_fortune_data`）
- 封面：Ctrl+V 粘贴 → base64 data URL 存储（>500KB 自动缩放到 800px）
- 豆瓣图片直链无法直接 `<img>` 显示（防盗链 418），需通过代理中转
- 主题：粉色 `#ec4899` + 暗色模式（手动切换，`reading_fortune_theme`）
- 卡片：横向布局（封面左 140px + 内容右），手机端纵向

| 文件 | 敏感级别 | Git |
|------|---------|-----|
| `.claude/settings.local.json` | 含 App Secret | ❌ ignore |
| `.token_state.json` | 含 access_token | ❌ ignore |
| `oauth_exchange*.ps1` | 含旧 token | ❌ ignore |
| `task_tmp.json` | 临时文件 | ❌ ignore |
| `feishu_token.ps1` | 含 App Secret | ⚠️ 谨慎提交 |
| `memory/feishu-auto-send.md` | 含 App Secret | ⚠️ 已提交 |

## 记录财 — 每日综合记录

### 产品
**生产地址**：https://poppy-daily-tracker.surge.sh（国内直连）

**更新命令**：
```powershell
copy "E:\claude code\connect feishu\daily-tracker.html" "E:\daily-deploy\index.html" /Y
npx surge "E:\daily-deploy" poppy-daily-tracker.surge.sh
```

### 网页技术架构
- 纯 HTML + CSS + Vanilla JS，localStorage + Firebase 双存储（key: `daily_tracker_data`）
- Firebase 5 秒轮询多设备同步，路径 `/daily-records.json`
- 橙粉色主题 `#f97316` + 暗色模式
- 6 大模块：日期头、时间轴（24 整点/点击展开/标签/摘要）、精力总结（按小时饼图）、餐食、感恩日记、状态打分

## 雅思备考网页

### 线上部署
**生产地址**：https://poppy-ielts-plan.surge.sh（国内直连，无需科学上网）

**更新命令**（改完 `ielts-plan.html` 后执行）：
```powershell
copy "E:\claude code\connect feishu\ielts-plan.html" "E:\ielts-deploy\index.html" /Y
npx surge "E:\ielts-deploy" poppy-ielts-plan.surge.sh
# 提示 overwrite? → 输入 y 回车
```
> 注意 surge 需要目录而非单文件，所以要先复制到 `E:\ielts-deploy\` 再发布。

### 技术要点
- 纯 HTML + CSS + Vanilla JS，零依赖
- 120 天数据嵌入 `D()` 函数，`renderDayDetail()` 动态渲染
- localStorage keys：`ielts_plan_v2`（完成状态）、`ielts_plan_custom_v2`（自定义任务增删改）、`ielts_plan_theme`
- 自定义任务通过 `getMergedTasks()` 合并原始+自定义数据
- URL hash 定位 `#day31`，键盘左右箭头翻页
- 数据源是 `雅思逐日备考计划.md`（HTML 任务数据需手动同步）

### 其他部署方式（历史）
- GitHub Pages：需科学上网，`index.html` 自动跳转到 `ielts-plan.html`
- `deploy.js`：第一版 surge 脚本（单文件模式已弃用，现用目录模式）
- 备忘记录在 `笔记.md`

## 用户偏好

- 语言：简体中文，助手自称「财财」
- 新闻简报：生成 HTML 并在浏览器打开，不发飞书消息
- 任务：默认入 poppy 清单、设宁为负责人、开始时间=创建时间、发飞书通知
- 食谱：一人食、一个厨具搞定、份量精准（50kg 女生）
- 车企数字化是新闻必搜类别
- 用户说「早上好」= 触发新闻财全流程
