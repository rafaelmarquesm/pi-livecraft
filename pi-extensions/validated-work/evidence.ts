import type { ValidatedWorkEvidenceKind } from '../../shared/validated-work.ts'

export interface ObservedToolEvidenceDraft {
  id: string
  kind: ValidatedWorkEvidenceKind
  summary: string
  observedAt: number
  toolCallId?: string
  entryId?: string
  checkIds: string[]
  toolName: string
  durationMs?: number
  commandOrPath?: string
  isError: boolean
}

const checkCommandPattern =
  /\b(npm\s+(run\s+)?(test|typecheck|lint|build|format:check)|node\s+--test|vitest|playwright\s+test|tsc\b|oxlint\b|dprint\s+check)\b/

export function classifyToolEvidence(
  toolName: string,
  isError: boolean,
  commandOrPath = '',
): ValidatedWorkEvidenceKind {
  if (isError) return 'failed_observation'
  if (toolName === 'bash' && checkCommandPattern.test(commandOrPath)) return 'observed_check'
  if (toolName === 'read' || toolName === 'grep' || toolName === 'find' || toolName === 'ls') {
    return 'inspection'
  }
  if (toolName === 'edit' || toolName === 'write') return 'mutation'
  return 'observed_tool'
}

export function summarizeToolObservation(
  toolName: string,
  commandOrPath = '',
  output = '',
  durationMs?: number,
): string {
  const subject = truncateOneLine(sanitizeObservationText(commandOrPath), 160)
  const suffix = truncateOneLine(sanitizeObservationText(output), 240)
  const duration = Number.isFinite(durationMs)
    ? `${Math.max(0, Math.round(durationMs ?? 0))}ms`
    : ''
  return [toolName, subject, duration, suffix].filter(Boolean).join(': ')
}

export function sanitizeObservationText(value: unknown): string {
  const text = typeof value === 'string' ? value : safeJson(value)
  return text
    .replaceAll(
      /\b(authorization|api[_-]?key|token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replaceAll(/(?:^|[\s/\\])\.env(?:\.[\w.-]+)?/g, ' [redacted-env-file]')
}

export function toolSubjectFromArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const input = args as Record<string, unknown>
  const value = toolName === 'bash'
    ? input.command
    : input.file_path ?? input.path ?? input.glob ?? input.query ?? input.pattern ?? input.src
      ?? input.dst
  return typeof value === 'string' ? value : safeJson(value)
}

export function outputSummaryFromResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result.map((item) => outputSummaryFromResult(item)).join(' ')
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    const content = record.content ?? record.text ?? record.output ?? record.stdout ?? record.stderr
      ?? record.error
    if (content !== undefined) return outputSummaryFromResult(content)
  }
  return safeJson(result)
}

export function truncateOneLine(value: string, limit: number): string {
  const compact = value.replaceAll(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1)}…`
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
