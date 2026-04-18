import { describe, expect, test } from 'bun:test'
import { modelFamily, priceUsage, totalTokens } from './pricing'

describe('modelFamily', () => {
  test.each([
    ['claude-opus-4-7', 'opus'],
    ['claude-opus-4-7[1m]', 'opus'],
    ['claude-sonnet-4-6', 'sonnet'],
    ['claude-haiku-4-5-20251001', 'haiku'],
    ['CLAUDE-OPUS-4-6', 'opus'],
    ['claude-opus-4-5', 'opus'],
    ['claude-opus-4-1', 'opus-legacy'],
    ['claude-opus-4', 'opus-legacy'],
    ['claude-opus-3', 'opus-legacy'],
    ['claude-opus-5-0', 'opus'],
    ['claude-haiku-3-5', 'haiku-3.5'],
    ['claude-haiku-3', 'haiku-3'],
    [undefined, 'sonnet'],
    ['gpt-4', 'sonnet'],
    ['claude-future-7-0', 'sonnet'],
  ])('%s → %s', (input, expected) => {
    expect(modelFamily(input)).toBe(expected as any)
  })
})

describe('priceUsage', () => {
  test('Opus 4.7: 1M input + 1M output = $5 + $25 = $30', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'claude-opus-4-7')).toBeCloseTo(30, 5)
  })

  test('Sonnet 4.6: 1M cache-read = $0.30', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    }
    expect(priceUsage(usage, 'claude-sonnet-4-6')).toBeCloseTo(0.3, 5)
  })

  test('Haiku 4.5: mixed 100K input/50K output/200K 5m-cache-write/500K cache-read', () => {
    const usage = {
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 500_000,
    }
    const expected = 0.1 + 0.25 + 0.25 + 0.05
    expect(priceUsage(usage, 'claude-haiku-4-5')).toBeCloseTo(expected, 5)
  })

  test('Opus 4.7: 1h cache write priced at $10/MTok, not $6.25', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_creation_5m: 0,
      cache_creation_1h: 1_000_000,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'claude-opus-4-7')).toBeCloseTo(10, 5)
  })

  test('Sonnet 4.6: mixed 5m + 1h cache creation priced separately', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 2_000_000,
      cache_creation_5m: 1_000_000,
      cache_creation_1h: 1_000_000,
      cache_read_input_tokens: 0,
    }
    const expected = 3.75 + 6
    expect(priceUsage(usage, 'claude-sonnet-4-6')).toBeCloseTo(expected, 5)
  })

  test('Opus 4.1 (legacy) priced at $15/$75 tier', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'claude-opus-4-1')).toBeCloseTo(15 + 75, 5)
  })

  test('Haiku 3.5 priced at $0.80/$4 tier', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'claude-haiku-3-5')).toBeCloseTo(0.8 + 4, 5)
  })

  test('Haiku 3 priced at $0.25/$1.25 tier', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'claude-haiku-3')).toBeCloseTo(0.25 + 1.25, 5)
  })

  test('unknown model → priced as Sonnet (safe fallback)', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      cache_read_input_tokens: 0,
    }
    expect(priceUsage(usage, 'gpt-4')).toBeCloseTo(3, 5)
  })
})

describe('totalTokens', () => {
  test('sums all four fields', () => {
    expect(
      totalTokens({
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      }),
    ).toBe(10)
  })
})
