import { isObject } from './is-object.ts'

export const VALIDATED_WORK_PROTOCOL = 'pi-livecraft.validated-work'
export const VALIDATED_WORK_VERSION = 1

export const VALIDATED_WORK_LIMITS = {
  goals: 12,
  requirements: 50,
  tasks: 100,
  checks: 100,
  evidenceRecords: 200,
  confidenceObservationsPerItem: 16,
  assumptions: 20,
  textChars: 2_000,
  observationSummaryChars: 4_000,
  serializedStateBytes: 128 * 1024,
  timelineEvents: 200,
} as const

export const VALIDATED_WORK_MODES = ['standard', 'plan', 'validated'] as const
export type ValidatedWorkMode = typeof VALIDATED_WORK_MODES[number]

export const WORK_PHASES = [
  'idle',
  'planning',
  'awaiting_approval',
  'executing',
  'reviewing',
  'blocked',
  'complete',
] as const
export type WorkPhase = typeof WORK_PHASES[number]

export const INTENT_STATES = ['uncertain', 'partial', 'clear', 'complete'] as const
export type IntentState = typeof INTENT_STATES[number]

export const EVIDENCE_STATES = ['speculative', 'plausible', 'validated', 'verified'] as const
export type EvidenceState = typeof EVIDENCE_STATES[number]

export const ITEM_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
export type ItemStatus = typeof ITEM_STATUSES[number]

export const CHECK_STATUSES = ['pending', 'passed', 'failed', 'blocked'] as const
export type CheckStatus = typeof CHECK_STATUSES[number]

export const REVIEW_SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

export const REVIEW_CONFIDENCES = ['low', 'medium', 'high'] as const
export type ReviewConfidence = typeof REVIEW_CONFIDENCES[number]

export const READINESS_STATES = [
  'not_ready',
  'needs_evidence',
  'needs_review',
  'ready',
  'budget_stopped',
] as const
export type Readiness = typeof READINESS_STATES[number]

export const REQUIREMENT_SOURCES = ['explicit', 'inferred'] as const
export type RequirementSource = typeof REQUIREMENT_SOURCES[number]

export const EVIDENCE_KINDS = [
  'claimed',
  'inspection',
  'mutation',
  'observed_tool',
  'observed_check',
  'failed_observation',
  'review',
  'manual_confirmation',
] as const
export type ValidatedWorkEvidenceKind = typeof EVIDENCE_KINDS[number]

export const REVIEW_SUMMARY_STATUSES = [
  'never_run',
  'queued',
  'running',
  'complete',
  'stale',
  'failed',
] as const
export type ValidatedWorkReviewSummaryStatus = typeof REVIEW_SUMMARY_STATUSES[number]

export interface ValidatedWorkRequirement {
  id: string
  text: string
  source: RequirementSource
}

export interface ValidatedWorkGoal {
  id: string
  title: string
  requirementIds: string[]
  status: ItemStatus
}

export interface ValidatedWorkItem {
  id: string
  goalId?: string
  requirementIds: string[]
  text: string
  status: ItemStatus
  confidence: EvidenceState
  completionConfidence?: EvidenceState
}

export interface ValidatedWorkCheck {
  id: string
  requirementIds: string[]
  itemIds: string[]
  text: string
  status: CheckStatus
  evidenceIds: string[]
}

export interface ValidatedWorkEvidence {
  id: string
  kind: ValidatedWorkEvidenceKind
  summary: string
  observedAt: number
  toolCallId?: string
  entryId?: string
  checkIds: string[]
}

export interface ConfidenceObservation {
  itemId: string
  state: EvidenceState
  observedAt: number
  reason?: string
  evidenceIds: string[]
}

export interface ReadinessReason {
  code: string
  text: string
  requirementIds: string[]
  itemIds: string[]
  checkIds: string[]
  findingIds: string[]
}

export interface ValidatedWorkAutomationCounters {
  extraTurns: number
  reviewCalls: number
  attributedInputTokens: number
  attributedOutputTokens: number
  attributedCacheReadTokens: number
  attributedCacheWriteTokens: number
  attributedCostUsd: number
}

