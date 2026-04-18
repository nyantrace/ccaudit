import type { Turn } from './grouper'
import type { AssistantTextEvent, AssistantToolUseEvent, UserToolResultEvent } from './reader'

export type FrustrationSignals = {
  misunderstandingCorrections: number
  explicitDismissals: number
  correctionKeywords: number
  retryLoops: number
  commitOnTestFailure: number
}

const CORRECTION_KEYWORDS = ['again', 'forgot', 'already told', 'no,', 'wrong', "that's not"]
const MISUNDERSTANDING_RE = /it'?s not .+, it'?s/i
const ERROR_KEYWORDS = ['error', 'failed', 'fail', 'exit code']
const GIT_COMMIT_RE = /git\s+commit/
const RETRY_THRESHOLD = 3

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function totalAssistantWords(turn: Turn): number {
  return turn.assistant
    .filter((e): e is AssistantTextEvent => e.kind === 'assistant/text')
    .reduce((sum, e) => sum + wordCount(e.text), 0)
}

function isTestFailure(text: string): boolean {
  return /fail|exit code [^0]/i.test(text)
}

function isTestPass(text: string): boolean {
  return /\d+ (tests?|specs?).*(pass|ok)|all tests pass|✓|PASS/i.test(text) && !isTestFailure(text)
}

function normalizeToolSignature(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') return input.command ? String(input.command).slice(0, 60) : ''
  if (toolName === 'Write' || toolName === 'Edit')
    return input.file_path ? String(input.file_path) : ''
  return toolName
}

export function detectSignals(turns: Turn[]): FrustrationSignals {
  let misunderstandingCorrections = 0
  let explicitDismissals = 0
  let correctionKeywords = 0
  let retryLoops = 0
  let commitOnTestFailure = 0
  let testEpochActive = false

  const toolDeques = new Map<string, ('error' | 'success')[]>()

  for (const turn of turns) {
    for (const u of turn.userPlain) {
      const text = u.text
      if (MISUNDERSTANDING_RE.test(text)) misunderstandingCorrections++

      const assistantWords = totalAssistantWords(turn)
      if (wordCount(text) <= 10 && assistantWords > 200) explicitDismissals++

      const lower = text.toLowerCase()
      if (CORRECTION_KEYWORDS.some((k) => lower.includes(k))) correctionKeywords++
    }

    const toolCalls = turn.assistant.filter(
      (e): e is AssistantToolUseEvent => e.kind === 'assistant/tool_use',
    )

    for (const toolCall of toolCalls) {
      const sig =
        toolCall.toolName + ':' + normalizeToolSignature(toolCall.toolName, toolCall.input)
      const result = turn.toolResults.find((r) => r.toolUseId === toolCall.toolUseId)
      const isError = result
        ? result.outputText
          ? ERROR_KEYWORDS.some((k) => result.outputText!.toLowerCase().includes(k))
          : false
        : false

      const outcome: 'error' | 'success' = isError ? 'error' : 'success'
      const deque = toolDeques.get(sig) ?? []

      if (outcome === 'success') {
        toolDeques.set(sig, [])
      } else {
        deque.push('error')
        toolDeques.set(sig, deque)
        const tail = deque.slice(-RETRY_THRESHOLD)
        if (tail.length === RETRY_THRESHOLD && tail.every((e) => e === 'error')) {
          retryLoops++
          toolDeques.set(sig, [])
        }
      }
    }

    const bashResults = turn.toolResults.filter((r) => {
      const matchingCall = turn.assistant.find(
        (e): e is AssistantToolUseEvent =>
          e.kind === 'assistant/tool_use' && e.toolUseId === r.toolUseId && e.toolName === 'Bash',
      )
      return !!matchingCall
    })

    for (const result of bashResults) {
      if (result.outputText) {
        if (isTestFailure(result.outputText)) testEpochActive = true
        else if (isTestPass(result.outputText)) testEpochActive = false
      }
    }

    const bashCommits = turn.assistant.filter(
      (e): e is AssistantToolUseEvent =>
        e.kind === 'assistant/tool_use' &&
        e.toolName === 'Bash' &&
        GIT_COMMIT_RE.test((e.input.command as string | undefined) ?? ''),
    )
    if (bashCommits.length > 0 && testEpochActive) {
      commitOnTestFailure++
    }
  }

  return {
    misunderstandingCorrections,
    explicitDismissals,
    correctionKeywords,
    retryLoops,
    commitOnTestFailure,
  }
}
