# Validated Work Pi extension

This extension is the opt-in Pi side of the Validated Work experiment. It is loaded into persistent Pi Livecraft sessions, but its default mode is `standard` and inactive.

## Inactive default

In `standard` mode the extension keeps no prompt, no active `validated_work` tool, no synthetic messages, and no summary status. Isolated prompts remain extension-free unless their caller explicitly loads this entrypoint.

## Private command

`/livecraft-validated-work` is reserved for Pi Livecraft UI wiring. It accepts either a mode string or JSON:

```text
/livecraft-validated-work plan
/livecraft-validated-work validated
/livecraft-validated-work standard
/livecraft-validated-work {"action":"approve"}
```

Activating `plan` or `validated` captures the exact active tool list, switches to the read-only planning allowlist, and publishes a bounded private summary on `pi-livecraft.validated-work`. Approval restores the captured tool list once and moves the state to `executing`. Returning to `standard` clears the summary.

## Tool state

The `validated_work` tool stores the complete `ValidatedWorkStateV1` snapshot in `toolResult.details`. State reconstruction walks only the active session branch, applies the latest `pi-livecraft.validated-work-config` entry, and then uses valid `validated_work` tool result snapshots on that branch.

The tool supports `replace_plan`, `update_items`, `update_checks`, `link_evidence`, `submit_for_approval`, `reassess`, and `status`. Updates are partial and strict: omitted fields are preserved, unknown fields fail, duplicate ids fail through the shared parser, and dangling references are rejected.

## Boundaries

This step does not add frontend controls or backend config endpoints. The extension uses Pi's public extension API, changes only the active tool list, and does not write project files or call another model.
