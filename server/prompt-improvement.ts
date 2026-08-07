import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { JsonObject } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

/** Loads the system prompt fresh from disk so edits take effect without restarting the manager. */
export async function loadPromptImprovementSystemPrompt(): Promise<string> {
  return readFile(new URL('prompt-improvement-system.txt', import.meta.url), 'utf8')
}

const improvementDirections: Record<string, string> = {
  clarify:
    'Clarify the request. Make the expected outcome, scope, and constraints explicit only when they are already implied by the draft.',
  ideate:
    'Encourage the model to suggest ideas, alternatives, or approaches relevant to the draft. Do not impose a format, count, or structure.',
  precise:
    'Make the request precise and unambiguous. Use specific, well-defined terms. Preserve all existing facts and constraints; do not add assumptions.',
}

/** Returns the direction instruction for a valid preset key, or undefined for an invalid or missing key. */
export function improvementDirectionInstruction(direction: string): string | undefined {
  return improvementDirections[direction]
}

/** Names excluded from the project map. */
const ignoredNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
])

/** Files whose content must never leak into the improver context. */
const ignoredFiles = new Set(['AGENTS.md', 'CLAUDE.md', 'agent.md'])

/** Maximum lines in the map before truncation. */
const maxMapLines = 150

/**
 * Builds a shallow directory tree from a workspace root.
 *
 * Never reads file contents. Depth is capped at 2; hidden entries,
 * build artifacts, and instruction files are excluded. Returns a
 * `<project_map>…</project_map>` block suitable for the improver
 * system prompt.
 */
export async function generateProjectMap(cwd: string): Promise<string> {
  const lines: string[] = ['<project_map>']
  await listEntries(cwd, '', lines, 0)
  lines.push('</project_map>')
  return lines.join('\n')
}

async function listEntries(
  dirPath: string,
  indent: string,
  lines: string[],
  depth: number,
): Promise<void> {
  if (depth > 2 || lines.length >= maxMapLines) return

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  const filtered = entries
    .filter((d) =>
      !d.name.startsWith('.') && !ignoredNames.has(d.name) && !ignoredFiles.has(d.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of filtered) {
    if (lines.length >= maxMapLines) return
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`)
      await listEntries(join(dirPath, entry.name), `${indent}  `, lines, depth + 1)
    } else {
      lines.push(`${indent}${entry.name}`)
    }
  }
}

/** Reads the Pi default model from its settings file, when present. */
export async function defaultModelFromSettings(
  agentDir?: string,
): Promise<{ id: string; provider: string } | undefined> {
  const dir = agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
  try {
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as JsonObject
    if (
      typeof settings.defaultProvider === 'string' && typeof settings.defaultModel === 'string'
    ) {
      return { provider: settings.defaultProvider, id: settings.defaultModel }
    }
  } catch {
    // No settings file — callers fall back to cheapest.
  }
  return undefined
}

/** Selects the cheapest usable model with the same deterministic ordering as pi-auto-title. */
export function cheapestAvailableModel(
  response: JsonObject,
): { id: string; provider: string } | undefined {
  if (!isObject(response.data) || !Array.isArray(response.data.models)) return undefined
  const models = response.data.models.filter(isModel)
  models.sort((left, right) =>
    left.cost.output - right.cost.output
    || left.cost.input - right.cost.input
    || Number(left.reasoning) - Number(right.reasoning)
  )
  return models[0]
}

/**
 * Picks the model for a disposable prompt: prefers Pi's configured default when it
 * is available, and otherwise falls back to the cheapest available model.
 */
export async function preferredAvailableModel(
  response: JsonObject,
  agentDir?: string,
): Promise<{ id: string; provider: string } | undefined> {
  const models = isObject(response.data) && Array.isArray(response.data.models)
    ? response.data.models
    : []
  const configured = await defaultModelFromSettings(agentDir)
  if (
    configured
    && models.some((m) =>
      isModel(m) && m.provider === configured.provider && m.id === configured.id
    )
  ) {
    return configured
  }
  return cheapestAvailableModel(response)
}

/** Returns the last assistant text from a completed disposable Pi session. */
export function assistantText(response: JsonObject): string | undefined {
  if (!isObject(response.data) || !Array.isArray(response.data.messages)) return undefined
  for (let index = response.data.messages.length - 1; index >= 0; index -= 1) {
    const message = response.data.messages[index]
    if (!isObject(message) || message.role !== 'assistant') continue
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim()
    if (!Array.isArray(message.content)) continue
    const text = message
      .content
      .flatMap((part) =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
      )
      .join('')
    if (text.trim()) return text.trim()
  }
  return undefined
}

function isModel(
  value: unknown,
): value is {
  id: string
  provider: string
  reasoning: boolean
  cost: { input: number; output: number }
} {
  if (
    !isObject(value) || typeof value.id !== 'string' || typeof value.provider !== 'string'
    || !isObject(value.cost)
  ) return false
  return typeof value.cost.input === 'number' && typeof value.cost.output === 'number'
    && typeof value.reasoning === 'boolean'
}
