// ============================================
// Code Tab - GitHub 仓库克隆到固定工作区
//
// opencode 后端没有 git 操作端点，通过一次性 PTY
// 执行 shell 脚本完成 clone/fetch/switch；脚本在退出前
// 输出 `__OPENCODEUI_EXIT__:<code>` 哨兵，前端通过 PTY
// WebSocket 收集输出、连接关闭后解析退出码。
// ============================================

import { createPtySession, removePtySession } from '../../api/pty'
import { getPtyConnectUrl } from '../../api/pty'
import { getPath } from '../../api/client'
import { connectTauriPty, type TauriPtyConnection } from '../../api/ptyBridge'
import { parsePtyFrame } from '../../utils/ptyProtocol'
import { isTauri } from '../../utils/tauri'

const EXIT_SENTINEL = '__OPENCODEUI_EXIT__'
export const PROJECTS_ROOT_NAME = 'OpenCodeUI-Projects'

const CLONE_TIMEOUT_MS = 10 * 60 * 1000
const COMMAND_TIMEOUT_MS = 60 * 1000

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
 * 实现：PTY 进程退出时服务器会关闭 WebSocket 连接，收集期间的全部输出，
 * 从中解析最后一个 `__OPENCODEUI_EXIT__:<code>` 哨兵行得到退出码。
 */
export async function runShellScript(
  script: string,
  opts: { cwd: string; serverId?: string; timeoutMs: number },
): Promise<ScriptResult> {
  try {
    return await runShellScriptOnce(script, opts)
  } catch (error) {
    // 极快结束的命令可能在 WS 连接建立前就执行完毕并被服务器清理，
    // 输出随之丢失。仅对无副作用的探测命令自动重试一次。
    if (
      script.trimStart().startsWith('test ') &&
      error instanceof Error &&
      error.message === 'pty-output-missing-exit-code'
    ) {
      return runShellScriptOnce(script, opts)
    }
    throw error
  }
}

async function runShellScriptOnce(
  script: string,
  opts: { cwd: string; serverId?: string; timeoutMs: number },
): Promise<ScriptResult> {
  const { cwd, serverId, timeoutMs } = opts
  // GIT_TERMINAL_PROMPT=0 防止凭据失效时 git 卡在交互提示上
  const wrapped = `{ export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true\n${script}\necho "${EXIT_SENTINEL}:$?" ; } 2>&1`

  const pty = await createPtySession(
    { command: 'sh', args: ['-c', wrapped], cwd, title: 'OpenCodeUI git' },
    undefined,
    serverId,
  )

  return await new Promise<ScriptResult>((resolve, reject) => {
    let output = ''
    let settled = false
    let ws: WebSocket | null = null
    let bridge: TauriPtyConnection | null = null
    const timer = setTimeout(() => settle(new Error('git-command-timeout')), timeoutMs)

    function settle(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws?.close()
      bridge?.close()
      // 状态 PTY 无保留价值，成功失败都清理
      removePtySession(pty.id, undefined, serverId).catch(() => {})

      if (error) {
        reject(error)
        return
      }

      const normalized = output.replace(/\r/g, '')
      const matches = [...normalized.matchAll(new RegExp(`${EXIT_SENTINEL}:(\\d+)`, 'g'))]
      const last = matches.at(-1)
      if (!last) {
        reject(new Error('pty-output-missing-exit-code'))
        return
      }
      const sentinelIndex = normalized.lastIndexOf(last[0])
      const logOutput = (normalized.slice(0, sentinelIndex) + normalized.slice(sentinelIndex + last[0].length))
        .trim()
        .slice(-4000)
      resolve({ exitCode: Number(last[1]), output: logOutput })
    }

    const handleChunk = (chunk: string | ArrayBuffer) => {
      const frame = parsePtyFrame(chunk)
      if (frame?.kind === 'data') output += frame.data
    }

    if (isTauri()) {
      void connectTauriPty({
        ptyId: pty.id,
        serverId,
        onConnected: () => {},
        onMessage: handleChunk,
        onDisconnected: () => settle(),
        onError: message => settle(new Error(message)),
      }).then(
        connection => {
          if (settled) {
            connection.close()
            return
          }
          bridge = connection
        },
        error => {
          settle(error instanceof Error ? error : new Error(String(error)))
        },
      )
      return
    }

    try {
      ws = new WebSocket(getPtyConnectUrl(pty.id, undefined, {}, serverId))
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
      return
    }
    ws.binaryType = 'arraybuffer'
    ws.onmessage = event => handleChunk(event.data as string | ArrayBuffer)
    ws.onclose = () => settle()
    ws.onerror = () => {
      // onclose 随后会触发并在无哨兵时报连接错误，这里不重复处理
    }
  })
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
