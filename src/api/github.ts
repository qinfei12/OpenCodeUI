// ============================================
// GitHub REST API - 仓库/分支浏览（Code Tab）
//
// Token 仅保存在浏览器 localStorage，直接从
// 前端调用 api.github.com，不经过 opencode 服务器。
// ============================================

const GITHUB_API_BASE = 'https://api.github.com'
const STORAGE_KEY_GITHUB_TOKEN = 'github.token'
const REPOS_PER_PAGE = 100

export interface GitHubRepo {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  defaultBranch: string
  isPrivate: boolean
}

export interface GitHubBranch {
  name: string
  commitSha: string
}

export class GitHubApiError extends Error {
  /** HTTP 状态码；network 类错误无状态码 */
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

export function getGitHubToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_GITHUB_TOKEN)
}

export function setGitHubToken(token: string): void {
  localStorage.setItem(STORAGE_KEY_GITHUB_TOKEN, token.trim())
}

export function clearGitHubToken(): void {
  localStorage.removeItem(STORAGE_KEY_GITHUB_TOKEN)
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function request<T>(path: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${GITHUB_API_BASE}${path}`, { headers: authHeaders(token) })
  } catch (error) {
    // DNS 失败、断网、扩展拦截等都会走到这里，保留原始原因
    const reason = error instanceof Error ? error.message : String(error)
    throw new GitHubApiError(`network-error: ${reason}`)
  }

  if (response.status === 401 || response.status === 403) {
    // 401=token 无效；403 可能是权限不足或触发了速率限制
    let apiMessage = ''
    try {
      const body = (await response.json()) as { message?: string }
      if (body?.message) apiMessage = body.message
    } catch {
      // 响应体非 JSON 时忽略，仅保留状态码信息
    }
    throw new GitHubApiError(
      `GitHub API ${response.status}${apiMessage ? `: ${apiMessage}` : ''}`,
      response.status,
    )
  }

  if (!response.ok) {
    let apiMessage = ''
    try {
      const body = (await response.json()) as { message?: string }
      if (body?.message) apiMessage = body.message
    } catch {
      // 响应体非 JSON 时忽略，仅保留状态码信息
    }
    throw new GitHubApiError(
      `GitHub API ${response.status}${apiMessage ? `: ${apiMessage}` : ''}`,
      response.status,
    )
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new GitHubApiError('invalid-response: response body is not valid JSON')
  }
}

interface RawRepo {
  id: number
  full_name: string
  name: string
  description: string | null
  default_branch: string
  private: boolean
  owner?: { login?: string }
}

interface RawBranch {
  name: string
  commit?: { sha?: string }
}

function normalizeRepo(raw: RawRepo): GitHubRepo {
  const [owner = raw.owner?.login ?? '', name = raw.name] = raw.full_name.split('/')
  return {
    id: raw.id,
    fullName: raw.full_name,
    owner,
    name,
    description: raw.description,
    defaultBranch: raw.default_branch,
    isPrivate: raw.private,
  }
}

/**
 * 获取当前 token 用户可见的仓库（按最近更新排序）
 */
export async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
  const rawRepos = await request<RawRepo[]>(`/user/repos?sort=updated&per_page=${REPOS_PER_PAGE}`, token)
  if (!Array.isArray(rawRepos)) {
    throw new GitHubApiError('invalid-response')
  }
  return rawRepos.map(normalizeRepo)
}

/**
 * 获取仓库分支列表
 */
export async function fetchRepoBranches(token: string, owner: string, repo: string): Promise<GitHubBranch[]> {
  const rawBranches = await request<RawBranch[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${REPOS_PER_PAGE}`,
    token,
  )
  if (!Array.isArray(rawBranches)) {
    throw new GitHubApiError('invalid-response')
  }
  return rawBranches.map(branch => ({
    name: branch.name,
    commitSha: branch.commit?.sha ?? '',
  }))
}
