import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { isObject } from '../../shared/is-object.ts'
import {
  activatePlanningTools,
  captureToolsBeforePlanning,
  enforcePlanningToolGate,
  restorePlanningTools,
} from './gates.ts'
import {
  planningSystemPrompt,
  validatedWorkPromptGuidelines,
  validatedWorkPromptSnippet,
} from './prompt.ts'
import {
  applyObservedEvidenceBatch,
  defaultConfig,
  applyValidatedWorkAction,
  approveState,
  createInitialState,
  evidenceIdForToolCall,
  incrementExtraTurn,
  recordBudgetStop,
  reconstructValidatedWork,
  setPausedState,
  summaryJson,
  type BranchEntryLike,
  type ValidatedWorkConfigEntry,
  type ValidatedWorkEvidenceBatchEntry,
  validatedWorkAttributionType,
  validatedWorkAttributionVersion,
  validatedWorkConfigType,
  validatedWorkConfigVersion,
  validatedWorkEvidenceBatchType,
  validatedWorkEvidenceBatchVersion,
  validatedWorkStatusKey,
  validatedWorkToolName,
} from './state.ts'
import {
  classifyToolEvidence,
  outputSummaryFromResult,
  summarizeToolObservation,
  toolSubjectFromArgs,
  type ObservedToolEvidenceDraft,
} from './evidence.ts'
import { parseCommandArgs, validatedWorkToolParameters } from './schema.ts'
import type { ValidatedWorkStateV1 } from '../../shared/validated-work.ts'

interface PendingToolObservation {
  toolCallId: string
  toolName: string
  args: unknown
  startedAt: number
}

interface ActiveSyntheticTurn {
  markerId: string
  reason: string
  stateRevision: number
  startedAt: number
}

