import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { JsonObject } from '../shared/types.ts'
import {
  parseUsageStore,
  rollupUsageRecords,
  usageRecordsForEntries,
  UsageLedger,
  type UsageEntryUsage,
  type UsageRecord,
} from '../server/features/usage/usage-ledger.ts'

const fixturesDirectory = fileURLToPath(new URL('fixtures/sessions/', import.meta.url))

/** Reads a synthetic session fixture and returns its entries (header excluded). */
async function fixtureEntries(name: string): Promise<JsonObject[]> {
  const content = await readFile(join(fixturesDirectory, name), 'utf8')
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonObject)
    .filter((entry) => entry.type !== 'session')
}

async function temporaryStore(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-usage-'))
  return { directory, path: join(directory, 'usage.jsonl') }
}

/**
 * T-LEDGER-1 band, documented in the handoff: `get_session_stats.cost`
 * includes compaction/branch-summary generation that may never appear in an
 * entry, so the ledger is compared as `ledger ≤ stats + 0.005` AND
 * `stats - ledger ≤ 0.05` — never strict equality.
 */
function assertWithinBand(ledgerCost: number, statsCost: number): void {
  assert.ok(
    ledgerCost <= statsCost + 0.005,
    `ledger ${ledgerCost} exceeds stats ${statsCost} + 0.005`,
  )
  assert.ok(
    statsCost - ledgerCost <= 0.05,
    `stats ${statsCost} exceeds ledger ${ledgerCost} by more than 0.05`,
  )
}

function sumCost(records: UsageEntryUsage[]): number {
  return records.reduce((sum, record) => sum + record.cost, 0)
}

test('extracts assistant usage keyed by entry id, costs verbatim from usage.cost.total', async () => {
  const records = usageRecordsForEntries(await fixtureEntries('fixture-short.jsonl'))
  assert.equal(records.length, 2)
  assert.deepEqual(records.map((record) => record.entryId), ['22222222', '44444444'])
  assert.equal(records[0].cost, 0.0099)
  assert.equal(records[0].provider, 'anthropic')
  assert.equal(records[0].model, 'claude-sonnet-4-5')
  assert.equal(records[0].totalTokens, 2340)
  assert.equal(records[0].timestamp, '2026-08-08T10:00:05.000Z')
  assert.equal(records[1].cost, 0.0054)
  assert.equal(records[1].model, 'claude-sonnet-4-5')
  // turnMs = delta to the previous entry's timestamp (Backlog B): the user
  // entry at 10:00:01 for the first assistant, the toolResult at 10:00:07 for
  // the second (the post-tool stretch, even without billable usage itself).
  assert.equal(records[0].turnMs, 4_000)
  assert.equal(records[1].turnMs, 5_000)
})

test('includes toolResult and compaction usage (E9) — never a local price table', async () => {
  const records = usageRecordsForEntries(await fixtureEntries('fixture-tool-result-usage.jsonl'))
  assert.equal(records.length, 4)
  assert.deepEqual(
    records.map((record) => record.entryId),
    ['bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'],
  )
  // The toolResult carrying nested subagent work must be counted (the E9 gap
  // in src/features/conversation/message-usage.ts is not copied).
  const toolResult = records[1]
  assert.equal(toolResult.entryId, 'cccccccc')
  assert.equal(toolResult.cost, 0.755)
  assert.equal(toolResult.model, undefined)
  // Compaction generation is part of get_session_stats.cost and must be counted too.
  assert.equal(records[2].entryId, 'dddddddd')
  assert.equal(records[2].cost, 0.365)
  // turnMs comes from consecutive entry timestamps: assistant→toolResult→compaction→assistant.
  assert.deepEqual(records.map((record) => record.turnMs), [3_000, 26_000, 270_000, 20_000])
})

