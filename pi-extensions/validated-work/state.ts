import {
  parseValidatedWorkStateV1,
  VALIDATED_WORK_PROTOCOL,
  VALIDATED_WORK_VERSION,
  type CheckStatus,
  type EvidenceState,
  type IntentState,
  type ItemStatus,
  type Readiness,
  type ValidatedWorkCheck,
  type ValidatedWorkEvidence,
  type ValidatedWorkGoal,
  type ValidatedWorkItem,
  type ValidatedWorkMode,
  type ValidatedWorkRequirement,
  type ValidatedWorkStateV1,
  type WorkPhase,
} from '../../shared/validated-work.ts'
import { isObject } from '../../shared/is-object.ts'

export const validatedWorkToolName = 'validated_work'
export const validatedWorkStatusKey = 'pi-livecraft.validated-work'
export const validatedWorkConfigType = 'pi-livecraft.validated-work-config'
export const validatedWorkConfigVersion = 1
export const validatedWorkSummaryProtocol = 'pi-livecraft.validated-work-summary'
export const validatedWorkSummaryVersion = 1
export const maxSummaryBytes = 2_048

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

export interface ValidatedWorkToolParams {
  action:
    | 'replace_plan'
    | 'update_items'
    | 'update_checks'
    | 'link_evidence'
    | 'submit_for_approval'
    | 'reassess'
    | 'status'
  phase?: WorkPhase
  userIntent?: string
  intentState?: IntentState
  assumptions?: string[]
  requirements?: ValidatedWorkRequirement[]
  goals?: ValidatedWorkGoal[]
  items?: Array<Partial<ValidatedWorkItem> & { id: string }>
  checks?: Array<Partial<ValidatedWorkCheck> & { id: string }>
  evidence?: ValidatedWorkEvidence[]
  readiness?: Readiness
  readinessReasons?: ValidatedWorkStateV1['readinessReasons']
  latestReview?: ValidatedWorkStateV1['latestReview']
}

const allowedToolArgs = new Set([
  'action',
  'phase',
  'userIntent',
  'intentState',
  'assumptions',
  'requirements',
  'goals',
  'items',
  'checks',
  'evidence',
  'readiness',
  'readinessReasons',
  'latestReview',
])

export interface ReconstructedValidatedWork {
  config: ValidatedWorkConfigEntry
  state: ValidatedWorkStateV1
  ignoredSnapshots: number
}

export interface ValidatedWorkSummaryV1 {
  protocol: typeof validatedWorkSummaryProtocol
  version: typeof validatedWorkSummaryVersion
  mode: ValidatedWorkMode
  phase: WorkPhase
  revision: number
  counts: {
    requirements: number
    goals: number
    items: number
    completedItems: number
    checks: Record<CheckStatus, number>
    evidence: number
  }
  readiness: Readiness
  blockers: string[]
  automation: {
    running: boolean
    extraTurns: number
    maxExtraTurns: number
  }
  review: {
    status: string
    openBlockers: number
  }
}

export type BranchEntryLike = {
  type?: unknown
  customType?: unknown
  data?: unknown
  message?: unknown
}

const defaultMaxExtraTurns = 2
const defaultMaxAttributedCostUsd = 1

export function defaultConfig(now = Date.now()): ValidatedWorkConfigEntry {
  return {
    protocol: validatedWorkConfigType,
    version: 1,
    mode: 'standard',
    updatedAt: now,
  }
}

export function createInitialState(
  mode: Exclude<ValidatedWorkMode, 'standard'>,
  now = Date.now(),
  config: Partial<ValidatedWorkConfigEntry> = {},
): ValidatedWorkStateV1 {
  return parseValidatedWorkStateV1({
    protocol: VALIDATED_WORK_PROTOCOL,
    version: VALIDATED_WORK_VERSION,
    cycleId: `cycle-${Math.max(0, Math.floor(now)).toString(36)}`,
    revision: 0,
    mode,
    phase: 'planning',
    paused: config.paused ?? false,
    createdAt: now,
    updatedAt: now,
    userIntent: '',
    intentState: 'uncertain',
    assumptions: [],
    requirements: [],
    goals: [],
    items: [],
    checks: [],
    evidence: [],
    confidenceHistory: [],
    readiness: 'not_ready',
    readinessReasons: [],
    automation: {
      counters: {
        extraTurns: 0,
        reviewCalls: 0,
        attributedInputTokens: 0,
        attributedOutputTokens: 0,
        attributedCacheReadTokens: 0,
        attributedCacheWriteTokens: 0,
        attributedCostUsd: 0,
      },
      limits: {
        maxExtraTurns: config.maxExtraTurns ?? defaultMaxExtraTurns,
        maxAttributedCostUsd: config.maxAttributedCostUsd ?? defaultMaxAttributedCostUsd,
      },
    },
    events: { totalEvents: 0, droppedEvents: 0, timeline: [] },
  })
}

