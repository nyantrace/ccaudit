import { lstatSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type SessionFile = {
  path: string
  projectSlug: string
  sessionId: string
  mtime: Date
  size: number
}

const SESSIONS_ROOT = join(homedir(), '.claude', 'projects')
export const MAX_SESSION_SIZE_BYTES = 500 * 1024 * 1024

export function listSessions(since?: Date, root: string = SESSIONS_ROOT): SessionFile[] {
  const out: SessionFile[] = []
  let projects: string[]
  try {
    projects = readdirSync(root)
  } catch {
    return []
  }

  for (const project of projects) {
    const projectPath = join(root, project)
    let files: string[]
    try {
      files = readdirSync(projectPath)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const full = join(projectPath, file)
      let st: ReturnType<typeof lstatSync>
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (st.size > MAX_SESSION_SIZE_BYTES) continue
      if (since && st.mtime < since) continue
      out.push({
        path: full,
        projectSlug: project,
        sessionId: file.replace(/\.jsonl$/, ''),
        mtime: st.mtime,
        size: st.size,
      })
    }
  }

  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
}

export function parseSinceDuration(input: string): Date {
  const match = input.match(/^(\d+)([dhm])$/)
  if (!match) throw new Error(`invalid --since value: ${input} (expected e.g. 7d, 24h, 30m)`)
  const n = Number.parseInt(match[1], 10)
  const unit = match[2]
  const now = Date.now()
  const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000
  return new Date(now - ms)
}
