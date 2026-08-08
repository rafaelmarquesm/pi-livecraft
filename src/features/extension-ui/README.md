# Extension UI host

Frontend half of the Extension UI contract (status bar, widgets, title, and
composer prefills rendered from `extension_ui_request` events). The pure
reducer lives in [`shared/extension-ui.ts`](/shared/extension-ui.ts) and is
shared with the manager.

## Ownership

- **State ownership:** `App.tsx` keeps one `ExtensionUiState` per session in
  `extensionUi` and applies every `extension_ui_request` through
  `applyExtensionUiRequest` in the pi event router. State is deleted when the
  session exits. Reserved keys (`agent`, `pi-livecraft.quotas`) are never
  stored by the reducer, so the existing reserved-key effects in `App.tsx`
  (active agent, quota refresh) remain the single source for them.
- **Rendering:** `ExtensionStatusBar` and `ExtensionWidgetHost` are mounted
  around the `<Composer>` in `App.tsx`; they render nothing when empty so the
  layout does not shift. Each widget is isolated in its own
  `WidgetErrorBoundary`.
- **Title:** `document.title` writes are owned by the notifications feature
  (single writer). Extension titles flow through the pure helper
  `extensionDocumentTitle` in `document-title.ts`, which the notifications
  effect calls with the selected session's title.
- **Composer prefills:** `Composer.tsx` consumes `editorText` and applies the
  `applyEditorPrefill` policy (empty draft → apply, otherwise ask). The host
  (`App.tsx`) resolves the ask through the single `ConfirmDialog` and applies
  the confirmed text through the existing composer draft mechanism.

## Tests

`test/extension-ui-frontend.test.ts` covers the pure helpers
(`extensionDocumentTitle`, `applyEditorPrefill`), the reducer integration for
a full event sequence, and the reserved-key spoofing regression (E13 rule 8).
The reducer itself is exercised in `test/extension-ui.test.ts`.
