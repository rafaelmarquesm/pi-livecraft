import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import { JsonLineDecoder, encodeJsonLine } from '../server/jsonl.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

interface EvidenceRequirement {
  label: string
  paths: string[]
}

interface DocumentationCase {
  name: string
  prompt: string
  expectedDocuments: string[]
  expectedEvidence: EvidenceRequirement[]
  allowedDocuments?: string[]
}

interface ToolCallTrace {
  id: string
  name: string
  args: JsonObject
  isError?: boolean
}

interface RoutingScore {
  compliance: boolean
  coverage: number
  ordered: boolean
  routingFirst: boolean
  readDocuments: string[]
}

interface ExplorationScore {
  evidenceComplete: boolean
  evidenceCoverage: number
  coveredEvidence: string[]
  toolCalls: number
  repeatedReads: string[]
  failedCalls: number
  unscopedSearches: number
  offRouteDocuments: string[]
}

const documentationCases: DocumentationCase[] = [
  {
    name: 'composer',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour ajouter un nouveau sélecteur dans la barre du composer.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-COMPOSER.md',
      'src/features/composer/README.md',
    ],
    expectedEvidence: [
      { label: 'composer owner', paths: ['src/features/composer/Composer.tsx'] },
      {
        label: 'select primitive',
        paths: ['src/features/composer/selects/ComposerSelect.tsx'],
      },
    ],
    allowedDocuments: ['.pi/skills/livecraft-ui/SKILL.md'],
  },
  {
    name: 'settings',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour ajouter une préférence utilisateur dans un nouvel onglet des réglages.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-SETTINGS.md',
      'src/features/settings/README.md',
    ],
    expectedEvidence: [
      { label: 'settings owner', paths: ['src/features/settings/SettingsPanel.tsx'] },
      { label: 'application wiring', paths: ['src/App.tsx'] },
    ],
    allowedDocuments: ['.pi/skills/livecraft-ui/SKILL.md'],
  },
  {
    name: 'manager lifecycle',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour changer le comportement de redémarrage supervisé du manager.',
    expectedDocuments: [
      'docs/README.md',
      'docs/MANAGER-LIFECYCLE.md',
    ],
    expectedEvidence: [
      {
        label: 'supervision owner',
        paths: [
          'server/manager-supervisor.ts',
          'server/manager-runtime-monitor.ts',
        ],
      },
      { label: 'manager owner', paths: ['server/manager.ts'] },
    ],
    allowedDocuments: [
      'docs/ARCHITECTURE.md',
      'src/features/manager/README.md',
    ],
  },
  {
    name: 'isolated prompt',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour ajouter un nouvel usage serveur des prompts Pi isolés.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-RUN-ISOLATED-PROMPT.md',
    ],
    expectedEvidence: [
      { label: 'isolated prompt owner', paths: ['server/run-isolated-prompt.ts'] },
      {
        label: 'server integration',
        paths: ['server/manager.ts', 'server/backend.ts'],
      },
    ],
    allowedDocuments: [
      'docs/ARCHITECTURE.md',
      'server/features/README.md',
    ],
  },
  {
    name: 'extension ui',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour afficher dans l\'interface les widgets et la barre de statut envoyés par les extensions Pi (setWidget/setStatus/set_editor_text).',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-EXTENSION-UI.md',
      'src/features/extension-ui/README.md',
    ],
    expectedEvidence: [
      { label: 'extension UI owner', paths: ['src/features/extension-ui/ExtensionWidgetHost.tsx'] },
      { label: 'shared reducer', paths: ['shared/extension-ui.ts'] },
    ],
    allowedDocuments: ['.pi/skills/livecraft-ui/SKILL.md'],
  },
  {
    name: 'export',
    prompt:
      'Sans modifier le dépôt, prépare un plan précis pour ajouter um novo formato de exportação de sessão.',
    expectedDocuments: [
      'docs/README.md',
      'docs/HOW-TO-EXPORT.md',
    ],
    expectedEvidence: [
      { label: 'export owner', paths: ['server/features/export/session-export.ts'] },
      { label: 'backend route', paths: ['server/backend.ts'] },
    ],
    allowedDocuments: [
      'server/features/export/session-markdown.ts',
      'src/features/dialogs/README.md',
    ],
  },
]

