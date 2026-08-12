# Validated Work and Quality Lab acceptance traceability

Date: 2026-08-12
Implementation range: `c173b43..032cf85`
Specification: `docs/SPEC-VALIDATED-WORK-AND-QUALITY-LAB.md`

## Status vocabulary

- **PASS**: directly observed through a public interface, integration boundary, or deterministic acceptance command.
- **PARTIAL**: implementation and lower-level checks pass, but one or more specified acceptance journeys lack direct observation.
- **BLOCKED**: requires credentials, approved paid spend, or publication outside this repository.

## Definition of Done matrix

| # | Requirement | Concrete check | Observed result | Status |
|---:|---|---|---|---|
| 1 | Standard has zero token delta and no extra call | `test/validated-work-extension.integration.test.ts`, standard-mode config assertions, offline campaign arm fingerprints | Default tool is inactive, active tools are unchanged, and no synthetic/review call is scheduled in standard mode | PASS |
| 2 | Plan first blocks writes until approval and restores tools | `test/validated-work-extension.integration.test.ts`; `e2e/quality.spec.ts` approval, request-changes, and cancellation journeys | Write/bash/unknown tools are blocked while planning; approval restores the exact prior tool list; request changes remains read-only | PASS |
| 3 | State is branch-aware and survives resume/fork/restart | Extension integration and backend tests in `test/validated-work-extension.integration.test.ts` and `test/validated-work-backend.test.ts` | Branch reconstruction, persisted tool-result snapshots, resume, fork, and stale runtime handling pass | PASS |
| 4 | Readiness derives from traceability and observed evidence | `test/validated-work-extension.test.ts`, protocol tests, evidence/gate tests included in the full serial suite | Claimed text alone does not verify work; missing checks/evidence block readiness; observed checks can advance it | PASS |
| 5 | Auto-follow-up respects turn, cost, no-progress, and abort | Gate/config/backend tests plus regression `cb91198` | Default and configured limits, dedupe fingerprint, no-progress stop, pause, and abort paths pass | PASS |
| 6 | Review is isolated, read-only, bounded, structured, deduplicated | `test/code-review-{packet,output,store,protocol}.test.ts`; review API tests; review E2E triage/send preview | Packet and output limits pass, filesystem tools are unavailable, reports are structured/stored, unchanged diff is deduplicated, and sending requires preview | PASS |
| 7 | UI shows plan, checks, findings, and cost without a false score | `e2e/quality.spec.ts`; component and backend fixture assertions | Plan approval, readiness text, campaign metrics, review findings, usage/cost fields, and no 0–100 aggregate score are rendered | PASS |
| 8 | Usage attributes automation/review without guessed cost | `test/usage-ledger.test.ts`, `test/usage-ledger-burst.test.ts`, `test/usage-widget.test.ts` | Main, automated validation, code review, prompt improvement, isolated, and legacy usage reconcile without duplicate cost | PASS |
| 9 | Performance budgets pass | `npm run bench:snapshot`, `npm run bench:memory`, `npm run bench:quality`, `npm run bench:validated-work`, `npm run bench:quality-ui`; packet/state/cache tests | Clean Node 24/Linux + Pi 0.84.1 passed deterministic gates: no-op p95 0.0000ms; cold extraction 1.541ms; incremental p95 2.518ms; summary ≤2KiB; full state 124,674B; aggregate retained heap 177.6KiB/state; review packet 98,048B; snapshot cold 1217.6ms/warm 18.8ms; memory delta +1.6MiB. Real offline Pi PSS was measured for 1/3/10 sessions. Real browser React Profiler measured 200 QualityWidget update commits at p95 2.50ms against the <16ms budget | PASS |
| 10 | E2E is provider-independent | `npm run test:e2e` | 34 Playwright tests passed using seeded routes/state and no paid provider | PASS |
| 11 | A/B campaigns produce reproducible artifacts and invalidity gates | `npm run eval:quality:offline`, `npm run bench:quality`, quality campaign/validity/statistics tests | Deterministic fake campaign emits raw JSON/Markdown, fingerprints, invalid reasons, pass@1/pass@k, Wilson interval, paired deltas, cost, time, and small-sample guards | PASS |
| 12 | A published standard-vs-validated campaign with k>=3 exists before default promotion | Manual `.github/workflows/agent-quality.yml` plus paid self-hosted runs `31552939352` and `31583270532` | The corrected DeepSeek smoke run and corrected official GPT-5.4 run each completed with 9 valid trials per arm, published redacted artifacts, and provider-backed cost/time metrics. Default promotion remains a product decision rather than a missing acceptance artifact | PASS |
| 13 | Technical, threat-model, UX, and operations docs are current | Protocol docs, feature READMEs, evaluation README, adapter attribution, settings guide, this matrix, rollout checklist | Implementation and operating contracts are documented, including the corrected paid rollout path and final official result captured on 2026-08-12 | PASS |
| 14 | Quality CI and E2E are green | GitHub Actions CI run `31382125212`; local format/lint/typecheck/unit/build/E2E runs | Published `origin/main` commit `92c93c1` passed hosted Quality and E2E jobs. Hosted E2E reported 34 passed and one intentional benchmark-only skip | PASS |

