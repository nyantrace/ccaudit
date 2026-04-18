import { describe, expect, test } from 'bun:test'
import { dedupeTurnUsages, summarizeSession } from './aggregator'
import type { SessionEvent } from './session/reader'

function assistantEvent(
  uuid: string,
  tokens: number,
  opts: { isSidechain?: boolean; kind?: 'assistant/text' | 'assistant/tool_use' } = {},
): SessionEvent {
  const base = {
    uuid,
    rawType: 'assistant' as const,
    usage: {
      input_tokens: tokens,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: 'claude-sonnet-4-6',
    isSidechain: opts.isSidechain,
  }
  if (opts.kind === 'assistant/tool_use') {
    return {
      ...base,
      kind: 'assistant/tool_use',
      toolUseId: `tu-${uuid}`,
      toolName: 'Read',
      input: {},
    } as SessionEvent
  }
  return { ...base, kind: 'assistant/text', text: 'x' } as SessionEvent
}

describe('dedupeTurnUsages', () => {
  test('dedupes multiple events from same uuid to single turn usage', () => {
    const events: SessionEvent[] = [
      assistantEvent('a1', 100, { kind: 'assistant/text' }),
      assistantEvent('a1', 100, { kind: 'assistant/tool_use' }),
      assistantEvent('a2', 50, { kind: 'assistant/text' }),
    ]
    const usages = dedupeTurnUsages(events)
    expect(usages).toHaveLength(2)
    expect(usages.map((u) => u.uuid)).toEqual(['a1', 'a2'])
  })

  test('skips events without usage', () => {
    const noUsage: SessionEvent = {
      uuid: 'x1',
      kind: 'assistant/text',
      rawType: 'assistant',
      text: 'no usage',
    } as SessionEvent
    const usages = dedupeTurnUsages([noUsage])
    expect(usages).toHaveLength(0)
  })

  test('flags sidechain turns correctly', () => {
    const events: SessionEvent[] = [
      assistantEvent('main1', 100),
      assistantEvent('sub1', 50, { isSidechain: true }),
    ]
    const usages = dedupeTurnUsages(events)
    expect(usages.find((u) => u.uuid === 'sub1')?.isSidechain).toBe(true)
    expect(usages.find((u) => u.uuid === 'main1')?.isSidechain).toBe(false)
  })
})

describe('summarizeSession', () => {
  test('separates main vs sidechain, computes totals', () => {
    const events: SessionEvent[] = [
      assistantEvent('a1', 1_000_000),
      assistantEvent('a2', 1_000_000, { isSidechain: true }),
    ]
    const summary = summarizeSession('s1', 'proj', '/p/s1.jsonl', events)
    expect(summary.mainUsages).toHaveLength(1)
    expect(summary.sidechainUsages).toHaveLength(1)
    expect(summary.totalCost).toBeCloseTo(6, 5)
    expect(summary.totalTokens).toBe(2_000_000)
    expect(summary.modelsUsed).toEqual(['sonnet'])
  })
})
