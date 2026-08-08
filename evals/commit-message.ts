import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  buildCommitPrompt,
  loadCommitMessageSystemPrompt,
  normalizeCommitMessage,
} from '../server/features/git/commit-message.ts'
import { assistantText } from '../server/prompt-improvement.ts'
import { JsonLineDecoder, encodeJsonLine } from '../server/jsonl.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

/** A synthetic or real unified diff fixture used by the commit-message eval. */
interface CommitDiffFixture {
  name: string
  diff: string
}

/** 8–12 diff fixtures covering the failure modes L3.2 names (rename, delete, formatting, multi-file, binary, over-limit). */
const commitMessageFixtures: CommitDiffFixture[] = [
  {
    name: 'rename',
    diff: [
      'diff --git a/src/features/search/search-utils.ts b/src/features/search/utils.ts',
      'similarity index 92%',
      'rename from src/features/search/search-utils.ts',
      'rename to src/features/search/utils.ts',
      'index 1111111..2222222 100644',
      '--- a/src/features/search/search-utils.ts',
      '+++ b/src/features/search/utils.ts',
      '@@ -6,7 +6,7 @@ export function normalizeQuery(query: string): string {',
      '  return query.trim().toLowerCase()',
      '}',
      '',
      '-export function highlightMatches(text: string, query: string): string {',
      '+export function highlightMatches(text: string, query: string, maxLength = 200): string {',
      '  const index = text.toLowerCase().indexOf(query.toLowerCase())',
      '  if (index === -1) return text',
    ]
      .join('\n'),
  },
  {
    name: 'delete',
    diff: [
      'diff --git a/src/legacy/migrate.ts b/src/legacy/migrate.ts',
      'deleted file mode 100644',
      'index 3333333..0000000',
      '--- a/src/legacy/migrate.ts',
      '+++ /dev/null',
      '@@ -1,11 +0,0 @@',
      '-import { readFile, writeFile } from \'node:fs/promises\'',
      '',
      '/** Obsolete migration, replaced by the session-store reindexer. */',
      '-export async function migrateOldFormat(path: string): Promise<void> {',
      '-  const content = await readFile(path, \'utf8\')',
      '-  if (content.startsWith(\'{"version":1,\')) return',
      '-  await writeFile(path, content.replace(/^\\{/, \'{"version":1,\'))',
      '-}',
    ]
      .join('\n'),
  },
  {
    name: 'formatting-only',
    diff: [
      'diff --git a/src/features/git/git-diff.ts b/src/features/git/git-diff.ts',
      'index 4444444..5555555 100644',
      '--- a/src/features/git/git-diff.ts',
      '+++ b/src/features/git/git-diff.ts',
      '@@ -18,9 +18,9 @@ export function parseGitDiff(diff: string): GitDiffLine[] {',
      '  const lines: GitDiffLine[] = []',
      '  for (const line of diff.split(\'\\n\')) {',
      '    if (line.startsWith(\'@@\')) {',
      '-      lines.push({ kind: \'hunk\', content: line, oldLine: null, newLine: null })',
      '+      lines.push({ content: line, kind: \'hunk\', oldLine: null, newLine: null })',
      '    } else if (line.startsWith(\'+\')) {',
      '-      lines.push({ kind: \'added\', content: line.slice(1), oldLine: null, newLine: count })',
      '+      lines.push({ content: line.slice(1), kind: \'added\', oldLine: null, newLine: count })',
      '      count += 1',
    ]
      .join('\n'),
  },
  {
    name: 'multi-file',
    diff: [
      'diff --git a/src/features/todos/todo-store.ts b/src/features/todos/todo-store.ts',
      'index 6666666..7777777 100644',
      '--- a/src/features/todos/todo-store.ts',
      '+++ b/src/features/todos/todo-store.ts',
      '@@ -12,6 +12,7 @@ export async function loadWorkspaceTodos(cwd: string): Promise<TodoItem[]> {',
      '    return []',
      '  }',
      '-  return parseTodoItems(await readFile(storePath, \'utf8\'))',
      '+  return sortTodoItemsForDisplay(await parseTodoItems(await readFile(storePath, \'utf8\')))',
      '}',
      'diff --git a/src/features/todos/todo-order.ts b/src/features/todos/todo-order.ts',
      'new file mode 100644',
      'index 0000000..9999999',
      '--- /dev/null',
      '+++ b/src/features/todos/todo-order.ts',
      '@@ -0,0 +1,15 @@',
      '+/** Sorts open items before completed ones, keeping the original order within each group. */',
      '+export function sortTodoItemsForDisplay(items: TodoItem[]): TodoItem[] {',
      '+  return [...items].sort((left, right) => Number(left.completed) - Number(right.completed))',
      '+}',
    ]
      .join('\n'),
  },
  {
    name: 'binary',
    diff: [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 1234567..89abcde 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
      'diff --git a/src/features/workspace/sidebar-sessions.ts b/src/features/workspace/sidebar-sessions.ts',
      'index aaaaaaa..bbbbbbb 100644',
      '--- a/src/features/workspace/sidebar-sessions.ts',
      '+++ b/src/features/workspace/sidebar-sessions.ts',
      '@@ -41,7 +41,7 @@ export function groupSessionChildren(',
      '  const childrenByParentPath = new Map<string, RecentSession[]>()',
      '  for (const session of sessions) {',
      '    if (session.parentSession) {',
      '-      const siblings = childrenByParentPath.get(session.parentSession) ?? []',
      '+      const siblings = childrenByParentPath.get(session.parentSession) ?? [] as RecentSession[]',
      '      siblings.push(session)',
      '      childrenByParentPath.set(session.parentSession, siblings)',
    ]
      .join('\n'),
  },
  {
    name: 'over-limit',
    diff: overLimitDiff(),
  },
  {
    name: 'feature',
    diff: [
      'diff --git a/src/features/export/session-markdown.ts b/src/features/export/session-markdown.ts',
      'new file mode 100644',
      'index 0000000..ddddddd',
      '--- /dev/null',
      '+++ b/src/features/export/session-markdown.ts',
      '@@ -0,0 +1,28 @@',
      '+import type { SessionMessage } from \'../../../shared/types.ts\'',
      '',
      '/** Renders one session message as Markdown for the session export feature. */',
      '+export function messageToMarkdown(message: SessionMessage): string {',
      '+  if (message.message.role === \'user\') {',
      '+    const text = typeof message.message.content === \'string\'',
      '+      ? message.message.content',
      '+      : \'[image attached]\'',
      '+    return `**You:** ${text}`',
      '+  }',
      '+  return `**Pi:** ${String(message.message.content)}`',
      '+}',
    ]
      .join('\n'),
  },
  {
    name: 'bugfix',
    diff: [
      'diff --git a/server/session-snapshot.ts b/server/session-snapshot.ts',
      'index eeeeeee..fffffff 100644',
      '--- a/server/session-snapshot.ts',
      '+++ b/server/session-snapshot.ts',
      '@@ -55,7 +55,7 @@ export function activeSessionMessages(entries: JsonObject[]): SessionMessage[] {',
      '  const messages: SessionMessage[] = []',
      '  const byParent = new Map<string, JsonObject[]>()',
      '  for (const entry of entries) {',
      '-    const parent = entry.parentId === null ? \'\' : String(entry.parentId)',
      '+    const parent = typeof entry.parentId === \'string\' ? entry.parentId : \'\'',
      '    const siblings = byParent.get(parent) ?? []',
      '    siblings.push(entry)',
      '    byParent.set(parent, siblings)',
      '@@ -63,7 +63,7 @@ export function activeSessionMessages(entries: JsonObject[]): SessionMessage[] {',
      '  const visit = (parent: string): void => {',
      '    for (const entry of byParent.get(parent) ?? []) {',
      '-      messages.push({ entryId: entry.id, message: entry.message })',
      '+      messages.push({ entryId: String(entry.id), message: entry.message })',
      '      visit(String(entry.id))',
    ]
      .join('\n'),
  },
  {
    name: 'docs',
    diff: [
      'diff --git a/docs/README.md b/docs/README.md',
      'index 1231231..4564564 100644',
      '--- a/docs/README.md',
      '+++ b/docs/README.md',
      '@@ -10,6 +10,7 @@',
      '| [HOW-TO-COMPOSER.md](HOW-TO-COMPOSER.md) | Composer bar extension points |',
      '| [HOW-TO-EXPORT.md](HOW-TO-EXPORT.md) | Session export formats |',
      '+| [HOW-TO-COMMIT-MESSAGE.md](HOW-TO-COMMIT-MESSAGE.md) | Generating commit messages via Pi |',
      '| [HOW-TO-RUN-ISOLATED-PROMPT.md](HOW-TO-RUN-ISOLATED-PROMPT.md) | Isolated prompt usage |',
    ]
      .join('\n'),
  },
  {
    name: 'chore',
    diff: [
      'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml',
      'index 7897897..abcabca 100644',
      '--- a/.github/workflows/ci.yml',
      '+++ b/.github/workflows/ci.yml',
      '@@ -8,6 +8,8 @@ jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '+    timeout-minutes: 30',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '+      - uses: oven-sh/setup-bun@v2',
    ]
      .join('\n'),
  },
]