export function reconstructValidatedWork(
  entries: readonly BranchEntryLike[],
  now = Date.now(),
): ReconstructedValidatedWork {
  let config = defaultConfig(now)
  let state: ValidatedWorkStateV1 | undefined
  let ignoredSnapshots = 0
  for (const entry of entries) {
    const nextConfig = configFromEntry(entry)
    if (nextConfig) {
      config = nextConfig
      continue
    }
    const snapshot = stateFromEntry(entry)
    if (snapshot === 'invalid') {
      ignoredSnapshots += 1
      continue
    }
    if (snapshot) state = snapshot
  }
  if (config.mode === 'standard') {
    state = createInitialState('plan', now, config)
    return { config, state: { ...state, mode: 'standard', phase: 'idle' }, ignoredSnapshots }
  }
  state = state && state.mode === config.mode ? state : createInitialState(config.mode, now, config)
  if (config.approvedAt && (state.phase === 'planning' || state.phase === 'awaiting_approval')) {
    state = parseValidatedWorkStateV1({
      ...state,
      phase: 'executing',
      updatedAt: Math.max(state.updatedAt, config.approvedAt),
      revision: state.revision + 1,
    })
  }
  return { config, state, ignoredSnapshots }
}

export function applyValidatedWorkAction(
  state: ValidatedWorkStateV1,
  params: ValidatedWorkToolParams,
  now = Date.now(),
): ValidatedWorkStateV1 {
  assertKnownToolArgs(params)
  if (state.mode === 'standard') throw new Error('validated_work is inactive in standard mode.')
  if (params.action === 'status') return state
  let next: ValidatedWorkStateV1 = structuredClone(state)
  if (params.action === 'replace_plan') next = applyPlan(next, params)
  else if (params.action === 'update_items') {
    next.items = mergeById(
      next.items,
      params.items ?? [],
      requireItem,
      itemKeys,
    )
  } else if (params.action === 'update_checks') {
    next.checks = mergeById(next.checks, params.checks ?? [], requireCheck, checkKeys)
  } else if (params.action === 'link_evidence') {
    next.evidence = mergeById(next.evidence, params.evidence ?? [], requireEvidence, evidenceKeys)
    if (params.checks) next.checks = mergeById(next.checks, params.checks, requireCheck, checkKeys)
  } else if (params.action === 'submit_for_approval') {
    next.phase = 'awaiting_approval'
    next.readiness = 'not_ready'
    next.readinessReasons = [{
      code: 'planning-needs-approval',
      text: 'Planning needs approval before execution.',
      requirementIds: [],
      itemIds: [],
      checkIds: [],
      findingIds: [],
    }]
  } else if (params.action === 'reassess') {
    if (params.readiness) next.readiness = params.readiness
    if (params.readinessReasons) next.readinessReasons = params.readinessReasons
    if (params.latestReview) next.latestReview = params.latestReview
    if (params.phase) next.phase = params.phase
  }
  next.revision += 1
  next.updatedAt = now
  return parseValidatedWorkStateV1(next)
}

export function approveState(state: ValidatedWorkStateV1, now = Date.now()): ValidatedWorkStateV1 {
  if (state.mode === 'standard') return state
  return parseValidatedWorkStateV1({
    ...state,
    phase: 'executing',
    updatedAt: now,
    revision: state.revision + 1,
  })
}

export function buildSummary(state: ValidatedWorkStateV1): ValidatedWorkSummaryV1 {
  const checks = { pending: 0, passed: 0, failed: 0, blocked: 0 }
  for (const check of state.checks) checks[check.status] += 1
  const summary: ValidatedWorkSummaryV1 = {
    protocol: validatedWorkSummaryProtocol,
    version: validatedWorkSummaryVersion,
    mode: state.mode,
    phase: state.phase,
    revision: state.revision,
    counts: {
      requirements: state.requirements.length,
      goals: state.goals.length,
      items: state.items.length,
      completedItems: state.items.filter((item) => item.status === 'completed').length,
      checks,
      evidence: state.evidence.length,
    },
    readiness: state.readiness,
    blockers: state.readinessReasons.map((reason) => `${reason.code}: ${reason.text}`),
    automation: {
      running: false,
      extraTurns: state.automation.counters.extraTurns,
      maxExtraTurns: state.automation.limits.maxExtraTurns,
    },
    review: {
      status: state.latestReview?.status ?? 'never_run',
      openBlockers: state.latestReview?.openBlockers ?? 0,
    },
  }
  return boundSummary(summary)
}

export function summaryJson(state: ValidatedWorkStateV1): string {
  return JSON.stringify(buildSummary(state))
}

function configFromEntry(entry: BranchEntryLike): ValidatedWorkConfigEntry | undefined {
  if (entry.type !== 'custom' || entry.customType !== validatedWorkConfigType) return undefined
  return parseConfigEntry(entry.data)
}

