import type { SessionSummary } from './aggregator'
import { MODEL_PRICES } from './pricing'
import type { UserToolResultEvent } from './session/reader'
import { detectSignals } from './session/signals'

export type Category = 'waste' | 'overhead'

export type WasteItem = {
  id: string
  category: Category
  label: string
  costUsd: number
  detail: string
  fix: string
  count: number
}

export function runHeuristics(summaries: SessionSummary[]): WasteItem[] {
  const items: WasteItem[] = [
    cacheReinjectionTax(summaries),
    compactionBurn(summaries),
    duplicateFileReads(summaries),
    retryLoops(summaries),
    frustrationCost(summaries),
    oversizedOutputs(summaries),
    sidechainBlowup(summaries),
  ]
  return items.filter((i) => i.costUsd > 0.01 || i.count > 0)
}

export function cacheReinjectionTax(summaries: SessionSummary[]): WasteItem {
  let cost = 0
  let turns = 0
  for (const s of summaries) {
    for (const t of s.mainUsages) {
      const cacheRead = t.usage.cache_read_input_tokens
      if (cacheRead <= 0) continue
      cost += (cacheRead / 1_000_000) * MODEL_PRICES[t.family].cacheRead
      turns += 1
    }
  }
  return {
    id: 'cache-reinjection',
    category: 'overhead',
    label: 'Context re-injection on every turn',
    costUsd: cost,
    detail: `${turns} turns re-read cached context (CLAUDE.md, history, system prompt)`,
    fix: 'Trim CLAUDE.md, move reminders to frequency: session_start, or split long sessions',
    count: turns,
  }
}

export function compactionBurn(summaries: SessionSummary[]): WasteItem {
  let cost = 0
  let count = 0
  let totalPreTokens = 0
  for (const s of summaries) {
    for (const c of s.compactions) {
      const pre = c.compactPreTokens ?? 0
      if (pre <= 0) continue
      cost += (pre / 1_000_000) * MODEL_PRICES[s.modelsUsed[0] ?? 'sonnet'].cacheWrite5m
      totalPreTokens += pre
      count += 1
    }
  }
  return {
    id: 'compaction-burn',
    category: 'overhead',
    label: 'Auto-compaction rewrites',
    costUsd: cost,
    detail: `${count} compactions rewrote ${Math.round(totalPreTokens / 1000)}K tokens to cache`,
    fix: 'Trim CLAUDE.md, reduce context footprint, or split sessions before limit',
    count,
  }
}

export function duplicateFileReads(summaries: SessionSummary[]): WasteItem {
  const READ_LIKE = new Set(['Read', 'Grep', 'NotebookRead'])
  let extraReads = 0
  let affectedFiles = 0
  for (const s of summaries) {
    const counts = new Map<string, number>()
    for (const t of s.toolUses) {
      if (!READ_LIKE.has(t.toolName)) continue
      const fp = t.input.file_path ?? t.input.path
      if (typeof fp !== 'string') continue
      counts.set(fp, (counts.get(fp) ?? 0) + 1)
    }
    for (const c of counts.values()) {
      if (c > 2) {
        extraReads += c - 2
        affectedFiles += 1
      }
    }
  }
  const estCostPerReread = 0.003
  return {
    id: 'duplicate-reads',
    category: 'waste',
    label: 'Same file read multiple times',
    costUsd: extraReads * estCostPerReread,
    detail: `${extraReads} redundant reads across ${affectedFiles} files`,
    fix: 'Cache content in a variable, use Grep with -n line numbers, or include in CLAUDE.md once',
    count: extraReads,
  }
}

function meanOutputCost(summaries: SessionSummary[]): number {
  let totalOutputCost = 0
  let turns = 0
  for (const s of summaries) {
    for (const t of s.mainUsages) {
      totalOutputCost += (t.usage.output_tokens / 1_000_000) * MODEL_PRICES[t.family].output
      turns += 1
    }
  }
  return turns > 0 ? totalOutputCost / turns : 0
}

export function retryLoops(summaries: SessionSummary[]): WasteItem {
  let loops = 0
  for (const s of summaries) {
    loops += detectSignals(s.turns).retryLoops
  }
  const cost = loops * meanOutputCost(summaries) * 3
  return {
    id: 'retry-loops',
    category: 'waste',
    label: 'Same action retried 3+ times in a row',
    costUsd: cost,
    detail: `${loops} retry clusters (3 consecutive failing tool calls on same input)`,
    fix: 'Fix root cause — repetition does not recover a failing tool. Raise timeout, check permissions, or rethink approach.',
    count: loops,
  }
}

export function frustrationCost(summaries: SessionSummary[]): WasteItem {
  let corrections = 0
  let dismissals = 0
  let keywords = 0
  for (const s of summaries) {
    const sig = detectSignals(s.turns)
    corrections += sig.misunderstandingCorrections
    dismissals += sig.explicitDismissals
    keywords += sig.correctionKeywords
  }
  const total = corrections + dismissals + keywords
  const cost = total * meanOutputCost(summaries)
  return {
    id: 'frustration-cost',
    category: 'waste',
    label: 'Correction / dismissal cycles',
    costUsd: cost,
    detail: `${corrections} "it's not X, it's Y" · ${dismissals} short dismissals · ${keywords} correction keywords`,
    fix: 'Add clearer rules to CLAUDE.md; repeated corrections mean missing context the agent had to guess at',
    count: total,
  }
}

export function oversizedOutputs(summaries: SessionSummary[]): WasteItem {
  const THRESHOLD_CHARS = 10_000
  let count = 0
  let excessChars = 0
  for (const s of summaries) {
    const results = s.events.filter((e): e is UserToolResultEvent => e.kind === 'user/tool_result')
    for (const r of results) {
      const c = r.outputText
      if (typeof c !== 'string') continue
      if (c.length <= THRESHOLD_CHARS) continue
      count += 1
      excessChars += c.length - THRESHOLD_CHARS
    }
  }
  const approxTokens = excessChars / 4
  const cost = (approxTokens / 1_000_000) * MODEL_PRICES.sonnet.cacheWrite5m
  return {
    id: 'oversized-outputs',
    category: 'waste',
    label: 'Oversized tool outputs (>10K chars)',
    costUsd: cost,
    detail: `${count} tool results over 10K chars bloat subsequent cache-writes`,
    fix: 'Use Grep with -c or -l, pipe to head, or limit output with --max-lines flags',
    count,
  }
}

export function sidechainBlowup(summaries: SessionSummary[]): WasteItem {
  let cost = 0
  let turns = 0
  for (const s of summaries) {
    for (const t of s.sidechainUsages) {
      cost += t.cost
      turns += 1
    }
  }
  return {
    id: 'sidechain-blowup',
    category: 'overhead',
    label: 'Subagent / sidechain spend',
    costUsd: cost,
    detail: `${turns} subagent turns ran in sidechains`,
    fix: 'For simple tasks, inline work beats spawning a subagent — subagents duplicate context-loading cost',
    count: turns,
  }
}