export interface ValidatedWorkAutomationLimits {
  maxExtraTurns: number
  maxAttributedCostUsd: number
}

export interface ValidatedWorkAutomation {
  counters: ValidatedWorkAutomationCounters
  limits: ValidatedWorkAutomationLimits
}

export interface LatestReviewSummary {
  reportId: string
  status: ValidatedWorkReviewSummaryStatus
  openBlockers: number
  diffHash?: string
}

export interface ValidatedWorkTimelineEvent {
  id: string
  type: string
  observedAt: number
  summary: string
  entryId?: string
}

export interface ValidatedWorkEventAggregates {
  totalEvents: number
  droppedEvents: number
  timeline: ValidatedWorkTimelineEvent[]
}

export interface ValidatedWorkStateV1 {
  protocol: typeof VALIDATED_WORK_PROTOCOL
  version: typeof VALIDATED_WORK_VERSION
  cycleId: string
  revision: number
  mode: ValidatedWorkMode
  phase: WorkPhase
  paused: boolean
  createdAt: number
  updatedAt: number
  userIntent: string
  intentState: IntentState
  assumptions: string[]
  requirements: ValidatedWorkRequirement[]
  goals: ValidatedWorkGoal[]
  items: ValidatedWorkItem[]
  checks: ValidatedWorkCheck[]
  evidence: ValidatedWorkEvidence[]
  confidenceHistory: ConfidenceObservation[]
  readiness: Readiness
  readinessReasons: ReadinessReason[]
  automation: ValidatedWorkAutomation
  latestReview?: LatestReviewSummary
  events: ValidatedWorkEventAggregates
}

export class ValidatedWorkParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidatedWorkParseError'
  }
}

export function parseValidatedWorkStateV1(value: unknown): ValidatedWorkStateV1 {
  assertSerializedSize(value, '$')
  const root = objectWithKeys(value, '$', [
    'protocol',
    'version',
    'cycleId',
    'revision',
    'mode',
    'phase',
    'paused',
    'createdAt',
    'updatedAt',
    'userIntent',
    'intentState',
    'assumptions',
    'requirements',
    'goals',
    'items',
    'checks',
    'evidence',
    'confidenceHistory',
    'readiness',
    'readinessReasons',
    'automation',
    'events',
  ], ['latestReview'])

  literal(root.protocol, VALIDATED_WORK_PROTOCOL, '$.protocol')
  literal(root.version, VALIDATED_WORK_VERSION, '$.version')

  const state: ValidatedWorkStateV1 = {
    protocol: VALIDATED_WORK_PROTOCOL,
    version: VALIDATED_WORK_VERSION,
    cycleId: idField(root, 'cycleId', '$'),
    revision: nonNegativeInteger(root.revision, '$.revision'),
    mode: enumValue(root.mode, VALIDATED_WORK_MODES, '$.mode'),
    phase: enumValue(root.phase, WORK_PHASES, '$.phase'),
    paused: booleanValue(root.paused, '$.paused'),
    createdAt: nonNegativeNumber(root.createdAt, '$.createdAt'),
    updatedAt: nonNegativeNumber(root.updatedAt, '$.updatedAt'),
    userIntent: textField(root, 'userIntent', '$'),
    intentState: enumValue(root.intentState, INTENT_STATES, '$.intentState'),
    assumptions: stringArray(root.assumptions, '$.assumptions', VALIDATED_WORK_LIMITS.assumptions),
    requirements: parseRequirements(root.requirements),
    goals: parseGoals(root.goals),
    items: parseItems(root.items),
    checks: parseChecks(root.checks),
    evidence: parseEvidence(root.evidence),
    confidenceHistory: parseConfidenceHistory(root.confidenceHistory),
    readiness: enumValue(root.readiness, READINESS_STATES, '$.readiness'),
    readinessReasons: parseReadinessReasons(root.readinessReasons),
    automation: parseAutomation(root.automation),
    events: parseEvents(root.events),
  }
  if (Object.hasOwn(root, 'latestReview')) state.latestReview = parseLatestReview(root.latestReview)

  validateStateReferences(state)
  return state
}

