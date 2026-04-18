import { readFileSync } from 'fs'
import { z } from 'zod'

const Meta = z
  .object({
    uuid: z.string().optional(),
    parentUuid: z.string().nullish(),
    logicalParentUuid: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
    isSidechain: z.boolean().optional(),
    parentToolUseID: z.string().nullish(),
  })
  .passthrough()

const RawUsage = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation: z
      .object({
        ephemeral_5m_input_tokens: z.number().optional(),
        ephemeral_1h_input_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_creation_5m?: number
  cache_creation_1h?: number
  cache_read_input_tokens: number
}

function normalizeUsage(u: z.infer<typeof RawUsage> | undefined): Usage | undefined {
  if (!u) return undefined
  const cc5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0
  const cc1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const totalCreation = u.cache_creation_input_tokens ?? cc5m + cc1h
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: totalCreation,
    cache_creation_5m: cc5m || (cc1h === 0 ? totalCreation : 0),
    cache_creation_1h: cc1h,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  }
}

const RawUserPlain = Meta.extend({
  type: z.literal('user'),
  message: z.object({ role: z.literal('user'), content: z.string() }).passthrough(),
}).passthrough()

const ToolResultBlock = z
  .object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.unknown(),
    is_error: z.boolean().optional(),
  })
  .passthrough()

const HOOK_DENY_RE = /Hook ([^:]+):(\S+) denied this tool/i

const RawUserToolResult = Meta.extend({
  type: z.literal('user'),
  message: z
    .object({
      role: z.literal('user'),
      content: z.array(ToolResultBlock).min(1),
    })
    .passthrough(),
}).passthrough()

const ContentBlock = z.union([
  z.object({ type: z.literal('thinking'), thinking: z.string() }).passthrough(),
  z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal('tool_use'),
      id: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
  z.object({ type: z.string() }).passthrough(),
])

const RawAssistant = Meta.extend({
  type: z.literal('assistant'),
  message: z
    .object({
      role: z.literal('assistant'),
      model: z.string().optional(),
      content: z.array(ContentBlock).default([]),
      stop_reason: z.string().nullish(),
      usage: RawUsage.optional(),
    })
    .passthrough(),
}).passthrough()

const RawProgress = Meta.extend({
  type: z.literal('progress'),
  toolUseID: z.string().optional(),
  data: z
    .object({
      type: z.literal('hook_progress'),
      hookEvent: z.string(),
      hookName: z.string(),
      command: z.string(),
    })
    .passthrough(),
}).passthrough()

