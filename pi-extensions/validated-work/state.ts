import {
  parseValidatedWorkStateV1,
  VALIDATED_WORK_PROTOCOL,
  VALIDATED_WORK_VERSION,
  type CheckStatus,
  type ConfidenceObservation,
  type EvidenceState,
  type IntentState,
  type ItemStatus,
  type ReadinessReason,
  type Readiness,
  type ValidatedWorkEvidenceKind,
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
import { sanitizeObservationText, type ObservedToolEvidenceDraft } from './evidence.ts'

export const validatedWorkToolName = 'validated_work'
export const validatedWorkStatusKey = 'pi-livecraft.validated-work'
export const validatedWorkConfigType = 'pi-livecraft.validated-work-config'
export const validatedWorkConfigVersion = 1
export const validatedWorkEvidenceBatchType = 'pi-livecraft.validated-work-evidence-batch'
export const validatedWorkEvidenceBatchVersion = 1
export const validatedWorkAttributionType = 'pi-livecraft.validated-work-attribution'
export const validatedWorkAttributionVersion = 1
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
  abortedAt?: number
  maxExtraTurns?: number
  maxAttributedCostUsd?: number
}

export interface ValidatedWorkEvidenceBatchEntry {
  protocol: typeof validatedWorkEvidenceBatchType
  version: typeof validatedWorkEvidenceBatchVersion
  cycleId: string
  stateRevision: number
  observedAt: number
  evidence: ObservedToolEvidenceDraft[]
}