export function isValidatedWorkStateV1(value: unknown): value is ValidatedWorkStateV1 {
  try {
    parseValidatedWorkStateV1(value)
    return true
  } catch {
    return false
  }
}

function parseRequirements(value: unknown): ValidatedWorkRequirement[] {
  return array(value, '$.requirements', VALIDATED_WORK_LIMITS.requirements).map(
    (candidate, index) => {
      const path = `$.requirements[${index}]`
      const item = objectWithKeys(candidate, path, ['id', 'text', 'source'])
      return {
        id: idField(item, 'id', path),
        text: textField(item, 'text', path),
        source: enumValue(item.source, REQUIREMENT_SOURCES, `${path}.source`),
      }
    },
  )
}

function parseGoals(value: unknown): ValidatedWorkGoal[] {
  return array(value, '$.goals', VALIDATED_WORK_LIMITS.goals).map((candidate, index) => {
    const path = `$.goals[${index}]`
    const item = objectWithKeys(candidate, path, ['id', 'title', 'requirementIds', 'status'])
    return {
      id: idField(item, 'id', path),
      title: textField(item, 'title', path),
      requirementIds: idArray(item.requirementIds, `${path}.requirementIds`),
      status: enumValue(item.status, ITEM_STATUSES, `${path}.status`),
    }
  })
}

function parseItems(value: unknown): ValidatedWorkItem[] {
  return array(value, '$.items', VALIDATED_WORK_LIMITS.tasks).map((candidate, index) => {
    const path = `$.items[${index}]`
    const item = objectWithKeys(candidate, path, [
      'id',
      'requirementIds',
      'text',
      'status',
      'confidence',
    ], ['goalId', 'completionConfidence'])
    const parsed: ValidatedWorkItem = {
      id: idField(item, 'id', path),
      requirementIds: idArray(item.requirementIds, `${path}.requirementIds`),
      text: textField(item, 'text', path),
      status: enumValue(item.status, ITEM_STATUSES, `${path}.status`),
      confidence: enumValue(item.confidence, EVIDENCE_STATES, `${path}.confidence`),
    }
    if (Object.hasOwn(item, 'goalId')) parsed.goalId = idValue(item.goalId, `${path}.goalId`)
    if (Object.hasOwn(item, 'completionConfidence')) {
      parsed.completionConfidence = enumValue(
        item.completionConfidence,
        EVIDENCE_STATES,
        `${path}.completionConfidence`,
      )
    }
    return parsed
  })
}

function parseChecks(value: unknown): ValidatedWorkCheck[] {
  return array(value, '$.checks', VALIDATED_WORK_LIMITS.checks).map((candidate, index) => {
    const path = `$.checks[${index}]`
    const item = objectWithKeys(candidate, path, [
      'id',
      'requirementIds',
      'itemIds',
      'text',
      'status',
      'evidenceIds',
    ])
    return {
      id: idField(item, 'id', path),
      requirementIds: idArray(item.requirementIds, `${path}.requirementIds`),
      itemIds: idArray(item.itemIds, `${path}.itemIds`),
      text: textField(item, 'text', path),
      status: enumValue(item.status, CHECK_STATUSES, `${path}.status`),
      evidenceIds: idArray(item.evidenceIds, `${path}.evidenceIds`),
    }
  })
}

