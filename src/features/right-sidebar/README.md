# Right sidebar

The right sidebar keeps workspace tools close without mixing their behavior. `RightSidebar.tsx` composes the rail, active panel, and accessible resizing; `App.tsx` owns the active widget and width because they affect the whole layout.

## Adding a widget

Follow the [step-by-step guide](/docs/HOW-TO-WIDGET.md). Return here for the sidebar-specific contracts below.

Each widget automatically receives an **Open…** palette command and an assignable shortcut via `rightWidgetDefinitions`. Rendering remains explicit: do not introduce a component registry.

Width and active widget are stored in `pi-livecraft.right-sidebar-width` and `pi-livecraft.right-sidebar-widget`. Legacy Git sidebar keys are read only as migration fallbacks. Width stays between 240 and 720 px. Every rendered panel must also have an exhaustive policy in `isRightPanelVisible`; otherwise TypeScript rejects a new registry member instead of letting its DOM mount inside the rail's collapsed 48 px column. `App.tsx` and `RightSidebar.tsx` share that decision, the unit matrix covers every registered widget, and Playwright exercises collapse and direct reopen.

The `%` rail opens provider **Quotas** (remaining allowance); `$` opens workspace **Usage & inference metrics** (cost, tokens, cache, input:output, and generation speed). The Quotas panel links directly to Usage because glyph-only rails make these related concepts easy to confuse.

Panel contracts: [Git](/src/features/git/README.md), [quotas](/src/features/quotas/README.md), [todo](/src/features/todo/README.md), and [session analysis](/src/features/session-analysis/README.md). [Terminal](/src/features/terminal/README.md) is an immediate rail action rather than a panel. Registry and width behavior are covered by `test/shortcuts.test.ts` and `test/git-sidebar.test.ts`.
