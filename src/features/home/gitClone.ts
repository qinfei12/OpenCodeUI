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

/** WS 握手缓冲：PTY 进程至少存活该时长，避免快速失败时会话被提前销毁导致输出丢失 */
const PTY_START_DELAY_SECONDS = 1

/**
 * 在服务器上执行一段 POSIX shell 片段，返回退出码与合并输出。
 *
 * 实现：PTY 进程退出时服务器会关闭 WebSocket 连接，收集期间的全部输出，
 * 从中解析最后一个 `__OPENCODEUI_EXIT__:<code>` 哨兵行得到退出码。
 * 脚本开头 sleep 一小段时间，保证客户端完成 WS 握手后再开始真正的命令，
 * 否则毫秒级失败的命令会在会话销毁后连输出一起消失。
 */
export async function runShellScript(
  script: string,
  opts: {
    cwd: string
    serverId?: string
    timeoutMs: number
    /** 输出到达时实时回调，用于进度展示与状态标记解析 */
    onOutput?: (chunk: string) => void
  },
): Promise<ScriptResult> {
  const { cwd, serverId, timeoutMs, onOutput } = opts
  // GIT_TERMINAL_PROMPT=0 防止凭据失效时 git 卡在交互提示上
  const wrapped = `{ sleep ${PTY_START_DELAY_SECONDS}\nexport GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true\n${script}\necho "${EXIT_SENTINEL}:$?" ; } 2>&1`

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
      if (frame?.kind === 'data') {
        output += frame.data
        onOutput?.(frame.data)
      }
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

const STATUS_MARKER = '__OPENCODEUI_STATUS__:'

/**
 * 将仓库准备到固定工作区目录：
 * - 目录不存在 → depth=1 clone 到 {home}/OpenCodeUI-Projects/{owner}/{repo}
 * - 已是 git 仓库且分支一致 → 直接复用
 * - 已是 git 仓库但分支不同 → fetch + switch --force
 *
 * 全流程合并为一个 shell 脚本在单个 PTY 内执行：多次 PTY 往返既慢，
 * 又会让毫秒级失败的中间步骤因会话提前销毁而丢失输出。
 * 脚本通过 STATUS 标记行上报当前阶段，前端实时解析用于进度展示与结果判定。
 */
export async function prepareRepoWorktree(opts: PrepareRepoOptions): Promise<PrepareRepoResult> {
  const { serverId, owner, repo, branch, token, onProgress } = opts
  const pathInfo = await getPath(serverId)
  const projectsRoot = projectsRootDir(pathInfo.home)
  const worktree = repoWorktreeDir(projectsRoot, owner, repo)
  const shellCwd = trimTrailingSlash(pathInfo.home) || '/'
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
  const cloneUrl = githubCloneUrl(owner, repo, token)

  onProgress?.('checking-worktree')

  // 记录输出流中最近一次阶段标记，供 onProgress 实时刷新文案
  let lastStatus = ''
  const handleOutputChunk = (chunk: string) => {
    for (const match of chunk.matchAll(new RegExp(`${STATUS_MARKER}(\\w+)`, 'g'))) {
      lastStatus = match[1]
      if (lastStatus === 'cloning') onProgress?.('cloning')
      if (lastStatus === 'switching') onProgress?.('switching-branch')
    }
  }

  const script = [
    `WORKTREE=${quote(worktree)}`,
    `BRANCH=${quote(branch)}`,
    `URL=${quote(cloneUrl)}`,
    `if [ -d "$WORKTREE/.git" ]; then`,
    `  CURRENT=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null)`,
    `  if [ "$CURRENT" = "$BRANCH" ]; then`,
    `    echo "${STATUS_MARKER}ready"`,
    `  else`,
    `    echo "${STATUS_MARKER}switching"`,
    `    git -C "$WORKTREE" fetch origin "$BRANCH" --depth=1 && git -C "$WORKTREE" switch --force "$BRANCH"`,
    `    CODE=$?`,
    `    if [ $CODE -ne 0 ]; then echo "${EXIT_SENTINEL}:$CODE"; exit 0; fi`,
    `    echo "${STATUS_MARKER}switched"`,
    `  fi`,
    `elif [ -d "$WORKTREE" ]; then`,
    `  echo "${STATUS_MARKER}conflict"`,
    `else`,
    `  echo "${STATUS_MARKER}cloning"`,
    `  git clone --branch "$BRANCH" --depth 1 "$URL" "$WORKTREE"`,
    `  CODE=$?`,
    `  if [ $CODE -ne 0 ]; then echo "${EXIT_SENTINEL}:$CODE"; exit 0; fi`,
    `fi`,
    `echo "${EXIT_SENTINEL}:$?"`,
  ].join('\n')

  const result = await runShellScript(script, {
    cwd: shellCwd,
    serverId,
    timeoutMs: CLONE_TIMEOUT_MS,
    onOutput: handleOutputChunk,
  })

  if (lastStatus === 'conflict') {
    throw Object.assign(new Error('worktree-conflict'), { detail: worktree })
  }

  if (result.exitCode !== 0) {
    // 失败输出可能包含带 token 的 remote 地址，统一脱敏后再展示
    const sanitized = token ? result.output.replaceAll(token, '***') : result.output
    const failedWhileSwitching = lastStatus === 'switching'
    throw Object.assign(new Error(failedWhileSwitching ? 'git-switch-failed' : 'git-clone-failed'), {
      detail: sanitized.slice(0, 500),
    })
  }

  // cloning 完成 → created；switching 完成 → switched；ready → ready
  const status: PrepareRepoStatus =
    lastStatus === 'ready' ? 'ready' : lastStatus === 'switched' ? 'switched' : 'created'
  return { status, worktree }
}
