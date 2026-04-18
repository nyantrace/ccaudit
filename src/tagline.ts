import type { AuditReport } from './audit'

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

function windowLabel(since: Date): string {
  const days = Math.round((Date.now() - since.getTime()) / 86_400_000)
  return days <= 1 ? '24h' : `${days} days`
}

export function pickTagline(report: AuditReport): string {
  const { wastePct, overheadPct, totalCostUsd, sessionCount, since } = report

  if (totalCostUsd < 0.01 || sessionCount === 0) {
    return 'No meaningful spend in window.'
  }

  if (wastePct >= 15) {
    return `${wastePct}% of your Claude Code spend is avoidable with config changes.`
  }

  if (overheadPct >= 40 && wastePct < 5) {
    return `"Claude isn't getting more expensive. Your context is."`
  }

  if (wastePct === 0 && overheadPct < 25) {
    return 'Tight config. Nothing recoverable here.'
  }

  return `${usd(totalCostUsd)} spent on Claude Code in the ${windowLabel(since)}.`
}
