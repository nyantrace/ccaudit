import type {
  AssistantTextEvent,
  AssistantToolUseEvent,
  ProgressEvent,
  SessionEvent,
  SystemEvent,
  UnparsedEvent,
  UserPlainEvent,
  UserToolResultEvent,
} from './reader'

export type Turn = {
  turnId: string
  assistant: (AssistantTextEvent | AssistantToolUseEvent)[]
  userPlain: UserPlainEvent[]
  toolResults: UserToolResultEvent[]
  progress: ProgressEvent[]
  system: SystemEvent[]
  unparsed: UnparsedEvent[]
}

export function groupTurns(events: SessionEvent[]): Turn[] {
  const byUuid = new Map<string, SessionEvent[]>()
  for (const e of events) {
    const id = (e as { uuid?: string }).uuid
    if (id) {
      const existing = byUuid.get(id) ?? []
      existing.push(e)
      byUuid.set(id, existing)
    }
  }

  function nearestAssistantUuid(
    uuid: string | undefined | null,
    visited = new Set<string>(),
  ): string | null {
    if (!uuid || visited.has(uuid)) return null
    visited.add(uuid)
    const group = byUuid.get(uuid)
    if (group?.some((e) => e.rawType === 'assistant')) return uuid
    const first = group?.[0] as
      | { parentUuid?: string | null; logicalParentUuid?: string }
      | undefined
    return nearestAssistantUuid(first?.parentUuid ?? first?.logicalParentUuid ?? null, visited)
  }

  const turns = new Map<string, Turn>()

  function getOrCreateTurn(id: string): Turn {
    if (!turns.has(id)) {
      turns.set(id, {
        turnId: id,
        assistant: [],
        userPlain: [],
        toolResults: [],
        progress: [],
        system: [],
        unparsed: [],
      })
    }
    return turns.get(id)!
  }

  // Build reverse map: user uuid → assistant turn uuid (first assistant child found)
  const userUuidToAssistantTurnId = new Map<string, string>()
  for (const e of events) {
    if (e.rawType !== 'assistant') continue
    const uuid = (e as { uuid?: string }).uuid
    const parentUuid = (e as { parentUuid?: string | null }).parentUuid
    if (uuid && parentUuid) {
      if (!userUuidToAssistantTurnId.has(parentUuid)) {
        userUuidToAssistantTurnId.set(parentUuid, uuid)
      }
    }
  }

  const toolUseIdToTurnId = new Map<string, string>()

  for (const e of events) {
    const uuid = (e as { uuid?: string }).uuid
    const parentUuid = (e as { parentUuid?: string | null }).parentUuid
    const logicalParentUuid = (e as { logicalParentUuid?: string }).logicalParentUuid

    if (e.kind === 'system') {
      const turnId = uuid ?? `orphan:system:${Math.random()}`
      getOrCreateTurn(turnId).system.push(e as SystemEvent)
      continue
    }

    if (e.rawType === 'assistant') {
      const turnId = uuid ?? `orphan:${Math.random()}`
      getOrCreateTurn(turnId).assistant.push(e as AssistantTextEvent | AssistantToolUseEvent)
      if (e.kind === 'assistant/tool_use') {
        toolUseIdToTurnId.set((e as AssistantToolUseEvent).toolUseId, turnId)
      }
      continue
    }

    if (e.kind === 'user/tool_result' && !uuid) continue

    const ancestorId = nearestAssistantUuid(parentUuid ?? logicalParentUuid ?? null)

    // For user/plain: if no assistant ancestor, check if this user message is the parent of an assistant turn
    let turnId: string
    if (!ancestorId && e.kind === 'user/plain' && uuid) {
      const childAssistantTurnId = userUuidToAssistantTurnId.get(uuid)
      turnId = childAssistantTurnId ?? `orphan:${uuid}`
    } else {
      turnId = ancestorId ?? (uuid ? `orphan:${uuid}` : `orphan:noid:${Math.random()}`)
    }

    if (e.kind === 'user/plain') getOrCreateTurn(turnId).userPlain.push(e as UserPlainEvent)
    else if (e.kind === 'user/tool_result') {
      if (uuid) getOrCreateTurn(turnId).toolResults.push(e as UserToolResultEvent)
    } else if (e.kind === 'progress') getOrCreateTurn(turnId).progress.push(e as ProgressEvent)
    else if (e.kind === 'unparsed') getOrCreateTurn(turnId).unparsed.push(e as UnparsedEvent)
  }

  for (const e of events) {
    if (e.kind !== 'user/tool_result') continue
    const uuid = (e as { uuid?: string }).uuid
    if (uuid) continue
    const toolUseId = (e as UserToolResultEvent).toolUseId
    const turnId = toolUseIdToTurnId.get(toolUseId)
    if (turnId) getOrCreateTurn(turnId).toolResults.push(e as UserToolResultEvent)
  }

  return Array.from(turns.values())
}
