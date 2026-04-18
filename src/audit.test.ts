import { describe, expect, test } from 'bun:test'
import type { SessionSummary } from './aggregator'
import type { AuditReport } from './audit'
import { runHeuristics } from './heuristics'

function mkReport(
  items: ReturnType<typeof runHeuristics>,
  totalCost: number,
): Pick<
  AuditReport,
  'wasteCostUsd' | 'overheadCostUsd' | 'productiveCostUsd' | 'wastePct' | 'overheadPct'
> {
  const wasteCost = items.filter((i) => i.category === 'waste').reduce((s, w) => s + w.costUsd, 0)
  const overheadCost = items
    .filter((i) => i.category === 'overhead')
    .reduce((s, w) => s + w.costUsd, 0)
  const productive = Math.max(0, totalCost - wasteCost - overheadCost)
  return {
    wasteCostUsd: wasteCost,
    overheadCostUsd: overheadCost,
    productiveCostUsd: productive,
    wastePct: Math.round((wasteCost / totalCost) * 100),
    overheadPct: Math.round((overheadCost / totalCost) * 100),
  }
}

describe('percentage math invariants', () => {
  test('productivePct + overheadPct + wastePct always sums to 100', async () => {
    const { audit } = await import('./audit')
    const fakeRoot = '/tmp/ccaudit-nonexistent-path-for-test'
    const r = audit({ since: new Date(Date.now() - 86_400_000), root: fakeRoot })
    expect(r.productivePct + r.overheadPct + r.wastePct).toBe(100)
  })
})

describe('three-bucket categorization', () => {
  test('productive + overhead + waste sum to total', () => {
    const summaries: SessionSummary[] = [
      {
        sessionId: 's1',
        projectSlug: 'p',
        path: '/p/s1.jsonl',
        events: [],
        turns: [],
        turnUsages: [],
        mainUsages: [
          {
            uuid: 'a1',
            timestamp: undefined,
            model: 'claude-sonnet-4-6',
            family: 'sonnet',
            isSidechain: false,
            cost: 1.0,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 1_000_000,
            },
          },
        ],
        sidechainUsages: [],
        totalCost: 1.0,
        totalTokens: 1_000_000,
        modelsUsed: ['sonnet'],
        compactions: [],
        toolUses: [],
      },
    ]
    const items = runHeuristics(summaries)
    const r = mkReport(items, 1.0)
    expect(r.productiveCostUsd + r.overheadCostUsd + r.wasteCostUsd).toBeCloseTo(1.0, 5)
  })

  test('pure cache-read → 100% overhead, 0% waste', () => {
    const summaries: SessionSummary[] = [
      {
        sessionId: 's1',
        projectSlug: 'p',
        path: '/p/s1.jsonl',
        events: [],
        turns: [],
        turnUsages: [],
        mainUsages: [
          {
            uuid: 'a1',
            timestamp: undefined,
            model: 'claude-sonnet-4-6',
            family: 'sonnet',
            isSidechain: false,
            cost: 0.3,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 1_000_000,
            },
          },
        ],
        sidechainUsages: [],
        totalCost: 0.3,
        totalTokens: 1_000_000,
        modelsUsed: ['sonnet'],
        compactions: [],
        toolUses: [],
      },
    ]
    const items = runHeuristics(summaries)
    expect(items.every((i) => i.category === 'overhead' || i.count === 0)).toBe(true)
  })
})
