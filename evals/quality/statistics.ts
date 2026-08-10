import type { InvalidReasonCode, QualityTrial } from './artifact-schema.ts'

export interface WilsonInterval {
  lower: number
  upper: number
  center: number
}

export interface BootstrapInterval {
  lower: number
  upper: number
  confidence: number
  iterations: number
}

export interface PairedDelta {
  taskId: string
  seed: string
  left: number
  right: number
  delta: number
}

export interface ProgressCurvePoint {
  elapsedMs: number
  bestPassed: boolean
  bestScore: number | null
}

/** Computes pass@k with 1 - C(n-c,k) / C(n,k), where c is successful trials. */
export function passAtK(total: number, successes: number, k: number): number {
  if (!Number.isInteger(total) || !Number.isInteger(successes) || !Number.isInteger(k))
    throw new Error('pass@k inputs must be integers')
  if (total < 0 || successes < 0 || successes > total) throw new Error('Invalid pass@k counts')
  if (k < 1 || k > total) throw new Error('pass@k requires 1 <= k <= n')
  if (successes === 0) return 0
  if (total - successes < k) return 1

  let miss = 1
  for (let index = 0; index < k; index += 1) {
    miss *= (total - successes - index) / (total - index)
  }
  return 1 - miss
}

export function passAt1(total: number, successes: number): number {
  if (total === 0) throw new Error('pass@1 requires at least one valid trial')
  return successes / total
}

/** Wilson interval over the raw success proportion, not the pass@k estimator. */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.959963984540054,
): WilsonInterval {
  if (
    !Number.isInteger(successes) || !Number.isInteger(total) || total < 1 || successes < 0
    || successes > total
  ) {
    throw new Error('Invalid Wilson interval counts')
  }
  const proportion = successes / total
  const zSquared = z * z
  const denominator = 1 + zSquared / total
  const center = (proportion + zSquared / (2 * total)) / denominator
  const margin = z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)
    / denominator
  return { center, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) }
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean requires at least one value')
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median requires at least one value')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const center = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0)
    / (values.length - 1)
  return Math.sqrt(variance)
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Seeded bootstrap percentile CI for the sample mean. */
export function bootstrapMeanCi(
  values: readonly number[],
  options: { seed: number; iterations: number; confidence: number },
): BootstrapInterval {
  if (values.length === 0) throw new Error('bootstrap requires at least one value')
  if (!Number.isInteger(options.iterations) || options.iterations < 1)
    throw new Error('bootstrap iterations must be positive')
  if (options.confidence <= 0 || options.confidence >= 1)
    throw new Error('bootstrap confidence must be between 0 and 1')

  const random = createPrng(options.seed)
  const estimates: number[] = []
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    let total = 0
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)]
    }
    estimates.push(total / values.length)
  }
  estimates.sort((left, right) => left - right)
  const tail = (1 - options.confidence) / 2
  const lowerIndex = Math.floor(tail * (estimates.length - 1))
  const upperIndex = Math.ceil((1 - tail) * (estimates.length - 1))
  return {
    confidence: options.confidence,
    iterations: options.iterations,
    lower: estimates[lowerIndex],
    upper: estimates[upperIndex],
  }
}

export function costPerSuccess(trials: readonly QualityTrial[]): number | null {
  const valid = trials.filter((trial) => trial.valid)
  const successes = valid.filter((trial) => trial.passed).length
  if (successes === 0) return null
  return valid.reduce((sum, trial) => sum + trial.costUsd, 0) / successes
}

export function timeToFirstPass(trials: readonly QualityTrial[]): number | null {
  const passTimes = trials
    .filter((trial) => trial.valid && trial.passed)
    .map((trial) => trial.timeToPassMs ?? trial.durationMs)
    .sort((left, right) => left - right)
  return passTimes[0] ?? null
}

export function invalidReasonCounts(
  trials: readonly QualityTrial[],
): Map<InvalidReasonCode, number> {
  const counts = new Map<InvalidReasonCode, number>()
  for (const trial of trials) {
    for (const reason of trial.invalidReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
  }
  return counts
}

export function pairedDeltas(
  left: readonly QualityTrial[],
  right: readonly QualityTrial[],
  value: (trial: QualityTrial) => number | null,
): PairedDelta[] {
  const rightByPair = new Map<string, QualityTrial>()
  for (const trial of right) {
    if (!trial.valid) continue
    rightByPair.set(`${trial.taskId}\0${trial.seed}`, trial)
  }

  const deltas: PairedDelta[] = []
  for (const leftTrial of left) {
    if (!leftTrial.valid) continue
    const rightTrial = rightByPair.get(`${leftTrial.taskId}\0${leftTrial.seed}`)
    if (rightTrial === undefined) continue
    const leftValue = value(leftTrial)
    const rightValue = value(rightTrial)
    if (leftValue === null || rightValue === null) continue
    deltas.push({
      delta: rightValue - leftValue,
      left: leftValue,
      right: rightValue,
      seed: leftTrial.seed,
      taskId: leftTrial.taskId,
    })
  }
  return deltas
}

export function progressCurve(trials: readonly QualityTrial[]): ProgressCurvePoint[] {
  const points = trials
    .filter((trial) => trial.valid)
    .flatMap((trial) => trial.progress.map((point) => ({ ...point })))
    .sort((left, right) => left.elapsedMs - right.elapsedMs)

  const curve: ProgressCurvePoint[] = []
  let bestScore: number | null = null
  let bestPassed = false
  for (const point of points) {
    bestPassed = bestPassed || point.passed
    if (point.bestScore !== null && (bestScore === null || point.bestScore > bestScore))
      bestScore = point.bestScore
    curve.push({ bestPassed, bestScore, elapsedMs: point.elapsedMs })
  }
  return curve
}
