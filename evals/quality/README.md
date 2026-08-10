# Agent Quality foundations

This directory contains the offline foundations for reproducible quality campaigns. It does not run Pi, Livecraft, or paid model calls yet. The normal CI entry point is:

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
- `drivers/fake.ts` is a deterministic offline driver. It intentionally makes the `livecraft-validated` arm worse than `livecraft-standard`, so tests and local smoke runs can prove the comparison path catches regressions.
- `cli.ts` exposes local fake, validate, and compare commands.

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
- Wilson intervals are applied only to the raw success proportion, not to pass@k.
- Do not claim a winner when any compared cell has fewer than three valid trials.
- Campaign and artifact paths are resolved under the configured results root. Absolute paths and traversal are rejected.
- Redaction runs before runner-produced artifacts are returned for persistence.
