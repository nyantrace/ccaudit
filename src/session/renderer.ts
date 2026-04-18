import type { Turn } from './grouper'
import type { AssistantToolUseEvent, SystemEvent } from './reader'
import type { FrustrationSignals } from './signals'

export type ReplayOptions = { limit?: number; fromTurn?: number }

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return '--:--:--'
  return new Date(timestamp).toISOString().slice(11, 19)
}

function inputSummary(input: Record<string, unknown>): string {
  const cmd = input.command ?? input.file_path ?? input.path ?? Object.values(input)[0]
  const str = String(cmd ?? '').slice(0, 60)
  return str.length < String(cmd ?? '').length ? str + '…' : str
}

export function renderReplay(
  turns: Turn[],
  signalsByTurnId: Record<string, string[]>,
  options: ReplayOptions = {},
): string {
  const { limit = 100, fromTurn = 1 } = options
  const lines: string[] = []

  const start = fromTurn - 1
  const slice = turns.slice(start, start + limit)

  for (const turn of slice) {
    for (const s of turn.system) {
      if (s.subtype === 'compact_boundary') {
        const tokens = (s as SystemEvent).compactPreTokens
        lines.push(`  [session compacted${tokens ? ` — ${tokens} tokens` : ''}]`)
      }
    }

    for (const u of turn.userPlain) {
      const time = formatTime(u.timestamp)
      const annotations = signalsByTurnId[turn.turnId] ?? []
      const annotationStr = annotations.length ? `  ← ${annotations.join(', ')}` : ''
      lines.push(`\n[${time}] USER${annotationStr}`)
      lines.push(u.text)
    }

    const assistantTexts = turn.assistant.filter((e) => e.kind === 'assistant/text')
    const toolCalls = turn.assistant.filter(
      (e): e is AssistantToolUseEvent => e.kind === 'assistant/tool_use',
    )

    if (assistantTexts.length || toolCalls.length) {
      const firstTs = turn.assistant[0]?.timestamp
      lines.push(`\n[${formatTime(firstTs)}] CLAUDE`)
      for (const e of assistantTexts) {
        lines.push((e as { text: string }).text.slice(0, 300))
      }
      for (const tool of toolCalls) {
        const result = turn.toolResults.find((r) => r.toolUseId === tool.toolUseId)
        let resultStr = ''
        if (result) {
          if (result.outputText) {
            const lower = result.outputText.toLowerCase()
            const isError = ['error', 'failed', 'fail', 'exit code'].some((k) => lower.includes(k))
            resultStr = isError ? `[ERROR: ${result.outputText.slice(0, 40)}]` : '[OK]'
          } else {
            resultStr = '[OK]'
          }
        }
        lines.push(
          `  ↳ TOOL  ${tool.toolName.padEnd(12)} ${inputSummary(tool.input).padEnd(40)} ${resultStr}`,
        )
      }
    }
  }

  return lines.join('\n')
}

export function renderAnalyzeSummary(
  sessionId: string,
  projectSlug: string,
  turnCount: number,
  toolCallCount: number,
  signals: FrustrationSignals,
): string {
  const lines: string[] = []
  const shortId = sessionId.slice(0, 8)
  const shortSlug = projectSlug.replace(/^-/, '').split('-').slice(-2).join('-')

  lines.push(`Session: ${shortId}  ${shortSlug}  ${turnCount} turns  ${toolCallCount} tool calls`)
  lines.push('')

  const numericEntries = [
    [signals.misunderstandingCorrections, 'misunderstanding correction', '"it\'s not x, it\'s y"'],
    [signals.retryLoops, 'retry loop', 'tool → error × 3'],
    [signals.explicitDismissals, 'explicit dismissal', 'short reply after long response'],
    [signals.correctionKeywords, 'correction keyword', '"forgot", "wrong", "again"'],
    [signals.commitOnTestFailure, 'commit on test failure', 'git commit after failing tests'],
  ] as [number, string, string][]

  const nonZeroNumeric = numericEntries.filter(([count]) => count > 0)

  if (nonZeroNumeric.length === 0) {
    lines.push('No frustration signals detected.')
  } else {
    const total = nonZeroNumeric.reduce((s, [c]) => s + c, 0)
    lines.push(`Frustration signals (${total}):`)
    for (const [count, label, example] of nonZeroNumeric) {
      lines.push(`  ${String(count).padStart(2)}x  ${label.padEnd(32)} ${example}`)
    }
  }

  return lines.join('\n')
}

function extractWindowText(turns: Turn[], indices: number[]): string {
  return indices
    .map((i, n) => {
      const turn = turns[i]
      const texts = turn.userPlain
        .map((u) => {
          let text = u.text.slice(0, 120)
          text = text.replace(/\/(?:Users|home)\/[^\s,;)'"]+/g, '<path>')
          text = text.replace(/\b(?:src|lib|dist|test|tests|__tests__)\/[^\s,;)'"]+/g, '<path>')
          text = text.replace(/```[\s\S]*?```/g, '')
          text = text.replace(/^[ \t].*/gm, '')
          return text.trim()
        })
        .filter(Boolean)
        .join(' ')
      return texts ? `[turn ${i + 1}] ${texts}` : null
    })
    .filter(Boolean)
    .join('\n')
}

function windowIndices(total: number): { early: number[]; recent: number[] } {
  const size = Math.min(Math.max(Math.floor(total * 0.15), 3), 6)
  const early = Array.from({ length: Math.min(size, total) }, (_, i) => i)
  const recentStart = Math.max(total - size, 0)
  const recent = Array.from({ length: total - recentStart }, (_, i) => recentStart + i)
  return { early, recent }
}

export function buildAiPrompt(structuralSummary: string, turns: Turn[] = []): string {
  let windowSection = ''
  if (turns.length > 0) {
    const { early, recent } = windowIndices(turns.length)
    const earlyText = extractWindowText(turns, early)
    const recentText = extractWindowText(turns, recent)
    windowSection = `
Early user messages (original goals and constraints set by the user):
${earlyText || '(none)'}

Recent user messages (look for tone shift or repeated corrections):
${recentText || '(none)'}

Use these windows to assess:
- Sentiment trajectory: did tone degrade from early to recent?
- Instruction drift: did the agent forget constraints from the early window?

`
  }

  return `You are analyzing an AI coding session for workflow patterns and frustration signals.

Below is the structural summary of the session. Signal counts and tool names are included. User message text, file paths, and command strings have been excluded for privacy.

Signals include: misunderstanding corrections, retry loops, explicit dismissals, correction keywords, and commit on test failure.

${structuralSummary}
${windowSection}
Identify:
1. Root causes for the frustration signals
2. Workflow patterns that could be improved
3. Specific AgentFence config suggestions (context field, reminders, enforcement rules)
4. Sentiment trajectory — did the user's tone degrade over the session? Look for a shift from engaged or collaborative to curt, corrective, or dismissive.
5. Instruction drift — did the agent forget constraints the user established early on? Look for cases where the user re-corrected something they had already specified.

Be concise and specific. No generic advice.`
}