test('skips entries without billable usage, valid ids, or user roles', () => {
  const records = usageRecordsForEntries([
    { type: 'message', id: '12345678', message: { role: 'user', content: 'hi' } },
    { type: 'message', id: '23456789', message: { role: 'assistant', content: [] } },
    {
      type: 'message',
      id: 'tool-1',
      message: { role: 'assistant', usage: { cost: { total: 1 } } },
    },
    { type: 'compaction', id: '34567890', summary: 'no usage here' },
    { type: 'message', id: '45678901', message: { role: 'toolResult', isError: false } },
    { type: 'message', id: '56789012', message: { role: 'user', usage: { cost: { total: 5 } } } },
  ])
  assert.deepEqual(records, [])
})

test('omits turnMs for the first entry, a broken timestamp chain, and non-increasing deltas', () => {
  const usage = { cost: { total: 0.01 }, input: 10, output: 5 }
  const records = usageRecordsForEntries([
    // First billable entry: no previous entry to measure against.
    {
      type: 'message',
      id: '11111111',
      timestamp: '2026-08-08T10:00:05.000Z',
      message: { role: 'assistant', usage },
    },
    // Entry without a usable timestamp breaks the chain for the next record.
    { type: 'message', id: '22222222', message: { role: 'user', content: 'x' } },
    {
      type: 'message',
      id: '33333333',
      timestamp: '2026-08-08T10:00:12.000Z',
      message: { role: 'assistant', usage },
    },
    // Timestamp equal to the previous entry's: the delta is not positive.
    {
      type: 'message',
      id: '44444444',
      timestamp: '2026-08-08T10:00:12.000Z',
      message: { role: 'assistant', usage },
    },
  ])
  assert.deepEqual(
    records.map((record) => record.turnMs),
    [undefined, undefined, undefined],
  )
})

