# Agent quality evaluation strategy

This document defines how Pi Livecraft should measure model and harness quality, and records the
comparison that motivated the design. It separates deterministic product tests from paid,
stochastic agent evaluations: both are necessary, but they answer different questions.

## Scope and reviewed sources

Reviewed on 2026-08-10:

- `1jehuang/jcode` at `be462f9` — Terminal-Bench adapter, campaign manifests, confidence stepping,
  closed-feedback-loop gates, auto-poke, memory, startup and resource benchmarks.
- `1jehuang/jcode-bench` at `f8a67a4` — three optimization tasks, exhaustive correctness gates,
  paired Callgrind scoring, score-over-time artifacts, Modal runners, validity gates, and published
  run-to-run variance.
- Public benchmark descriptions at <https://jcode.sh/jcode-bench> and
  <https://jcode.sh/jcode-bench-models>.
- Livecraft's `evals/documentation-routing.ts`, `evals/commit-message.ts`, Node tests, Playwright
  journeys, and performance scripts.

Jcode performance and Terminal-Bench gains are project-published results, not independent findings.
They are useful hypotheses and design evidence; Livecraft must reproduce an effect before adopting a
behavioral intervention as a default.

## What Livecraft has today

Livecraft has strong deterministic coverage:

- Node unit, integration, and real-RPC contract tests;
- Playwright behavioral journeys;
- snapshot, memory, and ledger integrity benchmarks;
- CI on Node 24.

It also has two real-model evals:

1. documentation routing — expected read order, evidence coverage, redundant reads, failed calls,
   unscoped searches, and cost;
2. commit messages — conventional form, grounding, invented references, repeat variance, cost, and
   a 1–5 LLM judge.

Those evals are valuable but are not a general agent benchmark:

- they test two features, not end-to-end coding outcomes;
- they drive a disposable Pi process directly, bypassing Livecraft's HTTP/manager path;
- their summaries are printed but do not currently enforce an aggregate quality gate;
- results are not persisted as versioned JSON artifacts;
- executable, Pi, prompt, model resolution, repository, and environment are not fully fingerprinted;
- there is no baseline/current comparison command;
- there is no pass@k, confidence interval, or invalid-trial classification;
- the commit generator and judge can use the same model, so judge bias remains possible.

This is why a green Livecraft CI supports correctness claims about the product, but not a numerical
claim that the agent became more capable at coding.

## Architectural caveat: Livecraft is not yet a separate cognitive harness

Pi owns the agent loop, system prompt, context, built-in tools, model calls, and retries. Livecraft
currently controls and presents Pi. Most changes in this fork — snapshots, UI, export, search,
security, usage, balances, and watchdogs — improve speed, observability, safety, or state accuracy
without changing how the model reasons.

For example, the old Thinking selector sent `set_thinking_level` immediately; only the cached UI
label stayed stale until settle. The fix reconciles displayed state immediately, but does not by
itself prove an intellectual-quality gain in the model's next answer.

A baseline/current benchmark remains useful as a no-regression check, but a material capability gain
should be expected only after an explicit harness intervention such as evidence-gated completion,
closed feedback loops, selective memory, or orchestration.

## What jcode does well

### 1. Deterministic, continuous, hill-climbable grading

Jcode Bench gives the agent a correct baseline and a grader it can invoke repeatedly. Correctness is
an exhaustive gate; passing implementations receive a continuous score:

```text
score = log2(given_cost / submission_cost)
```

The paired baseline and deterministic instruction-cost model make every verified improvement visible.
The score-over-time curve measures whether the harness keeps finding productive iterations rather
than stopping after the first passing result.

Useful principle for Livecraft: tasks should expose a fast, objective feedback loop. The model should
be able to improve against the same signal used for grading, while hidden or exhaustive checks prevent
shortcut solutions.

### 2. Validity before score

Jcode's publication gate verifies the intended model actually ran, catches silent model fallback and
output truncation, requires the final official grade, rejects trivial early exits, and checks that
cells share pinned prompts, commits, budgets, and artifacts.

Useful principle for Livecraft: an attractive score from an invalid trial is not a score.

### 3. Provenance and durable artifacts

