import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { isObject } from '../shared/is-object.ts'
import {
  parseCopilotUsage,
  parseDeepSeekBalance,
  parseMoonshotBalance,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import type {
  CopilotQuotaWindow,
  OpenAiQuotaWindow,
  ProviderBalance,
  QuotaProviderReport,
  QuotaReport,
} from '../shared/types.ts'

const statusKey = 'pi-livecraft.quotas'
const timeoutMs = 15_000

/** Registers a silent RPC command that publishes only normalized quotas to Pi Livecraft. */
export default function registerQuotas(pi: ExtensionAPI): void {
  let lastRefreshAt = 0
  let lastReport: QuotaReport | undefined
  let pendingRefresh: Promise<void> | undefined

  /** Deduplicates requests and spaces automatic snapshots without limiting manual clicks. */
  function refresh(ctx: ExtensionContext, automatic: boolean): Promise<void> {
    const now = Date.now()
    if (!quotaRefreshAllowed(lastRefreshAt, automatic, now)) {
      if (lastReport) ctx.ui.setStatus(statusKey, JSON.stringify(lastReport))
      return Promise.resolve()
    }
    lastRefreshAt = now
    pendingRefresh ??= publishQuotaReport(ctx)
      .then((report) => {
        lastReport = report
      })
      .finally(() => {
        pendingRefresh = undefined
      })
    return pendingRefresh
  }

  pi.on('session_start', (_event, ctx) => {
    void refresh(ctx, true)
  })
  pi.registerCommand('livecraft-quotas', {
    description: 'Refresh Pi Livecraft quotas',
    handler: async (args, ctx) => refresh(ctx, args.trim() === 'auto'),
  })
}

async function publishQuotaReport(ctx: ExtensionContext): Promise<QuotaReport> {
  const [openai, copilot, deepseek, moonshot, moonshotCn] = await Promise.all([
    fetchOpenAiQuotas(ctx),
    fetchCopilotQuotas(ctx),
    fetchDeepSeekBalance(ctx),
    fetchMoonshotBalance(ctx, 'moonshotai', 'https://api.moonshot.ai/v1/users/me/balance', 'USD'),
    fetchMoonshotBalance(
      ctx,
      'moonshotai-cn',
      'https://api.moonshot.cn/v1/users/me/balance',
      'CNY',
    ),
  ])
  const report: QuotaReport = {
    protocol: 'pi-livecraft.quotas',
    version: 2,
    refreshedAt: Date.now(),
    openai,
    copilot,
    deepseek,
    moonshot,
    moonshotCn,
  }
  ctx.ui.setStatus(statusKey, JSON.stringify(report))
  return report
}

/** Resolves OAuth through Pi before calling the Codex usage endpoint. */
async function fetchOpenAiQuotas(
  ctx: ExtensionContext,
): Promise<QuotaProviderReport<OpenAiQuotaWindow>> {
  try {
    const auth = await ctx.modelRegistry.getProviderAuth('openai-codex')
    const credential = await readCredential(ctx, 'openai-codex')
    const token = auth?.auth.apiKey
    const accountId = stringField(credential, 'accountId')
    if (!token || !accountId) return failure('OpenAI Codex connection is unavailable in Pi.')
    const data = await fetchJson('https://chatgpt.com/backend-api/wham/usage', {
      Authorization: `Bearer ${token}`,
      'ChatGPT-Account-Id': accountId,
      Accept: 'application/json',
      Origin: 'https://chatgpt.com',
      Referer: 'https://chatgpt.com/',
    })
    return { ok: true, data: parseOpenAiUsage(data) }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch OpenAI quotas.'))
  }
}

/** Uses the GitHub OAuth token held by Pi, not the Copilot proxy token. */
async function fetchCopilotQuotas(
  ctx: ExtensionContext,
): Promise<QuotaProviderReport<CopilotQuotaWindow>> {
  try {
    await ctx.modelRegistry.getProviderAuth('github-copilot')
    const credential = await readCredential(ctx, 'github-copilot')
    const token = stringField(credential, 'refresh')
    if (!token) return failure('GitHub Copilot connection is unavailable in Pi.')
    const data = await fetchJson('https://api.github.com/copilot_internal/user', {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'Copilot-Integration-Id': 'vscode-chat',
    })
    return { ok: true, data: parseCopilotUsage(data) }
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch Copilot quotas.'))
  }
}

/** Uses the API key already resolved by Pi to read DeepSeek's official account balance. */
async function fetchDeepSeekBalance(
  ctx: ExtensionContext,
): Promise<QuotaProviderReport<ProviderBalance>> {
  try {
    const token = await providerApiKey(ctx, 'deepseek')
    if (!token) return { ok: true, data: [] }
    const balances = parseDeepSeekBalance(
      await fetchJson('https://api.deepseek.com/user/balance', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      }),
    )
    return balances.length > 0
      ? { ok: true, data: balances }
      : failure('The DeepSeek balance response was not recognized.')
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch DeepSeek balance.'))
  }
}

/** Reads one Moonshot regional account; international and China keys are independent. */
async function fetchMoonshotBalance(
  ctx: ExtensionContext,
  provider: 'moonshotai' | 'moonshotai-cn',
  url: string,
  currency: 'USD' | 'CNY',
): Promise<QuotaProviderReport<ProviderBalance>> {
  try {
    const token = await providerApiKey(ctx, provider)
    if (!token) return { ok: true, data: [] }
    const balances = parseMoonshotBalance(
      await fetchJson(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' }),
      currency,
    )
    return balances.length > 0
      ? { ok: true, data: balances }
      : failure('The Moonshot balance response was not recognized.')
  } catch (error) {
    return failure(fetchError(error, 'Unable to fetch Moonshot balance.'))
  }
}

async function providerApiKey(
  ctx: ExtensionContext,
  provider: string,
): Promise<string | undefined> {
  const auth = await ctx.modelRegistry.getProviderAuth(provider)
  return auth?.auth.apiKey ?? stringField(await readCredential(ctx, provider), 'key')
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Reads the credential held by the Pi runtime without accessing its storage file. */
async function readCredential(ctx: ExtensionContext, provider: string): Promise<unknown> {
  const registry = ctx.modelRegistry as unknown as {
    runtime?: { credentials?: { read?: (providerId: string) => Promise<unknown> } }
  }
  const read = registry.runtime?.credentials?.read
  return read ? read.call(registry.runtime?.credentials, provider) : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const field = object(value)?.[key]
  return typeof field === 'string' && field ? field : undefined
}

function failure<T>(error: string): QuotaProviderReport<T> {
  return { ok: false, error }
}

function fetchError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'The quota request timed out.'
  if (error instanceof Error && /^HTTP \d{3}$/.test(error.message))
    return `${fallback} (${error.message})`
  return fallback
}