export default function registerValidatedWork(pi: ExtensionAPI): void {
  let config: ValidatedWorkConfigEntry = defaultConfig()
  let state: ValidatedWorkStateV1 = createInactiveState()
  let registeredTool = false
  let pendingTools = new Map<string, PendingToolObservation>()
  let turnEvidence: ObservedToolEvidenceDraft[] = []
  let lastFollowUpFingerprint: string | undefined
  let lastProgressRevision = -1
  let lastProgressEvidenceCount = -1
  let activeSyntheticTurn: ActiveSyntheticTurn | undefined

  function registerToolOnce(): void {
    if (registeredTool) return
    registeredTool = true
    pi.registerTool({
      name: validatedWorkToolName,
      label: 'Validated Work',
      description: 'Maintain Pi Livecraft structured planning, evidence, and readiness state.',
      promptSnippet: validatedWorkPromptSnippet,
      promptGuidelines: validatedWorkPromptGuidelines,
      parameters: validatedWorkToolParameters,
      executionMode: 'sequential',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        if (signal?.aborted) throw new Error('validated_work was aborted.')
        state = applyValidatedWorkAction(state, params)
        publishSummary(ctx)
        return {
          content: [{ type: 'text' as const, text: shortResultText(state, params.action) }],
          details: state,
        }
      },
    })
  }

  pi.on('session_start', (_event, ctx) => {
    registerToolOnce()
    const reconstructed = reconstructValidatedWork(
      ctx.sessionManager.getBranch() as BranchEntryLike[],
    )
    config = reconstructed.config
    state = reconstructed.state
    if (state.mode === 'standard') {
      removeValidatedToolFromActiveList()
      return
    }
    if (state.phase === 'planning' || state.phase === 'awaiting_approval') activatePlanningTools(pi)
    publishSummary(ctx)
  })

  pi.on('agent_start', () => {
    pendingTools = new Map()
    turnEvidence = []
  })

  pi.on('before_agent_start', () => {
    if (
      state.mode === 'standard'
      || (state.phase !== 'planning' && state.phase !== 'awaiting_approval')
    ) {
      return undefined
    }
    return { systemPrompt: planningSystemPrompt }
  })

  pi.on('tool_call', (event) => {
    const toolName = toolNameFromEvent(event)
    return enforcePlanningToolGate(state, toolName)
  })

  pi.on('tool_execution_start', (event) => {
    if (state.mode === 'standard' || !isObject(event) || typeof event.toolCallId !== 'string')
      return
    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown'
    if (toolName === validatedWorkToolName) return
    pendingTools.set(event.toolCallId, {
      toolCallId: event.toolCallId,
      toolName,
      args: event.args,
      startedAt: Date.now(),
    })
  })

  pi.on('tool_execution_end', (event) => {
    if (state.mode === 'standard' || !isObject(event) || typeof event.toolCallId !== 'string')
      return
    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown'
    if (toolName === validatedWorkToolName) return
    const started = pendingTools.get(event.toolCallId)
    const now = Date.now()
    const args = started?.args
    const commandOrPath = toolSubjectFromArgs(toolName, args)
    const output = outputSummaryFromResult(event.result)
    turnEvidence.push({
      id: evidenceIdForToolCall(event.toolCallId),
      kind: classifyToolEvidence(toolName, event.isError === true, commandOrPath),
      summary: summarizeToolObservation(
        toolName,
        commandOrPath,
        output,
        started ? now - started.startedAt : undefined,
      ),
      observedAt: now,
      toolCallId: event.toolCallId,
      checkIds: [],
      toolName,
      ...(started ? { durationMs: now - started.startedAt } : {}),
      ...(commandOrPath ? { commandOrPath } : {}),
      isError: event.isError === true,
    })
    pendingTools.delete(event.toolCallId)
  })

  pi.on('turn_end', (event, ctx) => {
    if (state.mode !== 'standard' && turnEvidence.length > 0) {
      const withEntryIds = addEntryIdsFromTurn(event, turnEvidence)
      const batch: ValidatedWorkEvidenceBatchEntry = {
        protocol: validatedWorkEvidenceBatchType,
        version: validatedWorkEvidenceBatchVersion,
        cycleId: state.cycleId,
        stateRevision: state.revision,
        observedAt: Date.now(),
        evidence: withEntryIds,
      }
      pi.appendEntry(validatedWorkEvidenceBatchType, batch)
      state = applyObservedEvidenceBatch(state, withEntryIds)
      publishSummary(ctx)
    }
    turnEvidence = []
    pendingTools.clear()
  })

  pi.on('message_end', (event) => {
    if (!activeSyntheticTurn || !isObject(event) || !isObject(event.message)) return
    if (event.message.role !== 'assistant') return
    const entryId = typeof event.message.id === 'string'
      ? event.message.id
      : typeof (event as { id?: unknown }).id === 'string'
      ? (event as { id: string }).id
      : undefined
    appendAttribution({ ...activeSyntheticTurn, targetEntryId: entryId, settledAt: Date.now() })
  })

  pi.on('agent_settled', (_event, ctx) => {
    if (!activeSyntheticTurn) {
      maybeQueueValidatedFollowUp(ctx)
      return
    }
    activeSyntheticTurn = undefined
    maybeQueueValidatedFollowUp(ctx)
  })

  pi.on('session_shutdown', () => {
    pendingTools.clear()
    turnEvidence = []
    activeSyntheticTurn = undefined
  })

  pi.registerCommand('livecraft-validated-work', {
    description: 'Configure Pi Livecraft Validated Work mode',
    handler: async (args, ctx) => {
      const command = parseCommandArgs(args)
      if (command.action === 'status') {
        publishSummary(ctx)
        return
      }
      const now = Date.now()
      if (command.action === 'approve') {
        state = approveState(state, now)
        restorePlanningTools(pi, config)
        config = { ...config, approvedAt: now, updatedAt: now }
        appendConfig(config)
        publishSummary(ctx)
        return
      }
      if (command.action === 'abort_automation') {
        config = { ...config, paused: true, abortedAt: now, updatedAt: now }
        state = setPausedState(state, true, now)
        appendConfig(config)
        publishSummary(ctx)
        if (activeSyntheticTurn && !ctx.isIdle()) ctx.abort()
        activeSyntheticTurn = undefined
        return
      }
      if (command.paused !== undefined && command.mode === undefined) {
        config = { ...config, paused: command.paused, updatedAt: now }
        state = setPausedState(state, command.paused, now)
        appendConfig(config)
        publishSummary(ctx)
        return
      }
      const mode = command.mode ?? state.mode
      if (mode === 'standard') {
        restorePlanningTools(pi, config)
        config = { ...defaultConfig(now), toolsBeforePlanning: config.toolsBeforePlanning }
        state = createInactiveState(now)
        appendConfig(config)
        ctx.ui.setStatus(validatedWorkStatusKey, undefined)
        removeValidatedToolFromActiveList()
        return
      }
      const toolsBeforePlanning = state.mode === 'standard'
        ? captureToolsBeforePlanning(pi)
        : config.toolsBeforePlanning ?? captureToolsBeforePlanning(pi)
      config = {
        protocol: validatedWorkConfigType,
        version: validatedWorkConfigVersion,
        mode,
        updatedAt: now,
        toolsBeforePlanning,
        paused: command.paused ?? false,
        maxExtraTurns: command.maxExtraTurns,
        maxAttributedCostUsd: command.maxAttributedCostUsd,
      }
      state = state.mode === mode && state.phase !== 'idle'
        ? state
        : createInitialState(mode, now, config)
      if (command.paused !== undefined) state = setPausedState(state, command.paused, now)
      activatePlanningTools(pi)
      appendConfig(config)
      publishSummary(ctx)
    },
  })

  function publishSummary(ctx: ExtensionContext): void {
    if (state.mode === 'standard') return
    ctx.ui.setStatus(validatedWorkStatusKey, summaryJson(state))
  }

  function appendConfig(nextConfig: ValidatedWorkConfigEntry): void {
    pi.appendEntry(validatedWorkConfigType, nextConfig)
  }

  function maybeQueueValidatedFollowUp(ctx: ExtensionContext): void {
    if (state.paused) return
    if (state.mode !== 'validated') return
    if (state.readiness === 'ready') return
    if (state.readiness === 'budget_stopped') return
    if (state.automation.counters.extraTurns >= state.automation.limits.maxExtraTurns) {
      state = recordBudgetStop(
        state,
        'turn-budget-stop',
        'Stopped at the configured automatic turn limit.',
      )
      publishSummary(ctx)
      return
    }
    if (
      state.automation.counters.attributedCostUsd >= state.automation.limits.maxAttributedCostUsd
    ) {
      state = recordBudgetStop(
        state,
        'cost-budget-stop',
        'Stopped at the configured attributed cost limit.',
      )
      publishSummary(ctx)
      return
    }
    const reason = state.readinessReasons[0]
    if (!reason) return
    const fingerprint = `${state.cycleId}:${reason.code}:${state.revision}`
    const progressed = state.revision !== lastProgressRevision
      || state.evidence.length !== lastProgressEvidenceCount
    if (fingerprint === lastFollowUpFingerprint || !progressed) {
      state = recordBudgetStop(
        state,
        'no-progress',
        'Stopped because the last automatic follow-up made no observable progress.',
      )
      publishSummary(ctx)
      return
    }
    lastFollowUpFingerprint = fingerprint
    const markerId = `auto-${Date.now().toString(36)}`
    activeSyntheticTurn = {
      markerId,
      reason: reason.code,
      stateRevision: state.revision,
      startedAt: Date.now(),
    }
    appendAttribution(activeSyntheticTurn)
    state = incrementExtraTurn(state)
    lastProgressRevision = state.revision
    lastProgressEvidenceCount = state.evidence.length
    publishSummary(ctx)
    pi.sendMessage({
      customType: 'pi-livecraft.validated-work-followup',
      content: followUpText(reason.code, reason.text),
      display: false,
      details: { cycleId: state.cycleId, reason: reason.code, stateRevision: state.revision },
    }, { deliverAs: 'followUp', triggerTurn: true })
  }

  function appendAttribution(
    marker: ActiveSyntheticTurn & { targetEntryId?: string; settledAt?: number },
  ): void {
    pi.appendEntry(validatedWorkAttributionType, {
      protocol: validatedWorkAttributionType,
      version: validatedWorkAttributionVersion,
      cycleId: state.cycleId,
      purpose: 'automated_validation',
      markerId: marker.markerId,
      reason: marker.reason,
      stateRevision: marker.stateRevision,
      startedAt: marker.startedAt,
      ...(marker.targetEntryId ? { targetEntryId: marker.targetEntryId } : {}),
      ...(marker.settledAt ? { settledAt: marker.settledAt } : {}),
    })
  }

  function removeValidatedToolFromActiveList(): void {
    const active = pi.getActiveTools()
    if (active.includes(validatedWorkToolName)) {
      pi.setActiveTools(active.filter((name) => name !== validatedWorkToolName))
    }
  }
}

