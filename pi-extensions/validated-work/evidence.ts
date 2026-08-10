import type { ValidatedWorkEvidenceKind } from '../../shared/validated-work.ts'

export interface ObservedToolEvidenceDraft {
  id: string
  kind: ValidatedWorkEvidenceKind
  summary: string
  observedAt: number
  toolCallId?: string
  entryId?: string
  checkIds: string[]
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
): string {
  const subject = truncateOneLine(commandOrPath, 160)
  const suffix = truncateOneLine(output, 240)
  return [toolName, subject, suffix].filter(Boolean).join(': ')
}

function truncateOneLine(value: string, limit: number): string {
  const compact = value.replaceAll(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1)}…`
}
