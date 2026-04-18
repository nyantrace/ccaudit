import type { SessionEvent } from './reader'

export type SchemaFingerprint = {
  source: 'claude-code-jsonl'
  version: string | null
  observedEventTypes: string[]
  observedEventTypeCount: number
  hookOutputParsing: 'enabled' | 'disabled'
  stderrLine: string
}

export function fingerprint(events: SessionEvent[]): SchemaFingerprint {
  let version: string | null = null
  const rawTypes = new Set<string>()

  for (const e of events) {
    const v = (e as { version?: string }).version
    if (v && !version) version = v
    const rt = (e as { rawType?: string }).rawType
    if (rt) rawTypes.add(rt)
  }

  const hookOutputParsing: 'enabled' | 'disabled' = 'disabled'

  const observedEventTypes = Array.from(rawTypes).sort()
  const stderrLine = `Claude Code v${version ?? 'unknown'}, ${observedEventTypes.length} event types observed, hook-output parsing ${hookOutputParsing}`

  return {
    source: 'claude-code-jsonl',
    version,
    observedEventTypes,
    observedEventTypeCount: observedEventTypes.length,
    hookOutputParsing,
    stderrLine,
  }
}
