# Render extension UI

This guide covers what Pi extensions can render around the composer (status
chips, widgets, the window title, and draft prefills) and how the frontend
hosts it. Extensions emit `extension_ui_request` events; the manager sanitizes
them and the frontend reduces them into per-session display state. Every step
is required unless noted otherwise.

## 1. What Livecraft renders

The frontend renders the five fire-and-forget methods of
`extension_ui_request`. Blocking dialog methods (`select`, `confirm`, `input`,
`editor`) are handled by the [dialog protocol](/src/features/dialogs/README.md)
instead and are not covered here.

| Method | Rendered as | Where |
|---|---|---|
| `setStatus` | `key: value` chip | horizontal strip directly above the composer |
| `setWidget` | `<pre>` block, one per widget key | above or below the composer by `widgetPlacement` |
| `setTitle` | window title (`Livecraft — <title>`) | notifications feature applies it (single writer) |
| `set_editor_text` | composer draft prefill | applied to the composer, subject to confirmation |

The shared contract, limits, and reducer live in
[`shared/extension-ui.ts`](/shared/extension-ui.ts); the rendering host is
`src/features/extension-ui/` and the per-session state is owned by `App.tsx`.

## 2. Status chips

A `setStatus` request stores one visible text per `statusKey`:

```json
{ "type": "extension_ui_request", "id": "…", "method": "setStatus",
  "statusKey": "weather", "statusText": "sunny 21°C" }
```

Each stored entry renders as a chip (`key` in accent, `text` muted) in the
status bar. Omitting `statusText` clears the key. **Reserved keys are never
rendered:** `agent` and `pi-livecraft.quotas` are intercepted by Livecraft
itself (active-agent state and quota refresh) and the reducer refuses to store
them, so an extension cannot spoof them onto the status bar (E13 rule 8).

## 3. Widgets

A `setWidget` request stores `widgetLines` (array of strings) under a
`widgetKey` with a placement:

```json
{ "type": "extension_ui_request", "id": "…", "method": "setWidget",
  "widgetKey": "report", "widgetPlacement": "aboveEditor",
  "widgetLines": ["building…", "done"] }
```

- **Placement rules:** `aboveEditor` widgets render between the status bar and
  the composer; `belowEditor` widgets render below the composer. Unknown
  placements default to `aboveEditor`. Widgets render in the order the keys
  were first set.
- **Isolation:** every widget is wrapped in its own error boundary; a widget
  that throws renders nothing and cannot take down the composer.
- **Truncation is applied by the reducer** (see limits below) — render as-is.
- Omitting `widgetLines` clears the widget key.

## 4. Window title

`setTitle` stores a sanitized title per session. The frontend never writes
`document.title` from this feature: the notifications feature is the single
writer, and it composes activity and extension titles through the pure helper
`extensionDocumentTitle` (`src/features/extension-ui/document-title.ts`), which
applies the fixed, non-removable `Livecraft — ` prefix. Omitting `title`
clears the extension title.

## 5. Draft prefills (set_editor_text)

`set_editor_text` carries a nonce-tagged text. The composer never overwrites a
draft:

- The composer is **empty** (or whitespace-only) → the prefill is applied
  silently.
- The composer has a **draft** → the user is asked with the confirm dialog
  ("An extension wants to replace your current draft."). **Replace** applies
  the prefill through the normal draft mechanism; **Keep** preserves the
  draft.

The decision is the pure policy `applyEditorPrefill`
(`src/features/extension-ui/editor-prefill.ts`).

## 6. Limits and sanitization

All extension text is ANSI-stripped and size-limited with a visible `…` marker
on the frontend (the manager re-applies the same limits before transport):

| Payload | Limit |
|---|---|
| `statusText` | 500 characters |
| `title` | 200 characters |
| widget line | 200 columns, 40 lines |
| `set_editor_text` text | 100,000 characters |

## 7. How to test

Local fixture extensions: add a small extension under
`pi-extensions/` (following [`pi-extensions/README.md`](/pi-extensions/README.md))
and register it in `server/pi-process.ts`, or load one of the upstream Pi
package fixtures from `examples/extensions/` into a persistent session and
observe the events in the browser. The Pi package ships example extensions
that emit the full `extension_ui_request` surface — run one, then check:

- status chips appear above the composer and clear when the extension omits
  `statusText`;
- `aboveEditor`/`belowEditor` widgets appear on the correct side of the
  composer and render as monospace blocks;
- the window title becomes `Livecraft — <title>` and reverts when cleared;
- with a draft in the composer, `set_editor_text` asks instead of
  overwriting.

The pure logic is covered by `test/extension-ui-frontend.test.ts` (title
prefix, prefill policy, reducer integration, reserved-key spoofing) and the
reducer by `test/extension-ui.test.ts`.

## Files touched

| File | Action |
|---|---|
| `shared/extension-ui.ts` | Shared contract, limits, reducer (already exists) |
| `src/features/extension-ui/` | Status bar, widget host, pure helpers, README |
| `src/features/dialogs/ConfirmDialog.tsx` | Confirm host used by prefills and git actions |
| `src/App.tsx` | Per-session state, event wiring, composer mounting |
| `src/features/composer/Composer.tsx` | `editorText` prop + prefill policy |
| `docs/HOW-TO-EXTENSION-UI.md` | This guide |