export interface ValidatedWorkAttributionEntry {
  protocol: typeof validatedWorkAttributionType
  version: typeof validatedWorkAttributionVersion
  cycleId: string
  purpose: 'automated_validation'
  markerId: string
  reason: string
  stateRevision: number
  startedAt: number
  targetEntryId?: string
  settledAt?: number
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
    const batch = evidenceBatchFromEntry(entry)
    if (batch === 'invalid') {
      ignoredSnapshots += 1
      continue
    }
    if (batch && state && batch.cycleId === state.cycleId) {
      state = applyObservedEvidenceBatch(state, batch.evidence, batch.observedAt, false)
      continue
    }
    const recovered = recoveredEvidenceFromEntry(entry)
    if (recovered && state) {
      state = applyObservedEvidenceBatch(state, [recovered], recovered.observedAt, false)
    }
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

export function applyObservedEvidenceBatch(
  state: ValidatedWorkStateV1,
  evidence: readonly ObservedToolEvidenceDraft[],
  now = Date.now(),
  incrementsRevision = true,
): ValidatedWorkStateV1 {
  if (state.mode === 'standard' || evidence.length === 0) return state
  const existing = new Set(state.evidence.map((item) => item.id))
  const existingToolCalls = new Set(
    state.evidence.flatMap((item) => item.toolCallId ? [item.toolCallId] : []),
  )
  const nextEvidence = [...state.evidence]
  const nextTimeline = [...state.events.timeline]
  let accepted = 0
  for (const draft of evidence) {
    if (existing.has(draft.id) || (draft.toolCallId && existingToolCalls.has(draft.toolCallId)))
      continue
    const item: ValidatedWorkEvidence = {
      id: draft.id,
      kind: draft.kind,
      summary: draft.summary,
      observedAt: draft.observedAt,
      ...(draft.toolCallId ? { toolCallId: draft.toolCallId } : {}),
      ...(draft.entryId ? { entryId: draft.entryId } : {}),
      checkIds: draft.checkIds,
    }
    nextEvidence.push(item)
    existing.add(item.id)
    if (item.toolCallId) existingToolCalls.add(item.toolCallId)
    nextTimeline.push({
      id: `evidence-${item.id}`,
      type: item.kind,
      observedAt: item.observedAt,
      summary: item.summary,
      ...(item.entryId ? { entryId: item.entryId } : {}),
    })
    accepted += 1
  }
  if (accepted === 0) return state
  const boundedTimeline = nextTimeline.slice(-200)
  const next = parseValidatedWorkStateV1({
    ...state,
    evidence: nextEvidence.slice(-200),
    events: {
      totalEvents: state.events.totalEvents + accepted,
      droppedEvents: state.events.droppedEvents
        + Math.max(0, nextTimeline.length - boundedTimeline.length),
      timeline: boundedTimeline,
    },
    updatedAt: now,
    revision: incrementsRevision ? state.revision + 1 : state.revision,
  })
  return deriveReadiness(next, now, incrementsRevision)
}

export function applyValidatedWorkAction(
  state: ValidatedWorkStateV1,
  params: ValidatedWorkToolParams,
  now = Date.now(),
): ValidatedWorkStateV1 {
  assertKnownToolArgs(params)
  if (state.mode === 'standard') throw new Error('validated_work is inactive in standard mode.')
  if (params.action === 'status') return state
  const before = structuredClone(state)
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
  next = appendConfidenceObservations(before, next, now)
  next = deriveReadiness(next, now, false)
  next.revision += 1
  next.updatedAt = now
  return parseValidatedWorkStateV1(next)
}

export function approveState(state: ValidatedWorkStateV1, now = Date.now()): ValidatedWorkStateV1 {
  if (state.mode === 'standard') return state
  return deriveReadiness(
    parseValidatedWorkStateV1({
      ...state,
      phase: 'executing',
      updatedAt: now,
      revision: state.revision + 1,
    }),
    now,
    false,
  )
}

export function setPausedState(
  state: ValidatedWorkStateV1,
  paused: boolean,
  now = Date.now(),
): ValidatedWorkStateV1 {
  if (state.mode === 'standard') return state
  return deriveReadiness(
    parseValidatedWorkStateV1({
      ...state,
      paused,
      updatedAt: now,
      revision: state.revision + 1,
    }),
    now,
    false,
  )
}

export function recordBudgetStop(
  state: ValidatedWorkStateV1,
  code = 'budget-stop',
  text = 'Stopped at the configured automation budget.',
  now = Date.now(),
): ValidatedWorkStateV1 {
  if (state.mode === 'standard') return state
  return parseValidatedWorkStateV1({
    ...state,
    phase: 'blocked',
    readiness: 'budget_stopped',
    readinessReasons: [reason(code, text)],
    updatedAt: now,
    revision: state.revision + 1,
    events: addTimelineEvent(state.events, code, now, text),
  })
}

export function incrementExtraTurn(
  state: ValidatedWorkStateV1,
  now = Date.now(),
): ValidatedWorkStateV1 {
  return parseValidatedWorkStateV1({
    ...state,
    automation: {
      ...state.automation,
      counters: {
        ...state.automation.counters,
        extraTurns: state.automation.counters.extraTurns + 1,
      },
    },
    updatedAt: now,
    revision: state.revision + 1,
  })
}

export function deriveReadiness(
  state: ValidatedWorkStateV1,
  now = Date.now(),
  bumpsRevision = false,
): ValidatedWorkStateV1 {
  const derived = readinessForState(state)
  if (
    state.readiness === derived.readiness && sameReasons(state.readinessReasons, derived.reasons)
  ) {
    return state
  }
  return parseValidatedWorkStateV1({
    ...state,
    readiness: derived.readiness,
    readinessReasons: derived.reasons,
    updatedAt: now,
    revision: bumpsRevision ? state.revision + 1 : state.revision,
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
  if (isFiniteNonNegative(value.abortedAt)) entry.abortedAt = value.abortedAt
  if (isFiniteNonNegative(value.maxExtraTurns)) entry.maxExtraTurns = value.maxExtraTurns
  if (isFiniteNonNegative(value.maxAttributedCostUsd)) {
    entry.maxAttributedCostUsd = value.maxAttributedCostUsd
  }
  return entry
}

function evidenceBatchFromEntry(
  entry: BranchEntryLike,
): ValidatedWorkEvidenceBatchEntry | 'invalid' | undefined {
  if (entry.type !== 'custom' || entry.customType !== validatedWorkEvidenceBatchType)
    return undefined
  try {
    return parseEvidenceBatchEntry(entry.data)
  } catch {
    return 'invalid'
  }
}

function parseEvidenceBatchEntry(value: unknown): ValidatedWorkEvidenceBatchEntry {
  if (!isObject(value)) throw new Error('evidence batch must be an object')
  if (
    value.protocol !== validatedWorkEvidenceBatchType
    || value.version !== validatedWorkEvidenceBatchVersion
  ) {
    throw new Error('invalid evidence batch protocol')
  }
  if (typeof value.cycleId !== 'string' || typeof value.stateRevision !== 'number') {
    throw new Error('invalid evidence batch cycle')
  }
  if (typeof value.observedAt !== 'number' || !Array.isArray(value.evidence)) {
    throw new Error('invalid evidence batch payload')
  }
  return {
    protocol: validatedWorkEvidenceBatchType,
    version: validatedWorkEvidenceBatchVersion,
    cycleId: value.cycleId,
    stateRevision: value.stateRevision,
    observedAt: value.observedAt,
    evidence: value.evidence.map(parseObservedToolEvidenceDraft),
  }
}

function parseObservedToolEvidenceDraft(value: unknown): ObservedToolEvidenceDraft {
  if (!isObject(value)) throw new Error('observed evidence must be an object')
  if (
    typeof value.id !== 'string' || typeof value.kind !== 'string'
    || typeof value.summary !== 'string'
  ) {
    throw new Error('observed evidence fields are invalid')
  }
  if (typeof value.observedAt !== 'number' || !Array.isArray(value.checkIds)) {
    throw new Error('observed evidence time or links are invalid')
  }
  if (!isEvidenceKind(value.kind)) throw new Error('observed evidence kind is invalid')
  return {
    id: value.id,
    kind: value.kind,
    summary: sanitizeObservationText(value.summary),
    observedAt: value.observedAt,
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
    ...(typeof value.entryId === 'string' ? { entryId: value.entryId } : {}),
    checkIds: value.checkIds.filter((id): id is string => typeof id === 'string'),
    toolName: typeof value.toolName === 'string' ? value.toolName : 'unknown',
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.commandOrPath === 'string' ? { commandOrPath: value.commandOrPath } : {}),
    isError: value.isError === true,
  }
}

function recoveredEvidenceFromEntry(entry: BranchEntryLike): ObservedToolEvidenceDraft | undefined {
  if (entry.type !== 'message' || !isObject(entry.message)) return undefined
  const message = entry.message
  if (message.role !== 'toolResult' || typeof message.toolName !== 'string') return undefined
  if (message.toolName === validatedWorkToolName) return undefined
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined
  const entryId = typeof (entry as { id?: unknown }).id === 'string'
    ? (entry as { id: string }).id
    : undefined
  const summary = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? message.details ?? '')
  const observedAt = Date.parse(
    typeof (entry as { timestamp?: unknown }).timestamp === 'string'
      ? (entry as { timestamp: string }).timestamp
      : '',
  ) || Date.now()
  return {
    id: evidenceIdForToolCall(toolCallId ?? `${message.toolName}-${observedAt}`),
    kind: message.isError === true ? 'failed_observation' : 'observed_tool',
    summary: sanitizeObservationText(`${message.toolName}: ${summary}`).slice(0, 4000),
    observedAt,
    ...(toolCallId ? { toolCallId } : {}),
    ...(entryId ? { entryId } : {}),
    checkIds: [],
    toolName: message.toolName,
    isError: message.isError === true,
  }
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

function appendConfidenceObservations(
  before: ValidatedWorkStateV1,
  next: ValidatedWorkStateV1,
  now: number,
): ValidatedWorkStateV1 {
  const previous = new Map(before.items.map((item) => [item.id, item]))
  const observations: ConfidenceObservation[] = []
  let events = next.events
  for (const item of next.items) {
    const prior = previous.get(item.id)
    const priorState = prior ? observedItemConfidence(prior) : undefined
    const currentState = observedItemConfidence(item)
    if (priorState === currentState) continue
    observations.push({
      itemId: item.id,
      state: currentState,
      observedAt: now,
      reason: item.status === 'completed' ? 'completion confidence changed' : 'confidence changed',
      evidenceIds: itemEvidenceIds(next, item),
    })
    if (
      item.status === 'completed'
      && confidenceRank(currentState) - confidenceRank(priorState ?? 'speculative') >= 2
    ) {
      const id = `confidence_spike-${item.id}`
      if (!next.events.timeline.some((event) => event.id === id)) {
        events = addTimelineEvent(
          events,
          'confidence_spike',
          now,
          `Confidence jumped for ${item.id}`,
          id,
        )
      }
    }
  }
  if (observations.length === 0 && events === next.events) return next
  const byItem = new Map<string, ConfidenceObservation[]>()
  for (const observation of [...next.confidenceHistory, ...observations]) {
    const list = byItem.get(observation.itemId) ?? []
    list.push(observation)
    byItem.set(observation.itemId, list.slice(-16))
  }
  return {
    ...next,
    confidenceHistory: [...byItem.values()].flat(),
    events,
  }
}

function readinessForState(
  state: ValidatedWorkStateV1,
): { readiness: Readiness; reasons: ReadinessReason[] } {
  if (state.paused)
    return {
      readiness: 'not_ready',
      reasons: [reason('automation-paused', 'Automation is paused.')],
    }
  if (state.phase === 'awaiting_approval') {
    return {
      readiness: 'not_ready',
      reasons: [reason('planning-needs-approval', 'Planning needs approval before execution.')],
    }
  }
  if (state.mode !== 'validated') return { readiness: 'not_ready', reasons: [] }
  if (state.automation.counters.extraTurns >= state.automation.limits.maxExtraTurns) {
    return {
      readiness: 'budget_stopped',
      reasons: [reason('turn-budget-stop', 'Stopped at the configured automatic turn limit.')],
    }
  }
  if (state.automation.counters.attributedCostUsd >= state.automation.limits.maxAttributedCostUsd) {
    return {
      readiness: 'budget_stopped',
      reasons: [reason('cost-budget-stop', 'Stopped at the configured attributed cost limit.')],
    }
  }
  const openItems = state.items.filter((item) =>
    item.status !== 'completed' && item.status !== 'cancelled'
  )
  if (openItems.length > 0) {
    return {
      readiness: 'not_ready',
      reasons: [
        reason('items-open', `${openItems.length} item(s) are still open.`, {
          itemIds: openItems.map((item) => item.id),
        }),
      ],
    }
  }
  const requirementsWithoutChecks = state.requirements.filter((requirement) =>
    !state.checks.some((check) => check.requirementIds.includes(requirement.id))
  )
  if (requirementsWithoutChecks.length > 0) {
    return {
      readiness: 'needs_evidence',
      reasons: [
        reason(
          'requirements-without-checks',
          `${requirementsWithoutChecks.length} requirement(s) lack checks.`,
          {
            requirementIds: requirementsWithoutChecks.map((requirement) => requirement.id),
          },
        ),
      ],
    }
  }
  const unfinishedChecks = state.checks.filter((check) => check.status !== 'passed')
  if (unfinishedChecks.length > 0) {
    return {
      readiness: 'needs_evidence',
      reasons: [
        reason(
          'checks-not-passed',
          `${unfinishedChecks.length} check(s) are pending, failed, or blocked.`,
          {
            checkIds: unfinishedChecks.map((check) => check.id),
          },
        ),
      ],
    }
  }
  const insufficient = state.items.filter((item) => !itemHasEnoughCompletionConfidence(state, item))
  if (insufficient.length > 0) {
    return {
      readiness: 'needs_evidence',
      reasons: [
        reason(
          'completion-confidence-insufficient',
          `${insufficient.length} completed item(s) lack observed validation evidence.`,
          {
            itemIds: insufficient.map((item) => item.id),
          },
        ),
      ],
    }
  }
  const spikes = state.events.timeline.filter((event) => event.type === 'confidence_spike')
  if (spikes.length > 0 && state.latestReview?.status !== 'complete') {
    return {
      readiness: 'needs_review',
      reasons: [
        reason('confidence-spike-unreviewed', 'A confidence spike needs review before readiness.', {
          itemIds: spikes.map((event) => event.id.replace(/^confidence_spike-/, '')),
        }),
      ],
    }
  }
  if ((state.latestReview?.openBlockers ?? 0) > 0) {
    return {
      readiness: 'needs_review',
      reasons: [
        reason('review-blockers-open', 'Confirmed high-severity review blockers remain open.'),
      ],
    }
  }
  return {
    readiness: 'ready',
    reasons: [reason('ready', 'Ready: mapped checks passed with observed evidence.')],
  }
}

function itemHasEnoughCompletionConfidence(
  state: ValidatedWorkStateV1,
  item: ValidatedWorkItem,
): boolean {
  const confidence = item.completionConfidence
  if (!confidence || confidenceRank(confidence) < confidenceRank('validated')) return false
  const evidence = itemEvidenceIds(state, item)
    .map((id) => state.evidence.find((entry) => entry.id === id))
    .filter((entry): entry is ValidatedWorkEvidence => Boolean(entry))
  if (confidenceRank(confidence) >= confidenceRank('validated')) {
    if (!evidence.some((entry) => entry.kind !== 'claimed')) return false
  }
  if (confidence === 'verified') {
    return item.requirementIds.every((requirementId) =>
      state.checks.some((check) =>
        check.status === 'passed' && check.requirementIds.includes(requirementId)
        && check.evidenceIds.length > 0
      )
    )
  }
  return true
}

function observedItemConfidence(item: ValidatedWorkItem): EvidenceState {
  return item.status === 'completed' && item.completionConfidence
    ? item.completionConfidence
    : item.confidence
}

function itemEvidenceIds(state: ValidatedWorkStateV1, item: ValidatedWorkItem): string[] {
  const ids = new Set<string>()
  for (const check of state.checks) {
    if (check.itemIds.includes(item.id)) {
      for (const evidenceId of check.evidenceIds) ids.add(evidenceId)
    }
  }
  return [...ids]
}

function confidenceRank(state: EvidenceState): number {
  return { speculative: 0, plausible: 1, validated: 2, verified: 3 }[state]
}

function reason(
  code: string,
  text: string,
  refs: Partial<Pick<ReadinessReason, 'requirementIds' | 'itemIds' | 'checkIds' | 'findingIds'>> =
    {},
): ReadinessReason {
  return {
    code,
    text,
    requirementIds: refs.requirementIds ?? [],
    itemIds: refs.itemIds ?? [],
    checkIds: refs.checkIds ?? [],
    findingIds: refs.findingIds ?? [],
  }
}

function sameReasons(left: readonly ReadinessReason[], right: readonly ReadinessReason[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function addTimelineEvent(
  events: ValidatedWorkStateV1['events'],
  type: string,
  observedAt: number,
  summary: string,
  id = `${type}-${Math.max(0, Math.floor(observedAt)).toString(36)}`,
): ValidatedWorkStateV1['events'] {
  const timeline = [...events.timeline.filter((event) => event.id !== id), {
    id,
    type,
    observedAt,
    summary,
  }]
  const boundedTimeline = timeline.slice(-200)
  return {
    totalEvents: events.totalEvents + 1,
    droppedEvents: events.droppedEvents + Math.max(0, timeline.length - boundedTimeline.length),
    timeline: boundedTimeline,
  }
}

function isEvidenceKind(value: string): value is ValidatedWorkEvidenceKind {
  return value === 'claimed' || value === 'inspection' || value === 'mutation'
    || value === 'observed_tool'
    || value === 'observed_check' || value === 'failed_observation' || value === 'review'
    || value === 'manual_confirmation'
}

export function evidenceIdForToolCall(toolCallId: string): string {
  return `tool-${toolCallId}`.replaceAll(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
}