Campaigns record binary SHA-256, version, model, reasoning, resources, prompt, benchmark commit,
trial outputs, transcripts, checkpoints, grades, and timing. Settings drift is rejected rather than
silently mixed in one campaign.

Useful principle for Livecraft: every claim must be reproducible from an artifact, not console text.

### 4. Variance is measured, not hand-waved

Jcode Bench reports roughly 0.09 standard deviation from agent behavior on one measured task, versus
about 0.004 grader noise. It explicitly warns that a one-run gap around 0.1 can be noise and estimates
how `k` must grow for smaller effects.

Useful principle for Livecraft: default to at least `k=3` for directional comparisons, report the raw
trials and uncertainty, and never publish a winner from one favorable run.

### 5. Confidence stepping and evidence-gated completion

Jcode's todo tool owns an append-only confidence history. A model cannot manufacture intermediate
steps in one final update. Completion requires sufficient confidence; an abrupt confidence jump
triggers an independent recheck. Incomplete todos or unresolved quality observations can generate a
bounded synthetic continuation instead of accepting premature completion.

Useful principle for Livecraft: confidence is useful only when tied to observed validation and when
the harness, not the model, owns the history.

### 6. Closed feedback loops

Jcode assesses intent understanding, acceptance relevance, edge/integration coverage, requirement-to-
check traceability, delivery state, iteration maturity, and stopping evidence. Weak goals are reframed
into measurable objectives before work continues.

Useful principle for Livecraft: “run tests” is not evidence unless those tests enforce the requested
behavior. Every requirement and changed public output should map to an observation.

### 7. External suites and resource budgets

Jcode has a Harbor adapter for Terminal-Bench and regression budgets for startup and memory. This
separates product-specific evals from external comparability and prevents intelligence work from
hiding resource regressions.

## What should not be copied blindly

- Three C optimization tasks do not represent all software engineering. They measure optimization,
  persistence, and tool-loop quality particularly well, but not product discovery, UI judgment,
  requirements negotiation, or maintenance work.
- Unlimited time is valuable for frontier research but unsuitable as the only product gate. Livecraft
  should report cost/time curves and also support explicit user budgets.
- Self-reported confidence alone is theater. Only tool-owned history plus validation evidence is useful.
- Memory can inject stale or irrelevant facts, increase cost, and create privacy risk. It needs retrieval
  precision/recall evals before default enablement.
- Swarms can duplicate work, conflict on files, and spend more without improving outcomes. “Enabled”
  is not evidence of delegation; helper events and net score/cost must be measured.
- Vendor-published benchmark gains should be reproduced independently.

## Proposed Livecraft Agent Quality Lab

### Evaluation arms

Every campaign should support matched arms:

- `pi-direct` — disposable Pi process; measures the underlying Pi/model baseline;
- `livecraft` — session created and driven through the real HTTP/manager path;
- `livecraft-experiment` — same path with one opt-in harness intervention;
- `git:<revision>` — sequential worktrees for before/after comparisons.

The direct-vs-Livecraft arm detects accidental degradation. The experiment arm measures whether a
new harness policy helps. A revision comparison alone must not attribute model/provider drift to code.

### Task families

1. **Seed-generated bug repair** — disposable TypeScript repositories with generated identifiers,
   constants, edge cases, and graders. Public task generators, per-run unseen instances.
2. **Requirements and integration** — implement a feature whose acceptance contract spans API,
   persistence, security, and UI; deterministic tests score the result.
3. **Adversarial regression** — plausible local fix plus hidden cross-session, retry, concurrency,
   path, or browser-state cases.
4. **Optimization** — a fast deterministic grader and a correct baseline, producing a continuous
   score-over-time curve.
5. **External suites** — a pinned Jcode Bench adapter on Linux and a Pi/Livecraft Harbor adapter for
   selected Terminal-Bench tasks.
6. **Product-specific behavior** — model/reasoning reconciliation, evidence-backed completion,
   extension use, and recovery paths through Livecraft.

The first native suite should be small: three generated tasks covering parser correctness, state/cache
reconciliation, and multi-file API/persistence behavior. Expansion should follow discrimination data,
not task count vanity.

### Metrics

Correctness is the primary gate. Report per arm and task:

