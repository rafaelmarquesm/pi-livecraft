#!/usr/bin/env node
import process from 'node:process'
import {
  assertValidatedWorkPerformanceBudgets,
  measureRealPiResources,
  measureReviewPacketPerformance,
  measureValidatedWorkCorePerformance,
  unsupportedValidatedWorkMeasurements,
  validatedWorkPerformanceBudgets,
} from './validated-work-performance.ts'

async function main(): Promise<void> {
  const authoritativeEnvironment = process.platform === 'linux'
    && process.versions.node.startsWith('24.')
  if (!authoritativeEnvironment) {
    console.warn(
      `Warning: validated-work timing budgets are authoritative after stabilization in CI Node 24/Linux. Running on ${process.platform} Node ${process.versions.node}.`,
    )
  }
  const core = measureValidatedWorkCorePerformance()
  assertValidatedWorkPerformanceBudgets(core)
  const review = await measureReviewPacketPerformance()
  if (review.bytes > validatedWorkPerformanceBudgets.reviewPacketBytes) {
    throw new Error(
      `review packet ${review.bytes} bytes > ${validatedWorkPerformanceBudgets.reviewPacketBytes} bytes`,
    )
  }

  console.log('Validated Work performance matrix')
  console.log('')
  console.log('| Measurement | Result | Budget | Status |')
  console.log('|---|---:|---:|---|')
  row('no-op extension handler p95', `${core.noopHandlerP95Ms.toFixed(6)} ms`, '< 1 ms', true)
  row(
    `cold state extraction (${core.extractionEntries} entries, median of 7)`,
    `${core.coldExtractionMs.toFixed(3)} ms`,
    '< 25 ms',
    true,
  )
  row(
    'incremental extraction p95 (warmed 5,001-entry branch)',
    `${core.incrementalExtractionP95Ms.toFixed(3)} ms`,
    '< 10 ms',
    true,
  )
  row('summary payload', `${core.summaryBytes} bytes`, '≤ 2,048 bytes', true)
  row('full state response', `${core.fullStatePayloadBytes} bytes`, '≤ 131,072 bytes', true)
  row(
    'aggregate heap per active quality state',
    core.qualityStateHeapBytes === null
      ? 'unsupported (run with --expose-gc)'
      : `${(core.qualityStateHeapBytes / 1024).toFixed(1)} KiB`,
    '< 1 MiB',
    core.qualityStateHeapBytes === null
      || core.qualityStateHeapBytes <= validatedWorkPerformanceBudgets.qualityStateHeapBytes,
  )
  row('review packet', `${review.bytes} bytes`, '≤ 98,304 bytes', true)
  row('review packet build', `${review.buildMs.toFixed(1)} ms`, 'measurement only', true)

  if (!process.argv.includes('--skip-real-pi')) {
    console.log('')
    console.log('Real offline Pi RPC resource matrix')
    const realPi = await measureRealPiResources()
    if (!realPi.supported) {
      console.log(`UNSUPPORTED: ${realPi.reason}`)
    } else {
      console.log(
        '| Sessions | Ready p95 | Aggregate RSS | RSS/session | Aggregate PSS | PSS/session |',
      )
      console.log('|---:|---:|---:|---:|---:|---:|')
      for (const measurement of realPi.measurements) {
        console.log(
          `| ${measurement.sessions} | ${measurement.readyP95Ms.toFixed(1)} ms | ${
            measurement.rssMiB.toFixed(1)
          } MiB | ${measurement.rssPerSessionMiB.toFixed(1)} MiB | ${
            formatMiB(measurement.pssMiB)
          } | ${formatMiB(measurement.pssPerSessionMiB)} |`,
        )
      }
      if (!realPi.pssSupported) {
        console.log(
          'PSS is unsupported on this host because /proc/<pid>/smaps_rollup is unavailable.',
        )
      }
    }
  } else {
    console.log('')
    console.log('Real Pi RSS/PSS matrix skipped by --skip-real-pi.')
  }

  console.log('')
  console.log('Unsupported or intentionally unclaimed measurements')
  for (const measurement of unsupportedValidatedWorkMeasurements) console.log(`- ${measurement}`)
}

function row(label: string, result: string, budget: string, passed: boolean): void {
  console.log(`| ${label} | ${result} | ${budget} | ${passed ? 'PASS' : 'FAIL'} |`)
}

function formatMiB(value: number | null): string {
  return value === null ? 'unsupported' : `${value.toFixed(1)} MiB`
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
