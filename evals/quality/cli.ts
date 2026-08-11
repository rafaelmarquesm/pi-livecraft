import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { parseQualityArtifactText, readQualityArtifact } from './artifact-schema.ts'
import {
  compareQualityArtifacts,
  renderComparisonJson,
  renderComparisonMarkdown,
} from './compare.ts'
import { createFakeQualityDriver } from './drivers/fake.ts'
import { createLivecraftQualityDriver } from './drivers/livecraft.ts'
import { createPiDirectQualityDriver } from './drivers/pi-direct.ts'
import {
  assertSafeIdentifier,
  resolveInsideRoot,
  sha256Text,
  stableStringify,
  type FingerprintJson,
} from './fingerprint.ts'
import { parseQualityArm, readQualityManifest, type QualityManifest } from './manifest.ts'
import { runBoundedProcess } from './process.ts'
import { runQualityCampaign, type QualityDriver } from './runner.ts'
import {
  GENERATED_TASK_IDS,
  GENERATED_TASK_REVISION,
  generatedTaskFingerprint,
  generatedTaskPrompt,
  isGeneratedTaskId,
  type GeneratedTaskId,
} from './tasks/generated.ts'

function argValue(args: readonly string[], name: string, fallback: string | null = null): string {
  const index = args.indexOf(name)
  if (index === -1) {
    if (fallback !== null) return fallback
    throw new Error(`Missing ${name}`)
  }
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return value
}

function hasArg(args: readonly string[], name: string): boolean {
  return args.includes(name)
}

function optionalArg(args: readonly string[], name: string): string | null {
  return hasArg(args, name) ? argValue(args, name) : null
}

function integerArg(args: readonly string[], name: string, fallback: number): number {
  const raw = argValue(args, name, String(fallback))
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function numberArg(args: readonly string[], name: string, fallback: number): number {
  const raw = argValue(args, name, String(fallback))
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
  return value
}

function csvArgs(args: readonly string[], name: string): string[] {
  const raw = argValue(args, name)
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (values.length === 0) throw new Error(`${name} must contain at least one value`)
  return values
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function manifestOutputPath(resultsRoot: string, campaignId: string): string {
  return resolveInsideRoot(resultsRoot, `${campaignId}/manifest.json`)
}

function artifactOutputPath(resultsRoot: string, campaignId: string): string {
  return resolveInsideRoot(resultsRoot, `${campaignId}/artifact.json`)
}

function summaryOutputPath(resultsRoot: string, campaignId: string): string {
  return resolveInsideRoot(resultsRoot, `${campaignId}/summary.md`)
}

export interface GeneratedCampaignManifestOptions {
  arms: readonly string[]
  attempts: number
  campaignId: string
  maxCostUsd: number
  maxTimeMs: number
  maxTurns: number
  requested: QualityManifest['requested']
  tasks: readonly string[]
}

function slugForCellId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/g, '-')
}

async function currentGitRevision(cwd = process.cwd()): Promise<string> {
  const result = await runBoundedProcess('git', ['rev-parse', 'HEAD'], { cwd, timeoutMs: 5_000 })
  return result.exitCode === 0 ? result.stdout.trim() || 'unknown' : 'unknown'
}

async function currentPiMetadata(executable: string | null): Promise<QualityManifest['pi']> {
  if (executable === null) return { executableSha256: sha256Text('missing-pi'), version: 'unknown' }
  const version = await runBoundedProcess(executable, ['--version'], { timeoutMs: 5_000 })
  return {
    executableSha256: sha256Text(executable),
    version: version.exitCode === 0 ? version.stdout.trim() || executable : executable,
  }
}

function parseGeneratedTaskIds(values: readonly string[]): GeneratedTaskId[] {
  return values.map((value) => {
    if (!isGeneratedTaskId(value)) {
      throw new Error(
        `Unsupported generated task ${value}. Expected one of: ${GENERATED_TASK_IDS.join(', ')}`,
      )
    }
    return value
  })
}

