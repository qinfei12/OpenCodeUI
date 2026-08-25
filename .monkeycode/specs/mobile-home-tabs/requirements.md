# Requirements Document

## Introduction

本功能将 opencodeui 移动端（视口宽度 < 768px）的首页改造为类似 TRAE Android 的 Work/Code 双 Tab 界面。进入应用时不再直接进入默认新对话页，而是展示顶部两个切换按钮：**Work**（工作）与 **Code**（代码）。

- Work Tab：展示原有默认新对话主页，提供新建会话入口。
- Code Tab：展示 GitHub 项目浏览能力，用户输入 Personal Access Token（PAT）后，可查看自己的仓库、选择分支、克隆到固定工作区目录，随后进入 AI 编程会话。

桌面端（视口宽度 >= 768px）保持原有行为不变。

## Glossary

- **System**: opencodeui 移动端应用界面
- **User**: 使用移动端界面的用户
- **GitHub Token (PAT)**: 用户在 GitHub 设置中生成的 Personal Access Token，用于鉴权调用 GitHub REST API
- **Work Tab**: 首页顶部的"工作"页签，对应原有默认新对话主页
- **Code Tab**: 首页顶部的"代码"页签，对应 GitHub 项目浏览与克隆
- **Repository (Repo)**: GitHub 上的仓库
- **Branch**: 仓库的分支
- **Workspace Directory**: 仓库克隆的固定落盘目录，格式为 `~/OpenCodeUI-Projects/{owner}/{repo}`
- **AI Programming Session**: 克隆完成后创建的 opencode 会话，用于在该目录中进行 AI 辅助编程
- **Mobile Viewport**: 视口宽度小于 768 像素的显示环境

## Requirements

### Requirement 1: 移动端双 Tab 首页

**User Story:** AS 移动端用户，I want 进入应用时看到 Work/Code 两个页签，so that 我能快速选择开始新对话或进入代码编程。

#### Acceptance Criteria

1. WHEN 应用在移动端视口启动且当前无活动会话，系统 SHALL 展示双 Tab 首页，其中 Work 为默认选中页签
2. WHEN 应用在桌面端视口启动，系统 SHALL 保持原有首页行为，双 Tab 首页不展示
3. WHEN 用户点击 Code 页签，系统 SHALL 切换到 GitHub 项目浏览界面
4. WHEN 用户点击 Work 页签，系统 SHALL 切换到原默认新对话主页
5. WHEN 用户退出当前会话回到首页，系统 SHALL 重新展示双 Tab 首页

### Requirement 2: GitHub Token 配置

**User Story:** AS 移动端用户，I want 在 Code Tab 中输入并保存我的 GitHub Token，so that 我能访问我的仓库列表。

#### Acceptance Criteria

1. WHEN Code Tab 尚未配置有效 Token，系统 SHALL 展示 Token 输入界面并提示用户输入 GitHub PAT
2. WHEN 用户输入 Token 并点击保存，系统 SHALL 将 Token 持久化保存在浏览器本地存储中
3. WHEN 用户修改 Token，系统 SHALL 使用新 Token 重新请求仓库列表
4. WHEN Token 无效或已过期，系统 SHALL 展示鉴权失败提示并允许用户重新输入
5. WHEN 用户已保存有效 Token，系统 SHALL 在下次进入 Code Tab 时直接加载仓库列表

### Requirement 3: 仓库列表浏览

**User Story:** AS 移动端用户，I want 查看我的 GitHub 仓库列表，so that 我能选择要编程的仓库。

#### Acceptance Criteria

1. WHEN 用户已配置有效 Token，系统 SHALL 请求并展示当前用户的仓库列表（包含仓库名与描述）
2. WHEN 仓库列表加载中，系统 SHALL 展示加载状态
3. WHEN 仓库列表加载失败，系统 SHALL 展示错误信息并提供重试入口
4. WHEN 用户点击某个仓库，系统 SHALL 展示该仓库的分支选择界面

### Requirement 4: 分支选择

**User Story:** AS 移动端用户，I want 为选中的仓库选择分支，so that 我能基于特定分支进行克隆与编程。

#### Acceptance Criteria

1. WHEN 用户选中仓库，系统 SHALL 请求并展示该仓库的分支列表
2. WHEN 仓库默认分支存在，系统 SHALL 默认选中默认分支
3. WHEN 分支列表加载失败，系统 SHALL 展示错误信息并提供重试入口
4. WHEN 用户确认选择分支，系统 SHALL 触发克隆流程

### Requirement 5: 仓库克隆

**User Story:** AS 移动端用户，I want 将选中的仓库克隆到固定工作区，so that 我能在本地基于该代码进行 AI 编程。

#### Acceptance Criteria

1. WHEN 用户确认克隆仓库，系统 SHALL 将仓库克隆至 `~/OpenCodeUI-Projects/{owner}/{repo}` 目录
2. WHEN 目标目录已存在，系统 SHALL 复用现有目录并跳过重复克隆
3. WHEN 用户选择的仓库在目标目录已存在但分支不同，系统 SHALL 允许重新选择分支并在现有目录中切换分支
4. WHEN 克隆过程中出现网络或权限错误，系统 SHALL 展示克隆失败信息并允许用户重试
5. WHEN 克隆成功，系统 SHALL 展示成功状态并提供进入 AI 编程会话的入口

### Requirement 6: 进入 AI 编程会话

**User Story:** AS 移动端用户，I want 在克隆完成后进入基于该仓库目录的 AI 编程会话，so that 我能直接在选定项目上进行 AI 辅助编程。

#### Acceptance Criteria

1. WHEN 克隆成功且用户点击进入编程，系统 SHALL 基于目标目录创建新会话并导航至会话界面
2. WHEN 会话创建失败，系统 SHALL 展示错误信息并允许用户重试
