import type { QualityArtifact, QualityTrial } from './artifact-schema.ts'
import type { QualityArm } from './manifest.ts'
import {
  bootstrapMeanCi,
  costPerSuccess,
  invalidReasonCounts,
  mean,
  median,
  passAt1,
  passAtK,
  sampleStandardDeviation,
  timeToFirstPass,
  wilsonInterval,
} from './statistics.ts'

export interface ArmSummary {
  arm: QualityArm
  totalTrials: number
  validTrials: number
  invalidTrials: number
  successes: number
  passAt1: number | null
  passAtK: number | null
  wilson: { lower: number; upper: number; center: number } | null
  costPerSuccess: number | null
  timeToFirstPassMs: number | null
  score: {
    mean: number | null
    median: number | null
    sampleSd: number
    bootstrapMeanCi: { lower: number; upper: number; confidence: number; iterations: number } | null
  }
  invalidReasons: Record<string, number>
  rawTrialIds: string[]
}

export interface ComparisonReport {
  generatedAt: string
  k: number
  summaries: ArmSummary[]
  warning: string | null
}

function groupByArm(trials: readonly QualityTrial[]): Map<QualityArm, QualityTrial[]> {
  const groups = new Map<QualityArm, QualityTrial[]>()
  for (const trial of trials) {
    const trialsForArm = groups.get(trial.arm) ?? []
    trialsForArm.push(trial)
    groups.set(trial.arm, trialsForArm)
  }
  return groups
}

function mapToObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

export function summarizeTrialsByArm(
  trials: readonly QualityTrial[],
  k: number,
  bootstrapSeed = 12345,
): ArmSummary[] {
  return [...groupByArm(trials).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([arm, armTrials]) => {
      const valid = armTrials.filter((trial) => trial.valid)
      const successes = valid.filter((trial) => trial.passed).length
      const scores = valid.map((trial) => trial.score).filter((score): score is number =>
        score !== null
      )
      return {
        arm,
        costPerSuccess: costPerSuccess(armTrials),
        invalidReasons: mapToObject(invalidReasonCounts(armTrials)),
        invalidTrials: armTrials.length - valid.length,
        passAt1: valid.length === 0 ? null : passAt1(valid.length, successes),
        passAtK: valid.length === 0 || k > valid.length
          ? null
          : passAtK(valid.length, successes, k),
        rawTrialIds: armTrials.map((trial) => trial.id),
        score: {
          bootstrapMeanCi: scores.length === 0
            ? null
            : bootstrapMeanCi(scores, { confidence: 0.95, iterations: 1000, seed: bootstrapSeed }),
          mean: scores.length === 0 ? null : mean(scores),
          median: scores.length === 0 ? null : median(scores),
          sampleSd: sampleStandardDeviation(scores),
        },
        successes,
        timeToFirstPassMs: timeToFirstPass(armTrials),
        totalTrials: armTrials.length,
        validTrials: valid.length,
        wilson: valid.length === 0 ? null : wilsonInterval(successes, valid.length),
      }
    })
}

export function compareQualityArtifacts(
  artifacts: readonly QualityArtifact[],
  k: number,
): ComparisonReport {
  if (k < 1) throw new Error('Comparison k must be positive')
  const trials = artifacts.flatMap((artifact) => artifact.trials)
  const summaries = summarizeTrialsByArm(trials, k)
  const warning = summaries.some((summary) => summary.validTrials < 3)
    ? 'At least one arm has fewer than 3 valid trials. Do not claim a winner.'
    : null
  return { generatedAt: new Date().toISOString(), k, summaries, warning }
}

function formatNumber(value: number | null, digits = 3): string {
  return value === null ? 'n/a' : value.toFixed(digits)
}

export function renderComparisonMarkdown(report: ComparisonReport): string {
  const lines = ['# Quality comparison', '', `k: ${report.k}`, '']
  if (report.warning !== null) lines.push(`> ${report.warning}`, '')
  lines.push(
    '| Arm | Valid | Invalid | Successes | pass@1 | pass@k | Wilson raw success | Cost/success | First pass ms | Mean score | Median score | SD |',
  )
  lines.push('|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|')
  for (const summary of report.summaries) {
    const wilson = summary.wilson === null
      ? 'n/a'
      : `${summary.wilson.lower.toFixed(3)} to ${summary.wilson.upper.toFixed(3)}`
    lines.push(
      `| ${summary.arm} | ${summary.validTrials} | ${summary.invalidTrials} | ${summary.successes} | ${
        formatNumber(summary.passAt1)
      } | ${formatNumber(summary.passAtK)} | ${wilson} | ${
        formatNumber(summary.costPerSuccess, 4)
      } | ${formatNumber(summary.timeToFirstPassMs, 0)} | ${formatNumber(summary.score.mean)} | ${
        formatNumber(summary.score.median)
      } | ${summary.score.sampleSd.toFixed(3)} |`,
    )
  }
  lines.push('', 'Raw trial IDs are always included in JSON output. Invalid reason counts:', '')
  for (const summary of report.summaries) {
    lines.push(`- ${summary.arm}: ${JSON.stringify(summary.invalidReasons)}`)
  }
  return `${lines.join('\n')}\n`
}

export function renderComparisonJson(report: ComparisonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
