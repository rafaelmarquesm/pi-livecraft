# Quality feature

The Quality feature owns the frontend plan-first and validation display for Validated Work.

- `App.tsx` owns per-session summary state, active mode, first-use confirmation, and approval actions because those coordinate Composer, Pi commands, and the right sidebar.
- `Composer` renders `QualityModeSelect` and calls back to App. It never calls the backend directly.
- `QualityWidget` fetches full details through `src/api.ts` only when opened or when the summary revision changes.
- `CampaignsSection` appears as a `Campaigns` tab only when `/api/quality/campaigns` finds artifacts; it renders results-root campaign artifacts without adding a new rail item.
- `ReviewSection` owns independent review detail fetches, triage state, selected findings, and send-confirmation preview. It talks only through `src/api.ts`.
- `PlanApprovalDialog` is UI-owned approval. The model cannot self-approve; App sends the private backend config action.

Review findings are not treated as facts until confirmed or verified. Sending selected findings asks the active agent to verify before editing and never marks findings resolved automatically.
