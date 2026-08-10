# Validated Work backend

This feature module supports the plan-first UI without owning Pi processes.

- `validated-work-state.ts` reconstructs validated-work state from the cached active session entries and derives the detail response/ETag.
- `validated-work-config.ts` strictly parses browser config updates and serializes canonical arguments for the private `/livecraft-validated-work` command.
- `validated-work-baseline.ts` captures canonical Git baseline metadata for future review without storing raw diffs.

`server/backend.ts` remains the HTTP boundary. It resolves the session through the manager, forwards only the fixed private command, and refreshes the snapshot cache after accepted config updates.