function parseEvidence(value: unknown): ValidatedWorkEvidence[] {
  return array(value, '$.evidence', VALIDATED_WORK_LIMITS.evidenceRecords).map(
    (candidate, index) => {
      const path = `$.evidence[${index}]`
      const item = objectWithKeys(candidate, path, [
        'id',
        'kind',
        'summary',
        'observedAt',
        'checkIds',
      ], ['toolCallId', 'entryId'])
      const parsed: ValidatedWorkEvidence = {
        id: idField(item, 'id', path),
        kind: enumValue(item.kind, EVIDENCE_KINDS, `${path}.kind`),
        summary: textField(item, 'summary', path, VALIDATED_WORK_LIMITS.observationSummaryChars),
        observedAt: nonNegativeNumber(item.observedAt, `${path}.observedAt`),
        checkIds: idArray(item.checkIds, `${path}.checkIds`),
      }
      if (Object.hasOwn(item, 'toolCallId'))
        parsed.toolCallId = idValue(item.toolCallId, `${path}.toolCallId`)
      if (Object.hasOwn(item, 'entryId')) parsed.entryId = idValue(item.entryId, `${path}.entryId`)
      return parsed
    },
  )
}

function parseConfidenceHistory(value: unknown): ConfidenceObservation[] {
  return array(value, '$.confidenceHistory', Number.MAX_SAFE_INTEGER).map((candidate, index) => {
    const path = `$.confidenceHistory[${index}]`
    const item = objectWithKeys(candidate, path, [
      'itemId',
      'state',
      'observedAt',
      'evidenceIds',
    ], ['reason'])
    const parsed: ConfidenceObservation = {
      itemId: idField(item, 'itemId', path),
      state: enumValue(item.state, EVIDENCE_STATES, `${path}.state`),
      observedAt: nonNegativeNumber(item.observedAt, `${path}.observedAt`),
      evidenceIds: idArray(item.evidenceIds, `${path}.evidenceIds`),
    }
    if (Object.hasOwn(item, 'reason')) parsed.reason = textField(item, 'reason', path)
    return parsed
  })
}

function parseReadinessReasons(value: unknown): ReadinessReason[] {
  return array(value, '$.readinessReasons', Number.MAX_SAFE_INTEGER).map((candidate, index) => {
    const path = `$.readinessReasons[${index}]`
    const item = objectWithKeys(candidate, path, [
      'code',
      'text',
      'requirementIds',
      'itemIds',
      'checkIds',
      'findingIds',
    ])
    return {
      code: idField(item, 'code', path),
      text: textField(item, 'text', path),
      requirementIds: idArray(item.requirementIds, `${path}.requirementIds`),
      itemIds: idArray(item.itemIds, `${path}.itemIds`),
      checkIds: idArray(item.checkIds, `${path}.checkIds`),
      findingIds: idArray(item.findingIds, `${path}.findingIds`),
    }
  })
}

function parseAutomation(value: unknown): ValidatedWorkAutomation {
  const item = objectWithKeys(value, '$.automation', ['counters', 'limits'])
  return {
    counters: parseAutomationCounters(item.counters),
    limits: parseAutomationLimits(item.limits),
  }
}

function parseAutomationCounters(value: unknown): ValidatedWorkAutomationCounters {
  const item = objectWithKeys(value, '$.automation.counters', [
    'extraTurns',
    'reviewCalls',
    'attributedInputTokens',
    'attributedOutputTokens',
    'attributedCacheReadTokens',
    'attributedCacheWriteTokens',
    'attributedCostUsd',
  ])
  return {
    extraTurns: nonNegativeInteger(item.extraTurns, '$.automation.counters.extraTurns'),
    reviewCalls: nonNegativeInteger(item.reviewCalls, '$.automation.counters.reviewCalls'),
    attributedInputTokens: nonNegativeInteger(
      item.attributedInputTokens,
      '$.automation.counters.attributedInputTokens',
    ),
    attributedOutputTokens: nonNegativeInteger(
      item.attributedOutputTokens,
      '$.automation.counters.attributedOutputTokens',
    ),
    attributedCacheReadTokens: nonNegativeInteger(
      item.attributedCacheReadTokens,
      '$.automation.counters.attributedCacheReadTokens',
    ),
    attributedCacheWriteTokens: nonNegativeInteger(
      item.attributedCacheWriteTokens,
      '$.automation.counters.attributedCacheWriteTokens',
    ),
    attributedCostUsd: nonNegativeNumber(
      item.attributedCostUsd,
      '$.automation.counters.attributedCostUsd',
    ),
  }
}

