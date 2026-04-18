import { type ModelFamily, modelFamily, priceUsage, totalTokens } from './pricing'
import { groupTurns, type Turn } from './session/grouper'
import type { AssistantToolUseEvent, SessionEvent, SystemEvent, Usage } from './session/reader'

export type TurnUsage = {
  uuid: string
  timestamp: string | undefined
  usage: Usage
  model: string | undefined
  family: ModelFamily
  isSidechain: boolean
  cost: number
}

export type SessionSummary = {
  sessionId: string
  projectSlug: string
  path: string
  events: SessionEvent[]
  turns: Turn[]
  turnUsages: TurnUsage[]
  mainUsages: TurnUsage[]
  sidechainUsages: TurnUsage[]
  totalCost: number
  totalTokens: number
  modelsUsed: ModelFamily[]
  compactions: SystemEvent[]
  toolUses: AssistantToolUseEvent[]
}

export function dedupeTurnUsages(events: SessionEvent[]): TurnUsage[] {
  const seen = new Set<string>()
  const out: TurnUsage[] = []
  for (const e of events) {
    if (e.rawType !== 'assistant') continue
    const a = e as {
      uuid?: string
      usage?: Usage
      model?: string
      timestamp?: string
      isSidechain?: boolean
    }
    if (!a.uuid || seen.has(a.uuid) || !a.usage) continue
    seen.add(a.uuid)
    out.push({
      uuid: a.uuid,
      timestamp: a.timestamp,
      usage: a.usage,
      model: a.model,
      family: modelFamily(a.model),
      isSidechain: a.isSidechain === true,
      cost: priceUsage(a.usage, a.model),
    })
  }
  return out
}

export function summarizeSession(
  sessionId: string,
  projectSlug: string,
  path: string,
  events: SessionEvent[],
): SessionSummary {
  const turnUsages = dedupeTurnUsages(events)
  const mainUsages = turnUsages.filter((t) => !t.isSidechain)
  const sidechainUsages = turnUsages.filter((t) => t.isSidechain)
  const totalCost = turnUsages.reduce((s, t) => s + t.cost, 0)
  const totalTok = turnUsages.reduce((s, t) => s + totalTokens(t.usage), 0)
  const modelsUsed = Array.from(new Set(turnUsages.map((t) => t.family)))
  const compactions = events.filter(
    (e): e is SystemEvent => e.kind === 'system' && (e as SystemEvent).compactPreTokens != null,
  )
  const toolUses = events.filter((e): e is AssistantToolUseEvent => e.kind === 'assistant/tool_use')
  const turns = groupTurns(events)
  return {
    sessionId,
    projectSlug,
    path,
    events,
    turns,
    turnUsages,
    mainUsages,
    sidechainUsages,
    totalCost,
    totalTokens: totalTok,
    modelsUsed,
    compactions,
    toolUses,
  }
}
