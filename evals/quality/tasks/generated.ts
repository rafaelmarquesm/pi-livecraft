import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fingerprintDirectory,
  fingerprintJson,
  sha256Text,
  type FingerprintJson,
} from '../fingerprint.ts'
import {
  assertSuccessfulProcess,
  runBoundedProcess,
  type BoundedProcessResult,
} from '../process.ts'

export const GENERATED_TASK_REVISION = 'generated-v1'
export const GENERATED_TASK_IDS = ['parser-repair', 'state-cache', 'api-persistence'] as const

export type GeneratedTaskId = typeof GENERATED_TASK_IDS[number]

export interface GeneratedTaskInstance {
  id: GeneratedTaskId
  revision: typeof GENERATED_TASK_REVISION
  seed: string
  prompt: string
  promptHash: string
  taskFingerprint: string
  workspace: string
  publicSmokeCommand: readonly string[]
  hiddenGradeCommand: readonly string[]
  materializeHiddenGrader(): Promise<void>
  cleanup(): Promise<void>
}

export interface GraderRun {
  command: readonly string[]
  exitCode: number | null
  stdout: string
  stderr: string
  summary: string
  passed: boolean
  timedOut: boolean
  durationMs: number
}

interface TaskDefinition {
  id: GeneratedTaskId
  publicFiles(seed: string): Record<string, string>
  hiddenFiles(seed: string): Record<string, string>
  fixedFiles(seed: string): Record<string, string>
  prompt(seed: string): string
}

function variant(seed: string, prefix: string): string {
  return `${prefix}${sha256Text(`${prefix}:${seed}`).slice(0, 8)}`
}

function packageJson(name: string): string {
  return `${
    JSON.stringify(
      {
        name,
        private: true,
        scripts: { grade: 'node .hidden/grader.js', smoke: 'node test/smoke.test.js' },
        version: '1.0.0',
      },
      null,
      2,
    )
  }\n`
}

function parserPublicFiles(seed: string): Record<string, string> {
  const name = variant(seed, 'service_')
  return {
    'README.md':
      `# Parser repair\n\nFix src/config-parser.js so config text with comments, quotes, and typed values parses correctly.\n`,
    'package.json': packageJson('quality-parser-repair'),
    'src/config-parser.js':
      `function parseConfig(text) {\n  const result = {};\n  for (const line of text.split('\\n')) {\n    if (!line.trim() || line.trim().startsWith('#')) continue;\n    const [key, value] = line.split('=');\n    result[key.trim()] = value.trim();\n  }\n  return result;\n}\n\nmodule.exports = { parseConfig };\n`,
    'test/smoke.test.js':
      `const assert = require('node:assert/strict');\nconst { parseConfig } = require('../src/config-parser.js');\nconst parsed = parseConfig('name=${name}\\ncount=2\\nenabled=true');\nassert.equal(parsed.name, '${name}');\nassert.equal(parsed.count, 2);\nassert.equal(parsed.enabled, true);\n`,
  }
}

function parserHiddenFiles(seed: string): Record<string, string> {
  const quoted = variant(seed, 'quoted-')
  return {
    '.hidden/grader.js':
      `const assert = require('node:assert/strict');\nconst { parseConfig } = require('../src/config-parser.js');\nconst text = '# generated hidden case\\n title = "${quoted}" \\n retries = 5 # inline comment\\n empty = \\n enabled = false\\n ratio = 2.5';\nconst parsed = parseConfig(text);\nassert.deepEqual(parsed, { title: '${quoted}', retries: 5, empty: '', enabled: false, ratio: 2.5 });\nconsole.log(JSON.stringify({ passed: true, summary: 'parser handles comments, quotes, booleans, numbers, and empty values' }));\n`,
  }
}

function parserFixedFiles(): Record<string, string> {
  return {
    'src/config-parser.js':
      `function stripInlineComment(value) {\n  let quoted = false;\n  let output = '';\n  for (const char of value) {\n    if (char === '"') quoted = !quoted;\n    if (char === '#' && !quoted) break;\n    output += char;\n  }\n  return output.trim();\n}\n\nfunction coerceValue(raw) {\n  const value = stripInlineComment(raw);\n  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);\n  if (value === 'true') return true;\n  if (value === 'false') return false;\n  if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) return Number(value);\n  return value;\n}\n\nfunction parseConfig(text) {\n  const result = {};\n  for (const rawLine of text.split('\\n')) {\n    const line = rawLine.trim();\n    if (!line || line.startsWith('#')) continue;\n    const separator = line.indexOf('=');\n    if (separator === -1) continue;\n    const key = line.slice(0, separator).trim();\n    result[key] = coerceValue(line.slice(separator + 1));\n  }\n  return result;\n}\n\nmodule.exports = { parseConfig };\n`,
  }
}

