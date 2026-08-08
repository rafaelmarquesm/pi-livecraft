import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUsageStore, UsageLedger } from '../server/features/usage/usage-ledger.ts'
import type { JsonObject } from '../shared/types.ts'

// §4.5 — ledger under a burst: the serialized write queue must not lose
// records when many sessions settle near-simultaneously, and usage.jsonl must
// stay intact (every line a valid UsageRecord) with an exact count.

function assistantEntry(id: string, cost: number): JsonObject {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      model: 'bench-model',
      usage: {
        cost: { total: cost },
        totalTokens: 100,
        input: 90,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
      },
    },
  }
}

test('§4.5 ledger burst: 10 concurrent settles lose no records and stay intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-livecraft-ledger-burst-'))
  const path = join(dir, 'usage.jsonl')
  try {
    const ledger = new UsageLedger(path)
    const sessions = Array.from({ length: 10 }, (_, i) => `session-${i}`)
    // Two billable assistant entries per session.
    const entriesBySession = sessions.map((_session, i) => [
      assistantEntry(`aaaaaaaa`, 0.01 + i),
      assistantEntry(`bbbbbbbb`, 0.02 + i),
    ])

    // Fire the settles concurrently; the ledger serializes them internally.
    await Promise.all(
      sessions.map((session, i) => ledger.append(session, '/workspace', entriesBySession[i])),
    )

    const content = await readFile(path, 'utf8')
    const records = parseUsageStore(content)

    // No records lost and no duplicates (10 sessions × 2 entries).
    assert.equal(records.length, 20, 'expected every record to survive the burst')
    const keys = new Set(records.map((r) => `${r.sessionId}:${r.entryId}`))
    assert.equal(keys.size, 20, 'expected 20 unique session:entry keys')

    // Every line parsed as a valid UsageRecord (integrity).
    for (const record of records) {
      assert.match(record.entryId, /^[0-9a-f]{8}$/)
      assert.ok(record.cost > 0)
      assert.equal(typeof record.cwd, 'string')
    }

    // All ten sessions present exactly twice each.
    for (const session of sessions) {
      assert.equal(records.filter((r) => r.sessionId === session).length, 2)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('§4.5 idempotency: re-appending the same entries does not duplicate (T-LEDGER-2)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-livecraft-ledger-idem-'))
  const path = join(dir, 'usage.jsonl')
  try {
    const ledger = new UsageLedger(path)
    const entries = [assistantEntry('c1c1c1c1', 0.05), assistantEntry('d2d2d2d2', 0.06)]
    await ledger.append('session-idem', '/workspace', entries)
    await ledger.append('session-idem', '/workspace', entries) // same entries again

    const records = await ledger.load()
    assert.equal(records.length, 2, 'reprocessing must not duplicate records')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('§4.5 crash tolerance: a trailing partial line is dropped, not treated as corrupt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-livecraft-ledger-crash-'))
  const path = join(dir, 'usage.jsonl')
  try {
    const ledger = new UsageLedger(path)
    await ledger.append('session-a', '/workspace', [assistantEntry('e3e3e3e3', 0.07)])

    // Simulate an interrupted append: a trailing partial JSON line.
    const content = await readFile(path, 'utf8')
    await writeFile(path, `${content}{"entryId":"f4f4f4f4","sessionI`)

    const records = await ledger.load()
    assert.equal(records.length, 1, 'partial trailing line is dropped, store stays usable')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
