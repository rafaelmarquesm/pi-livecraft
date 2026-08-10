# Code review backend

This feature builds and persists independent review artifacts without owning Pi processes.

- `packet-builder.ts` builds a deterministic, bounded Git packet from the canonical workspace using fixed shell-free Git commands. It excludes known secret paths, prioritizes security/API/persistence files when truncating, and records every omission in a truncation manifest.
- `review-runner.ts` is imported only by the manager. It runs the fixed `submit_code_review` extension through `runIsolatedPrompt()` with context files and filesystem tools disabled.
- `review-output.ts` converts the structured extension payload into a canonical `CodeReviewReportV1`; the backend derives finding fingerprints.
- `review-store.ts` persists append-only JSONL events under `~/.pi-livecraft/reviews` with `0600` permissions, a serialized write queue, and tmp + rename writes.
- `review-coordinator.ts` owns backend queueing, dedupe, SSE revision bumps, and extension summary reconciliation. `server/backend.ts` remains the HTTP boundary.

No raw diff or credential-bearing packet text is persisted by default. The browser never supplies extension paths, executables, shell commands, or filesystem tool names for the reviewer.
