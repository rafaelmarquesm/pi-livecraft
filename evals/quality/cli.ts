import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { parseQualityArtifactText, readQualityArtifact } from './artifact-schema.ts'
import {
  compareQualityArtifacts,
  renderComparisonJson,
  renderComparisonMarkdown,
} from './compare.ts'
import { createFakeQualityDriver } from './drivers/fake.ts'
import {
  assertSafeIdentifier,
  resolveInsideRoot,
  sha256Text,
  stableStringify,
  type FingerprintJson,
} from './fingerprint.ts'
import { readQualityManifest, type QualityManifest } from './manifest.ts'
import { runQualityCampaign } from './runner.ts'

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

function sampleManifest(campaignId: string): QualityManifest {
  const createdAt = '2026-01-01T00:00:00.000Z'
  const base = {
    environment: { arch: process.arch, node: process.version, os: process.platform },
    livecraftRevision: 'offline-fake',
    observed: { model: 'fake-model', provider: 'fake', thinking: 'none' },
    pi: { executableSha256: sha256Text('fake-pi'), version: 'fake' },
    requested: { model: 'fake-model', provider: 'fake', thinking: 'none' },
  }
  return {
    ...base,
    campaignId,
    cells: [
      {
        arm: 'livecraft-standard',
        attempts: 3,
        id: 'standard-parser-seed1',
        promptHash: sha256Text('parser-repair'),
        seed: 'seed1',
        taskId: 'parser-repair',
        taskRevision: 'fake-v1',
      },
      {
        arm: 'livecraft-validated',
        attempts: 3,
        id: 'validated-parser-seed1',
        promptHash: sha256Text('parser-repair'),
        seed: 'seed1',
        taskId: 'parser-repair',
        taskRevision: 'fake-v1',
      },
    ],
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
  if (command === 'compare') return commandCompare([command, ...args])
  if (command === 'validate') return commandValidate(args)
  throw new Error('Usage: cli.ts fake|compare|validate')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
