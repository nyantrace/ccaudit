import { describe, expect, test } from 'bun:test'
import { normalizeRawLine, parseRawLine } from './reader'

describe('normalizeRawLine — assistant usage extraction', () => {
  test('assistant with usage + model → events carry usage and model', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'p1',
      timestamp: '2026-04-18T00:00:00Z',
      sessionId: 's1',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 8000,
          cache_creation: { ephemeral_5m_input_tokens: 1500, ephemeral_1h_input_tokens: 500 },
        },
      },
    })
    const raw = parseRawLine(line, 1)
    const events = normalizeRawLine(raw as any, 1)
    expect(events).toHaveLength(2)
    for (const e of events) {
      expect((e as any).usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 2000,
        cache_creation_5m: 1500,
        cache_creation_1h: 500,
        cache_read_input_tokens: 8000,
      })
      expect((e as any).model).toBe('claude-opus-4-7')
    }
  })

  test('flat cache_creation_input_tokens without ephemeral breakdown → treated as 5m', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 0,
        },
      },
    })
    const raw = parseRawLine(line, 1)
    const events = normalizeRawLine(raw as any, 1)
    expect((events[0] as any).usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_creation_5m: 1000,
      cache_creation_1h: 0,
      cache_read_input_tokens: 0,
    })
  })

  test('assistant without usage → events have undefined usage', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
    })
    const raw = parseRawLine(line, 1)
    const events = normalizeRawLine(raw as any, 1)
    expect(events).toHaveLength(1)
    expect((events[0] as any).usage).toBeUndefined()
  })

  test('isSidechain flag passes through to all events from the message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      isSidechain: true,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'sub-agent response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
      },
    })
    const raw = parseRawLine(line, 1)
    const events = normalizeRawLine(raw as any, 1)
    expect((events[0] as any).isSidechain).toBe(true)
  })

  test('partial usage (missing cache fields) defaults to 0', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 7, output_tokens: 3 },
      },
    })
    const raw = parseRawLine(line, 1)
    const events = normalizeRawLine(raw as any, 1)
    expect((events[0] as any).usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      cache_read_input_tokens: 0,
    })
  })
})
