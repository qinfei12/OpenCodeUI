// ============================================
// Code Tab - GitHub 仓库克隆到固定工作区
//
// opencode 后端没有 git 操作端点，通过一次性 PTY
// 执行 shell 脚本完成 clone/fetch/switch，退出码
// 通过状态文件 + file.read 读回。
// ============================================

import { createPtySession, getPtySession, removePtySession } from '../../api/pty'
import { getFileContent } from '../../api/file'
import { getPath } from '../../api/client'

const EXIT_SENTINEL = '__OPENCODEUI_EXIT__'
export const PROJECTS_ROOT_NAME = 'OpenCodeUI-Projects'

const CLONE_TIMEOUT_MS = 10 * 60 * 1000
const COMMAND_TIMEOUT_MS = 60 * 1000
const POLL_INTERVAL_MS = 800

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/** 固定工作区根目录：{home}/OpenCodeUI-Projects */
export function projectsRootDir(home: string): string {
  return `${trimTrailingSlash(home)}/${PROJECTS_ROOT_NAME}`
}

/** 仓库落盘目录：{root}/{owner}/{repo} */
export function repoWorktreeDir(projectsRoot: string, owner: string, repo: string): string {
  return `${trimTrailingSlash(projectsRoot)}/${owner}/${repo}`
}

/** GitHub HTTPS 克隆地址（携带 PAT 以支持私有仓库） */
export function githubCloneUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`
}

/** 通过服务器 Path API 解析固定工作区根目录 */
export async function getProjectsRoot(serverId?: string): Promise<string> {
  const pathInfo = await getPath(serverId)
  return projectsRootDir(pathInfo.home)
}

interface ScriptResult {
  exitCode: number
  output: string
}

/**
 * 在服务器上执行一段 POSIX shell 片段，返回退出码与合并输出。
 *
 * 实现：脚本输出重定向到状态文件，PTY 进程退出后用 file.read 读回，
 * 最后一行 `__OPENCODEUI_EXIT__:<code>` 为退出码哨兵。
 */
async function runShellScript(
  script: string,
  opts: { cwd: string; serverId?: string; timeoutMs: number },
): Promise<ScriptResult> {
  const { cwd, serverId, timeoutMs } = opts
  const statusFile = `${trimTrailingSlash(cwd)}/.opencodeui-cmd-${Date.now()}.log`
  const wrapped = `{ ${script}\necho "${EXIT_SENTINEL}:$?" ; } > '${statusFile}' 2>&1`

  const pty = await createPtySession(
    { command: 'sh', args: ['-c', wrapped], cwd, title: 'OpenCodeUI git' },
    undefined,
    serverId,
  )

  try {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      if (Date.now() > deadline) {
        throw new Error('git-command-timeout')
      }
      const current = await getPtySession(pty.id, undefined, serverId)
      if (current.status === 'exited') break
    }

    const fileContent = await getFileContent(statusFile, undefined, serverId)
    const content = typeof fileContent?.content === 'string' ? fileContent.content : ''
    const lines = content.split('\n')
    let exitCode = -1
    while (lines.length > 0) {
      const line = lines.pop()?.trim()
      if (!line) continue
      const match = line.match(new RegExp(`^${EXIT_SENTINEL}:(\\d+)$`))
      if (match) {
        exitCode = Number(match[1])
      }
      break
    }
    return { exitCode, output: content.slice(0, 4000) }
  } finally {
    // 状态 PTY 无保留价值，失败/成功都清理
    removePtySession(pty.id, undefined, serverId).catch(() => {})
  }
}

export type PrepareRepoStatus = 'created' | 'switched' | 'ready'

export interface PrepareRepoOptions {
  serverId?: string
  owner: string
  repo: string
  branch: string
  token: string
  onProgress?: (message: string) => void
}

export interface PrepareRepoResult {
  status: PrepareRepoStatus
  worktree: string
}

/**
 * 将仓库准备到固定工作区目录：
 * - 目录不存在 → depth=1 clone 到 {home}/OpenCodeUI-Projects/{owner}/{repo}
 * - 已是 git 仓库且分支一致 → 直接复用
 * - 已是 git 仓库但分支不同 → fetch + switch --force
 */
export async function prepareRepoWorktree(opts: PrepareRepoOptions): Promise<PrepareRepoResult> {
  const { serverId, owner, repo, branch, token, onProgress } = opts
  const pathInfo = await getPath(serverId)
  const projectsRoot = projectsRootDir(pathInfo.home)
  const worktree = repoWorktreeDir(projectsRoot, owner, repo)
  const shellCwd = trimTrailingSlash(pathInfo.home) || '/'
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

  onProgress?.('checking-worktree')

  const isGitRepo = await runShellScript(`test -d ${quote(`${worktree}/.git`)}`, {
    cwd: shellCwd,
    serverId,
    timeoutMs: COMMAND_TIMEOUT_MS,
  })

  if (isGitRepo.exitCode === 0) {
    const branchCheck = await runShellScript(`git -C ${quote(worktree)} rev-parse --abbrev-ref HEAD`, {
      cwd: shellCwd,
      serverId,
      timeoutMs: COMMAND_TIMEOUT_MS,
    })
    const currentBranch = branchCheck.output
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0 && !line.startsWith(EXIT_SENTINEL))

    if (currentBranch === branch && branchCheck.exitCode === 0) {
      return { status: 'ready', worktree }
    }

    onProgress?.('switching-branch')
    const switchResult = await runShellScript(
      `git -C ${quote(worktree)} fetch origin ${quote(branch)} --depth=1 && ` +
        `git -C ${quote(worktree)} switch --force ${quote(branch)}`,
      { cwd: shellCwd, serverId, timeoutMs: CLONE_TIMEOUT_MS },
    )
    if (switchResult.exitCode !== 0) {
      throw Object.assign(new Error('git-switch-failed'), { detail: switchResult.output })
    }
    return { status: 'switched', worktree }
  }

  // 目录已存在但不是 git 仓库：拒绝覆盖，避免破坏用户数据
  const dirExists = await runShellScript(`test -d ${quote(worktree)}`, {
    cwd: shellCwd,
    serverId,
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  if (dirExists.exitCode === 0) {
    throw Object.assign(new Error('worktree-conflict'), { detail: worktree })
  }

  onProgress?.('cloning')
  const cloneResult = await runShellScript(
    `git clone --branch ${quote(branch)} --depth 1 ${quote(githubCloneUrl(owner, repo, token))} ${quote(worktree)}`,
    { cwd: shellCwd, serverId, timeoutMs: CLONE_TIMEOUT_MS },
  )
  if (cloneResult.exitCode !== 0) {
    // 失败输出可能包含带 token 的 remote 地址，统一脱敏后再展示
    const sanitized = token ? cloneResult.output.replaceAll(token, '***') : cloneResult.output
    throw Object.assign(new Error('git-clone-failed'), { detail: sanitized.slice(0, 500) })
  }

  return { status: 'created', worktree }
}
