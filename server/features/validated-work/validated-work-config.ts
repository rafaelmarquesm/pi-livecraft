import type { JsonObject } from '../../../shared/types.ts'
import {
  VALIDATED_WORK_MODES,
  type ValidatedWorkConfigUpdate,
  type ValidatedWorkMode,
} from '../../../shared/validated-work.ts'
import { isObject } from '../../../shared/is-object.ts'

export interface ParsedValidatedWorkConfigUpdate {
  body: ValidatedWorkConfigUpdate
  commandArgs: string
  capturesBaseline: boolean
  resultingMode?: ValidatedWorkMode
}

/** Parses the strict browser config body and returns canonical private-command args. */
export function parseValidatedWorkConfigUpdate(value: JsonObject): ParsedValidatedWorkConfigUpdate {
  assertAllowed(value, ['mode', 'paused', 'action', 'limits'], '$')
  const body: ValidatedWorkConfigUpdate = {}
  if (Object.hasOwn(value, 'mode')) body.mode = mode(value.mode)
  if (Object.hasOwn(value, 'paused')) {
    if (typeof value.paused !== 'boolean') throw new Error('paused must be a boolean')
    body.paused = value.paused
  }
  if (Object.hasOwn(value, 'action')) {
    if (
      value.action !== 'approve' && value.action !== 'reset' && value.action !== 'abort_automation'
    ) {
      throw new Error('action must be approve, reset, or abort_automation')
    }
    body.action = value.action
  }
  if (Object.hasOwn(value, 'limits')) {
    if (!isObject(value.limits)) throw new Error('limits must be an object')
    assertAllowed(value.limits, ['maxExtraTurns', 'maxAttributedCostUsd'], '$.limits')
    body.limits = {}
    if (Object.hasOwn(value.limits, 'maxExtraTurns')) {
      body.limits.maxExtraTurns = boundedInteger(value.limits.maxExtraTurns, 0, 5, 'maxExtraTurns')
    }
    if (Object.hasOwn(value.limits, 'maxAttributedCostUsd')) {
      body.limits.maxAttributedCostUsd = boundedNumber(
        value.limits.maxAttributedCostUsd,
        0,
        100,
        'maxAttributedCostUsd',
      )
    }
  }
  const command = privateCommandArgs(body)
  return {
    body,
    commandArgs: command.args,
    capturesBaseline: command.mode === 'plan' || command.mode === 'validated'
      || body.action === 'reset',
    resultingMode: command.mode,
  }
}

function privateCommandArgs(
  body: ValidatedWorkConfigUpdate,
): { args: string; mode?: ValidatedWorkMode } {
  if (body.action === 'approve') return { args: canonicalJson({ action: 'approve' }) }
  if (body.action === 'reset')
    return { args: canonicalJson({ mode: 'standard' }), mode: 'standard' }
  if (body.action === 'abort_automation')
    return { args: canonicalJson({ mode: 'standard' }), mode: 'standard' }
  const targetMode = body.mode
  if (!targetMode) throw new Error('mode or action is required')
  const command: Record<string, unknown> = { mode: targetMode }
  if (body.limits?.maxExtraTurns !== undefined) command.maxExtraTurns = body.limits.maxExtraTurns
  if (body.limits?.maxAttributedCostUsd !== undefined) {
    command.maxAttributedCostUsd = body.limits.maxAttributedCostUsd
  }
  return { args: canonicalJson(command), mode: targetMode }
}

export function canonicalJson(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) sorted[key] = value[key]
  return JSON.stringify(sorted)
}

function mode(value: unknown): ValidatedWorkMode {
  if (typeof value !== 'string' || !(VALIDATED_WORK_MODES as readonly string[]).includes(value)) {
    throw new Error('mode must be standard, plan, or validated')
  }
  return value as ValidatedWorkMode
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`)
  }
  return value
}

function boundedNumber(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}`)
  }
  return value
}

function assertAllowed(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not allowed`)
  }
}
