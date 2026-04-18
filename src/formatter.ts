import chalk from 'chalk'
import type { AuditReport } from './audit'

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatSince(since: Date): string {
  const days = Math.round((Date.now() - since.getTime()) / 86_400_000)
  return days <= 1 ? 'last 24 hours' : `last ${days} days`
}

export function formatReport(report: AuditReport): string {
  const lines: string[] = []
  const header =
    chalk.bold('ccaudit') +
    chalk.dim(
      ` — ${formatSince(report.since)} · ${report.sessionCount} sessions across ${report.projectCount} projects`,
    )
  lines.push(header)
  lines.push('')

  if (report.sessionCount === 0) {
    lines.push(chalk.yellow('No Claude Code sessions found in window.'))
    lines.push(
      chalk.dim(
        `Checked ${chalk.cyan('~/.claude/projects/')}. Adjust --since (default 7d) or --project.`,
      ),
    )
    return lines.join('\n')
  }

  const productivePct = report.productivePct
  lines.push(
    `Total: ${chalk.bold(usd(report.totalCostUsd))} ${chalk.dim(`(${shortTokens(report.totalTokens)} tokens)`)}`,
  )
  lines.push(
    `${chalk.green('├─ Productive:')} ${usd(report.productiveCostUsd).padStart(8)} ${chalk.dim(`(${productivePct}%)`)}`,
  )
  lines.push(
    `${chalk.yellow('├─ Overhead: ')}  ${usd(report.overheadCostUsd).padStart(8)} ${chalk.dim(`(${report.overheadPct}%)  unavoidable but reducible`)}`,
  )
  lines.push(
    `${chalk.red('└─ Waste:    ')}  ${chalk.bold(usd(report.wasteCostUsd).padStart(8))} ${chalk.dim(`(${report.wastePct}%)  recoverable with config changes`)}`,
  )
  lines.push('')

  if (report.items.length === 0) {
    lines.push(
      chalk.dim('No patterns detected. Either clean sessions or heuristics missed signals.'),
    )
    return lines.join('\n')
  }

  lines.push(chalk.bold('Where your tokens went:'))
  const top = report.items.slice(0, 8)
  for (let i = 0; i < top.length; i++) {
    const w = top[i]
    const idx = chalk.dim(`${i + 1}.`)
    const tag = w.category === 'waste' ? chalk.red('[waste]') : chalk.yellow('[ohead]')
    const label = w.label.padEnd(42).slice(0, 42)
    const cost = chalk.cyan(usd(w.costUsd).padStart(7))
    lines.push(`  ${idx} ${tag} ${label} ${cost}`)
    lines.push(`        ${chalk.dim(w.detail)}`)
    lines.push(`        ${chalk.green('→')} ${chalk.dim(w.fix)}`)
  }
  lines.push('')

  if (report.topFix) {
    lines.push(`${chalk.bold('Top fix:')} ${report.topFix}`)
  }
  lines.push('')
  if (report.skippedFiles > 0) {
    lines.push(chalk.yellow(`Warning: skipped ${report.skippedFiles} unreadable session file(s).`))
  }
  lines.push(
    chalk.dim('Run ') + chalk.cyan('ccaudit --share') + chalk.dim(' to write a shareable PNG.'),
  )
  lines.push(chalk.dim('Numbers are estimates from local JSONL. Nothing is sent anywhere.'))

  return lines.join('\n')
}
