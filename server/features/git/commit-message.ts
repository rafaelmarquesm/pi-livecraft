import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { runIsolatedPrompt } from '../../run-isolated-prompt.ts'

const execFileAsync = promisify(execFile)

/** Maximum diff size sent to the model; larger diffs are truncated with a visible marker. */
export const MAX_DIFF_BYTES = 50 * 1024

/** Marker appended when a diff exceeds {@link MAX_DIFF_BYTES}. */
export const TRUNCATION_MARKER = '\n… diff truncated (50 KB limit) …\n'

/** Thrown when the repository has no staged or unstaged textual changes; the route maps this to 409. */
export class EmptyDiffError extends Error {
  constructor() {
    super('Nothing to commit')
    this.name = 'EmptyDiffError'
  }
}

/** Loads the commit-message system prompt fresh from disk so edits take effect without restarting. */
export async function loadCommitMessageSystemPrompt(): Promise<string> {
  return readFile(new URL('commit-message-system.txt', import.meta.url), 'utf8')
}

/**
 * Removes binary diff noise while keeping each file's `diff --git` header, so
 * the model still knows the file changed without seeing base85 blob content.
 */
export function filterBinaryDiff(diff: string): string {
  const lines = diff.split('\n')
  const filtered: string[] = []
  let skippingBinaryPatch = false
  for (const line of lines) {
    if (skippingBinaryPatch) {
      if (line.startsWith('diff --git ')) {
        skippingBinaryPatch = false
        filtered.push(line)
      }
      continue
    }
    if (line === 'GIT binary patch' || /^Binary files .* differ$/.test(line)) {
      skippingBinaryPatch = line === 'GIT binary patch'
      continue
    }
    filtered.push(line)
  }
  return filtered.join('\n')
}

/** Truncates a diff to {@link MAX_DIFF_BYTES} at a line boundary, appending a visible marker. */
export function truncateDiff(diff: string): string {
  if (Buffer.byteLength(diff, 'utf8') <= MAX_DIFF_BYTES) return diff
  const budget = MAX_DIFF_BYTES - Buffer.byteLength(TRUNCATION_MARKER, 'utf8')
  let low = 0
  let high = diff.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(diff.slice(0, mid), 'utf8') <= budget) low = mid
    else high = mid - 1
  }
  const boundary = diff.lastIndexOf('\n', low)
  return `${diff.slice(0, boundary > 0 ? boundary : low)}${TRUNCATION_MARKER}`
}

/** Builds the exact prompt sent to the model: binary filtering, truncation, and diff tags. */
export function buildCommitPrompt(diff: string): string {
  return `<git_diff>\n${truncateDiff(filterBinaryDiff(diff))}\n</git_diff>`
}

/**
 * Reduces the model's answer to the one-line subject: strips surrounding code
 * fences and every backtick, then keeps the first non-empty line.
 */
export function normalizeCommitMessage(text: string): string {
  const withoutFences = text
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  const firstLine = withoutFences.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.replaceAll('`', '').trim()
}

/** Runs `git diff --staged`, falling back to the unstaged diff when nothing is staged. */
export async function collectGitDiff(cwd: string): Promise<string> {
  const staged = await runGitDiff(cwd, ['diff', '--staged'])
  const diff = staged.trim() ? staged : await runGitDiff(cwd, ['diff'])
  if (!diff.trim()) throw new EmptyDiffError()
  return diff.trim()
}

async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
    return stdout
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Git diff failed: ${detail}`)
  }
}

/** Generates a one-line conventional commit message for the changes in `cwd`. */
export async function generateCommitMessage(
  cwd: string,
): Promise<{ message: string; cost?: number }> {
  const [systemPrompt, diff] = await Promise.all([
    loadCommitMessageSystemPrompt(),
    collectGitDiff(cwd),
  ])
  const result = await runIsolatedPrompt({
    cwd,
    prompt: buildCommitPrompt(diff),
    systemPrompt,
    includeContextFiles: false,
    usagePurpose: 'prompt_improvement',
  })
  return { message: normalizeCommitMessage(result.text), cost: result.cost }
}
