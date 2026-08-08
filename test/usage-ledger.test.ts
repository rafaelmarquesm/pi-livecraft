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
  assert.equal(records[0].model, 'claude-sonnet-4-5')
  assert.equal(records[0].totalTokens, 2340)
  assert.equal(records[0].timestamp, '2026-08-08T10:00:05.000Z')
  assert.equal(records[1].cost, 0.0054)
  assert.equal(records[1].model, 'claude-sonnet-4-5')
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

test('rolls usage up by UTC day and model for one workspace', () => {
  const records: UsageRecord[] = [
    {
      entryId: '11111111',
      sessionId: 's1',
      cwd: '/workspaces/demo',
      timestamp: '2026-08-08T10:00:05.000Z',
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
  })
  assert.deepEqual(rollup.byDay, [
    { day: '2026-08-09', cost: 0.049, totalTokens: 2590, records: 1 },
    { day: '2026-08-08', cost: 0.0099 + 0.005, totalTokens: 2340 + 100, records: 2 },
  ])
  assert.deepEqual(rollup.byModel, [
    { model: 'claude-opus-4-1', cost: 0.049, totalTokens: 2590, records: 1 },
    { model: 'claude-sonnet-4-5', cost: 0.0099, totalTokens: 2340, records: 1 },
    { model: 'unknown', cost: 0.005, totalTokens: 100, records: 1 },
  ])
  const other = rollupUsageRecords(records, '/workspaces/other')
  assert.deepEqual(other.totals, { cost: 0.01, totalTokens: 200, records: 1 })
  assert.deepEqual(other.byModel, [{ model: 'unknown', cost: 0.01, totalTokens: 200, records: 1 }])
})