export async function buildGeneratedCampaignManifest(
  options: GeneratedCampaignManifestOptions,
): Promise<QualityManifest> {
  const createdAt = new Date().toISOString()
  const tasks = parseGeneratedTaskIds(uniqueValues(options.tasks))
  const arms = uniqueValues(options.arms).map((value) => parseQualityArm(value))
  const cells = tasks.flatMap((taskId) => {
    const seed = 'seed1'
    const prompt = generatedTaskPrompt(taskId, seed)
    const taskFingerprint = generatedTaskFingerprint(taskId, seed)
    return arms.map((arm) => ({
      arm,
      attempts: options.attempts,
      id: `${slugForCellId(arm)}-${taskId}-${seed}`,
      promptHash: sha256Text(prompt),
      seed,
      taskFingerprint,
      taskId,
      taskRevision: GENERATED_TASK_REVISION,
    }))
  })
  return {
    campaignId: assertSafeIdentifier(options.campaignId, 'campaign id'),
    cells,
    environment: { arch: process.arch, node: process.version, os: process.platform },
    limits: {
      maxCostUsd: options.maxCostUsd,
      maxTimeMs: options.maxTimeMs,
      maxTurns: options.maxTurns,
    },
    livecraftRevision: await currentGitRevision(),
    observed: { ...options.requested },
    pi: await currentPiMetadata(options.requested.provider === 'fake' ? null : 'pi'),
    requested: { ...options.requested },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt, updatedAt: createdAt },
    validatedWork: {
      mode: arms.some((arm) => arm.includes('validated')) ? 'validated' : 'standard',
    },
    version: 1,
  }
}

async function writeCampaignFiles(
  resultsRoot: string,
  manifest: QualityManifest,
  artifact: unknown,
  summaryMarkdown: string,
): Promise<{ artifactPath: string; manifestPath: string; summaryPath: string }> {
  const manifestPath = manifestOutputPath(resultsRoot, manifest.campaignId)
  const artifactPath = artifactOutputPath(resultsRoot, manifest.campaignId)
  const summaryPath = summaryOutputPath(resultsRoot, manifest.campaignId)
  await mkdir(dirname(artifactPath), { recursive: true })
  await writeFile(manifestPath, `${stableStringify(manifest as unknown as FingerprintJson)}\n`, {
    mode: 0o600,
  })
  await writeFile(artifactPath, `${stableStringify(artifact as FingerprintJson)}\n`, {
    mode: 0o600,
  })
  await writeFile(summaryPath, summaryMarkdown, { mode: 0o600 })
  return { artifactPath, manifestPath, summaryPath }
}

function driverFromArgs(args: readonly string[]): QualityDriver {
  const driver = argValue(args, '--driver', 'fake')
  if (driver === 'fake') return createFakeQualityDriver()
  if (driver === 'livecraft') {
    return createLivecraftQualityDriver({
      baseUrl: optionalArg(args, '--base-url') ?? undefined,
    })
  }
  if (driver === 'pi-direct') {
    return createPiDirectQualityDriver({
      executable: optionalArg(args, '--pi-executable') ?? undefined,
    })
  }
  throw new Error('Usage: --driver must be one of fake, livecraft, pi-direct')
}

function sampleManifest(campaignId: string): QualityManifest {
  const createdAt = '2026-01-01T00:00:00.000Z'
  const base = {
    environment: { arch: process.arch, node: process.version, os: process.platform },
    livecraftRevision: 'offline-fake',
    observed: { model: 'fake-model', provider: 'fake', thinking: 'none' },
    pi: { executableSha256: sha256Text('fake-pi'), version: 'fake' },
    requested: { model: 'fake-model', provider: 'fake', thinking: 'none' },
  }
  const cells = GENERATED_TASK_IDS.flatMap((taskId) => {
    const seed = 'seed1'
    const prompt = generatedTaskPrompt(taskId, seed)
    const taskFingerprint = generatedTaskFingerprint(taskId, seed)
    return [
      {
        arm: 'livecraft-standard' as const,
        attempts: 3,
        id: `standard-${taskId}-seed1`,
        promptHash: sha256Text(prompt),
        seed,
        taskFingerprint,
        taskId,
        taskRevision: GENERATED_TASK_REVISION,
      },
      {
        arm: 'livecraft-validated' as const,
        attempts: 3,
        id: `validated-${taskId}-seed1`,
        promptHash: sha256Text(prompt),
        seed,
        taskFingerprint,
        taskId,
        taskRevision: GENERATED_TASK_REVISION,
      },
    ]
  })
  return {
    ...base,
    campaignId,
    cells,
    limits: { maxCostUsd: 1, maxTimeMs: 60_000, maxTurns: 4 },
    resources: { concurrency: 1 },
    review: {},
    timestamps: { createdAt, updatedAt: createdAt },
    validatedWork: { mode: 'fake' },
    version: 1,
  }
}