function parseAutomationLimits(value: unknown): ValidatedWorkAutomationLimits {
  const item = objectWithKeys(value, '$.automation.limits', [
    'maxExtraTurns',
    'maxAttributedCostUsd',
  ])
  return {
    maxExtraTurns: nonNegativeInteger(item.maxExtraTurns, '$.automation.limits.maxExtraTurns'),
    maxAttributedCostUsd: nonNegativeNumber(
      item.maxAttributedCostUsd,
      '$.automation.limits.maxAttributedCostUsd',
    ),
  }
}

function parseLatestReview(value: unknown): LatestReviewSummary {
  const item = objectWithKeys(value, '$.latestReview', [
    'reportId',
    'status',
    'openBlockers',
  ], ['diffHash'])
  const parsed: LatestReviewSummary = {
    reportId: idField(item, 'reportId', '$.latestReview'),
    status: enumValue(item.status, REVIEW_SUMMARY_STATUSES, '$.latestReview.status'),
    openBlockers: nonNegativeInteger(item.openBlockers, '$.latestReview.openBlockers'),
  }
  if (Object.hasOwn(item, 'diffHash'))
    parsed.diffHash = textField(item, 'diffHash', '$.latestReview')
  return parsed
}

function parseEvents(value: unknown): ValidatedWorkEventAggregates {
  const item = objectWithKeys(value, '$.events', ['totalEvents', 'droppedEvents', 'timeline'])
  const timeline = array(item.timeline, '$.events.timeline', VALIDATED_WORK_LIMITS.timelineEvents)
    .map(
      (candidate, index) => {
        const path = `$.events.timeline[${index}]`
        const event = objectWithKeys(candidate, path, [
          'id',
          'type',
          'observedAt',
          'summary',
        ], ['entryId'])
        const parsed: ValidatedWorkTimelineEvent = {
          id: idField(event, 'id', path),
          type: idField(event, 'type', path),
          observedAt: nonNegativeNumber(event.observedAt, `${path}.observedAt`),
          summary: textField(event, 'summary', path),
        }
        if (Object.hasOwn(event, 'entryId'))
          parsed.entryId = idValue(event.entryId, `${path}.entryId`)
        return parsed
      },
    )
  uniqueIds(timeline, '$.events.timeline')
  return {
    totalEvents: nonNegativeInteger(item.totalEvents, '$.events.totalEvents'),
    droppedEvents: nonNegativeInteger(item.droppedEvents, '$.events.droppedEvents'),
    timeline,
  }
}

function validateStateReferences(state: ValidatedWorkStateV1): void {
  const requirementIds = uniqueIds(state.requirements, '$.requirements')
  const goalIds = uniqueIds(state.goals, '$.goals')
  const itemIds = uniqueIds(state.items, '$.items')
  const checkIds = uniqueIds(state.checks, '$.checks')
  const evidenceIds = uniqueIds(state.evidence, '$.evidence')

  for (const goal of state.goals) {
    references(goal.requirementIds, requirementIds, `$.goals.${goal.id}.requirementIds`)
  }
  for (const item of state.items) {
    references(item.requirementIds, requirementIds, `$.items.${item.id}.requirementIds`)
    if (item.goalId) references([item.goalId], goalIds, `$.items.${item.id}.goalId`)
  }
  for (const check of state.checks) {
    references(check.requirementIds, requirementIds, `$.checks.${check.id}.requirementIds`)
    references(check.itemIds, itemIds, `$.checks.${check.id}.itemIds`)
    references(check.evidenceIds, evidenceIds, `$.checks.${check.id}.evidenceIds`)
  }
  for (const evidence of state.evidence) {
    references(evidence.checkIds, checkIds, `$.evidence.${evidence.id}.checkIds`)
  }
  const confidenceCounts = new Map<string, number>()
  for (const observation of state.confidenceHistory) {
    references([observation.itemId], itemIds, `$.confidenceHistory.${observation.itemId}.itemId`)
    references(
      observation.evidenceIds,
      evidenceIds,
      `$.confidenceHistory.${observation.itemId}.evidenceIds`,
    )
    const count = (confidenceCounts.get(observation.itemId) ?? 0) + 1
    if (count > VALIDATED_WORK_LIMITS.confidenceObservationsPerItem) {
      throw new ValidatedWorkParseError(
        `$.confidenceHistory.${observation.itemId} exceeds ${VALIDATED_WORK_LIMITS.confidenceObservationsPerItem} observations`,
      )
    }
    confidenceCounts.set(observation.itemId, count)
  }
  for (const reason of state.readinessReasons) {
    references(
      reason.requirementIds,
      requirementIds,
      `$.readinessReasons.${reason.code}.requirementIds`,
    )
    references(reason.itemIds, itemIds, `$.readinessReasons.${reason.code}.itemIds`)
    references(reason.checkIds, checkIds, `$.readinessReasons.${reason.code}.checkIds`)
  }
}

