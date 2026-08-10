# Agent Quality foundations

This directory contains reproducible quality campaign foundations plus the first generated coding task suite. The normal CI entry point stays provider-free:

```bash
npm run eval:quality:offline
```

## Files

- `manifest.ts` parses a versioned `campaign.json` and rejects unknown fields, unsafe IDs, unsupported arms, and settings drift inputs.
- `artifact-schema.ts` parses the versioned artifact schema for raw trials, grader output, progress, timing, tokens, cost, and invalid reasons.
- `validity.ts` classifies invalid trials separately from valid failures.
- `statistics.ts` implements pass@1, pass@k, Wilson raw-success intervals, descriptive statistics, seeded bootstrap CI, paired deltas, cost per success, time to first pass, progress curves, and invalid reason counts.
- `compare.ts` renders Markdown or JSON summaries while retaining raw trial IDs.
- `redaction.ts` redacts credentials, auth headers, cookies, `.env` values, and home paths before artifact persistence.
- `fingerprint.ts` provides deterministic JSON, file, and directory SHA-256 fingerprints plus results-root path confinement.
- `tasks/generated.ts` creates three deterministic temporary Git repositories from seeds: `parser-repair`, `state-cache`, and `api-persistence`. Public smoke tests are present in the repo; hidden graders are written only after the driver finishes the agent run.
- `drivers/fake.ts` is a deterministic offline driver. It exercises the generated repos without a paid provider and intentionally makes the `livecraft-validated` arm worse than `livecraft-standard`, so tests and local smoke runs can prove the comparison path catches regressions.
- `drivers/pi-direct.ts` runs generated tasks in a bounded disposable `pi --mode rpc --no-session` process and records requested versus observed provider, model, thinking, tokens, and cost.
- `drivers/livecraft.ts` runs generated tasks through the local Livecraft HTTP API and manager path with bounded HTTP operations and the same requested/observed config capture.
- `cli.ts` exposes local fake, validate, and compare commands.
- `adapters/jcode-bench.ts` and `adapters/harbor.ts` build bounded opt-in external-suite plans without starting providers.
- `ADAPTER-ATTRIBUTION.md` records attribution, license, and claims rules for external suites.

## CLI examples

Generate an offline fake artifact under a confined results root:

```bash
node evals/quality/cli.ts fake --campaign-id offline-fake --results-root evals/quality/results
```

Validate an artifact schema:

```bash
node evals/quality/cli.ts validate --artifact evals/quality/results/offline-fake/artifact.json
```

Compare one or more artifacts as Markdown or JSON:

```bash
node evals/quality/cli.ts compare --k 3 --format markdown evals/quality/results/offline-fake/artifact.json
node evals/quality/cli.ts compare --k 3 --format json evals/quality/results/offline-fake/artifact.json
```

## Rules

- Invalid trials are reported and excluded from pass-rate denominators.
- A generated task cell must record `taskRevision`, `taskFingerprint`, `seed`, and `promptHash`; validity gates reject task drift.
- Hidden grader files are never present in the temporary repo before the agent run completes.
- Wilson intervals are applied only to the raw success proportion, not to pass@k.
- Do not claim a winner when any compared cell has fewer than three valid trials.
- Campaign and artifact paths are resolved under the configured results root. Absolute paths and traversal are rejected.
- Redaction runs before runner-produced artifacts are returned for persistence.
