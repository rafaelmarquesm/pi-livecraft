# Prepare the real quality rollout

This checklist is the operator runbook for the paid `standard` vs `validated` campaign. The local code path is now wired and dry-run safe. Real provider execution still requires explicit environment approval, credentials, and budget sign-off.

## Current state

- Offline foundations are reproducible with `npm run eval:quality:offline`.
- Local rollout scaffolding is wired through `evals/quality/cli.ts run`.
- `.github/workflows/agent-quality.yml` supports:
  - provider-free fake runs
  - explicit paid-path opt-in
  - path-safe campaign IDs
  - bounded per-trial timeouts derived from the workflow timeout
  - artifact redaction before upload
  - manifest, artifact, and summary persistence
- Paid workflow runs stay blocked until the `agent-quality` environment sets `QUALITY_ALLOW_PAID_PROVIDER=true` and exposes the required runtime variables.

## Required environment variables

Configure these in the GitHub `agent-quality` environment before a paid run:

- `QUALITY_ALLOW_PAID_PROVIDER=true`
- `PI_QUALITY_EXECUTABLE=/absolute/path/to/pi` when using `driver=pi-direct`
- `PI_QUALITY_BASE_URL=http://127.0.0.1:5174` when using `driver=livecraft`
- Provider credentials required by the selected Pi provider route

Do not enable the paid gate until budget approval is explicit.

## Safe dry-run path

Use this before any real-provider run:

```bash
node evals/quality/cli.ts run \
  --driver fake \
  --campaign-id prep-dry-run \
  --results-root evals/quality/results \
  --provider fake \
  --model fake-model \
  --thinking none \
  --arms livecraft-standard,livecraft-validated \
  --tasks parser-repair,state-cache,api-persistence \
  --k 3 \
  --budget-usd 1 \
  --max-time-ms 60000
node evals/quality/cli.ts validate --artifact evals/quality/results/prep-dry-run/artifact.json
node evals/quality/cli.ts compare --k 3 --format markdown evals/quality/results/prep-dry-run/artifact.json
```

Expected outputs under `evals/quality/results/<campaign-id>/`:

- `manifest.json`
- `artifact.json`
- `summary.md`

## Manual workflow dispatch

Recommended manual dispatch inputs:

- `provider`: real provider route name
- `driver`: `pi-direct` unless a maintained Livecraft HTTP test rig is available
- `model`: exact target model
- `thinking`: exact target thinking level
- `arms`: `livecraft-standard,livecraft-validated`
- `tasks`: `parser-repair,state-cache,api-persistence`
- `k`: `3` for smoke, `6` for stronger evidence, `18` total valid trials minimum before promotion claims
- `budget_usd`: approved cap for the run
- `timeout_minutes`: full workflow budget
- `campaign_id`: safe identifier such as `real-std-vs-val-2026-08-11`
- `dry_run`: `false`

## Promotion gate reminders

Do not promote `validated` by default until all are true:

1. matched paid campaign completed
2. at least 18 valid trials across the rollout decision set
3. provider-backed token delta captured
4. provider-backed review latency captured
5. summary shows acceptable quality gain relative to cost and time
6. artifact redaction and upload succeeded

## Recovery and failure handling

- If the workflow exits with the paid gate disabled message, enable `QUALITY_ALLOW_PAID_PROVIDER=true` only after budget approval.
- If `pi-direct` cannot find `pi`, set `PI_QUALITY_EXECUTABLE` explicitly.
- If `livecraft` cannot reach the manager API, verify the HTTP base URL and service availability.
- If any artifact contains sensitive material, treat the run as invalid, rotate credentials if needed, and re-run after redaction review.
- If fewer than 3 valid trials land for any arm, do not claim a winner.

## Definition of done for rollout readiness

This checklist is complete when:

- dry-run command succeeds locally
- workflow source is wired to `evals/quality/cli.ts run`
- paid path requires explicit environment opt-in
- manifest, artifact, and summary are uploaded for every run
- remaining blocker is only external approval, credentials, or provider budget