/** Builds a diff that exceeds the 50 KB truncation limit so the eval exercises the marker path. */
function overLimitDiff(): string {
  const header = [
    'diff --git a/src/generated/data.ts b/src/generated/data.ts',
    'index 0000000..ccccccc 100644',
    '--- a/src/generated/data.ts',
    '+++ b/src/generated/data.ts',
    '@@ -1,0 +1,6000 @@',
  ]
    .join('\n')
  const rows: string[] = []
  for (let index = 0; index < 6000; index += 1) {
    rows.push(`+export const row${index} = 'generated value ${index}'`)
  }
  return `${header}\n${rows.join('\n')}`
}

/** Canonical Conventional Commits types the system prompt restricts the model to. */
const CONVENTIONAL_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+$/

interface CommitScore {
  /** Matches the Conventional Commits type(scope): subject shape. */
  conventional: boolean
  /** Subject stays within 72 characters. */
  fits: boolean
  /** Subject does not duplicate the type as a conventional prefix ("feat: feat: …"). */
  redundantPrefix: boolean
  /** Every file-like token in the subject appears in the diff. */
  grounded: boolean
  /** Subject mentions no issue/PR number and no username. */
  inventedReference: boolean
}

/** Deterministic checks over a generated message and the diff the model actually saw. */
function scoreCommitMessage(message: string, diff: string): CommitScore {
  const match = CONVENTIONAL_PATTERN.exec(message)
  const subject = match ? message.slice(match[0].indexOf(':') + 1).trim() : ''
  // Types come from the fixed conventional list above, so no escaping is needed.
  const redundantPrefix = match !== null && new RegExp(`^${match[1]}\\s*[:!]`).test(subject)
  const candidates = pathCandidates(subject)
  const paths = changedPathsFromDiff(diff)
  return {
    conventional: match !== null,
    fits: message.length <= 72,
    redundantPrefix,
    grounded: candidates.every((candidate) => isGrounded(candidate, paths)),
    inventedReference: /#\d+/.test(message) || /@\w+/.test(message),
  }
}

