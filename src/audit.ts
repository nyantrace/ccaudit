import { type SessionSummary, summarizeSession } from './aggregator'
import { runHeuristics, type WasteItem } from './heuristics'
import { listSessions, type SessionFile } from './session/discover'
import { parseSession } from './session/reader'

export type AuditReport = {
  since: Date
  sessionCount: number
  skippedFiles: number
  projectCount: number
  totalCostUsd: number
  totalTokens: number
  items: WasteItem[]
  wasteCostUsd: number
  overheadCostUsd: number
  productiveCostUsd: number
  wastePct: number
  overheadPct: number
  productivePct: number
  topFix: string | null
}

export type AuditOptions = {
  since: Date
  projectFilter?: string
  root?: string
}

export function audit(opts: AuditOptions): AuditReport {
  const files = listSessions(opts.since, opts.root)
  const filtered = opts.projectFilter
    ? files.filter((f) => f.projectSlug.toLowerCase().includes(opts.projectFilter!.toLowerCase()))
    : files

  const summaries: SessionSummary[] = []
  let skippedFiles = 0
  for (const f of filtered) {
    try {
      const { events } = parseSession(f.path)
      summaries.push(summarizeSession(f.sessionId, f.projectSlug, f.path, events))
    } catch {
      skippedFiles += 1
    }
  }

  const totalCost = summaries.reduce((s, x) => s + x.totalCost, 0)
  const totalTok = summaries.reduce((s, x) => s + x.totalTokens, 0)
  const items = runHeuristics(summaries).sort((a, b) => b.costUsd - a.costUsd)
  const wasteCost = items.filter((i) => i.category === 'waste').reduce((s, w) => s + w.costUsd, 0)
  const overheadCost = items
    .filter((i) => i.category === 'overhead')
    .reduce((s, w) => s + w.costUsd, 0)
  const productive = Math.max(0, totalCost - wasteCost - overheadCost)
  const rawSum = wasteCost + overheadCost
  const scale = totalCost > 0 && rawSum > totalCost ? totalCost / rawSum : 1
  const rawWastePct = totalCost > 0 ? ((wasteCost * scale) / totalCost) * 100 : 0
  const rawOverheadPct = totalCost > 0 ? ((overheadCost * scale) / totalCost) * 100 : 0
  const wastePct = Math.min(100, Math.round(rawWastePct))
  const overheadPct = Math.min(100 - wastePct, Math.round(rawOverheadPct))
  const productivePct = 100 - wastePct - overheadPct
  const topWaste = items.find((i) => i.category === 'waste')
  const topFix = topWaste?.fix ?? items[0]?.fix ?? null

  const projects = new Set(summaries.map((s) => s.projectSlug))

  return {
    since: opts.since,
    sessionCount: summaries.length,
    skippedFiles,
    projectCount: projects.size,
    totalCostUsd: totalCost,
    totalTokens: totalTok,
    items,
    wasteCostUsd: wasteCost,
    overheadCostUsd: overheadCost,
    productiveCostUsd: productive,
    wastePct,
    overheadPct,
    productivePct,
    topFix,
  }
}

export { listSessions, type SessionFile }
