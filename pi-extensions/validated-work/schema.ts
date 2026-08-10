import { Type, type Static } from 'typebox'
import { StringEnum } from '@earendil-works/pi-ai'
import {
  CHECK_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_STATES,
  INTENT_STATES,
  ITEM_STATUSES,
  READINESS_STATES,
  REQUIREMENT_SOURCES,
  REVIEW_SUMMARY_STATUSES,
  VALIDATED_WORK_MODES,
  WORK_PHASES,
  type ValidatedWorkMode,
} from '../../shared/validated-work.ts'
import { isObject } from '../../shared/is-object.ts'

export const validatedWorkToolName = 'validated_work'
export const validatedWorkStatusKey = 'pi-livecraft.validated-work'
export const validatedWorkConfigType = 'pi-livecraft.validated-work-config'
export const validatedWorkConfigVersion = 1
export const validatedWorkSummaryProtocol = 'pi-livecraft.validated-work-summary'
export const validatedWorkSummaryVersion = 1
export const maxSummaryBytes = 2_048

export const validatedWorkActions = [
  'replace_plan',
  'update_items',
  'update_checks',
  'link_evidence',
  'submit_for_approval',
  'reassess',
  'status',
] as const
export type ValidatedWorkAction = typeof validatedWorkActions[number]

