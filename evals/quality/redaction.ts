const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(api[_-]?key|authorization|bearer|cookie|password|passwd|secret|token|session)(?:$|[_-])/i
const AUTH_HEADER_PATTERN = /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi
const COOKIE_PATTERN = /\b(cookie\s*[:=]\s*)[^\n\r]+/gi
const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const API_KEY_PATTERN = /\b(?:sk|pk|api|key|token)_[A-Za-z0-9]{16,}\b/g
const AWS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g
const HOME_PATH_PATTERN = /(?<![\w/])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?=\/|\b)/g
const ENV_ASSIGNMENT_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Za-z0-9_]*=).+$/gim

export type RedactableJson =
  | null
  | boolean
  | number
  | string
  | RedactableJson[]
  | { [key: string]: RedactableJson }

/** Redacts secrets and host-specific paths from free-form text before logs or artifacts are persisted. */
export function redactText(text: string): string {
  return text
    .replace(ENV_ASSIGNMENT_PATTERN, `$1${REDACTED}`)
    .replace(AUTH_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(COOKIE_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(API_KEY_PATTERN, REDACTED)
    .replace(AWS_KEY_PATTERN, REDACTED)
    .replace(HOME_PATH_PATTERN, '~')
}

/** Recursively redacts sensitive object fields while preserving non-sensitive structure. */
export function redactJson<T extends RedactableJson>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => redactJson(item)) as T

  const redacted: Record<string, RedactableJson> = {}
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactJson(item)
  }
  return redacted as T
}