function statePublicFiles(seed: string): Record<string, string> {
  const key = variant(seed, 'item_')
  return {
    'README.md':
      `# State cache\n\nFix src/state-cache.js so cached totals reconcile after updates.\n`,
    'package.json': packageJson('quality-state-cache'),
    'src/state-cache.js':
      `class StateCache {\n  constructor() {\n    this.items = new Map();\n    this.cachedTotal = null;\n  }\n\n  set(id, value) {\n    this.items.set(id, value);\n  }\n\n  delete(id) {\n    this.items.delete(id);\n  }\n\n  total() {\n    if (this.cachedTotal !== null) return this.cachedTotal;\n    this.cachedTotal = [...this.items.values()].reduce((sum, value) => sum + value, 0);\n    return this.cachedTotal;\n  }\n}\n\nmodule.exports = { StateCache };\n`,
    'test/smoke.test.js':
      `const assert = require('node:assert/strict');\nconst { StateCache } = require('../src/state-cache.js');\nconst cache = new StateCache();\ncache.set('${key}', 2);\nassert.equal(cache.total(), 2);\ncache.set('${key}', 5);\nassert.equal(cache.total(), 5);\n`,
  }
}

function stateHiddenFiles(seed: string): Record<string, string> {
  const key = variant(seed, 'hidden_')
  return {
    '.hidden/grader.js':
      `const assert = require('node:assert/strict');\nconst { StateCache } = require('../src/state-cache.js');\nconst cache = new StateCache();\ncache.set('${key}', 3);\ncache.set('other', 4);\nassert.equal(cache.total(), 7);\ncache.delete('${key}');\nassert.equal(cache.total(), 4);\ncache.set('other', -1);\nassert.equal(cache.total(), -1);\nconsole.log(JSON.stringify({ passed: true, summary: 'cache invalidates on set, delete, and replacement' }));\n`,
  }
}

function stateFixedFiles(): Record<string, string> {
  return {
    'src/state-cache.js':
      `class StateCache {\n  constructor() {\n    this.items = new Map();\n    this.cachedTotal = null;\n  }\n\n  invalidate() {\n    this.cachedTotal = null;\n  }\n\n  set(id, value) {\n    this.items.set(id, value);\n    this.invalidate();\n  }\n\n  delete(id) {\n    const deleted = this.items.delete(id);\n    if (deleted) this.invalidate();\n  }\n\n  total() {\n    if (this.cachedTotal !== null) return this.cachedTotal;\n    this.cachedTotal = [...this.items.values()].reduce((sum, value) => sum + value, 0);\n    return this.cachedTotal;\n  }\n}\n\nmodule.exports = { StateCache };\n`,
  }
}

function apiPublicFiles(seed: string): Record<string, string> {
  const user = variant(seed, 'user_')
  return {
    'README.md':
      `# API persistence\n\nFix the multi-file user API so created users are durable and duplicate names are rejected.\n`,
    'package.json': packageJson('quality-api-persistence'),
    'src/api.js':
      `const { JsonStore } = require('./store.js');\n\nclass UserApi {\n  constructor(path) {\n    this.store = new JsonStore(path);\n  }\n\n  async createUser(name) {\n    const users = await this.store.read();\n    const user = { id: String(users.length + 1), name };\n    users.push(user);\n    return user;\n  }\n\n  async listUsers() {\n    return this.store.read();\n  }\n}\n\nmodule.exports = { UserApi };\n`,
    'src/store.js':
      `const fs = require('node:fs/promises');\n\nclass JsonStore {\n  constructor(path) {\n    this.path = path;\n  }\n\n  async read() {\n    try {\n      return JSON.parse(await fs.readFile(this.path, 'utf8'));\n    } catch {\n      return [];\n    }\n  }\n\n  async write(value) {\n    await fs.writeFile(this.path, JSON.stringify(value, null, 2));\n  }\n}\n\nmodule.exports = { JsonStore };\n`,
    'test/smoke.test.js':
      `const assert = require('node:assert/strict');\nconst { mkdtemp } = require('node:fs/promises');\nconst { join } = require('node:path');\nconst { tmpdir } = require('node:os');\nconst { UserApi } = require('../src/api.js');\n(async () => {\n  const dir = await mkdtemp(join(tmpdir(), 'quality-api-smoke-'));\n  const file = join(dir, 'users.json');\n  const api = new UserApi(file);\n  await api.createUser('${user}');\n  const reopened = new UserApi(file);\n  assert.deepEqual(await reopened.listUsers(), [{ id: '1', name: '${user}' }]);\n})();\n`,
  }
}

