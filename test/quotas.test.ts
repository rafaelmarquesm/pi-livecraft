import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseCopilotUsage,
  parseDeepSeekBalance,
  parseMoonshotBalance,
  parseOpenAiUsage,
} from '../shared/quota-parsers.ts'
import { quotaRefreshAllowed } from '../shared/quota-refresh.ts'
import { QuotaCache } from '../server/features/quotas/quota-cache.ts'
import { quotaProviderForModel, railQuota } from '../src/features/quotas/quota-display.ts'

test('normalizes the Codex five-hour and weekly windows', () => {
  assert.deepEqual(
    parseOpenAiUsage({
      rate_limit: {
        primary_window: {
          used_percent: 24.5,
          reset_at: 1_800_000_000,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          percent_left: 31,
          reset_at: 1_900_000_000,
          limit_window_seconds: 604_800,
        },
      },
    }),
    [
      { period: '5h', remainingPercent: 75.5, resetsAt: 1_800_000_000_000 },
      { period: '7d', remainingPercent: 31, resetsAt: 1_900_000_000_000 },
    ],
  )
})

test('keeps only finite monthly Copilot quotas', () => {
  assert.deepEqual(
    parseCopilotUsage({
      quota_reset_date: '2030-01-01T00:00:00Z',
      quota_snapshots: {
        premium_interactions: { entitlement: 300, remaining: 125, unlimited: false },
        chat: { entitlement: 0, remaining: 0, unlimited: true },
      },
    }),
    [{
      name: 'Premium interactions',
      used: 175,
      limit: 300,
      resetsAt: Date.parse('2030-01-01T00:00:00Z'),
    }],
  )
})

test('normalizes DeepSeek and regional Moonshot account balances', () => {
  assert.deepEqual(
    parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{
        currency: 'USD',
        total_balance: '12.3456',
        granted_balance: '2.5',
        topped_up_balance: '9.8456',
      }],
    }),
    [{
      currency: 'USD',
      total: 12.3456,
      granted: 2.5,
      toppedUp: 9.8456,
      usable: true,
    }],
  )
  assert.deepEqual(
    parseMoonshotBalance({
      data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
    }, 'USD'),
    [{
      currency: 'USD',
      total: 49.58894,
      voucher: 46.58893,
      cash: 3.00001,
    }],
  )
  assert.deepEqual(parseDeepSeekBalance({ balance_infos: [{ total_balance: 'NaN' }] }), [])
  assert.deepEqual(parseMoonshotBalance({ data: {} }, 'CNY'), [])
})

test('throttles automatic quota refreshes for 30 seconds but never manual ones', () => {
  assert.equal(quotaRefreshAllowed(10_000, true, 39_999), false)
  assert.equal(quotaRefreshAllowed(10_000, true, 40_000), true)
  assert.equal(quotaRefreshAllowed(39_999, false, 40_000), true)
})

test('shows the primary quota for the provider selected by the model', () => {
  const quotas = {
    openai: {
      data: [{ period: '7d' as const, remainingPercent: 20 }, {
        period: '5h' as const,
        remainingPercent: 74.6,
      }],
      stale: false,
    },
    copilot: { data: [{ name: 'Premium interactions', used: 75, limit: 300 }], stale: true },
    deepseek: {
      data: [{ currency: 'USD', total: 12.5, granted: 2.5, toppedUp: 10 }],
      stale: false,
    },
    moonshot: { data: [{ currency: 'USD', total: 49.5 }], stale: false },
    moonshotCn: { data: [], stale: false },
    refreshing: false,
    sessionRequired: false,
  }

  assert.equal(quotaProviderForModel('openai-codex'), 'openai')
  assert.equal(quotaProviderForModel('github-copilot'), 'copilot')
  assert.equal(quotaProviderForModel('deepseek'), 'deepseek')
  assert.equal(quotaProviderForModel('moonshotai'), 'moonshot')
  assert.equal(quotaProviderForModel('moonshotai-cn'), 'moonshotCn')
  assert.equal(quotaProviderForModel('anthropic'), undefined)
  const formattedPercent = new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 })
  assert.deepEqual(railQuota(quotas, 'openai'), {
    label: `OpenAI Codex quota: ${formattedPercent.format(74.6)} % remaining`,
    stale: false,
    value: '75%',
  })
  assert.deepEqual(railQuota(quotas, 'copilot'), {
    label: `GitHub Copilot quota: ${formattedPercent.format(75)} % remaining`,
    stale: true,
    value: '75%',
  })
  assert.deepEqual(railQuota(quotas, 'deepseek'), {
    label: `DeepSeek balance: ${
      new Intl.NumberFormat(navigator.language, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      })
        .format(12.5)
    }`,
    stale: false,
    value: new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 1,
    })
      .format(12.5),
  })
})

test('accepts legacy v1 reports with empty balance providers', () => {
  const cache = new QuotaCache()
  assert.equal(
    cache.receiveManagerEvent(statusEvent({
      protocol: 'pi-livecraft.quotas',
      version: 1,
      refreshedAt: 100,
      openai: { ok: true, data: [] },
      copilot: { ok: true, data: [] },
    })),
    true,
  )
  assert.deepEqual(cache.snapshot(false).deepseek.data, [])
  assert.deepEqual(cache.snapshot(false).moonshot.data, [])
})

test('retains a stale provider snapshot when its next refresh fails', () => {
  const cache = new QuotaCache()
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 100,
    openai: { ok: true, data: [{ period: '5h', remainingPercent: 80 }] },
    copilot: { ok: true, data: [] },
  }))
  cache.receiveManagerEvent(statusEvent({
    protocol: 'pi-livecraft.quotas',
    version: 1,
    refreshedAt: 200,
    openai: { ok: false, error: 'OpenAI indisponible' },
    copilot: { ok: true, data: [] },
  }))

  assert.deepEqual(cache.snapshot(false).openai, {
    data: [{ period: '5h', remainingPercent: 80 }],
    updatedAt: 100,
    stale: true,
    error: 'OpenAI indisponible',
  })
})

test('retains the last valid DeepSeek balance when a refresh fails', () => {
  const cache = new QuotaCache()
  const base = {
    protocol: 'pi-livecraft.quotas',
    version: 2,
    openai: { ok: true, data: [] },
    copilot: { ok: true, data: [] },
    moonshot: { ok: true, data: [] },
    moonshotCn: { ok: true, data: [] },
  }
  cache.receiveManagerEvent(statusEvent({
    ...base,
    refreshedAt: 100,
    deepseek: { ok: true, data: [{ currency: 'USD', total: 12.5, usable: true }] },
  }))
  cache.receiveManagerEvent(statusEvent({
    ...base,
    refreshedAt: 200,
    deepseek: { ok: false, error: 'Unable to fetch DeepSeek balance. (HTTP 503)' },
  }))

  assert.deepEqual(cache.snapshot(false).deepseek, {
    data: [{ currency: 'USD', total: 12.5, usable: true }],
    updatedAt: 100,
    stale: true,
    error: 'Unable to fetch DeepSeek balance. (HTTP 503)',
  })
})

function statusEvent(report: unknown): unknown {
  return {
    event: 'pi',
    data: {
      type: 'extension_ui_request',
      method: 'setStatus',
      statusKey: 'pi-livecraft.quotas',
      statusText: JSON.stringify(report),
    },
  }
}