## Public interface and integration-boundary checks

| Public output or boundary | Concrete check | Observed result |
|---|---|---|
| Composer mode selector | `e2e/quality.spec.ts` | Warning, Experimental mode, approval, cancellation, and narrow 320px keyboard access pass |
| First-use cost disclosure | `e2e/quality.spec.ts` | Confirmation dialog is shown before enabling experimental mode |
| Settings Quality tab | `e2e/settings-quality.spec.ts`; `test/quality-settings.test.ts` | Safe defaults, malformed/legacy storage fallback, ranges, persistence, no secret fields, and acknowledgement reset pass |
| Plan approval commands | `e2e/quality.spec.ts`; backend tests | Approve, request changes as a real user prompt, keep/cancel protocol paths are validated |
| Quality state HTTP/SSE boundary | `test/validated-work-backend.test.ts`; full serial suite | Versioned summary/details parsing, bounds, ETag behavior, session state, and private command guards pass |
| Traceability/evidence protocol | Protocol and extension tests | IDs, uniqueness, references, limits, evidence linking, and readiness derivation pass |
| Review HTTP/store/runner boundary | Code-review packet/output/store tests and review E2E | Read-only packet, strict output, persistence, triage, cost estimate, and selected-send confirmation pass |
| Usage ledger boundary | Usage ledger and widget tests | Auxiliary records merge by purpose without duplicate costs; legacy usage remains unknown |
| Campaign filesystem/API/UI boundary | Quality campaign, validity, adapter tests and campaign E2E | Results-root confinement, artifact validation, hidden empty tab, metrics display, and adapters pass |
| Manual paid workflow | Workflow source inspection, paid self-hosted runs `31552939352` and `31583270532`, and artifact download | Inputs, approval environment, provider concurrency, redaction, failure upload, and summary are implemented. Real paid runs completed successfully after the driver fixes in `672986b`, `fe21cc7`, and `032cf85` |
| Production bundle | `npm run build` | Build passed; Vite reported the existing >500kB chunk advisory |
| Backward compatibility | malformed/legacy parser tests and full serial suite | Legacy usage/settings records remain accepted and malformed external data fails safely |

## Required Playwright journey coverage

All twelve provider-independent journeys required by section 14.4 now have direct Playwright observations:

1. mode selector labels and warning: **PASS**
2. plan approve/request changes/cancel: **PASS**
3. Quality panel visible and narrow resize/collapse: **PASS**
4. traceability requirement/check/evidence rendering and navigation target: **PASS**
5. configured budget stop readiness: **PASS**
6. review loading/error/empty/findings states: **PASS**
7. finding triage and send confirmation: **PASS**
8. Usage by purpose with attributed-cost disclosure: **PASS**
9. campaign small-sample warning: **PASS**
10. keyboard, 320px, 768px, and 200% zoom: **PASS**
11. stale state isolation while switching sessions: **PASS**
12. quality-state preservation across backend reconnect: **PASS**

## Commands and observed results

| Command | Result |
|---|---|
| `npm run format:check` | PASS |
| `npm run lint` | PASS with 0 warnings and 0 errors |
| `npm run typecheck` | PASS |
| `node --test --test-concurrency=1` | 539 total, 537 passed, 2 skipped, 0 failed |
| `npm run build` | PASS |
| `npm run test:e2e` | 34 passed |
| `npm run bench:snapshot` | PASS on Node 24/Linux; 5,000-message cold 1217.6ms, warm p50 18.8ms. Full HTTP response bytes are informational; incremental backend reads are covered by `test/snapshot-cache.test.ts` |
| `npm run bench:memory` | PASS on Node 24/Linux; backend+manager RSS 194.5 MiB baseline, 196.1 MiB after 10 cycles, +1.6 MiB |
| `npm run bench:quality` | PASS; deterministic k=3 fake comparison and complete artifacts |
| `npm run eval:quality:offline` | PASS; 15/15 focused offline checks |
| `npm run bench:validated-work` | PASS; aggregate retained heap measured across 200 active quality states at 177.6 KiB/state against <1 MiB. Node 24/Linux deterministic gates and real offline Pi PSS matrix also passed |
| `npm run bench:quality-ui` | PASS; 200 real-browser QualityWidget update commits, p95 2.50 ms against <16 ms budget. Instrumentation is benchmark-only |
| Paid workflow `31552939352` | PASS; corrected DeepSeek smoke on `deepseek-v4-flash`, 9 valid trials per arm, `standard` 5/9 vs `validated` 6/9 |
| Paid workflow `31583270532` | PASS; corrected official `openai-codex / gpt-5.4`, 9 valid trials per arm, `standard` 6/9 vs `validated` 7/9 with near-flat cost and lower total duration |

## Remaining acceptance work

1. Decide product policy after the corrected official result. The current evidence is directionally positive for `validated`, but the decision set is still narrow and two tasks are saturated.
2. Broaden the rollout decision set before any default-promotion claim that aims to generalize beyond the current three-task suite.
3. Keep `standard` as the safe default until that product decision is explicitly recorded. `validated` can remain Experimental with a now-proven positive signal on the corrected official GPT-5.4 run.
