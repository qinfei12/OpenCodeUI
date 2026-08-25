// ============================================
// Code Tab - GitHub 仓库浏览 / 分支选择 / 克隆
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  FolderIcon,
  GitBranchIcon,
  KeyIcon,
  RetryIcon,
  SpinnerIcon,
} from '../../components/Icons'
import {
  fetchRepoBranches,
  fetchUserRepos,
  getGitHubToken,
  setGitHubToken,
  GitHubApiError,
  type GitHubBranch,
  type GitHubRepo,
} from '../../api/github'
import { prepareRepoWorktree, type PrepareRepoStatus } from './gitClone'

interface GitHubProjectBrowserProps {
  serverId: string
  /** 克隆完成后基于工作区目录创建会话；抛错时由本组件展示重试入口 */
  onStartCoding: (directory: string) => Promise<void>
}

type Phase = 'token' | 'repos' | 'branches' | 'cloning' | 'ready'

const PROGRESS_KEYS: Record<PrepareRepoStatus | string, string> = {
  'checking-worktree': 'mobileHome.progress.checking',
  'cloning': 'mobileHome.progress.cloning',
  'switching-branch': 'mobileHome.progress.switching',
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof GitHubApiError && (error.status === 401 || error.status === 403)
}

/** 提取错误的可展示详情：优先 message，兜底 String */
function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function GitHubProjectBrowser({ serverId, onStartCoding }: GitHubProjectBrowserProps) {
  const { t } = useTranslation(['chat'])
  const [phase, setPhase] = useState<Phase>(() => (getGitHubToken() ? 'repos' : 'token'))
  const [tokenInput, setTokenInput] = useState('')
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [repoErrorDetail, setRepoErrorDetail] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [branchErrorDetail, setBranchErrorDetail] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [cloneProgress, setCloneProgress] = useState<string>('mobileHome.progress.checking')
  const [readyWorktree, setReadyWorktree] = useState<string | null>(null)
  const [isEnteringSession, setIsEnteringSession] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)
  const [cloneError, setCloneError] = useState<{ message: string; detail?: string } | null>(null)
  const reposRequestIdRef = useRef(0)
  const branchesRequestIdRef = useRef(0)

  const loadRepos = useCallback(async () => {
    const token = getGitHubToken()
    if (!token) {
      setPhase('token')
      return
    }
    const requestId = ++reposRequestIdRef.current
    setIsLoadingRepos(true)
    setRepoError(null)
    setRepoErrorDetail(null)
    try {
      const data = await fetchUserRepos(token)
      if (requestId !== reposRequestIdRef.current) return
      setRepos(data)
    } catch (error) {
      console.error('[CodeTab] loadRepos failed:', error)
      if (requestId !== reposRequestIdRef.current) return
      if (isUnauthorized(error)) {
        setPhase('token')
        setRepoError('unauthorized')
        setRepoErrorDetail(errorDetail(error))
        return
      }
      setRepoError('load-failed')
      setRepoErrorDetail(errorDetail(error))
    } finally {
      if (requestId === reposRequestIdRef.current) setIsLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    if (phase === 'repos') void loadRepos()
  }, [phase, loadRepos])

  const handleSaveToken = () => {
    const trimmed = tokenInput.trim()
    if (!trimmed) return
    setGitHubToken(trimmed)
    setTokenInput('')
    setRepoError(null)
    setRepoErrorDetail(null)
    setPhase('repos')
  }

  const handleSelectRepo = async (repo: GitHubRepo) => {
    const token = getGitHubToken()
    if (!token) {
      setPhase('token')
      return
    }
    setSelectedRepo(repo)
    setSelectedBranch(repo.defaultBranch)
    setBranches([])
    setBranchError(null)
    setBranchErrorDetail(null)
    setCloneError(null)
    setPhase('branches')
    const requestId = ++branchesRequestIdRef.current
    setIsLoadingBranches(true)
    setBranchError(null)
    setBranchErrorDetail(null)
    try {
      const data = await fetchRepoBranches(token, repo.owner, repo.name)
      if (requestId !== branchesRequestIdRef.current) return
      // 默认分支排最前
      const sorted = [...data.filter(b => b.name === repo.defaultBranch), ...data.filter(b => b.name !== repo.defaultBranch)]
      setBranches(sorted)
    } catch (error) {
      console.error('[CodeTab] loadBranches failed:', error)
      if (requestId !== branchesRequestIdRef.current) return
      setBranchError('load-failed')
      setBranchErrorDetail(errorDetail(error))
    } finally {
      if (requestId === branchesRequestIdRef.current) setIsLoadingBranches(false)
    }
  }

  const handleClone = async () => {
    if (!selectedRepo || !selectedBranch) return
    const token = getGitHubToken()
    if (!token) {
      setPhase('token')
      return
    }
    setPhase('cloning')
    setCloneError(null)
    setReadyWorktree(null)
    try {
      const result = await prepareRepoWorktree({
        serverId,
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedBranch,
        token,
        onProgress: key => {
          if (PROGRESS_KEYS[key]) setCloneProgress(PROGRESS_KEYS[key])
        },
      })
      setReadyWorktree(result.worktree)
    } catch (error) {
      console.error('[CodeTab] clone failed:', error)
      const message = error instanceof Error ? error.message : 'unknown'
      const detail = (error as { detail?: string }).detail
      setCloneError({ message, detail: detail || errorDetail(error) })
      setPhase('branches')
    }
  }

  const handleEnterCoding = async () => {
    if (!readyWorktree || isEnteringSession) return
    setIsEnteringSession(true)
    setEnterError(null)
    try {
      await onStartCoding(readyWorktree)
    } catch {
      setEnterError(t('mobileHome.error.enterSession'))
    } finally {
      setIsEnteringSession(false)
    }
  }

  const handleBackToToken = () => {
    setPhase('token')
  }

  const inputClass =
    'w-full px-3 py-2.5 bg-bg-200 border border-border-300/30 rounded-lg text-[length:var(--fs-base)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/50 transition-colors'

  if (phase === 'token') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-main-100 to-accent-main-200">
              <KeyIcon className="h-7 w-7 text-oncolor-100" />
            </div>
            <h2 className="text-center text-[length:var(--fs-heading-2)] font-semibold text-text-100">
              {t('mobileHome.token.title')}
            </h2>
            <p className="text-center text-[length:var(--fs-sm)] text-text-400">{t('mobileHome.token.description')}</p>
          </div>

          {repoError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[length:var(--fs-sm)] text-red-400">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <span>{t(repoError === 'unauthorized' ? 'mobileHome.error.unauthorized' : 'mobileHome.error.loadFailed')}</span>
                {repoErrorDetail && (
                  <pre className="mt-1 max-h-20 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all font-mono text-[length:var(--fs-xxs)] text-red-400/70">
                    {repoErrorDetail}
                  </pre>
                )}
              </div>
            </div>
          )}

          <input
            type="password"
            value={tokenInput}
            onChange={event => setTokenInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') handleSaveToken()
            }}
            placeholder={t('mobileHome.token.placeholder')}
            autoComplete="off"
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleSaveToken}
            disabled={!tokenInput.trim()}
            className="mt-4 w-full rounded-lg bg-accent-main-100 px-4 py-2.5 text-[length:var(--fs-base)] font-medium text-oncolor-100 transition-colors hover:bg-accent-main-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('mobileHome.token.save')}
          </button>
          <p className="mt-4 text-center text-[length:var(--fs-xs)] text-text-500">{t('mobileHome.token.hint')}</p>
        </div>
      </div>
    )
  }

  if (phase === 'cloning') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <SpinnerIcon className="h-8 w-8 animate-spin text-accent-main-100" />
        <p className="mt-4 text-[length:var(--fs-base)] text-text-300">{t(cloneProgress)}</p>
        {selectedRepo && selectedBranch && (
          <p className="mt-1 font-mono text-[length:var(--fs-sm)] text-text-500">
            {selectedRepo.fullName} @ {selectedBranch}
          </p>
        )}
      </div>
    )
  }

  if (phase === 'ready' && readyWorktree) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/15">
              <FolderIcon className="h-7 w-7 text-green-400" />
            </div>
          </div>
          <h2 className="text-[length:var(--fs-heading-2)] font-semibold text-text-100">
            {t('mobileHome.ready.title')}
          </h2>
          <p className="mt-2 break-all rounded-lg bg-bg-200 px-3 py-2 font-mono text-[length:var(--fs-xs)] text-text-400">
            {readyWorktree}
          </p>
          {enterError && (
            <p className="mt-3 text-[length:var(--fs-sm)] text-red-400">{enterError}</p>
          )}
          <button
            type="button"
            onClick={() => void handleEnterCoding()}
            disabled={isEnteringSession}
            className="mt-6 w-full rounded-lg bg-accent-main-100 px-4 py-2.5 text-[length:var(--fs-base)] font-medium text-oncolor-100 transition-colors hover:bg-accent-main-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('mobileHome.ready.start')}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'branches' && selectedRepo) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border-200/40 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              branchesRequestIdRef.current += 1
              setSelectedRepo(null)
              setBranches([])
              setPhase('repos')
            }}
            aria-label={t('mobileHome.common.back')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-200/70 hover:text-text-100"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[length:var(--fs-md)] font-medium text-text-100">{selectedRepo.fullName}</p>
            <p className="text-[length:var(--fs-xs)] text-text-500">{t('mobileHome.branches.subtitle')}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
          {isLoadingBranches && (
            <div className="flex items-center justify-center gap-2 py-10 text-text-400">
              <SpinnerIcon className="h-5 w-5 animate-spin" />
              <span className="text-[length:var(--fs-sm)]">{t('mobileHome.common.loading')}</span>
            </div>
          )}

          {!isLoadingBranches && branchError && (
            <div className="py-10 text-center">
              <p className="mb-1 text-[length:var(--fs-sm)] text-red-400">{t('mobileHome.error.loadFailed')}</p>
              {branchErrorDetail && (
                <pre className="mx-auto mb-3 max-h-20 max-w-md overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all rounded-lg bg-bg-200 px-2 py-1.5 text-left font-mono text-[length:var(--fs-xxs)] text-text-500">
                  {branchErrorDetail}
                </pre>
              )}
              <button
                type="button"
                onClick={() => void handleSelectRepo(selectedRepo)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-300/30 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 hover:bg-bg-200/50"
              >
                <RetryIcon className="h-4 w-4" />
                {t('mobileHome.common.retry')}
              </button>
            </div>
          )}

          {!isLoadingBranches && !branchError && (
            <ul className="space-y-1">
              {branches.map(branch => {
                const active = branch.name === selectedBranch
                return (
                  <li key={branch.name}>
                    <button
                      type="button"
                      onClick={() => setSelectedBranch(branch.name)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-bg-200/80 text-text-100' : 'text-text-300 hover:bg-bg-200/40'
                      }`}
                    >
                      <GitBranchIcon className={`h-4 w-4 shrink-0 ${active ? 'text-accent-main-100' : 'text-text-500'}`} />
                      <span className="truncate text-[length:var(--fs-base)]">{branch.name}</span>
                      {branch.name === selectedRepo.defaultBranch && (
                        <span className="ml-auto shrink-0 rounded bg-bg-300/60 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-text-400">
                          {t('mobileHome.branches.default')}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border-200/40 px-4 py-3">
          {cloneError && (
            <div className="mb-3">
              <p className="mb-1 text-[length:var(--fs-sm)] text-red-400">
                {cloneError.message === 'worktree-conflict'
                  ? t('mobileHome.error.worktreeConflict')
                  : cloneError.message === 'git-command-timeout'
                    ? t('mobileHome.error.timeout')
                    : t('mobileHome.error.cloneFailed')}
              </p>
              {cloneError.detail && (
                <pre className="max-h-24 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all rounded-lg bg-bg-200 px-2 py-1.5 font-mono text-[length:var(--fs-xxs)] text-text-500">
                  {cloneError.detail}
                </pre>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleClone()}
            disabled={!selectedBranch || isLoadingBranches}
            className="w-full rounded-lg bg-accent-main-100 px-4 py-2.5 text-[length:var(--fs-base)] font-medium text-oncolor-100 transition-colors hover:bg-accent-main-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('mobileHome.branches.clone')}
          </button>
        </div>
      </div>
    )
  }

  // phase === 'repos'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border-200/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[length:var(--fs-md)] font-medium text-text-100">{t('mobileHome.repos.title')}</p>
          <p className="text-[length:var(--fs-xs)] text-text-500">{t('mobileHome.repos.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleBackToToken}
          aria-label={t('mobileHome.repos.changeToken')}
          title={t('mobileHome.repos.changeToken')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-200/70 hover:text-text-100"
        >
          <KeyIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
        {isLoadingRepos && (
          <div className="flex items-center justify-center gap-2 py-10 text-text-400">
            <SpinnerIcon className="h-5 w-5 animate-spin" />
            <span className="text-[length:var(--fs-sm)]">{t('mobileHome.common.loading')}</span>
          </div>
        )}

        {!isLoadingRepos && repoError && (
          <div className="py-10 text-center">
            <p className="mb-1 text-[length:var(--fs-sm)] text-red-400">
              {repoError === 'unauthorized'
                ? t('mobileHome.error.unauthorized')
                : t('mobileHome.error.loadFailed')}
            </p>
            {repoErrorDetail && (
              <pre className="mx-auto mb-3 max-h-20 max-w-md overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all rounded-lg bg-bg-200 px-2 py-1.5 text-left font-mono text-[length:var(--fs-xxs)] text-text-500">
                {repoErrorDetail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => void loadRepos()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-300/30 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 hover:bg-bg-200/50"
            >
              <RetryIcon className="h-4 w-4" />
              {t('mobileHome.common.retry')}
            </button>
          </div>
        )}

        {!isLoadingRepos && !repoError && repos.length === 0 && (
          <p className="py-10 text-center text-[length:var(--fs-sm)] text-text-500">{t('mobileHome.repos.empty')}</p>
        )}

        {!isLoadingRepos && !repoError && repos.length > 0 && (
          <ul className="space-y-1">
            {repos.map(repo => (
              <li key={repo.id}>
                <button
                  type="button"
                  onClick={() => void handleSelectRepo(repo)}
                  className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-bg-200/40"
                >
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-4 w-4 shrink-0 text-text-500" />
                    <span className="truncate text-[length:var(--fs-base)] font-medium text-text-100">
                      {repo.fullName}
                    </span>
                    {repo.isPrivate && (
                      <span className="ml-auto shrink-0 rounded bg-bg-300/60 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-text-400">
                        {t('mobileHome.repos.private')}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-1 truncate pl-6 text-[length:var(--fs-sm)] text-text-500">{repo.description}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