/** Measures whether successful reads covered the expected documentation in order and began with the index. */
function scoreDocumentationRouting(
  cwd: string,
  expectedDocuments: string[],
  trace: ToolCallTrace[],
): RoutingScore {
  const successfulReads = trace
    .filter((call) =>
      call.name === 'read' && call.isError === false && typeof call.args.path === 'string'
    )
    .map((call) => normalizePath(cwd, call.args.path as string))
  const positions = expectedDocuments.map((document) => successfulReads.indexOf(document))
  const coverage = positions.filter((position) => position !== -1).length / expectedDocuments.length
  const ordered = positions.every((position, index) =>
    position !== -1 && (index === 0 || position > positions[index - 1])
  )
  const firstCall = trace[0]
  const routingFirst = firstCall?.name === 'read'
    && firstCall.isError === false
    && typeof firstCall.args.path === 'string'
    && normalizePath(cwd, firstCall.args.path) === expectedDocuments[0]
  return {
    compliance: coverage === 1 && ordered && routingFirst,
    coverage,
    ordered,
    routingFirst,
    readDocuments: successfulReads,
  }
}

/** Measures whether exploration found the minimum source evidence without common waste signals. */
function scoreExploration(
  cwd: string,
  testCase: DocumentationCase,
  trace: ToolCallTrace[],
): ExplorationScore {
  const successfulReads = trace
    .filter((call) =>
      call.name === 'read' && call.isError === false && typeof call.args.path === 'string'
    )
    .map((call) => normalizePath(cwd, call.args.path as string))
  const coveredEvidence = testCase
    .expectedEvidence
    .filter((requirement) => requirement.paths.some((path) => successfulReads.includes(path)))
    .map((requirement) => requirement.label)
  const evidenceCoverage = coveredEvidence.length / testCase.expectedEvidence.length
  const seenReads = new Set<string>()
  const repeatedReads = new Set<string>()
  for (const path of successfulReads) {
    if (seenReads.has(path)) repeatedReads.add(path)
    else seenReads.add(path)
  }
  const allowedDocuments = new Set([
    ...testCase.expectedDocuments,
    ...(testCase.allowedDocuments ?? []),
  ])
  const offRouteDocuments = [
    ...new Set(
      successfulReads.filter((path) => isGuidanceDocument(path) && !allowedDocuments.has(path)),
    ),
  ]
  return {
    evidenceComplete: evidenceCoverage === 1,
    evidenceCoverage,
    coveredEvidence,
    toolCalls: trace.length,
    repeatedReads: [...repeatedReads],
    failedCalls: trace.filter((call) => call.isError === true).length,
    unscopedSearches: trace.filter((call) => isUnscopedSearch(cwd, call)).length,
    offRouteDocuments,
  }
}

function isGuidanceDocument(path: string): boolean {
  return path.endsWith('/README.md')
    || path.endsWith('/SKILL.md')
    || path.startsWith('docs/') && path.endsWith('.md')
}

function isUnscopedSearch(cwd: string, call: ToolCallTrace): boolean {
  if (call.name !== 'find' && call.name !== 'grep') return false
  if (typeof call.args.path !== 'string') return true
  const path = normalizePath(cwd, call.args.path)
  return path === '' || path === '.'
}

function normalizePath(cwd: string, path: string): string {
  const cleaned = path.startsWith('@') ? path.slice(1) : path
  const absolute = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned)
  const workspacePath = relative(cwd, absolute)
  return workspacePath.startsWith('..') ? cleaned : workspacePath.split(sep).join('/')
}

function traceRead(path: string, isError = false): ToolCallTrace {
  return { id: path, name: 'read', args: { path }, isError }
}

test('scores documentation coverage, order, and initial routing independently', () => {
  const cwd = process.cwd()
  const expected = ['docs/README.md', 'docs/HOW-TO-COMPOSER.md']

  assert.deepEqual(
    scoreDocumentationRouting(cwd, expected, expected.map((path) => traceRead(path))),
    {
      compliance: true,
      coverage: 1,
      ordered: true,
      routingFirst: true,
      readDocuments: expected,
    },
  )

  const wrongOrder = scoreDocumentationRouting(
    cwd,
    expected,
    [...expected].reverse().map((path) => traceRead(path)),
  )
  assert.equal(wrongOrder.coverage, 1)
  assert.equal(wrongOrder.ordered, false)
  assert.equal(wrongOrder.routingFirst, false)

  const sourceFirst = scoreDocumentationRouting(cwd, expected, [
    traceRead('src/App.tsx'),
    ...expected.map((path) => traceRead(path)),
  ])
  assert.equal(sourceFirst.coverage, 1)
  assert.equal(sourceFirst.ordered, true)
  assert.equal(sourceFirst.routingFirst, false)

  const failedGuide = scoreDocumentationRouting(cwd, expected, [
    traceRead(expected[0]),
    traceRead(expected[1], true),
  ])
  assert.equal(failedGuide.coverage, 0.5)
  assert.equal(failedGuide.compliance, false)
})

