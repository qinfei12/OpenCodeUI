# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: Agent 完成"与上游同步"任务（保留界面美化 + 模板画廊，舍弃其余功能）
- Category: Workflow & Collaboration
- Instructions:
  - 上游仓库为 lehhair/OpenCodeUI（README 内引用），origin 为 qinfei12/OpenCodeUI fork
  - 同步前本仓库历史已重置为单提交、与上游无共同祖先，直接 merge 产生 70 个 add/add 冲突
  - 已采用的同步方法：以本地改动相对上游 v0.6.45 基线的 diff 生成 patch，checkout upstream/main 新分支后 `git apply -3` 三方重放，混功能文件（Header 等）手工只挑样式 hunk
  - 2026-09-30 同步后 main 已基于上游 8a6d4ea（v0.6.46），此后与上游有共同祖先，可直接 git fetch upstream + merge
  - 保留改动清单：index.css 全部美化、消息气泡（MessageRenderer/TextPartView/ChatArea）、侧栏/输入框/设置/会话列表样式、模板画廊（TemplatesGallery + templateGalleryStore + 输入框/侧栏/空状态入口）
  - 舍弃：移动端主页 MobileHome、GitHub 项目浏览器、constants/api.ts 与 serverStore 的 URL 迁移逻辑

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: Agent 执行"生成预览"任务时启动开发服务器
- Category: Operations & Deployment
- Instructions:
  - 开发服务器启动命令：`npm install && npm run dev`（Vite 8，默认端口 5173，strictPort 已开启）
  - 环境中已有 OpenCode 后端进程监听 127.0.0.1:4096，前端 vite.config.ts 已配置 `/api` 反向代理到该地址（含 WebSocket），预览时页面可直接与后端通信
  - vite.config.ts 的 server.allowedHosts 已设为 true，任意域名访问均可