function apiHiddenFiles(seed: string): Record<string, string> {
  const one = variant(seed, 'alice_')
  const two = variant(seed, 'bob_')
  return {
    '.hidden/grader.js':
      `const assert = require('node:assert/strict');\nconst { mkdtemp } = require('node:fs/promises');\nconst { join } = require('node:path');\nconst { tmpdir } = require('node:os');\nconst { UserApi } = require('../src/api.js');\n(async () => {\n  const dir = await mkdtemp(join(tmpdir(), 'quality-api-hidden-'));\n  const file = join(dir, 'users.json');\n  const api = new UserApi(file);\n  assert.deepEqual(await api.createUser('${one}'), { id: '1', name: '${one}' });\n  assert.deepEqual(await api.createUser('${two}'), { id: '2', name: '${two}' });\n  await assert.rejects(() => api.createUser('${one}'), /duplicate/i);\n  const reopened = new UserApi(file);\n  assert.deepEqual(await reopened.listUsers(), [{ id: '1', name: '${one}' }, { id: '2', name: '${two}' }]);\n  console.log(JSON.stringify({ passed: true, summary: 'API persists users across instances and rejects duplicates' }));\n})();\n`,
  }
}

function apiFixedFiles(): Record<string, string> {
  return {
    'src/api.js':
      `const { JsonStore } = require('./store.js');\n\nclass UserApi {\n  constructor(path) {\n    this.store = new JsonStore(path);\n  }\n\n  async createUser(name) {\n    const users = await this.store.read();\n    if (users.some((user) => user.name === name)) throw new Error(\`duplicate user: \${name}\`);\n    const user = { id: String(users.length + 1), name };\n    users.push(user);\n    await this.store.write(users);\n    return user;\n  }\n\n  async listUsers() {\n    return this.store.read();\n  }\n}\n\nmodule.exports = { UserApi };\n`,
    'src/store.js':
      `const fs = require('node:fs/promises');\nconst path = require('node:path');\n\nclass JsonStore {\n  constructor(filePath) {\n    this.path = filePath;\n  }\n\n  async read() {\n    try {\n      return JSON.parse(await fs.readFile(this.path, 'utf8'));\n    } catch (error) {\n      if (error && error.code === 'ENOENT') return [];\n      throw error;\n    }\n  }\n\n  async write(value) {\n    await fs.mkdir(path.dirname(this.path), { recursive: true });\n    await fs.writeFile(this.path, JSON.stringify(value, null, 2));\n  }\n}\n\nmodule.exports = { JsonStore };\n`,
  }
}

const definitions: Record<GeneratedTaskId, TaskDefinition> = {
  'api-persistence': {
    fixedFiles: apiFixedFiles,
    hiddenFiles: apiHiddenFiles,
    id: 'api-persistence',
    prompt: (seed) =>
      `Fix the generated API persistence task for seed ${seed}. Run npm run smoke before finishing.`,
    publicFiles: apiPublicFiles,
  },
  'parser-repair': {
    fixedFiles: parserFixedFiles,
    hiddenFiles: parserHiddenFiles,
    id: 'parser-repair',
    prompt: (seed) =>
      `Fix the generated parser task for seed ${seed}. Run npm run smoke before finishing.`,
    publicFiles: parserPublicFiles,
  },
  'state-cache': {
    fixedFiles: stateFixedFiles,
    hiddenFiles: stateHiddenFiles,
    id: 'state-cache',
    prompt: (seed) =>
      `Fix the generated state-cache task for seed ${seed}. Run npm run smoke before finishing.`,
    publicFiles: statePublicFiles,
  },
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = join(root, relativePath)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, content, { mode: 0o600 })
  }
}