const RawSystem = Meta.extend({
  type: z.literal('system'),
  subtype: z.string(),
  durationMs: z.number().optional(),
  slug: z.string().optional(),
  compactMetadata: z
    .object({
      trigger: z.string().optional(),
      preTokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

export type UserPlainEvent = z.infer<typeof Meta> & {
  kind: 'user/plain'
  rawType: 'user'
  text: string
}
export type UserToolResultEvent = z.infer<typeof Meta> & {
  kind: 'user/tool_result'
  rawType: 'user'
  toolUseId: string
  outputText?: string
}
export type ToolResultHookDenyEvent = z.infer<typeof Meta> & {
  kind: 'user/hook_deny'
  rawType: 'user'
  toolUseId: string
  hookEvent: string
  toolName: string
  reason: string
}
export type AssistantTextEvent = z.infer<typeof Meta> & {
  kind: 'assistant/text'
  rawType: 'assistant'
  text: string
  usage?: Usage
  model?: string
}
export type AssistantToolUseEvent = z.infer<typeof Meta> & {
  kind: 'assistant/tool_use'
  rawType: 'assistant'
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  usage?: Usage
  model?: string
}
export type ProgressEvent = z.infer<typeof Meta> & {
  kind: 'progress'
  rawType: 'progress'
  toolUseID?: string
  hookEvent: string
  hookName: string
  command: string
}
export type SystemEvent = z.infer<typeof Meta> & {
  kind: 'system'
  rawType: 'system'
  subtype: string
  durationMs?: number
  compactPreTokens?: number
}
export type UnparsedEvent = {
  kind: 'unparsed'
  reason:
    | 'invalid_json'
    | 'not_an_object'
    | 'missing_required_fields'
    | 'unknown_event_type'
    | 'unsupported_event_shape'
  rawText: string
  lineNumber?: number
  rawType?: string
}

export type SessionEvent =
  | UserPlainEvent
  | UserToolResultEvent
  | ToolResultHookDenyEvent
  | AssistantTextEvent
  | AssistantToolUseEvent
  | ProgressEvent
  | SystemEvent
  | UnparsedEvent

type RawLine = { type: string; [k: string]: unknown }

export function parseRawLine(line: string, lineNumber: number): RawLine | UnparsedEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { kind: 'unparsed', reason: 'invalid_json', rawText: line, lineNumber }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unparsed', reason: 'not_an_object', rawText: line, lineNumber }
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.type !== 'string') {
    return { kind: 'unparsed', reason: 'missing_required_fields', rawText: line, lineNumber }
  }
  return obj as RawLine
}

export function normalizeRawLine(raw: RawLine | UnparsedEvent, lineNumber: number): SessionEvent[] {
  if ('kind' in raw && raw.kind === 'unparsed') return [raw as UnparsedEvent]

  const r = raw as RawLine
  const unparsed = (reason: UnparsedEvent['reason']): UnparsedEvent[] => [
    { kind: 'unparsed', reason, rawText: JSON.stringify(r), lineNumber },
  ]
  const meta = {
    uuid: r.uuid as string | undefined,
    parentUuid: r.parentUuid as string | undefined,
    logicalParentUuid: r.logicalParentUuid as string | undefined,
    timestamp: r.timestamp as string | undefined,
    cwd: r.cwd as string | undefined,
    sessionId: r.sessionId as string | undefined,
    version: r.version as string | undefined,
    isSidechain: r.isSidechain as boolean | undefined,
    parentToolUseID: r.parentToolUseID as string | undefined,
  }

  if (r.type === 'user') {
    const msg = r.message as { role: string; content: unknown } | undefined
    if (!msg) return unparsed('missing_required_fields')

    if (typeof msg.content === 'string') {
      const result = RawUserPlain.safeParse(r)
      if (!result.success) return unparsed('unsupported_event_shape')
      return [{ ...meta, kind: 'user/plain', rawType: 'user', text: result.data.message.content }]
    }

    if (Array.isArray(msg.content)) {
      const firstItemType = (msg.content as { type?: unknown }[])[0]?.type
      if (firstItemType !== 'tool_result') return []
      const result = RawUserToolResult.safeParse(r)
      if (!result.success) return unparsed('unsupported_event_shape')
      const block = result.data.message.content[0]
      if (block.is_error === true && typeof block.content === 'string') {
        const match = block.content.match(HOOK_DENY_RE)
        if (match) {
          return [
            {
              ...meta,
              kind: 'user/hook_deny',
              rawType: 'user',
              toolUseId: block.tool_use_id,
              hookEvent: match[1],
              toolName: match[2],
              reason: block.content,
            },
          ]
        }
      }
      const outputText = typeof block?.content === 'string' ? block.content : undefined
      return [
        {
          ...meta,
          kind: 'user/tool_result',
          rawType: 'user',
          toolUseId: block.tool_use_id,
          outputText,
        },
      ]
    }

    return unparsed('unsupported_event_shape')
  }

  if (r.type === 'assistant') {
    const result = RawAssistant.safeParse(r)
    if (!result.success) return unparsed('unsupported_event_shape')
    const usage = normalizeUsage(result.data.message.usage)
    const model = result.data.message.model
    return result.data.message.content.flatMap((block): SessionEvent[] => {
      if (block.type === 'text')
        return [
          {
            ...meta,
            kind: 'assistant/text',
            rawType: 'assistant',
            text: (block as { text: string }).text,
            usage,
            model,
          },
        ]
      if (block.type === 'tool_use') {
        const b = block as { id: string; name: string; input: Record<string, unknown> }
        return [
          {
            ...meta,
            kind: 'assistant/tool_use',
            rawType: 'assistant',
            toolUseId: b.id,
            toolName: b.name,
            input: b.input,
            usage,
            model,
          },
        ]
      }
      return []
    })
  }

  if (r.type === 'progress') {
    const data = r.data as { type?: string } | undefined
    if (data?.type !== 'hook_progress') return []
    const result = RawProgress.safeParse(r)
    if (!result.success) return unparsed('unsupported_event_shape')
    const d = result.data
    return [
      {
        ...meta,
        kind: 'progress',
        rawType: 'progress',
        toolUseID: d.toolUseID,
        hookEvent: d.data.hookEvent,
        hookName: d.data.hookName,
        command: d.data.command,
      },
    ]
  }

  if (r.type === 'system') {
    const result = RawSystem.safeParse(r)
    if (!result.success) return unparsed('unsupported_event_shape')
    const d = result.data
    return [
      {
        ...meta,
        logicalParentUuid: d.logicalParentUuid,
        kind: 'system',
        rawType: 'system',
        subtype: d.subtype,
        durationMs: d.durationMs,
        compactPreTokens: d.compactMetadata?.preTokens,
      },
    ]
  }

  if (
    r.type === 'queue-operation' ||
    r.type === 'file-history-snapshot' ||
    r.type === 'last-prompt'
  )
    return []

  return [
    {
      kind: 'unparsed',
      reason: 'unknown_event_type',
      rawText: JSON.stringify(r),
      lineNumber,
      rawType: r.type,
    },
  ]
}

export function parseSession(filePath: string): {
  events: SessionEvent[]
  skippedLines: number
  version: string | null
} {
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
  const events: SessionEvent[] = []
  let skippedLines = 0
  let version: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = parseRawLine(lines[i], i + 1)
    if (!('kind' in raw) && typeof raw.version === 'string') {
      version ??= raw.version
    }
    for (const e of normalizeRawLine(raw, i + 1)) {
      if (e.kind === 'unparsed') skippedLines++
      events.push(e)
    }
  }

  return { events, skippedLines, version }
}