- valid trials / invalid trials;
- pass@1 and pass@k;
- deterministic task score or passed acceptance checks;
- time to first passing grade and final best score;
- active time and wall time;
- cost, input/output/cache tokens, and cost per successful trial;
- tool calls, failed calls, repeated reads, edits, and grader invocations;
- number and timing of productive score improvements;
- model/reasoning actually observed, not merely requested;
- completion evidence and todo/confidence trajectory when an experiment uses them.

For binary outcomes, publish raw counts and a Wilson interval. For continuous outcomes, publish every
trial, median, mean, standard deviation, and bootstrap confidence interval. Keep grader noise separate
from agent variance.

### Trial validity gates

A trial is invalid, not failed, when the model never had a fair opportunity to act. Require:

- exact provider/model and thinking preflight;
- pinned Pi and Livecraft revisions plus executable/package fingerprints;
- pristine workspace and isolated session/profile state;
- successful authentication and no quota/rate/connectivity failure;
- no unexpected model fallback;
- no output truncation at a configured ceiling;
- an observed settled event;
- grader execution and parseable result;
- no mutation outside the task workspace;
- complete transcript and usage artifact.

A run with zero valid trials can never pass.

### Artifact layout

```text
eval-results/<campaign-id>/
  campaign.json
  results.jsonl
  summary.json
  summary.md
  arms/<arm>/trials/<task>/<attempt>/
    manifest.json
    prompt.txt
    events.jsonl
    session.jsonl
    git.patch
    grader.json
    stderr.log
```

`campaign.json` pins all settings and refuses drift. Secrets and raw auth files are never copied into
artifacts.

### Before/after methodology

For a claim about this fork:

1. choose the baseline revision explicitly (`9412ae2` for the upstream v1.2.0 base, or another stated
   point);
2. pin the same Pi version, provider, model, thinking, task seeds, prompts, resources, and budgets;
3. run arms in alternating/randomized order to reduce provider-time bias;
4. use at least three trials per cell for a directional pilot;
5. inspect invalid trials before scores;
6. report confidence intervals and all raw artifacts;
7. rerun any apparent small effect before attributing it to the harness.

## Recommended implementation order

### P0 — measurement foundation

- Shared eval RPC/event driver instead of the two copied implementations.
- Versioned artifact schema, fingerprints, validity classification, and secret redaction.
- Deterministic fake-agent tests for runner/grader failure modes.
- A `compare` command with pass@k, cost/time, variance, and Markdown output.
- Manual GitHub workflow with explicit model, budget, `k`, and artifact upload; never run paid evals
  on every push.

### P1 — useful benchmark coverage

- Three seed-generated native coding tasks.
- `pi-direct` and real `livecraft` drivers.
- Linux-only pinned Jcode Bench adapter, with MIT attribution and no vendored result claims.
- Small Terminal-Bench pilot through Harbor.
- Startup, session-ready, browser-ready, and 1/3/10-session PSS budgets.

### P2 — first intelligence experiment

Add an opt-in **Validated Work** Pi extension, not a global prompt:

- structured goals and acceptance observations;
- tool-owned confidence/evidence history;
- incomplete-work auto-poke with a strict turn and USD budget;
- confidence-spike recheck;
- requirement-to-check traceability;
- visible status, user abort, and full event logging.

Run matched off/on campaigns before enabling it by default. The acceptance criterion is better
pass@k or deterministic score at an acceptable cost/time delta, not “the transcript looked more
thorough.”

### P3 — only after evidence

- selective cross-session memory with retrieval precision/recall and stale-conflict evals;
- agent swarms with explicit delegation traces, file-conflict accounting, and net quality/cost score;
- adaptive test-time compute based on feedback-loop progress rather than an unbounded retry loop.

## Initial success criteria

The evaluation system is ready for quality claims when it can:

1. reproduce a campaign from its artifact manifest;
2. reject wrong-model, auth-failed, truncated, contaminated, and ungraded trials;
3. compare direct Pi, Livecraft, and one experiment over identical generated tasks;
4. publish raw trials, uncertainty, cost, time, and transcripts;
5. show that a known deliberately degraded arm scores worse;
6. run all runner/grader tests offline and reserve model calls for an explicit manual workflow.

Until then, statements about intellectual improvement should remain qualitative and explicitly scoped.
