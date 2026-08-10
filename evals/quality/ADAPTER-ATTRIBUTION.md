# External adapter attribution and license notes

The Step 9 adapter files are scaffolds only. They build bounded execution plans and do not start paid providers, clone repositories, or publish benchmark claims.

## Jcode Bench

- Upstream: `1jehuang/jcode-bench`.
- Use: Linux-only adapter plan for a pinned local checkout supplied by the operator.
- Attribution: retain upstream copyright, license, task descriptions, and revision in campaign artifacts.
- Claims: Livecraft must publish raw campaign artifacts before making any comparative claim. Vendor or upstream published numbers are hypotheses, not Livecraft results.

## Harbor / Terminal-Bench pilot

- Upstream tasks may carry their own licenses and attribution requirements.
- Use: small, capped pilot task list through a local Harbor checkout supplied by the operator.
- Attribution: record selected task names, upstream revision, and license notes in the campaign manifest or accompanying artifact.
- Claims: report invalidity gates, costs, time, and raw trials. Do not mix Harbor pilot results with native Livecraft task scores without labeling them separately.

## Operational guardrails

- Adapter execution is opt-in and must use explicit budgets, timeouts, task caps, and a path-confined results root.
- Secrets, auth state, and provider tokens must be redacted before upload.
- Manual workflow runs require the `agent-quality` environment approval and one active run per provider.