test('T-LEDGER-1: ledger total stays within the documented band of get_session_stats', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const entries = await fixtureEntries('fixture-short.jsonl')
    const ledger = new UsageLedger(path)
    await ledger.append('sess-1', '/workspaces/demo', entries)
    // Mocked get_session_stats.cost: exactly what the Pi reports for this fixture.
    assertWithinBand(sumCost(await ledger.load()), 0.0099 + 0.0054)

    // The compaction caveat: when compaction/branch-summary generation cost is
    // part of stats but never lands in an entry, the ledger stays strictly
    // below stats — the band (not strict equality) is what makes T-LEDGER-1 pass.
    const entries2 = await fixtureEntries('fixture-tool-result-usage.jsonl')
    const ledger2 = new UsageLedger(join(directory, 'usage-2.jsonl'))
    await ledger2.append('sess-2', '/workspaces/demo', entries2)
    const ledgerCost = sumCost(await ledger2.load())
    const statsCost = ledgerCost + 0.01 // e.g. branch-summary cost missing from entries
    assertWithinBand(ledgerCost, statsCost)
    assert.notEqual(ledgerCost, statsCost) // proves strict equality would fail
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('T-LEDGER-2: reprocessing the same entries never duplicates records', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const entries = await fixtureEntries('fixture-tool-result-usage.jsonl')
    const ledger = new UsageLedger(path)
    await ledger.append('sess', '/workspaces/demo', entries)
    await ledger.append('sess', '/workspaces/demo', entries) // reprocess the same session
    const content = await readFile(path, 'utf8')
    const records = parseUsageStore(content)
    assert.equal(records.length, 4)
    assert.equal(new Set(records.map((record) => record.entryId)).size, 4)
    assert.equal(content.endsWith('\n'), true)
    // turnMs is derived at extraction and persists as part of the record.
    assert.equal(records[0].turnMs, 3_000)
    assert.equal(records[1].turnMs, 26_000)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('backfills provider and model identity for legacy records without duplicating usage', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const entries = await fixtureEntries('fixture-short.jsonl')
    await new UsageLedger(path).append('sess', '/workspaces/demo', entries)
    const legacy = (await readFile(path, 'utf8')).replaceAll('"provider":"anthropic",', '')
    await writeFile(path, legacy)

    await new UsageLedger(path).append('sess', '/workspaces/demo', entries)

    const records = parseUsageStore(await readFile(path, 'utf8'))
    assert.equal(records.length, 2)
    assert.deepEqual(records.map((record) => record.provider), ['anthropic', 'anthropic'])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('T-LEDGER-3: an interrupted cursor resumes without double counting', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const entries = await fixtureEntries('fixture-tool-result-usage.jsonl')
    // First half written by one process…
    const first = new UsageLedger(path)
    await first.append('sess', '/workspaces/demo', entries.slice(0, 3))
    // …a write interrupted midway leaves a partial trailing line…
    const partial = await readFile(path, 'utf8')
    await writeFile(path, partial + '{"entryId":"dddddddd","se')
    // …and a freshly constructed ledger resumes from the file-derived cursor.
    const second = new UsageLedger(path)
    await second.append('sess', '/workspaces/demo', entries)
    const records = await second.load()
    assert.deepEqual(
      records.map((record) => record.entryId).sort(),
      ['bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'],
    )
    // Same totals as processing the whole session once.
    const expected = sumCost(usageRecordsForEntries(entries))
    assert.ok(Math.abs(sumCost(records) - expected) < 1e-9)
    // The partial line was cleaned up and the store parses strictly.
    const content = await readFile(path, 'utf8')
    assert.equal(content.endsWith('\n'), true)
    assert.equal(parseUsageStore(content).length, 4)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('writes the ledger with mode 0o600 and honors the PI_LIVECRAFT_USAGE_STORE override', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const entries = await fixtureEntries('fixture-short.jsonl')
    process.env.PI_LIVECRAFT_USAGE_STORE = path
    try {
      const ledger = new UsageLedger()
      await ledger.append('sess', '/workspaces/demo', entries)
    } finally {
      delete process.env.PI_LIVECRAFT_USAGE_STORE
    }
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal((await new UsageLedger(path).load()).length, 2)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('serializes concurrent appends through the write queue', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const ledger = new UsageLedger(path)
    const [short, toolResult] = await Promise.all([
      fixtureEntries('fixture-short.jsonl'),
      fixtureEntries('fixture-tool-result-usage.jsonl'),
    ])
    await Promise.all([
      ledger.append('sess-a', '/workspaces/demo', short),
      ledger.append('sess-b', '/workspaces/demo', toolResult),
    ])
    const records = await ledger.load()
    assert.equal(records.length, 6)
    assert.equal(new Set(records.map((record) => record.sessionId)).size, 2)
    assert.equal(new Set(records.map((record) => record.entryId)).size, 6)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('validates the store strictly at the boundary', () => {
  const valid =
    '{"entryId":"11111111","sessionId":"s1","cwd":"/w","timestamp":"2026-08-08T10:00:00.000Z","cost":0.01,"totalTokens":10,"input":10,"output":0,"cacheRead":0,"cacheWrite":0}'
  assert.equal(parseUsageStore(valid).length, 1)
  assert.throws(() => parseUsageStore(`${valid}\nnot-json\n${valid}`), /unparseable line/)
  assert.throws(
    () => parseUsageStore(valid.replace('"cost":0.01', '"cost":-1')),
    /invalid record/,
  )
  assert.throws(
    () => parseUsageStore(valid.replace('"entryId":"11111111"', '"entryId":"TOOL-123"')),
    /invalid record/,
  )
  // A single trailing partial line (interrupted write) is tolerated…
  assert.deepEqual(
    parseUsageStore(`${valid}\n{"entryId":"22`).map((record) => record.entryId),
    ['11111111'],
  )
  assert.deepEqual(parseUsageStore(''), [])
  // turnMs is optional and validated when present.
  assert.equal(
    parseUsageStore(valid.replace('"cacheWrite":0}', '"cacheWrite":0,"turnMs":4000}'))[0].turnMs,
    4000,
  )
  assert.throws(
    () => parseUsageStore(valid.replace('"cacheWrite":0}', '"cacheWrite":0,"turnMs":-1}')),
    /invalid record/,
  )
})

test('rejects invalid session or workspace arguments', async () => {
  const { directory, path } = await temporaryStore()
  try {
    const ledger = new UsageLedger(path)
    const entries = await fixtureEntries('fixture-short.jsonl')
    assert.throws(() => ledger.append('', '/workspaces/demo', entries), /Invalid session id/)
    assert.throws(() => ledger.append('sess', '', entries), /Invalid working directory/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rolls usage up by UTC day, provider, and model for one workspace', () => {
  const records: UsageRecord[] = [
    {
      entryId: '11111111',
      sessionId: 's1',
      cwd: '/workspaces/demo',
      timestamp: '2026-08-08T10:00:05.000Z',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      cost: 0.0099,
      totalTokens: 2340,
      input: 1200,
      output: 340,
      cacheRead: 800,
      cacheWrite: 0,
    },
    {
      entryId: '22222222',
      sessionId: 's1',
      cwd: '/workspaces/demo',
      timestamp: '2026-08-09T10:00:05.000Z',
      provider: 'anthropic',
      model: 'claude-opus-4-1',
      cost: 0.049,
      totalTokens: 2590,
      input: 2100,
      output: 90,
      cacheRead: 400,
      cacheWrite: 0,
    },
    {
      entryId: '33333333',
      sessionId: 's1',
      cwd: '/workspaces/demo',
      timestamp: '2026-08-08T12:00:00.000Z',
      cost: 0.005,
      totalTokens: 100,
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    {
      entryId: '44444444',
      sessionId: 's2',
      cwd: '/workspaces/other',
      timestamp: '2026-08-08T13:00:00.000Z',
      cost: 0.01,
      totalTokens: 200,
      input: 200,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  ]
  const rollup = rollupUsageRecords(records, '/workspaces/demo')
  assert.deepEqual(rollup.totals, {
    cost: 0.0099 + 0.049 + 0.005,
    totalTokens: 2340 + 2590 + 100,
    records: 3,
    // Backlog B derived metrics over the three demo records:
    // cacheRead 1200 / (input 3400 + cacheRead 1200); output 430 > 0.
    cacheHitRate: 1200 / 4600,
    costPer1kOutput: (0.0099 + 0.049 + 0.005) / (430 / 1000),
    inputOutputRatio: 3400 / 430,
    // No record carries turnMs → no tok/s average.
  })
  assert.deepEqual(rollup.byDay, [
    {
      day: '2026-08-09',
      cost: 0.049,
      totalTokens: 2590,
      records: 1,
      cacheHitRate: 400 / 2500,
      costPer1kOutput: 0.049 / (90 / 1000),
      inputOutputRatio: 2100 / 90,
    },
    {
      day: '2026-08-08',
      cost: 0.0099 + 0.005,
      totalTokens: 2340 + 100,
      records: 2,
      cacheHitRate: 800 / 2100,
      costPer1kOutput: (0.0099 + 0.005) / (340 / 1000),
      inputOutputRatio: 1300 / 340,
    },
  ])
  assert.deepEqual(rollup.byProvider, [
    {
      provider: 'anthropic',
      cost: 0.0099 + 0.049,
      totalTokens: 2340 + 2590,
      records: 2,
      cacheHitRate: 1200 / 4500,
      costPer1kOutput: (0.0099 + 0.049) / (430 / 1000),
      inputOutputRatio: 3300 / 430,
    },
    {
      provider: 'unknown',
      cost: 0.005,
      totalTokens: 100,
      records: 1,
      cacheHitRate: 0,
    },
  ])
  assert.deepEqual(rollup.byModel, [
    {
      model: 'claude-opus-4-1',
      cost: 0.049,
      totalTokens: 2590,
      records: 1,
      cacheHitRate: 400 / 2500,
      costPer1kOutput: 0.049 / (90 / 1000),
      inputOutputRatio: 2100 / 90,
    },
    {
      model: 'claude-sonnet-4-5',
      cost: 0.0099,
      totalTokens: 2340,
      records: 1,
      cacheHitRate: 800 / 2000,
      costPer1kOutput: 0.0099 / (340 / 1000),
      inputOutputRatio: 1200 / 340,
    },
    {
      // Zero-output bucket: cache rate 0, cost/1k and ratio omitted.
      model: 'unknown',
      cost: 0.005,
      totalTokens: 100,
      records: 1,
      cacheHitRate: 0,
    },
  ])
  const other = rollupUsageRecords(records, '/workspaces/other')
  assert.deepEqual(other.totals, { cost: 0.01, totalTokens: 200, records: 1, cacheHitRate: 0 })
  assert.deepEqual(other.byProvider, [
    { provider: 'unknown', cost: 0.01, totalTokens: 200, records: 1, cacheHitRate: 0 },
  ])
  assert.deepEqual(other.byModel, [
    { model: 'unknown', cost: 0.01, totalTokens: 200, records: 1, cacheHitRate: 0 },
  ])
})

test('derives cache hit rate, cost per 1k output, ratio, and tok/s per bucket (Backlog B)', () => {
  const records: UsageRecord[] = [
    {
      entryId: '11111111',
      sessionId: 's1',
      cwd: '/w',
      timestamp: '2026-08-08T10:00:05.000Z',
      model: 'm1',
      cost: 0.0099,
      totalTokens: 2340,
      input: 1200,
      output: 340,
      cacheRead: 800,
      cacheWrite: 0,
      turnMs: 4000,
    },
    {
      // Zero-input record: the cache rate denominator is 0 → rate 0.
      entryId: '22222222',
      sessionId: 's1',
      cwd: '/w',
      timestamp: '2026-08-08T11:00:00.000Z',
      model: 'm1',
      cost: 0.001,
      totalTokens: 50,
      input: 0,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      turnMs: 5000,
    },
    {
      // Zero-output record with turnMs: cost/1k and ratio omitted, and it
      // contributes nothing to the tok/s average.
      entryId: '33333333',
      sessionId: 's1',
      cwd: '/w',
      timestamp: '2026-08-08T12:00:00.000Z',
      cost: 0.005,
      totalTokens: 100,
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      turnMs: 3000,
    },
    {
      // No turnMs (legacy data): excluded from the tok/s average.
      entryId: '44444444',
      sessionId: 's1',
      cwd: '/w',
      timestamp: '2026-08-08T13:00:00.000Z',
      model: 'm1',
      cost: 0.0054,
      totalTokens: 1620,
      input: 900,
      output: 120,
      cacheRead: 600,
      cacheWrite: 0,
    },
    {
      entryId: '55555555',
      sessionId: 's2',
      cwd: '/other',
      timestamp: '2026-08-08T10:00:00.000Z',
      cost: 0.01,
      totalTokens: 100,
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
  ]
  const rollup = rollupUsageRecords(records, '/w')
  // Generation rates: 340/(4000/1000) = 85 and 50/(5000/1000) = 10 → mean 47.5;
  // the zero-output and turnMs-less records are ignored.
  assert.deepEqual(rollup.totals, {
    cost: 0.0099 + 0.001 + 0.005 + 0.0054,
    totalTokens: 2340 + 50 + 100 + 1620,
    records: 4,
    cacheHitRate: 1400 / (2200 + 1400),
    costPer1kOutput: (0.0099 + 0.001 + 0.005 + 0.0054) / (510 / 1000),
    inputOutputRatio: 2200 / 510,
    tokensPerSecond: 47.5,
  })
  // The m1 bucket keeps the same tok/s average; the zero-output unknown bucket
  // reports only the (zero) cache rate.
  assert.equal(rollup.byModel[0].model, 'm1')
  assert.equal(rollup.byModel[0].tokensPerSecond, 47.5)
  assert.deepEqual(rollup.byModel[1], {
    model: 'unknown',
    cost: 0.005,
    totalTokens: 100,
    records: 1,
    cacheHitRate: 0,
  })
  // Workspace filtering still applies to the derived metrics.
  const other = rollupUsageRecords(records, '/other')
  assert.deepEqual(other.totals, { cost: 0.01, totalTokens: 100, records: 1, cacheHitRate: 0 })
})
