import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs'
import { join } from 'path'

export function deriveSlug(cwd: string): string {
  return cwd.replace(/\/$/, '').replace(/\//g, '-')
}

export function claudeProjectsBase(homeDir?: string): string {
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '~'
  return join(home, '.claude', 'projects')
}

export function discoverProjectDir(cwd: string, homeDir?: string): string | null {
  let canonical: string
  try {
    canonical = realpathSync(cwd).replace(/\/$/, '')
  } catch {
    canonical = cwd.replace(/\/$/, '')
  }

  const base = claudeProjectsBase(homeDir)
  if (!existsSync(base)) return null

  const slug = deriveSlug(canonical)
  const fast = join(base, slug)
  if (existsSync(fast)) return fast

  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => statSync(join(base, b.name)).mtimeMs - statSync(join(base, a.name)).mtimeMs)

  for (const dir of dirs) {
    const dirPath = join(base, dir.name)
    let files: string[]
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const first = readFileSync(join(dirPath, f), 'utf8').split('\n')[0]
        if (!first) continue
        const parsed = JSON.parse(first) as Record<string, unknown>
        if (parsed.cwd === canonical) return dirPath
      } catch {}
    }
  }
  return null
}

export function listSessions(projectDirPath: string): string[] {
  if (!existsSync(projectDirPath)) return []
  try {
    return readdirSync(projectDirPath)
      .filter((f) => f.endsWith('.jsonl'))
      .sort(
        (a, b) =>
          statSync(join(projectDirPath, b)).mtimeMs - statSync(join(projectDirPath, a)).mtimeMs,
      )
  } catch {
    return []
  }
}

export function mostRecentSession(projectDirPath: string): string | null {
  const sessions = listSessions(projectDirPath)
  return sessions[0] ? join(projectDirPath, sessions[0]) : null
}