test('scores evidence coverage and exploration waste independently', () => {
  const cwd = process.cwd()
  const testCase = documentationCases.find(({ name }) => name === 'composer')
  assert.ok(testCase)
  const trace = [
    ...testCase.expectedDocuments.map((path) => traceRead(path)),
    traceRead('src/features/composer/Composer.tsx'),
    traceRead('src/features/composer/selects/ComposerSelect.tsx'),
    traceRead('src/features/composer/Composer.tsx'),
    { id: 'root-search', name: 'grep', args: { pattern: 'Composer' }, isError: false },
    traceRead('docs/ARCHITECTURE.md'),
    traceRead('missing.ts', true),
  ]

  assert.deepEqual(scoreExploration(cwd, testCase, trace), {
    evidenceComplete: true,
    evidenceCoverage: 1,
    coveredEvidence: ['composer owner', 'select primitive'],
    toolCalls: 9,
    repeatedReads: ['src/features/composer/Composer.tsx'],
    failedCalls: 1,
    unscopedSearches: 1,
    offRouteDocuments: ['docs/ARCHITECTURE.md'],
  })
})

test(
  'evaluates documentation routing with a real read-only Pi agent',
  { timeout: 60 * 60_000 },
  async () => {
    const cwd = process.cwd()
    const repeats = positiveInteger(process.env.PI_DOC_ROUTING_REPEATS, 3)
    const provider = process.env.PI_DOC_ROUTING_PROVIDER ?? 'opencode-go'
    const model = process.env.PI_DOC_ROUTING_MODEL ?? 'deepseek-v4-pro'
    const thinking = process.env.PI_DOC_ROUTING_THINKING ?? 'high'
    const testCases = selectDocumentationCases(process.env.PI_DOC_ROUTING_CASES)
    const results: Array<{
      testCase: DocumentationCase
      routing: RoutingScore
      exploration: ExplorationScore
      cost?: number
      trace: ToolCallTrace[]
    }> = []

    console.log(
      `\nAgent guidance evaluation: ${provider}/${model}, thinking=${thinking}, repeats=${repeats}, cases=${
        testCases.map(({ name }) => name).join(', ')
      }`,
    )
    for (const testCase of testCases) {
      for (let attempt = 1; attempt <= repeats; attempt += 1) {
        const run = await runReadOnlyPrompt(cwd, testCase.prompt, provider, model, thinking)
        const routing = scoreDocumentationRouting(cwd, testCase.expectedDocuments, run.trace)
        const exploration = scoreExploration(cwd, testCase, run.trace)
        results.push({ testCase, routing, exploration, cost: run.cost, trace: run.trace })
        console.log(
          `${testCase.name} #${attempt}: compliance=${
            routing.compliance && exploration.evidenceComplete
          } routing=${routing.compliance} evidence=${
            formatRate(exploration.evidenceCoverage)
          } calls=${exploration.toolCalls} repeats=${exploration.repeatedReads.length} failed=${exploration.failedCalls} unscoped=${exploration.unscopedSearches} offRoute=${exploration.offRouteDocuments.length}`,
        )
        console.log(`  expected route: ${testCase.expectedDocuments.join(' -> ')}`)
        console.log(`  covered evidence: ${exploration.coveredEvidence.join(', ') || '(none)'}`)
        if (exploration.repeatedReads.length > 0)
          console.log(`  repeated reads: ${exploration.repeatedReads.join(', ')}`)
        if (exploration.offRouteDocuments.length > 0)
          console.log(`  off-route documents: ${exploration.offRouteDocuments.join(', ')}`)
        console.log(`  tools: ${formatTrace(cwd, run.trace)}`)
      }
    }

    const compliance = results
      .filter(({ routing, exploration }) => routing.compliance && exploration.evidenceComplete)
      .length / results.length
    const routingCompliance = results.filter(({ routing }) => routing.compliance).length
      / results.length
    const evidenceCoverage = results.reduce(
      (sum, { exploration }) => sum + exploration.evidenceCoverage,
      0,
    ) / results.length
    const toolCalls = results.reduce((sum, { exploration }) => sum + exploration.toolCalls, 0)
    const repeatedReads = results.reduce(
      (sum, { exploration }) => sum + exploration.repeatedReads.length,
      0,
    )
    const failedCalls = results.reduce(
      (sum, { exploration }) => sum + exploration.failedCalls,
      0,
    )
    const unscopedSearches = results.reduce(
      (sum, { exploration }) => sum + exploration.unscopedSearches,
      0,
    )
    const offRouteDocuments = results.reduce(
      (sum, { exploration }) => sum + exploration.offRouteDocuments.length,
      0,
    )
    const totalCost = results.reduce((sum, result) => sum + (result.cost ?? 0), 0)
    console.log(
      `Summary: compliance=${formatRate(compliance)} routing=${
        formatRate(routingCompliance)
      } evidence=${
        formatRate(evidenceCoverage)
      } calls=${toolCalls} repeats=${repeatedReads} failed=${failedCalls} unscoped=${unscopedSearches} offRoute=${offRouteDocuments} cost=$${
        totalCost.toFixed(4)
      }`,
    )
  },
)

