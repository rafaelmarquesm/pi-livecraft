# Prepare the real quality rollout

This checklist is the operator runbook for the paid `standard` vs `validated` campaign. The local code path is now wired and dry-run safe. As of 2026-08-12, the corrected paid smoke and corrected official GPT-5.4 runs have both completed successfully.

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
- Paid workflow runs are no longer blocked in principle. They have been exercised successfully on the self-hosted macOS runner with `PI_QUALITY_EXECUTABLE=/opt/homebrew/bin/pi`.
- Corrected paid runs observed so far:
  - `31552939352`: DeepSeek smoke, `standard` 5/9 vs `validated` 6/9
  - `31583270532`: official `openai-codex / gpt-5.4`, `standard` 6/9 vs `validated` 7/9

## Required environment variables

Configure these in the GitHub `agent-quality` environment before a paid run:

- `QUALITY_ALLOW_PAID_PROVIDER=true`
- `PI_QUALITY_EXECUTABLE=/absolute/path/to/pi` when using `driver=pi-direct`
- `PI_QUALITY_BASE_URL=http://127.0.0.1:5174` when using `driver=livecraft`
- Provider credentials required by the selected Pi provider route

For the current `openai-codex` setup in this repository, the recommended value is:

- `PI_QUALITY_EXECUTABLE=/opt/homebrew/bin/pi`

This only works on a self-hosted runner on the same Mac/user profile that already has Pi OAuth configured.
GitHub-hosted `ubuntu-latest` runners will not have this path or your OAuth session.

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
- `runs_on`: JSON string for the runner target. Use `"ubuntu-latest"` for GitHub-hosted fake runs or `["self-hosted","macOS"]` for the local OAuth-backed `openai-codex` path.
- `model`: exact target model
- `thinking`: exact target thinking level
- `arms`: `livecraft-standard,livecraft-validated`
- `tasks`: `parser-repair,state-cache,api-persistence`
- `k`: `3` for smoke, `6` for stronger evidence, `18` total valid trials minimum before promotion claims
- `budget_usd`: approved cap for the run
- `timeout_minutes`: full workflow budget
- `campaign_id`: safe identifier such as `real-std-vs-val-2026-08-11`
- `dry_run`: `false`

### Recommended values for this repository today

- **Smoke paid run**
  - `provider`: `deepseek`
  - `driver`: `pi-direct`
  - `runs_on`: `["self-hosted","macOS"]`
  - `model`: `deepseek-v4-flash`
  - `thinking`: `none`
  - `budget_usd`: `6`

- **Official paid run**
  - `provider`: `openai-codex`
  - `driver`: `pi-direct`
  - `runs_on`: `["self-hosted","macOS"]`
  - `model`: `gpt-5.4`
  - `thinking`: `low`
  - `budget_usd`: `25`

## Promotion gate reminders

Do not promote `validated` by default until all are true:

1. matched paid campaign completed
2. at least 18 valid trials across the rollout decision set
3. provider-backed token delta captured
4. provider-backed review latency captured
5. summary shows acceptable quality gain relative to cost and time
6. artifact redaction and upload succeeded

Status on 2026-08-12:

- 1: satisfied
- 2: satisfied for the current three-task decision set
- 3: satisfied via paid artifacts
- 4: satisfied via paid artifacts' total duration fields for the current workflow path
- 5: directionally satisfied, but still small-sample and narrow-decision-set
- 6: satisfied

## Recovery and failure handling

- If the workflow exits with the paid gate disabled message, enable `QUALITY_ALLOW_PAID_PROVIDER=true` only after budget approval.
- If `pi-direct` cannot find `pi`, set `PI_QUALITY_EXECUTABLE` explicitly.
- If `openai-codex` uses OAuth, run on a self-hosted runner that shares the same authenticated Pi profile.
- If `livecraft` cannot reach the manager API, verify the HTTP base URL and service availability.
- If any artifact contains sensitive material, treat the run as invalid, rotate credentials if needed, and re-run after redaction review.
- If fewer than 3 valid trials land for any arm, do not claim a winner.

## Definition of done for rollout readiness

This checklist is complete when:

- dry-run command succeeds locally
- workflow source is wired to `evals/quality/cli.ts run`
- paid path requires explicit environment opt-in
- manifest, artifact, and summary are uploaded for every run
- remaining blocker is only product policy on whether the current positive-but-narrow result is enough to change the default
