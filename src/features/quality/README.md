# Quality feature

The Quality feature owns the frontend plan-first and validation display for Validated Work.

- `App.tsx` owns per-session summary state, active mode, first-use confirmation, and approval actions because those coordinate Composer, Pi commands, and the right sidebar.
- `Composer` renders `QualityModeSelect` and calls back to App. It never calls the backend directly.
- `QualityWidget` fetches full details through `src/api.ts` only when opened or when the summary revision changes.
- `PlanApprovalDialog` is UI-owned approval. The model cannot self-approve; App sends the private backend config action.

This step intentionally does not implement automatic evidence gates or independent code review.