/** Extracts file-like tokens (paths, dotfiles, or names with extensions) from a subject line. */
function pathCandidates(message: string): string[] {
  return message
    .split(/[\s,;()'"`]+/)
    .map((token) => token.replace(/^[([{'"`]+|[)\]}'"`.,:;!?]+$/g, ''))
    .filter((token) =>
      token.length > 0
      && (token.includes('/') || token.startsWith('.')
        || /^[a-z][a-z0-9]{0,7}\.[a-z][a-z0-9]{0,7}$/i
          .test(token))
    )
}

/** True when the candidate matches a changed path exactly, as a directory prefix, or by basename. */
function isGrounded(candidate: string, changedPaths: ReadonlySet<string>): boolean {
  for (const path of changedPaths) {
    if (path === candidate) return true
    if (path.startsWith(`${candidate}/`)) return true
    if (candidate.startsWith(`${path}/`)) return true
    if (path.endsWith(`/${candidate}`)) return true
  }
  return false
}

/** Collects every file path mentioned in a unified diff (both sides of renames, minus /dev/null). */
function changedPathsFromDiff(diff: string): Set<string> {
  const paths = new Set<string>()
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (header) {
      addDiffPath(paths, header[1])
      addDiffPath(paths, header[2])
      continue
    }
    const rename = /^rename (?:from|to) (.+)$/.exec(line)
    if (rename) {
      addDiffPath(paths, rename[1])
      continue
    }
    const fileLine = /^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/.exec(line)
    if (fileLine) addDiffPath(paths, fileLine[1])
  }
  return paths
}

function addDiffPath(paths: Set<string>, value: string): void {
  if (value === '/dev/null') return
  const path = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
  if (path) paths.add(path)
}

test('scores conventional format, subject fit, grounding, and invented references independently', () => {
  const diff = [
    'diff --git a/src/api.ts b/src/api.ts',
    'index 1111111..2222222 100644',
    '--- a/src/api.ts',
    '+++ b/src/api.ts',
    '@@ -1,3 +1,3 @@',
    ' export async function listSessions() {',
    '-  return request(\'/api/sessions\')',
    '+  return request<SessionSummary[]>(\'/api/sessions\')',
    '}',
  ]
    .join('\n')

  const good = scoreCommitMessage('feat(api): type the sessions list response', diff)
  assert.equal(good.conventional, true)
  assert.equal(good.fits, true)
  assert.equal(good.redundantPrefix, false)
  assert.equal(good.grounded, true)
  assert.equal(good.inventedReference, false)

  assert.equal(scoreCommitMessage('Typed the sessions list response', diff).conventional, false)
  assert.equal(
    scoreCommitMessage(`feat(api): ${'x'.repeat(70)}`, diff).fits,
    false,
  )
  assert.equal(scoreCommitMessage('feat: feat: add sessions list', diff).redundantPrefix, true)
  assert.equal(scoreCommitMessage('fix: fix response typing', diff).redundantPrefix, false)
  assert.equal(
    scoreCommitMessage('fix #123 by @contributor', diff).inventedReference,
    true,
  )
  assert.equal(
    scoreCommitMessage('feat(api): add src/other.ts export', diff).grounded,
    false,
  )
  assert.equal(scoreCommitMessage('feat(api): type api.ts response', diff).grounded, true)
})

test('normalizes model responses to a one-line subject without fences or backticks', () => {
  assert.equal(
    normalizeCommitMessage('feat: add session export\n\nBody line'),
    'feat: add session export',
  )
  assert.equal(normalizeCommitMessage('```\nfix: parse empty diffs\n```'), 'fix: parse empty diffs')
  assert.equal(normalizeCommitMessage('```ts\nfeat: add export\n```'), 'feat: add export')
  assert.equal(normalizeCommitMessage('`feat`: add `export` button'), 'feat: add export button')
  assert.equal(normalizeCommitMessage('  \nchore: bump deps\n'), 'chore: bump deps')
})

test(
  'evaluates generated commit messages with deterministic checks and an LLM judge',
  { timeout: 60 * 60_000 },
  async () => {
    const repeats = positiveInteger(process.env.PI_CM_REPEATS, 3)
    const provider = process.env.PI_CM_PROVIDER ?? 'opencode-go'
    const model = process.env.PI_CM_MODEL ?? 'deepseek-v4-pro'
    const thinking = process.env.PI_CM_THINKING ?? 'low'
    const systemPrompt = await loadCommitMessageSystemPrompt()
    const fixtures = selectCommitMessageFixtures(process.env.PI_CM_CASES)
    const results: Array<{
      fixture: string
      attempt: number
      message: string
      score: CommitScore
      judge: number
      cost?: number
    }> = []

    console.log(
      `\nCommit-message evaluation: ${provider}/${model}, thinking=${thinking}, repeats=${repeats}, fixtures=${
        fixtures.map(({ name }) => name).join(', ')
      }`,
    )
    for (const fixture of fixtures) {
      const prepared = buildCommitPrompt(fixture.diff)
      const judgeScores: number[] = []
      for (let attempt = 1; attempt <= repeats; attempt += 1) {
        const run = await generateWithPi(prepared, systemPrompt, provider, model, thinking)
        const message = normalizeCommitMessage(run.text)
        const score = scoreCommitMessage(message, prepared)
        const judge = await judgeWithPi(prepared, message, provider, model, thinking)
        judgeScores.push(judge)
        results.push({ fixture: fixture.name, attempt, message, score, judge, cost: run.cost })
        console.log(
          `${fixture.name} #${attempt}: conventional=${score.conventional} fits=${score.fits} redundant=${score.redundantPrefix} grounded=${score.grounded} invented=${score.inventedReference} judge=${judge} "${message}"`,
        )
      }
      const mean = average(judgeScores)
      const deviation = standardDeviation(judgeScores)
      console.log(
        `  ${fixture.name} judge: mean=${mean.toFixed(2)} sd=${deviation.toFixed(2)}${
          mean >= 4 && deviation <= 0.5 ? ' PASS' : ' FAIL'
        }`,
      )
    }

    const conventionalRate = results.filter(({ score }) => score.conventional).length
      / results.length
    const fitsRate = results.filter(({ score }) => score.fits).length / results.length
    const redundantFailures = results.filter(({ score }) => score.redundantPrefix).length
    const groundedRate = results.filter(({ score }) => score.grounded).length / results.length
    const inventedFailures = results.filter(({ score }) => score.inventedReference).length
    console.log(
      `Summary: conventional=${formatRate(conventionalRate)} fits=${
        formatRate(fitsRate)
      } grounded=${
        formatRate(groundedRate)
      } redundantFailures=${redundantFailures} inventedFailures=${inventedFailures}`,
    )
  },
)

/** Runs one ephemeral Pi prompt with the real commit-message system prompt and no tools. */
async function generateWithPi(
  prompt: string,
  systemPrompt: string,
  provider: string,
  model: string,
  thinking: string,
): Promise<{ text: string; cost?: number }> {
  const pi = new RpcEvaluationProcess(process.cwd(), provider, model, thinking, systemPrompt)
  try {
    await Promise.all([
      pi.request({ type: 'prompt', message: prompt }, 10 * 60_000),
      pi.waitForEvent('agent_settled', 10 * 60_000),
    ])
    const text = assistantText(await pi.request({ type: 'get_messages' }))
    if (!text) throw new Error('The model returned no text')
    let cost: number | undefined
    try {
      const stats = await pi.request({ type: 'get_session_stats' })
      if (isObject(stats.data) && typeof stats.data.cost === 'number') cost = stats.data.cost
    } catch {
      // Cost metadata is optional and does not affect the evaluation.
    }
    return { text, cost }
  } finally {
    await pi.terminate()
  }
}

/** Runs one ephemeral Pi prompt that scores a message against a diff with a 1–5 rubric. */
async function judgeWithPi(
  diff: string,
  message: string,
  provider: string,
  model: string,
  thinking: string,
): Promise<number> {
  const systemPrompt = [
    'You grade Git commit messages against the diff they describe.',
    'Score how well the message captures the main change, using a 1-5 rubric:',
    '5 — precisely names the main change; every file reference is in the diff',
    '4 — clearly describes the main change with only minor imprecision',
    '3 — describes a plausible change but misses the main one or adds ungrounded detail',
    '2 — mostly unrelated to the diff',
    '1 — describes nothing in the diff',
    'Reply with ONLY the integer score.',
  ]
    .join('\n')
  const pi = new RpcEvaluationProcess(process.cwd(), provider, model, thinking, systemPrompt)
  try {
    const prompt = `<git_diff>\n${diff}\n</git_diff>\n\nCommit message: ${message}\n\nScore (1-5):`
    await Promise.all([
      pi.request({ type: 'prompt', message: prompt }, 5 * 60_000),
      pi.waitForEvent('agent_settled', 5 * 60_000),
    ])
    const text = assistantText(await pi.request({ type: 'get_messages' }))
    const match = /\b([1-5])\b/.exec(text ?? '')
    if (!match) throw new Error(`Judge returned no score: ${text}`)
    return Number(match[1])
  } finally {
    await pi.terminate()
  }
}

/** Minimal Pi RPC driver for evals, copied from evals/documentation-routing.ts with an optional system prompt. */
class RpcEvaluationProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #events = new EventEmitter()
  readonly #pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (value: JsonObject) => void
      timeout: NodeJS.Timeout
    }
  >()
  readonly #exited: Promise<void>
  #nextRequestId = 0
  #stderr = ''

  constructor(
    cwd: string,
    provider: string,
    model: string,
    thinking: string,
    systemPrompt?: string,
  ) {
    this.#child = spawn('pi', [
      '--mode',
      'rpc',
      '--no-session',
      '--provider',
      provider,
      '--model',
      model,
      '--thinking',
      thinking,
      '--system-prompt',
      systemPrompt ?? '',
      '--no-tools',
      '--no-extensions',
    ], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.#exited = new Promise((resolveExit) => this.#child.once('close', () => resolveExit()))
    const decoder = new JsonLineDecoder((value) => this.#receive(value))
    this.#child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    this.#child.stdout.on('end', () => decoder.end())
    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-8_192)
    })
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on(
      'close',
      (code, signal) =>
        this.#fail(new Error(`Pi exited (${signal ?? code ?? 'unknown'}): ${this.#stderr.trim()}`)),
    )
  }

  request(command: JsonObject, timeoutMs = 30_000): Promise<JsonObject> {
    const id = `cm-eval-${this.#nextRequestId += 1}`
    const { promise, resolve, reject } = Promise.withResolvers<JsonObject>()
    const timeout = setTimeout(() => {
      this.#pending.delete(id)
      reject(new Error(`Pi RPC command timed out: ${String(command.type)}`))
    }, timeoutMs)
    this.#pending.set(id, { reject, resolve, timeout })
    this.#child.stdin.write(encodeJsonLine({ ...command, id }))
    return promise
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const timeout = setTimeout(() => finish(new Error(`Pi event timed out: ${type}`)), timeoutMs)
    const onEvent = (event: JsonObject): void => {
      if (event.type === type) finish()
    }
    const onClose = (): void =>
      finish(new Error(`Pi exited before event ${type}: ${this.#stderr.trim()}`))
    const finish = (error?: Error): void => {
      clearTimeout(timeout)
      this.#events.off('event', onEvent)
      this.#child.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    this.#events.on('event', onEvent)
    this.#child.once('close', onClose)
    return promise
  }

  async terminate(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    this.#child.kill('SIGTERM')
    await Promise.race([
      this.#exited,
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ])
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL')
      await this.#exited
    }
  }

  #receive(value: unknown): void {
    if (!isObject(value)) return
    if (value.type === 'response' && typeof value.id === 'string') {
      const pending = this.#pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.#pending.delete(value.id)
      if (value.success === false)
        pending.reject(new Error(String(value.error ?? 'Pi RPC command failed')))
      else pending.resolve(value)
      return
    }
    this.#events.emit('event', value)
  }

  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

/** Selects an ordered subset of fixtures and rejects misspelled names. */
function selectCommitMessageFixtures(value: string | undefined): CommitDiffFixture[] {
  if (!value) return commitMessageFixtures
  const names = value.split(',').map((name) => name.trim()).filter(Boolean)
  return names.map((name) => {
    const fixture = commitMessageFixtures.find((candidate) => candidate.name === name)
    if (!fixture) throw new Error(`Unknown commit-message fixture: ${name}`)
    return fixture
  })
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Population standard deviation — the judge-stability metric from L3.2. */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = average(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`
}
