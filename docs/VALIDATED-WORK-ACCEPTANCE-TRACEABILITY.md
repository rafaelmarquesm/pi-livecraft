# Validated Work and Quality Lab acceptance traceability

Date: 2026-08-10  
Implementation range: `c173b43..db80d41`  
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
| 9 | Performance budgets pass | `npm run bench:snapshot`, `npm run bench:memory`, `npm run bench:quality`; packet/state size tests | Node 24/Linux clean-container runs passed the implemented latency and memory gates: snapshot cold 1217.6ms, warm p50 18.8ms; memory delta +1.6 MiB; quality artifacts complete. The full HTTP snapshot intentionally remains complete on warm reads, while incremental backend I/O is checked separately. The broader 1/3/10 real-Pi PSS and section-12 extraction/UI timing matrix is not implemented by these scripts | PARTIAL |
| 10 | E2E is provider-independent | `npm run test:e2e` | 34 Playwright tests passed using seeded routes/state and no paid provider | PASS |
| 11 | A/B campaigns produce reproducible artifacts and invalidity gates | `npm run eval:quality:offline`, `npm run bench:quality`, quality campaign/validity/statistics tests | Deterministic fake campaign emits raw JSON/Markdown, fingerprints, invalid reasons, pass@1/pass@k, Wilson interval, paired deltas, cost, time, and small-sample guards | PASS |
| 12 | A published standard-vs-validated campaign with k>=3 exists before default promotion | Manual `.github/workflows/agent-quality.yml` plus external credentials/budget | Offline k=3 smoke ran, but no real paid 18-valid-trial campaign was authorized or published. Default remains `standard` and `validated` remains Experimental | BLOCKED |
| 13 | Technical, threat-model, UX, and operations docs are current | Protocol docs, feature READMEs, evaluation README, adapter attribution, settings guide, this matrix | Implementation and operating contracts are documented. This matrix records remaining rollout and benchmark gaps | PASS |
| 14 | Quality CI and E2E are green | Offline workflow definition; local format/lint/typecheck/unit/build/E2E runs | Local checks passed. Hosted CI was not observed because commits were not pushed | PARTIAL |

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
| Manual paid workflow | Workflow source inspection and offline runner tests | Inputs, approval environment, provider concurrency, redaction, failure upload, and summary are implemented; external execution is blocked |
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
| `npm run lint` | PASS with 10 pre-existing warnings and 0 errors |
| `npm run typecheck` | PASS |
| `node --test --test-concurrency=1` | 539 total, 537 passed, 2 skipped, 0 failed |
| `npm run build` | PASS |
| `npm run test:e2e` | 34 passed |
| `npm run bench:snapshot` | PASS on Node 24/Linux; 5,000-message cold 1217.6ms, warm p50 18.8ms. Full HTTP response bytes are informational; incremental backend reads are covered by `test/snapshot-cache.test.ts` |
| `npm run bench:memory` | PASS on Node 24/Linux; backend+manager RSS 194.5 MiB baseline, 196.1 MiB after 10 cycles, +1.6 MiB |
| `npm run bench:quality` | PASS; deterministic k=3 fake comparison and complete artifacts |
| `npm run eval:quality:offline` | PASS; 15/15 focused offline checks |

## Remaining acceptance work

1. Run and publish the real paid `standard` vs `validated` campaign with at least 18 valid trials, after explicit credentials and budget approval.
2. Observe hosted CI after pushing the commit series.
3. Implement and capture the complete 1/3/10 real-Pi PSS, state-extraction, summary payload, UI commit, and review-packet timing matrix on Node 24/Linux. The clean-container run validated the existing scripts but exposed that they do not cover this full section-12 matrix.

No default promotion is permitted until item 1 satisfies the promotion gates. The current safe state is `standard` by default with `validated` marked Experimental.
