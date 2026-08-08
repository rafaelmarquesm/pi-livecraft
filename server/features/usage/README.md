# Usage ledger

Append-only, per-session cost/token ledger fed from session entries (Fase 4.1).
Owner: `server/features/usage/usage-ledger.ts`.

## Store (M6 pattern)

- Path: `~/.pi-livecraft/usage.jsonl`, overridable with `PI_LIVECRAFT_USAGE_STORE` (used by tests).
- One JSON line per billable record (`UsageRecord`), append-only.
- Written via tmp + `rename`, `mode: 0o600`, through a serialized write queue.
- Strict validation at the boundary (`parseUsageStore`): every complete line must be
  a valid `UsageRecord`; a single trailing partial line (a write interrupted midway)
  is tolerated and dropped on the next append.
- The ledger keeps its own durable per-session cursor: the last entry id recorded for
  the session, derived from the file itself, so a fresh process resumes where a
  previous one stopped (T-LEDGER-3). Only entries after the cursor are considered and
  records are deduplicated by `entryId` (T-LEDGER-2).

## UsageRecord

```ts
interface UsageRecord {
  entryId: string    // stable 8-hex session entry id — the idempotency key
  sessionId: string  // Livecraft session id
  cwd: string        // workspace; scopes the /api/usage rollup
  timestamp: string  // entry timestamp, ISO 8601 UTC
  model?: string     // model that produced the usage (assistant messages)
  cost: number       // USD, verbatim from usage.cost.total — never recomputed (E8)
  totalTokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
```

## Extraction rules (`usageRecordsForEntries`)

Mirror exactly what the Pi counts in `get_session_stats`:

- `message` entries with `role: 'assistant'` → `message.usage`
- `message` entries with `role: 'toolResult'` and `usage` → `message.usage`
  (nested LLM work such as subagents; the E9 gap in
  `src/features/conversation/message-usage.ts` — assistant-only — is NOT copied)
- `compaction` and `branchSummary` entries carrying top-level `usage`

Entries without billable usage, without a stable 8-hex id, or without a usable
timestamp are skipped. There is no local price table (E8).

## Feed

On `agent_settled`, `server/backend.ts` refreshes the snapshot cache (state + stats
+ entries) and feeds the ledger from `cache.entries` (fire-and-forget, silent catch).
The session's workspace comes from the manager session list, memoized per session id.

## Rollup — `GET /api/usage?cwd=…`

Pure aggregation (`rollupUsageRecords`) over the ledger, filtered to the requested
workspace. Response shape:

```json
{
  "cwd": "/path/to/workspace",
  "totals": { "cost": 1.2155, "totalTokens": 38370, "records": 4 },
  "byDay": [{ "day": "2026-08-08", "cost": 1.2155, "totalTokens": 38370, "records": 4 }],
  "byModel": [{ "model": "claude-opus-4-1", "cost": 0.0955, "totalTokens": 3630, "records": 2 }]
}
```

- `byDay` bucketed by UTC day (`timestamp.slice(0, 10)`), most recent first.
- `byModel` alphabetical; records without a model bucket as `"unknown"`.
- Floats are summed raw — compare against `get_session_stats.cost` with the
  T-LEDGER-1 band (`ledger ≤ stats + 0.005` AND `stats - ledger ≤ 0.05`), never
  strict equality, because `get_session_stats.cost` includes compaction/branch-summary
  generation that may never appear in an entry.
- `GET` sends no body and is not subject to the JSON Content-Type guard.