/** Runs one ephemeral Pi prompt with mutation-capable tools disabled and captures ordered tool events. */
async function runReadOnlyPrompt(
  cwd: string,
  prompt: string,
  provider: string,
  model: string,
  thinking: string,
): Promise<{ cost?: number; trace: ToolCallTrace[] }> {
  const pi = new RpcEvaluationProcess(cwd, provider, model, thinking)
  try {
    await Promise.all([
      pi.request({ type: 'prompt', message: prompt }, 10 * 60_000),
      pi.waitForEvent('agent_settled', 10 * 60_000),
    ])
    let cost: number | undefined
    try {
      const stats = await pi.request({ type: 'get_session_stats' })
      if (isObject(stats.data) && typeof stats.data.cost === 'number') cost = stats.data.cost
    } catch {
      // Cost metadata is optional and does not affect the routing evaluation.
    }
    return { cost, trace: pi.trace }
  } finally {
    await pi.terminate()
  }
}

class RpcEvaluationProcess {
  readonly trace: ToolCallTrace[] = []
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

  constructor(cwd: string, provider: string, model: string, thinking: string) {
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
      '--tools',
      'read,grep,find,ls',
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
    const id = `doc-eval-${this.#nextRequestId += 1}`
    return new Promise((resolveRequest, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Pi RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.#pending.set(id, { reject, resolve: resolveRequest, timeout })
      this.#child.stdin.write(encodeJsonLine({ ...command, id }))
    })
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    return new Promise((resolveEvent, reject) => {
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
        else resolveEvent()
      }
      this.#events.on('event', onEvent)
      this.#child.once('close', onClose)
    })
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
    if (
      value.type === 'tool_execution_start' && typeof value.toolCallId === 'string' && typeof value
          .toolName === 'string'
      && isObject(value.args)
    ) {
      this.trace.push({ id: value.toolCallId, name: value.toolName, args: value.args })
    }
    if (value.type === 'tool_execution_end' && typeof value.toolCallId === 'string') {
      const call = this.trace.find((entry) => entry.id === value.toolCallId)
      if (call) call.isError = value.isError === true
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

/** Selects an ordered subset of evaluation cases and rejects misspelled names. */
function selectDocumentationCases(value: string | undefined): DocumentationCase[] {
  if (!value) return documentationCases
  const names = value.split(',').map((name) => name.trim()).filter(Boolean)
  return names.map((name) => {
    const testCase = documentationCases.find((candidate) => candidate.name === name)
    if (!testCase) throw new Error(`Unknown documentation routing case: ${name}`)
    return testCase
  })
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatTrace(cwd: string, trace: ToolCallTrace[]): string {
  return trace
    .map((call) => {
      const path = typeof call.args.path === 'string'
        ? `(${normalizePath(cwd, call.args.path)})`
        : ''
      return `${call.name}${path}${call.isError ? '!' : ''}`
    })
    .join(' -> ') || '(none)'
}
