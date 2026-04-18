import { describe, expect, test } from 'bun:test'
import type { AuditReport } from './audit'
import { pickTagline } from './tagline'

function mkReport(over: Partial<AuditReport>): AuditReport {
  return {
    since: new Date(Date.now() - 7 * 86_400_000),
    sessionCount: 10,
    skippedFiles: 0,
    projectCount: 1,
    totalCostUsd: 100,
    totalTokens: 1_000_000,
    items: [],
    wasteCostUsd: 0,
    overheadCostUsd: 0,
    productiveCostUsd: 100,
    wastePct: 0,
    overheadPct: 0,
    topFix: null,
    ...over,
  }
}

describe('pickTagline', () => {
  test('overhead-heavy, low waste → "context is" tagline (Poe case)', () => {
    const r = mkReport({ overheadPct: 49, wastePct: 1 })
    expect(pickTagline(r)).toBe(`"Claude isn't getting more expensive. Your context is."`)
  })

  test('high waste (≥15%) → recoverable callout', () => {
    const r = mkReport({ overheadPct: 20, wastePct: 25 })
    expect(pickTagline(r)).toContain('25%')
    expect(pickTagline(r)).toContain('avoidable')
  })

  test('zero waste, low overhead → tight-config tagline', () => {
    const r = mkReport({ overheadPct: 10, wastePct: 0 })
    expect(pickTagline(r)).toContain('Tight config')
  })

  test('moderate both → neutral total-spend tagline', () => {
    const r = mkReport({ overheadPct: 30, wastePct: 8, totalCostUsd: 250 })
    expect(pickTagline(r)).toContain('$250.00')
    expect(pickTagline(r)).toContain('Claude Code')
  })

  test('high waste precedence over overhead', () => {
    const r = mkReport({ overheadPct: 50, wastePct: 20 })
    expect(pickTagline(r)).toContain('20%')
    expect(pickTagline(r)).toContain('avoidable')
  })

  test('zero spend → no-data tagline', () => {
    const r = mkReport({ totalCostUsd: 0, sessionCount: 0, overheadPct: 0, wastePct: 0 })
    expect(pickTagline(r)).toContain('No meaningful spend')
  })
})