const StringArray = Type.Array(Type.String())
const RequirementSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
  source: StringEnum(REQUIREMENT_SOURCES),
}, { additionalProperties: false })
const GoalSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  requirementIds: StringArray,
  status: StringEnum(ITEM_STATUSES),
}, { additionalProperties: false })
const ItemSchema = Type.Object({
  id: Type.String(),
  goalId: Type.Optional(Type.String()),
  requirementIds: StringArray,
  text: Type.String(),
  status: StringEnum(ITEM_STATUSES),
  confidence: StringEnum(EVIDENCE_STATES),
  completionConfidence: Type.Optional(StringEnum(EVIDENCE_STATES)),
}, { additionalProperties: false })
const ItemPatchSchema = Type.Object({
  id: Type.String(),
  goalId: Type.Optional(Type.String()),
  requirementIds: Type.Optional(StringArray),
  text: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(ITEM_STATUSES)),
  confidence: Type.Optional(StringEnum(EVIDENCE_STATES)),
  completionConfidence: Type.Optional(StringEnum(EVIDENCE_STATES)),
}, { additionalProperties: false })
const CheckSchema = Type.Object({
  id: Type.String(),
  requirementIds: StringArray,
  itemIds: StringArray,
  text: Type.String(),
  status: StringEnum(CHECK_STATUSES),
  evidenceIds: StringArray,
}, { additionalProperties: false })
const CheckPatchSchema = Type.Object({
  id: Type.String(),
  requirementIds: Type.Optional(StringArray),
  itemIds: Type.Optional(StringArray),
  text: Type.Optional(Type.String()),
  status: Type.Optional(StringEnum(CHECK_STATUSES)),
  evidenceIds: Type.Optional(StringArray),
}, { additionalProperties: false })
const EvidenceSchema = Type.Object({
  id: Type.String(),
  kind: StringEnum(EVIDENCE_KINDS),
  summary: Type.String(),
  observedAt: Type.Number(),
  toolCallId: Type.Optional(Type.String()),
  entryId: Type.Optional(Type.String()),
  checkIds: StringArray,
}, { additionalProperties: false })
const ReadinessReasonSchema = Type.Object({
  code: Type.String(),
  text: Type.String(),
  requirementIds: StringArray,
  itemIds: StringArray,
  checkIds: StringArray,
  findingIds: StringArray,
}, { additionalProperties: false })
const LatestReviewSchema = Type.Object({
  reportId: Type.String(),
  status: StringEnum(REVIEW_SUMMARY_STATUSES),
  openBlockers: Type.Number(),
  diffHash: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const validatedWorkToolParameters = Type.Object({
  action: StringEnum(validatedWorkActions),
  phase: Type.Optional(StringEnum(WORK_PHASES)),
  userIntent: Type.Optional(Type.String()),
  intentState: Type.Optional(StringEnum(INTENT_STATES)),
  assumptions: Type.Optional(StringArray),
  requirements: Type.Optional(Type.Array(RequirementSchema)),
  goals: Type.Optional(Type.Array(GoalSchema)),
  items: Type.Optional(Type.Array(Type.Union([ItemSchema, ItemPatchSchema]))),
  checks: Type.Optional(Type.Array(Type.Union([CheckSchema, CheckPatchSchema]))),
  evidence: Type.Optional(Type.Array(EvidenceSchema)),
  readiness: Type.Optional(StringEnum(READINESS_STATES)),
  readinessReasons: Type.Optional(Type.Array(ReadinessReasonSchema)),
  latestReview: Type.Optional(LatestReviewSchema),
}, { additionalProperties: false })

export type ValidatedWorkToolParams = Static<typeof validatedWorkToolParameters>

export interface ValidatedWorkConfigEntry {
  protocol: typeof validatedWorkConfigType
  version: typeof validatedWorkConfigVersion
  mode: ValidatedWorkMode
  updatedAt: number
  toolsBeforePlanning?: string[]
  approvedAt?: number
  paused?: boolean
  maxExtraTurns?: number
  maxAttributedCostUsd?: number
}

export interface ValidatedWorkCommandArgs {
  action: 'configure' | 'approve' | 'status' | 'abort_automation'
  mode?: ValidatedWorkMode
  paused?: boolean
  maxExtraTurns?: number
  maxAttributedCostUsd?: number
}

export function parseConfigEntry(value: unknown): ValidatedWorkConfigEntry | undefined {
  if (!isObject(value)) return undefined
  if (value.protocol !== validatedWorkConfigType || value.version !== validatedWorkConfigVersion) {
    return undefined
  }
  if (!isMode(value.mode) || !isFiniteNonNegative(value.updatedAt)) return undefined
  const entry: ValidatedWorkConfigEntry = {
    protocol: validatedWorkConfigType,
    version: validatedWorkConfigVersion,
    mode: value.mode,
    updatedAt: value.updatedAt,
  }
  if (Array.isArray(value.toolsBeforePlanning) && value.toolsBeforePlanning.every(isToolName)) {
    entry.toolsBeforePlanning = [...value.toolsBeforePlanning]
  }
  if (isFiniteNonNegative(value.approvedAt)) entry.approvedAt = value.approvedAt
  if (typeof value.paused === 'boolean') entry.paused = value.paused
  if (isFiniteNonNegative(value.maxExtraTurns)) entry.maxExtraTurns = value.maxExtraTurns
  if (isFiniteNonNegative(value.maxAttributedCostUsd)) {
    entry.maxAttributedCostUsd = value.maxAttributedCostUsd
  }
  return entry
}

export function parseCommandArgs(args: string): ValidatedWorkCommandArgs {
  const trimmed = args.trim()
  if (trimmed === '') return { action: 'status' }
  if (trimmed === 'plan' || trimmed === 'validated' || trimmed === 'standard') {
    return { action: 'configure', mode: trimmed }
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new Error('Expected JSON args, a mode, or no args for /livecraft-validated-work.')
  }
  if (!isObject(value)) throw new Error('Validated work config args must be an object.')
  const allowed = new Set(['action', 'mode', 'paused', 'maxExtraTurns', 'maxAttributedCostUsd'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Validated work config field is not allowed: ${key}`)
  }
  const action = value.action === undefined ? 'configure' : value.action
  if (
    action !== 'configure' && action !== 'approve' && action !== 'status'
    && action !== 'abort_automation'
  ) {
    throw new Error(
      'Validated work action must be configure, approve, abort_automation, or status.',
    )
  }
  const parsed: ValidatedWorkCommandArgs = { action }
  if (Object.hasOwn(value, 'mode')) {
    if (!isMode(value.mode))
      throw new Error('Validated work mode must be standard, plan, or validated.')
    parsed.mode = value.mode
  }
  if (Object.hasOwn(value, 'paused')) {
    if (typeof value.paused !== 'boolean') throw new Error('paused must be a boolean.')
    parsed.paused = value.paused
  }
  if (Object.hasOwn(value, 'maxExtraTurns')) {
    if (!isBoundedInteger(value.maxExtraTurns, 0, 5)) {
      throw new Error('maxExtraTurns must be an integer from 0 to 5.')
    }
    parsed.maxExtraTurns = value.maxExtraTurns
  }
  if (Object.hasOwn(value, 'maxAttributedCostUsd')) {
    if (!isBoundedNumber(value.maxAttributedCostUsd, 0, 100)) {
      throw new Error('maxAttributedCostUsd must be a number from 0 to 100.')
    }
    parsed.maxAttributedCostUsd = value.maxAttributedCostUsd
  }
  if (
    parsed.action === 'configure' && !parsed.mode && parsed.paused === undefined
    && parsed.maxExtraTurns === undefined && parsed.maxAttributedCostUsd === undefined
  ) {
    throw new Error('Configure requires a validated work mode, paused, or limits.')
  }
  return parsed
}

export function assertKnownToolArgs(params: ValidatedWorkToolParams): void {
  const allowed = new Set(Object.keys(validatedWorkToolParameters.properties))
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`validated_work argument is not allowed: ${key}`)
  }
}

function isMode(value: unknown): value is ValidatedWorkMode {
  return typeof value === 'string' && (VALIDATED_WORK_MODES as readonly string[]).includes(value)
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && value >= min && value <= max
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
