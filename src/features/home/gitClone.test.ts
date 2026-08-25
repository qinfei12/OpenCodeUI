import { beforeEach, describe, expect, it } from 'vitest'
import { githubCloneUrl, projectsRootDir, repoWorktreeDir } from './gitClone'

describe('projectsRootDir', () => {
  it('appends the fixed workspace root to home', () => {
    expect(projectsRootDir('/home/alice')).toBe('/home/alice/OpenCodeUI-Projects')
  })

  it('strips trailing slashes from home', () => {
    expect(projectsRootDir('/home/alice/')).toBe('/home/alice/OpenCodeUI-Projects')
  })
})

describe('repoWorktreeDir', () => {
  it('nests owner and repo below the projects root', () => {
    const root = projectsRootDir('/home/alice')
    expect(repoWorktreeDir(root, 'octocat', 'hello-world')).toBe(
      '/home/alice/OpenCodeUI-Projects/octocat/hello-world',
    )
  })

  it('normalizes a trailing slash on the root', () => {
    expect(repoWorktreeDir('/srv/projects/', 'a', 'b')).toBe('/srv/projects/a/b')
  })
})

describe('githubCloneUrl', () => {
  it('embeds the token as x-access-token for private repos', () => {
    expect(githubCloneUrl('octocat', 'hello-world', 'ghp_secret')).toBe(
      'https://x-access-token:ghp_secret@github.com/octocat/hello-world.git',
    )
  })

  it('url-encodes special characters in token and names', () => {
    const url = githubCloneUrl('my org', 'my.repo', 'tok/en t')
    expect(url).toBe('https://x-access-token:tok%2Fen%20t@github.com/my%20org/my.repo.git')
  })
})

describe('token round trip', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores, reads and clears the GitHub token', async () => {
    const { clearGitHubToken, getGitHubToken, setGitHubToken } = await import('../../api/github')

    expect(getGitHubToken()).toBeNull()

    setGitHubToken('  ghp_token123  ')
    expect(getGitHubToken()).toBe('ghp_token123')

    clearGitHubToken()
    expect(getGitHubToken()).toBeNull()
  })
})
