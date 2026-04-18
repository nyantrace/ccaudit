import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import type { AuditReport } from './audit'
import type { Category, WasteItem } from './heuristics'
import { pickTagline } from './tagline'

export type FontFiles = { regular: Buffer; bold: Buffer }

type SatoriNode = {
  type: string
  props: { style?: Record<string, unknown>; children?: unknown }
}

const COLORS = {
  bg: '#0D1117',
  barTrack: '#161B22',
  text: '#E6EDF3',
  muted: '#8B949E',
  dim: '#6E7681',
  productive: '#3FB950',
  overhead: '#D29922',
  waste: '#F85149',
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

function formatSince(since: Date): string {
  const days = Math.round((Date.now() - since.getTime()) / 86_400_000)
  return days <= 1 ? 'last 24h' : `last ${days}d`
}

function node(type: string, style: Record<string, unknown>, children?: unknown): SatoriNode {
  return { type, props: { style, children } }
}

function bar(color: string, widthPct: number): SatoriNode {
  return node('div', {
    display: 'flex',
    width: `${Math.max(0.5, widthPct)}%`,
    height: '100%',
    backgroundColor: color,
  })
}

function topExamples(items: WasteItem[], category: Category, n = 2): string[] {
  return items
    .filter((i) => i.category === category && i.count > 0)
    .slice(0, n)
    .map((i) => i.label.toLowerCase().replace(/ \(.+$/, ''))
}

function bucket(
  label: string,
  color: string,
  pct: number,
  cost: number,
  tag: string,
  examples: string[],
): SatoriNode {
  const exampleLines = examples.length > 0 ? examples : ['—']
  return node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      gap: '6px',
    },
    [
      node('div', { display: 'flex', alignItems: 'baseline', gap: '12px' }, [
        node(
          'div',
          { display: 'flex', fontSize: 26, fontWeight: 700, color, letterSpacing: '1px' },
          label,
        ),
        node(
          'div',
          { display: 'flex', fontSize: 26, fontWeight: 700, color: COLORS.text },
          `${pct}%`,
        ),
      ]),
      node('div', { display: 'flex', fontSize: 19, color: COLORS.text }, `${usd(cost)} ${tag}`),
      node(
        'div',
        { display: 'flex', flexDirection: 'column', fontSize: 15, color: COLORS.muted, gap: '2px' },
        exampleLines.map((line) => node('div', { display: 'flex' }, line)),
      ),
    ],
  )
}

function buildCard(report: AuditReport): SatoriNode {
  const productivePct = report.productivePct

  const header = node(
    'div',
    { display: 'flex', fontSize: 20, color: COLORS.muted },
    `ccaudit · ${formatSince(report.since)} · ${report.sessionCount} sessions · ${usd(report.totalCostUsd)} total`,
  )

  const barRow = node(
    'div',
    {
      display: 'flex',
      width: '100%',
      height: '28px',
      marginTop: '48px',
      borderRadius: '6px',
      overflow: 'hidden',
      backgroundColor: COLORS.barTrack,
    },
    [
      bar(COLORS.productive, productivePct),
      bar(COLORS.overhead, report.overheadPct),
      bar(COLORS.waste, report.wastePct),
    ],
  )

  const buckets = node('div', { display: 'flex', width: '100%', gap: '32px', marginTop: '32px' }, [
    bucket('PRODUCTIVE', COLORS.productive, productivePct, report.productiveCostUsd, '', [
      'real work',
    ]),
    bucket(
      'OVERHEAD',
      COLORS.overhead,
      report.overheadPct,
      report.overheadCostUsd,
      'reducible',
      topExamples(report.items, 'overhead'),
    ),
    bucket(
      'WASTE',
      COLORS.waste,
      report.wastePct,
      report.wasteCostUsd,
      'recoverable',
      topExamples(report.items, 'waste'),
    ),
  ])

  const tagline = node(
    'div',
    {
      display: 'flex',
      justifyContent: 'center',
      marginTop: 'auto',
      paddingTop: '32px',
      fontSize: 22,
      color: COLORS.text,
    },
    pickTagline(report),
  )

  const footer = node(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '24px',
      fontSize: 14,
      color: COLORS.dim,
    },
    [
      node('div', { display: 'flex' }, 'npx @nyantrace/ccaudit'),
      node('div', { display: 'flex' }, 'github.com/nyantrace/ccaudit'),
    ],
  )

  return node(
    'div',
    {
      width: '1200px',
      height: '630px',
      display: 'flex',
      flexDirection: 'column',
      padding: '56px 64px',
      backgroundColor: COLORS.bg,
      fontFamily: 'JetBrainsMono',
      color: COLORS.text,
    },
    [header, barRow, buckets, tagline, footer],
  )
}

export async function renderCard(report: AuditReport, fonts: FontFiles): Promise<Buffer> {
  const svg = await satori(buildCard(report) as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'JetBrainsMono', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'JetBrainsMono', data: fonts.bold, weight: 700, style: 'normal' },
    ],
  })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  return Buffer.from(resvg.render().asPng())
}
