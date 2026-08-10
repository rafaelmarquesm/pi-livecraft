# Usage ledger

Append-only, per-session cost/token ledger fed from session entries (Fase 4.1).
Owner: `server/features/usage/usage-ledger.ts`.

## Store (M6 pattern)

- Path: `~/.pi-livecraft/usage.jsonl`, overridable with `PI_LIVECRAFT_USAGE_STORE` (used by tests).
- Isolated operation usage is stored separately at `~/.pi-livecraft/auxiliary-usage.jsonl`, overridable with `PI_LIVECRAFT_AUXILIARY_USAGE_STORE`.
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
  turnMs?: number    // approximate generation duration (Backlog B): delta to the
                     // previous entry's timestamp; optional — old records lack it
  provider?: string  // provider reported by assistant messages; optional for legacy/tool records
  model?: string     // model that produced the usage (assistant messages)
  cost: number       // USD, verbatim from usage.cost.total — never recomputed (E8)
  totalTokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  purpose?: 'main' | 'automated_validation' | 'code_review' | 'prompt_improvement' | 'other_isolated'
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
timestamp are skipped. There is no local price table (E8). Provider/model identity is copied only
when the entry reports it; tool, compaction, and legacy records remain `unknown` rather than being
guessed. On the next settle of a legacy session, the ledger backfills missing identity by matching
its stable `entryId` against that session's real entries, atomically and without duplicating cost.

`purpose` defaults to `main` for newly extracted session entries unless a branch-local
`pi-livecraft.validated-work-attribution` custom entry targets the assistant entry as
`automated_validation`. Records written before this field remain valid and roll up as
`unknown`.

`turnMs` is derived at extraction (Backlog B): the delta between the entry's
timestamp and the previous entry's timestamp (entries arrive in append order;
for an assistant message after a toolResult this measures the post-tool
stretch, closest to pure inference). It is optional — records without it (old
data, missing timestamps, non-positive deltas) stay valid and are simply
excluded from the tok/s averages. Nothing else is persisted beyond this field.

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
  "totals": {
    "cost": 1.2155, "totalTokens": 38370, "records": 4,
    "cacheHitRate": 0.34, "costPer1kOutput": 1.2, "inputOutputRatio": 4,
    "tokensPerSecond": 12.4
  },
  "byDay": [{ "day": "2026-08-08", "cost": 1.2155, "totalTokens": 38370, "records": 4 }],
  "byProvider": [{ "provider": "anthropic", "cost": 0.0955, "totalTokens": 3630, "records": 2 }],
  "byModel": [{ "model": "claude-opus-4-1", "cost": 0.0955, "totalTokens": 3630, "records": 2 }],
  "byPurpose": [{ "purpose": "main", "cost": 0.0955, "totalTokens": 3630, "records": 2 }]
}
```

- `byDay` bucketed by UTC day (`timestamp.slice(0, 10)`), most recent first.
- `byProvider` and `byModel` alphabetical; records without identity bucket as `"unknown"`.
- `byPurpose` uses the fixed display order: main session, automated validation, code review,
  prompt improvement, other isolated, unknown legacy. Auxiliary records are deduped by
  operation id before merging so isolated cost is not counted twice.
- Every aggregate (totals, each day, each model) carries derived inference
  metrics (Backlog B), all optional so older consumers keep working:
  - `cacheHitRate` — `cacheRead / (input + cacheRead)` in 0..1; `0` when the
    denominator is 0 (nothing billed).
  - `costPer1kOutput` — `cost / (output / 1000)` in USD; omitted when the
    bucket has no output.
  - `inputOutputRatio` — `input / output`; omitted when the bucket has no output.
  - `tokensPerSecond` — mean of per-record `output / (turnMs / 1000)` over
    records carrying a `turnMs` and positive output; omitted when none.
- Floats are summed raw — compare against `get_session_stats.cost` with the
  T-LEDGER-1 band (`ledger ≤ stats + 0.005` AND `stats - ledger ≤ 0.05`), never
  strict equality, because `get_session_stats.cost` includes compaction/branch-summary
  generation that may never appear in an entry.
- `GET` sends no body and is not subject to the JSON Content-Type guard.
