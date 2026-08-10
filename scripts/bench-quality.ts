import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function runQualityCli(args: readonly string[]): Promise<string> {
  const { stderr, stdout } = await execFileAsync(
    process.execPath,
    ['evals/quality/cli.ts', ...args],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
  )
  if (stderr.trim()) process.stderr.write(stderr)
  return stdout
}

async function main(): Promise<void> {
  const resultsRoot = process.env.PI_LIVECRAFT_BENCH_QUALITY_RESULTS_ROOT
    ?? await mkdtemp(join(tmpdir(), 'pi-livecraft-quality-'))
  const campaignId = 'offline-fake'
  const fakeOutput = await runQualityCli([
    'fake',
    '--campaign-id',
    campaignId,
    '--results-root',
    resultsRoot,
  ])
  const artifactRelativePath = fakeOutput.trim().split('\n').at(-1)
  if (!artifactRelativePath) throw new Error('Quality fake campaign did not print an artifact path')
  const artifactPath = resolve(process.cwd(), artifactRelativePath)

  await runQualityCli(['validate', '--artifact', artifactPath])
  const report = await runQualityCli(['compare', '--k', '3', '--format', 'markdown', artifactPath])
  process.stdout.write(`Quality benchmark results root: ${resultsRoot}\n\n${report}`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