async function commandFake(args: readonly string[]): Promise<void> {
  const root = argValue(args, '--results-root', 'evals/quality/results')
  const campaignId = assertSafeIdentifier(
    argValue(args, '--campaign-id', 'offline-fake'),
    'campaign id',
  )
  const manifestPath = hasArg(args, '--manifest') ? argValue(args, '--manifest') : null
  const manifest = manifestPath === null
    ? sampleManifest(campaignId)
    : await readQualityManifest(manifestPath)
  const result = await runQualityCampaign(manifest, createFakeQualityDriver())
  const outputPath = resolveInsideRoot(root, `${manifest.campaignId}/artifact.json`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${stableStringify(result.artifact as unknown as FingerprintJson)}\n`,
    { mode: 0o600 },
  )
  process.stdout.write(`${relative(process.cwd(), outputPath)}\n`)
}

async function commandRun(args: readonly string[]): Promise<void> {
  const root = argValue(args, '--results-root', 'evals/quality/results')
  const manifestPath = optionalArg(args, '--manifest')
  const manifest = manifestPath === null
    ? await buildGeneratedCampaignManifest({
      arms: csvArgs(args, '--arms'),
      attempts: integerArg(args, '--k', 3),
      campaignId: assertSafeIdentifier(argValue(args, '--campaign-id'), 'campaign id'),
      maxCostUsd: numberArg(args, '--budget-usd', 1),
      maxTimeMs: integerArg(args, '--max-time-ms', 300_000),
      maxTurns: integerArg(args, '--max-turns', 4),
      requested: {
        model: argValue(args, '--model'),
        provider: argValue(args, '--provider'),
        thinking: argValue(args, '--thinking'),
      },
      tasks: csvArgs(args, '--tasks'),
    })
    : await readQualityManifest(manifestPath)
  const result = await runQualityCampaign(manifest, driverFromArgs(args))
  const report = compareQualityArtifacts([result.artifact], integerArg(args, '--k', 3))
  const paths = await writeCampaignFiles(
    root,
    manifest,
    result.artifact as unknown as FingerprintJson,
    renderComparisonMarkdown(report),
  )
  process.stdout.write(`${relative(process.cwd(), paths.artifactPath)}\n`)
}

async function commandCompare(args: readonly string[]): Promise<void> {
  const k = Number.parseInt(argValue(args, '--k', '3'), 10)
  const format = argValue(args, '--format', 'markdown')
  const paths = args.filter((arg) =>
    !arg.startsWith('--') && arg !== 'compare' && !['markdown', 'json', String(k)].includes(arg)
  )
  const artifacts = paths.length === 0
    ? [parseQualityArtifactText(
      await new Promise<string>((resolve) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => data += chunk)
        process.stdin.on('end', () => resolve(data))
      }),
    )]
    : await Promise.all(paths.map((path) => readQualityArtifact(path)))
  const report = compareQualityArtifacts(artifacts, k)
  process.stdout.write(
    format === 'json' ? renderComparisonJson(report) : renderComparisonMarkdown(report),
  )
}

async function commandValidate(args: readonly string[]): Promise<void> {
  const path = argValue(args, '--artifact')
  parseQualityArtifactText(await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8')))
  process.stdout.write('artifact valid\n')
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'fake') return commandFake(args)
  if (command === 'run') return commandRun(args)
  if (command === 'compare') return commandCompare([command, ...args])
  if (command === 'validate') return commandValidate(args)
  throw new Error('Usage: cli.ts fake|run|compare|validate')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