async function initializeGitRepository(root: string): Promise<void> {
  await assertSuccessfulProcess('git', ['init', '-q'], { cwd: root, timeoutMs: 10_000 })
  await assertSuccessfulProcess('git', ['add', '.'], { cwd: root, timeoutMs: 10_000 })
  await assertSuccessfulProcess(
    'git',
    [
      '-c',
      'user.name=Quality Eval',
      '-c',
      'user.email=quality@example.invalid',
      'commit',
      '-q',
      '-m',
      'Seed generated task',
    ],
    { cwd: root, timeoutMs: 10_000 },
  )
}

export function isGeneratedTaskId(value: string): value is GeneratedTaskId {
  return GENERATED_TASK_IDS.includes(value as GeneratedTaskId)
}

export function generatedTaskFingerprint(id: GeneratedTaskId, seed: string): string {
  const definition = definitions[id]
  return fingerprintJson(
    {
      hidden: Object.fromEntries(
        Object.entries(definition.hiddenFiles(seed)).map((
          [path, content],
        ) => [path, sha256Text(content)]),
      ),
      id,
      public: Object.fromEntries(
        Object.entries(definition.publicFiles(seed)).map((
          [path, content],
        ) => [path, sha256Text(content)]),
      ),
      revision: GENERATED_TASK_REVISION,
      seed,
    } satisfies FingerprintJson,
  )
}

export function generatedTaskPrompt(id: GeneratedTaskId, seed: string): string {
  return definitions[id].prompt(seed)
}

export async function createGeneratedTaskRepository(
  id: GeneratedTaskId,
  seed: string,
  workspaceRoot = tmpdir(),
): Promise<GeneratedTaskInstance> {
  const definition = definitions[id]
  const workspace = await mkdtemp(join(workspaceRoot, `quality-${id}-${seed}-`))
  await writeFiles(workspace, definition.publicFiles(seed))
  await initializeGitRepository(workspace)
  const prompt = generatedTaskPrompt(id, seed)
  return {
    cleanup: () => rm(workspace, { force: true, recursive: true }),
    hiddenGradeCommand: ['npm', 'run', 'grade'],
    id,
    materializeHiddenGrader: () => writeFiles(workspace, definition.hiddenFiles(seed)),
    prompt,
    promptHash: sha256Text(prompt),
    publicSmokeCommand: ['npm', 'run', 'smoke'],
    revision: GENERATED_TASK_REVISION,
    seed,
    taskFingerprint: generatedTaskFingerprint(id, seed),
    workspace,
  }
}

export async function applyGeneratedTaskFakeRepair(instance: GeneratedTaskInstance): Promise<void> {
  await writeFiles(instance.workspace, definitions[instance.id].fixedFiles(instance.seed))
}

export async function runTaskCommand(
  workspace: string,
  command: readonly string[],
  timeoutMs = 30_000,
): Promise<GraderRun> {
  const [executable, ...args] = command
  const result = await runBoundedProcess(executable, args, { cwd: workspace, timeoutMs })
  return processResult(command, result)
}

export async function runGeneratedTaskPublicSmoke(
  instance: GeneratedTaskInstance,
): Promise<GraderRun> {
  return runTaskCommand(instance.workspace, instance.publicSmokeCommand)
}

export async function runGeneratedTaskHiddenGrader(
  instance: GeneratedTaskInstance,
): Promise<GraderRun> {
  await instance.materializeHiddenGrader()
  return runTaskCommand(instance.workspace, instance.hiddenGradeCommand)
}

export async function fingerprintGeneratedTaskWorkspace(
  instance: GeneratedTaskInstance,
): Promise<string> {
  return fingerprintDirectory(instance.workspace)
}

function processResult(command: readonly string[], result: BoundedProcessResult): GraderRun {
  const parsedSummary = parseGraderSummary(result.stdout)
  return {
    command,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    passed: !result.timedOut && result.exitCode === 0,
    stderr: result.stderr,
    stdout: result.stdout,
    summary: parsedSummary
      ?? (result.exitCode === 0
        ? 'grader passed'
        : result.stderr || result.stdout || 'grader failed'),
    timedOut: result.timedOut,
  }
}

function parseGraderSummary(stdout: string): string | null {
  const lastLine = stdout.trim().split('\n').at(-1)
  if (!lastLine) return null
  try {
    const value: unknown = JSON.parse(lastLine)
    if (typeof value === 'object' && value !== null && 'summary' in value) {
      const summary = (value as { summary?: unknown }).summary
      return typeof summary === 'string' ? summary : null
    }
  } catch {
    return null
  }
  return null
}
