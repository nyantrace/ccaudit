import { describe, expect, test } from 'bun:test'
import type { SessionSummary } from './aggregator'
import {
  cacheReinjectionTax,
  compactionBurn,
  duplicateFileReads,
  oversizedOutputs,
  retryLoops,
  sidechainBlowup,
} from './heuristics'
import type { SessionEvent } from './session/reader'

function mkSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 's1',
    projectSlug: 'p',
    path: '/p/s1.jsonl',
    events: [],
    turns: [],
    turnUsages: [],
    mainUsages: [],
    sidechainUsages: [],
    totalCost: 0,
    totalTokens: 0,
    modelsUsed: ['sonnet'],
    compactions: [],
    toolUses: [],
    ...overrides,
  }
}

describe('cacheReinjectionTax', () => {
  test('sums cache-read tokens × rate across turns', () => {
    const s = mkSummary({
      mainUsages: [
        {
          uuid: 'a1',
          timestamp: undefined,
          model: 'claude-sonnet-4-6',
          family: 'sonnet',
          isSidechain: false,
          cost: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 1_000_000,
          },
        },
        {
          uuid: 'a2',
          timestamp: undefined,
          model: 'claude-sonnet-4-6',
          family: 'sonnet',
          isSidechain: false,
          cost: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 500_000,
          },
        },
      ],
    })
    const item = cacheReinjectionTax([s])
    expect(item.costUsd).toBeCloseTo(0.45, 3)
    expect(item.count).toBe(2)
  })
})

describe('compactionBurn', () => {
  test('counts compactions and prices cache-write', () => {
    const s = mkSummary({
      modelsUsed: ['opus'],
      compactions: [
        {
          kind: 'system',
          rawType: 'system',
          subtype: 'compact',
          compactPreTokens: 1_000_000,
        } as any,
        { kind: 'system', rawType: 'system', subtype: 'compact', compactPreTokens: 500_000 } as any,
      ],
    })
    const item = compactionBurn([s])
    expect(item.count).toBe(2)
    expect(item.costUsd).toBeCloseTo(1.5 * 6.25, 3)
  })
})

describe('duplicateFileReads', () => {
  const mkTool = (fp: string): any => ({
    kind: 'assistant/tool_use',
    rawType: 'assistant',
    toolName: 'Read',
    input: { file_path: fp },
    toolUseId: 't',
    uuid: 'u',
  })

  test('3 reads of same file → 1 redundant (2 was normal baseline)', () => {
    const s = mkSummary({ toolUses: [mkTool('a.ts'), mkTool('a.ts'), mkTool('a.ts')] })
    expect(duplicateFileReads([s]).count).toBe(1)
  })

  test('4 reads of one file + 3 reads of another → 2 + 1 = 3 redundant', () => {
    const s = mkSummary({
      toolUses: [
        mkTool('a.ts'),
        mkTool('a.ts'),
        mkTool('a.ts'),
        mkTool('a.ts'),
        mkTool('b.ts'),
        mkTool('b.ts'),
        mkTool('b.ts'),
      ],
    })
    expect(duplicateFileReads([s]).count).toBe(3)
  })

  test('ignores files read once or twice', () => {
    const s = mkSummary({
      toolUses: [mkTool('a.ts'), mkTool('a.ts'), mkTool('b.ts')],
    })
    expect(duplicateFileReads([s]).count).toBe(0)
  })
})

describe('retryLoops', () => {
  const mkTurn = (cmd: string, result: 'error' | 'success', idx: number): any => ({
    turnId: `t${idx}`,
    assistant: [
      {
        kind: 'assistant/tool_use',
        rawType: 'assistant',
        toolName: 'Bash',
        input: { command: cmd },
        toolUseId: `tu-${idx}`,
        uuid: `a-${idx}`,
      },
    ],
    userPlain: [],
    toolResults: [
      {
        kind: 'user/tool_result',
        rawType: 'user',
        toolUseId: `tu-${idx}`,
        outputText: result === 'error' ? 'bash: error: command failed' : 'ok',
      },
    ],
    progress: [],
    system: [],
    unparsed: [],
  })

  test('3 consecutive failing Bash commands → 1 retry cluster', () => {
    const s = mkSummary({
      turns: [
        mkTurn('npm test', 'error', 1),
        mkTurn('npm test', 'error', 2),
        mkTurn('npm test', 'error', 3),
      ],
    })
    expect(retryLoops([s]).count).toBe(1)
  })

  test('3 successes → 0 retry clusters', () => {
    const s = mkSummary({
      turns: [
        mkTurn('npm test', 'success', 1),
        mkTurn('npm test', 'success', 2),
        mkTurn('npm test', 'success', 3),
      ],
    })
    expect(retryLoops([s]).count).toBe(0)
  })

  test('success between failures resets the deque', () => {
    const s = mkSummary({
      turns: [
        mkTurn('npm test', 'error', 1),
        mkTurn('npm test', 'error', 2),
        mkTurn('npm test', 'success', 3),
        mkTurn('npm test', 'error', 4),
        mkTurn('npm test', 'error', 5),
      ],
    })
    expect(retryLoops([s]).count).toBe(0)
  })

  test('two runs of 3 consecutive failures → 2 clusters', () => {
    const s = mkSummary({
      turns: [
        mkTurn('a', 'error', 1),
        mkTurn('a', 'error', 2),
        mkTurn('a', 'error', 3),
        mkTurn('a', 'error', 4),
        mkTurn('a', 'error', 5),
        mkTurn('a', 'error', 6),
      ],
    })
    expect(retryLoops([s]).count).toBe(2)
  })
})

describe('oversizedOutputs', () => {
  test('counts tool results >10K chars', () => {
    const big = 'x'.repeat(20_000)
    const small = 'x'.repeat(5_000)
    const s = mkSummary({
      events: [
        {
          kind: 'user/tool_result',
          rawType: 'user',
          toolUseId: 't1',
          outputText: big,
        } as SessionEvent,
        {
          kind: 'user/tool_result',
          rawType: 'user',
          toolUseId: 't2',
          outputText: small,
        } as SessionEvent,
      ],
    })
    const item = oversizedOutputs([s])
    expect(item.count).toBe(1)
    expect(item.costUsd).toBeGreaterThan(0)
  })
})

describe('sidechainBlowup', () => {
  test('sums sidechain costs', () => {
    const s = mkSummary({
      sidechainUsages: [
        {
          uuid: 'sc1',
          timestamp: undefined,
          model: 'claude-sonnet-4-6',
          family: 'sonnet',
          isSidechain: true,
          cost: 1.5,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
        {
          uuid: 'sc2',
          timestamp: undefined,
          model: 'claude-sonnet-4-6',
          family: 'sonnet',
          isSidechain: true,
          cost: 0.5,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      ],
    })
    const item = sidechainBlowup([s])
    expect(item.count).toBe(2)
    expect(item.costUsd).toBe(2.0)
  })
})
