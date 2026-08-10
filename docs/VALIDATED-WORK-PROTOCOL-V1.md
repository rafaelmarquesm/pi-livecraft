# Validated Work Protocol v1

This document summarizes the versioned boundary contracts implemented in `shared/validated-work.ts` and `shared/code-review.ts`. The TypeScript parsers are the normative executable definition.

## Validated-work state

- Protocol: `pi-livecraft.validated-work`
- Version: `1`
- Parser: `parseValidatedWorkStateV1()`
- Type guard: `isValidatedWorkStateV1()`

The parser rejects unknown fields, coercion, malformed scalar values, oversized serialized state, duplicate IDs within a namespace, duplicate references, and references to missing requirements, goals, items, checks, or evidence.

Limits are exported as `VALIDATED_WORK_LIMITS`:

- 12 goals
- 50 requirements
- 100 tasks/items
- 100 checks
- 200 evidence records
- 16 confidence observations per item
- 20 assumptions
- 2,000 characters for ordinary text
- 4,000 characters for observation summaries
- 128 KiB serialized state
- 200 retained timeline events
- ASCII IDs matching `[a-zA-Z0-9._-]`, 1–80 characters

State snapshots contain no unrestricted tool output, file contents, credentials, or provider reasoning.

## Code-review report

- Protocol: `pi-livecraft.code-review`
- Version: `1`
- Parser: `parseCodeReviewReportV1()`
- Type guard: `isCodeReviewReportV1()`
- Maximum findings: 50

Reports record observed provider/model/thinking configuration, diff and base revisions, timestamps, duration, usage, truncation flags, validity, and structured findings. Findings use `P0` through `P3`, explicit confidence, source location when available, evidence, recommendation, fingerprint, and auditable status.

When `reviewedRequirementIds` is supplied, every finding reference must resolve within that set.

## Usage purpose

`parseUsagePurpose()` accepts only:

- `main`
- `automated_validation`
- `code_review`
- `prompt_improvement`
- `other_isolated`

`normalizeUsagePurpose()` maps missing or legacy values to `unknown` for backward-compatible reporting.

## Compatibility

Consumers must validate external JSON with these parsers rather than using direct casts. Future incompatible changes require a new protocol version. Existing version 1 payloads remain strict and deterministic.
