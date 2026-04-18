import type { Usage } from './session/reader'

export type ModelFamily = 'opus' | 'opus-legacy' | 'sonnet' | 'haiku' | 'haiku-3.5' | 'haiku-3'

export type PricePerMTok = {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export const MODEL_PRICES: Record<ModelFamily, PricePerMTok> = {
  opus: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'opus-legacy': { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  'haiku-3.5': { input: 0.8, output: 4, cacheWrite5m: 1, cacheWrite1h: 1.6, cacheRead: 0.08 },
  'haiku-3': { input: 0.25, output: 1.25, cacheWrite5m: 0.3, cacheWrite1h: 0.5, cacheRead: 0.03 },
}

export function modelFamily(model: string | undefined): ModelFamily {
  if (!model) return 'sonnet'
  const m = model.toLowerCase()

  if (m.includes('opus')) {
    const match = m.match(/opus-(\d+)(?:-(\d+))?/)
    if (!match) return 'opus'
    const major = Number.parseInt(match[1], 10)
    const minor = match[2] ? Number.parseInt(match[2], 10) : 0
    if (major > 4) return 'opus'
    if (major === 4 && minor >= 5) return 'opus'
    return 'opus-legacy'
  }

  if (m.includes('haiku')) {
    const match = m.match(/haiku-(\d+)(?:-(\d+))?/)
    if (!match) return 'haiku'
    const major = Number.parseInt(match[1], 10)
    const minor = match[2] ? Number.parseInt(match[2], 10) : 0
    if (major === 3 && minor === 5) return 'haiku-3.5'
    if (major === 3) return 'haiku-3'
    return 'haiku'
  }

  return 'sonnet'
}

export function priceUsage(usage: Usage, model: string | undefined): number {
  const p = MODEL_PRICES[modelFamily(model)]
  const cc5m = usage.cache_creation_5m ?? usage.cache_creation_input_tokens
  const cc1h = usage.cache_creation_1h ?? 0
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      cc5m * p.cacheWrite5m +
      cc1h * p.cacheWrite1h +
      usage.cache_read_input_tokens * p.cacheRead) /
    1_000_000
  )
}

export function totalTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens
  )
}