function objectWithKeys(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!isObject(value)) throw new ValidatedWorkParseError(`${path} must be an object`)
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ValidatedWorkParseError(`${path}.${key} is not allowed`)
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new ValidatedWorkParseError(`${path}.${key} is required`)
  }
  return value
}

function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new ValidatedWorkParseError(`${path} must be ${String(expected)}`)
  return expected
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidatedWorkParseError(`${path} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidatedWorkParseError(`${path} must be a boolean`)
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidatedWorkParseError(`${path} must be a non-negative finite number`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path)
  if (!Number.isInteger(parsed)) throw new ValidatedWorkParseError(`${path} must be an integer`)
  return parsed
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new ValidatedWorkParseError(`${path} must be an array`)
  if (value.length > max) throw new ValidatedWorkParseError(`${path} exceeds ${max} entries`)
  return value
}

function stringArray(value: unknown, path: string, max: number): string[] {
  return array(value, path, max).map((candidate, index) =>
    textValue(candidate, `${path}[${index}]`)
  )
}

function idArray(value: unknown, path: string): string[] {
  const values = array(value, path, Number.MAX_SAFE_INTEGER).map((candidate, index) =>
    idValue(candidate, `${path}[${index}]`)
  )
  const seen = new Set<string>()
  for (const id of values) {
    if (seen.has(id))
      throw new ValidatedWorkParseError(`${path} contains duplicate reference ${id}`)
    seen.add(id)
  }
  return values
}

function idField(value: Record<string, unknown>, key: string, path: string): string {
  return idValue(value[key], `${path}.${key}`)
}

function idValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(value)) {
    throw new ValidatedWorkParseError(`${path} must be an ASCII id of 1-80 chars`)
  }
  return value
}

function textField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  max: number = VALIDATED_WORK_LIMITS.textChars,
): string {
  return textValue(value[key], `${path}.${key}`, max)
}

function textValue(
  value: unknown,
  path: string,
  max: number = VALIDATED_WORK_LIMITS.textChars,
): string {
  if (typeof value !== 'string') throw new ValidatedWorkParseError(`${path} must be a string`)
  if (value.length > max) throw new ValidatedWorkParseError(`${path} exceeds ${max} chars`)
  return value
}

function uniqueIds(items: readonly { id: string }[], path: string): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id))
      throw new ValidatedWorkParseError(`${path} contains duplicate id ${item.id}`)
    ids.add(item.id)
  }
  return ids
}

function references(values: readonly string[], allowed: ReadonlySet<string>, path: string): void {
  for (const value of values) {
    if (!allowed.has(value))
      throw new ValidatedWorkParseError(`${path} references unknown id ${value}`)
  }
}

function assertSerializedSize(value: unknown, path: string): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new ValidatedWorkParseError(`${path} must be JSON serializable: ${String(error)}`)
  }
  const bytes = new TextEncoder().encode(serialized).length
  if (bytes > VALIDATED_WORK_LIMITS.serializedStateBytes) {
    throw new ValidatedWorkParseError(
      `${path} exceeds ${VALIDATED_WORK_LIMITS.serializedStateBytes} serialized bytes`,
    )
  }
}