function parseConfigEntry(value: unknown): ValidatedWorkConfigEntry | undefined {
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

function assertKnownToolArgs(params: ValidatedWorkToolParams): void {
  for (const key of Object.keys(params)) {
    if (!allowedToolArgs.has(key)) throw new Error(`validated_work argument is not allowed: ${key}`)
  }
}

function isMode(value: unknown): value is ValidatedWorkMode {
  return value === 'standard' || value === 'plan' || value === 'validated'
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function stateFromEntry(entry: BranchEntryLike): ValidatedWorkStateV1 | 'invalid' | undefined {
  if (entry.type !== 'message' || !isObject(entry.message)) return undefined
  if (entry.message.role !== 'toolResult' || entry.message.toolName !== validatedWorkToolName)
    return undefined
  try {
    return parseValidatedWorkStateV1(entry.message.details)
  } catch {
    return 'invalid'
  }
}

function applyPlan(
  state: ValidatedWorkStateV1,
  params: ValidatedWorkToolParams,
): ValidatedWorkStateV1 {
  if (params.userIntent !== undefined) state.userIntent = params.userIntent
  if (params.intentState !== undefined) state.intentState = params.intentState as IntentState
  if (params.assumptions !== undefined) state.assumptions = params.assumptions
  if (params.requirements !== undefined)
    state.requirements = params.requirements as ValidatedWorkRequirement[]
  if (params.goals !== undefined) state.goals = params.goals as ValidatedWorkGoal[]
  if (params.items !== undefined)
    state.items = mergeById(
      state.items,
      params.items,
      requireItem,
      itemKeys,
    )
  if (params.checks !== undefined)
    state.checks = mergeById(
      state.checks,
      params.checks,
      requireCheck,
      checkKeys,
    )
  if (params.phase !== undefined) state.phase = params.phase
  return state
}

const itemKeys = new Set([
  'id',
  'goalId',
  'requirementIds',
  'text',
  'status',
  'confidence',
  'completionConfidence',
])
const checkKeys = new Set(['id', 'requirementIds', 'itemIds', 'text', 'status', 'evidenceIds'])
const evidenceKeys = new Set([
  'id',
  'kind',
  'summary',
  'observedAt',
  'toolCallId',
  'entryId',
  'checkIds',
])

function mergeById<T extends { id: string }>(
  existing: readonly T[],
  patches: readonly unknown[],
  requireComplete: (value: Partial<T>) => T,
  allowedKeys: ReadonlySet<string>,
): T[] {
  const byId = new Map(existing.map((item) => [item.id, structuredClone(item)] as const))
  for (const patch of patches) {
    if (!isObject(patch) || typeof patch.id !== 'string')
      throw new Error('Every update requires an id.')
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.has(key)) throw new Error(`Update field is not allowed: ${key}`)
    }
    const current = byId.get(patch.id)
    const next = current ? { ...current, ...patch } as Partial<T> : patch as Partial<T>
    byId.set(patch.id, requireComplete(next))
  }
  return [...byId.values()]
}

function requireItem(value: Partial<ValidatedWorkItem>): ValidatedWorkItem {
  if (!value.id || !value.requirementIds || !value.text || !value.status || !value.confidence) {
    throw new Error(`Item ${value.id ?? '<missing>'} is incomplete.`)
  }
  return {
    id: value.id,
    ...(value.goalId ? { goalId: value.goalId } : {}),
    requirementIds: value.requirementIds,
    text: value.text,
    status: value.status as ItemStatus,
    confidence: value.confidence as EvidenceState,
    ...(value.completionConfidence ? { completionConfidence: value.completionConfidence } : {}),
  }
}

function requireCheck(value: Partial<ValidatedWorkCheck>): ValidatedWorkCheck {
  if (
    !value.id || !value.requirementIds || !value.itemIds || !value.text || !value.status
    || !value.evidenceIds
  ) {
    throw new Error(`Check ${value.id ?? '<missing>'} is incomplete.`)
  }
  return {
    id: value.id,
    requirementIds: value.requirementIds,
    itemIds: value.itemIds,
    text: value.text,
    status: value.status as CheckStatus,
    evidenceIds: value.evidenceIds,
  }
}

function requireEvidence(value: Partial<ValidatedWorkEvidence>): ValidatedWorkEvidence {
  if (
    !value.id || !value.kind || !value.summary || value.observedAt === undefined || !value.checkIds
  ) {
    throw new Error(`Evidence ${value.id ?? '<missing>'} is incomplete.`)
  }
  return {
    id: value.id,
    kind: value.kind,
    summary: value.summary,
    observedAt: value.observedAt,
    ...(value.toolCallId ? { toolCallId: value.toolCallId } : {}),
    ...(value.entryId ? { entryId: value.entryId } : {}),
    checkIds: value.checkIds,
  }
}

function boundSummary(summary: ValidatedWorkSummaryV1): ValidatedWorkSummaryV1 {
  let bounded = { ...summary, blockers: summary.blockers.slice(0, 12) }
  while (new TextEncoder().encode(JSON.stringify(bounded)).length > maxSummaryBytes) {
    if (bounded.blockers.length === 0) break
    bounded = { ...bounded, blockers: bounded.blockers.slice(0, -1) }
  }
  return bounded
}