function createInactiveState(now = Date.now()): ValidatedWorkStateV1 {
  const state = createInitialState('plan', now)
  return { ...state, mode: 'standard', phase: 'idle' }
}

function shortResultText(state: ValidatedWorkStateV1, action: string): string {
  return `Validated Work ${action} accepted. Mode ${state.mode}, phase ${state.phase}, revision ${state.revision}.`
}

function toolNameFromEvent(event: unknown): string | undefined {
  if (!isObject(event)) return undefined
  const toolName = event.toolName ?? event.name
  return typeof toolName === 'string' ? toolName : undefined
}

function addEntryIdsFromTurn(
  event: unknown,
  evidence: readonly ObservedToolEvidenceDraft[],
): ObservedToolEvidenceDraft[] {
  if (!isObject(event) || !Array.isArray(event.toolResults)) return [...evidence]
  const entryIds = new Map<string, string>()
  for (const result of event.toolResults) {
    if (!isObject(result) || typeof result.toolCallId !== 'string') continue
    const entryId = typeof result.id === 'string'
      ? result.id
      : typeof result.entryId === 'string'
      ? result.entryId
      : undefined
    if (entryId) entryIds.set(result.toolCallId, entryId)
  }
  return evidence.map((item) => {
    const entryId = item.toolCallId ? entryIds.get(item.toolCallId) : undefined
    return entryId ? { ...item, entryId } : item
  })
}

function followUpText(code: string, text: string): string {
  if (code === 'items-open') return `Continue only the open Validated Work items. ${text}`
  if (code === 'requirements-without-checks')
    return `Add checks for the untraced requirements, then update validated_work. ${text}`
  if (code === 'checks-not-passed')
    return `Run or fix the mapped checks, then link observed evidence. ${text}`
  if (code === 'completion-confidence-insufficient')
    return `Link observed evidence and set completion confidence only where justified. ${text}`
  if (code === 'confidence-spike-unreviewed')
    return `Review the confidence spike and either justify it with evidence or lower confidence. ${text}`
  return `Address this Validated Work blocker, then update validated_work: ${text}`
}
