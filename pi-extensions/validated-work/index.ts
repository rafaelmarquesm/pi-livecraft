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
  defaultConfig,
  applyValidatedWorkAction,
  approveState,
  createInitialState,
  reconstructValidatedWork,
  summaryJson,
  type BranchEntryLike,
  type ValidatedWorkConfigEntry,
  validatedWorkConfigType,
  validatedWorkConfigVersion,
  validatedWorkStatusKey,
  validatedWorkToolName,
} from './state.ts'
import { parseCommandArgs, validatedWorkToolParameters } from './schema.ts'
import type { ValidatedWorkStateV1 } from '../../shared/validated-work.ts'

export default function registerValidatedWork(pi: ExtensionAPI): void {
  let config: ValidatedWorkConfigEntry = defaultConfig()
  let state: ValidatedWorkStateV1 = createInactiveState()
  let registeredTool = false

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
      const mode = command.mode ?? 'standard'
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
        maxExtraTurns: command.maxExtraTurns,
        maxAttributedCostUsd: command.maxAttributedCostUsd,
      }
      state = state.mode === mode && state.phase !== 'idle'
        ? state
        : createInitialState(mode, now, config)
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
