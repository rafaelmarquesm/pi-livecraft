# Validated Work Step 0 Baseline

Recorded: 2026-08-10 UTC

Specification: [`SPEC-VALIDATED-WORK-AND-QUALITY-LAB.md`](./SPEC-VALIDATED-WORK-AND-QUALITY-LAB.md), Step 0

## Provenance

| Field | Observed value |
|---|---|
| Livecraft commit | `93b7fbf19bf6087dda11638085ffce97f440bd82` |
| Branch | `main` tracking `origin/main` |
| Initial worktree | clean |
| Pi | `0.84.1` |
| Node | `v25.6.1` |
| npm | `11.9.0` |
| OS | macOS Darwin `25.2.0`, arm64 |
| Package version | `pi-livecraft@1.2.0` |

The specification names Livecraft `6bb9b40` as its architectural base. This baseline was taken from the newer commit above. The repository requires Node `>=24`; CI Node 24 remains authoritative for environment-specific differences.

## Product validation

| Check | Result | Observation |
|---|---|---|
| `npm run format:check` | pass | No formatting differences. |
| `npm run lint` | pass with warnings | 0 errors and 10 pre-existing warnings. |
| `npm run typecheck` | pass | TypeScript project build completed. |
| `node --test --test-concurrency=1` | pass | 472 tests: 470 passed, 0 failed, 2 skipped. |
| `npm run build` | pass with warning | Vite built 1,092 modules. Main JS chunk was 754.05 kB, 230.52 kB gzip, and triggered the existing 500 kB chunk warning. |
| `npm run test:e2e` | pass | 18 Chromium journeys passed using one worker in 30.0 seconds. |

### Existing lint warnings

The baseline contains these warning groups without lint errors:

- React Fast Refresh component-only export warning in `src/features/settings/SettingsPanel.tsx`;
- missing React hook dependencies in `src/features/conversation/Conversation.tsx` and `src/features/workspace/DirectoryPicker.tsx`;
- control-character regex warnings in `shared/extension-ui.ts` and related tests;
- unused `AskUserQuestionResponse` import in `pi-extensions/ask-user-question.ts`.

These were observed only and were not changed in Step 0.

## Performance baseline

The existing backend and manager at `127.0.0.1:43121` and `127.0.0.1:43120` were used after `/api/health` returned `{"ok":true,"managerConnected":true}`. The authoritative measurements below were run sequentially to avoid benchmark interference.

### Snapshot benchmark

Command: `npm run bench:snapshot`

| Metric | Observation | Existing gate |
|---|---:|---:|
| Synthetic messages | 5,000 | n/a |
| Cold snapshot | 95.7 ms | `< 5,000 ms`, pass |
| Warm snapshot p50 | 18.6 ms | `< 200 ms`, pass |
| Snapshot response size | 2,060,740 bytes | informational |
| Warm/cold response byte ratio | 100.00% | informational |
| Warm/cold latency ratio | 5.15× faster | `>= 5×`, pass |

The response byte ratio is expected to remain 100% because the HTTP response still contains the complete message list. Incremental backend I/O is covered separately by `test/snapshot-cache.test.ts`.

An earlier parallel run measured 78.9 ms cold and 33.6 ms warm, failing the 5× relative-latency gate while both absolute latency gates passed. Because `bench:memory` was running concurrently, it is retained here as a noise observation rather than the authoritative baseline.

### Memory benchmark

Command: `npm run bench:memory`

| Metric | Observation | Existing gate |
|---|---:|---:|
| Cycles | 10 | n/a |
| Initial backend + manager RSS | 81.6 MiB | informational |
| Final backend + manager RSS | 83.1 MiB | informational |
| RSS delta | +1.5 MiB | `< 50 MiB`, pass |

The benchmark creates, refreshes, and closes sessions, then waits for Pi processes to be reaped before the final measurement.

## Baseline conclusion

The pre-implementation repository is green for formatting, lint policy, type checking, serial tests, production build, E2E, and the authoritative sequential benchmark gates. Step 0 changes no product behavior or implementation code. Future implementation steps should compare their validation and performance observations with this artifact, while treating CI Node 24/Linux as authoritative for stabilized performance budgets.
