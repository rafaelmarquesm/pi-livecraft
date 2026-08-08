# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-08

### Added

- Copy assistant code blocks to the clipboard with a single click.
- Export the current session from the command palette (`export-session`) as Markdown, JSONL, or HTML — the latter rendered by Pi via `export_html` and gated on that capability — with path-safe downloads and temporary-directory cleanup.
- Fork a session from any user message ("Fork from here") and clone the active branch with the `clone-session` palette command; both gate on Pi capabilities and confirm before aborting a running turn.
- Search the conversation with `search-conversation` (palette): case-insensitive matches with prev/next navigation, a counter, and scroll-to-match highlighting.
- Show sessions forked or cloned from each other as a parent/child tree in the sidebar.
- Track usage across sessions in a local ledger and inspect it in the new Usage right-sidebar widget (pure-SVG bars, `alt+u`).
- Set a per-workspace USD budget in Settings; sending a prompt that exceeds it asks for confirmation first.
- Pin sessions and attach tags or a note from the sidebar context menu (persisted per session file).
- See Pi and manager process memory in the Settings "Pi session" tab (via `ps`, no extra dependency).
- Host Pi extension UI: `setStatus` entries render as a status bar above the composer, `setWidget` blocks render above/below it with per-widget error isolation, `setTitle` updates the tab title with a fixed Livecraft prefix, and `set_editor_text` prefills the composer without ever silently replacing a non-empty draft.
- Get native OS notifications when a background session finishes or fails after retries (only while the tab is hidden), with the tab title and favicon reflecting running work.
- Cancel an in-progress retry (provider reconnection, compaction, or branch summary) with a "Cancel retries" button next to the composer's stop control.
- Configure the selected session from Settings: toggle auto-compaction (reconciled from the session state) and auto-retry (applies to new retries).
- See the connected Pi version and its available commands as chips in the Settings "Pi session" tab.
- Show a clearer context gauge: "—" with an explanatory tooltip when context usage is unknown after compaction.

### Changed

- Highlight tool call names with the app accent color for better readability.
- Load conversation snapshots incrementally: after the first load, each refresh reads only the new session entries instead of the whole history, and static session data (models, commands, templates) is cached per session.
- Every snapshot message now carries its stable session entry id, giving message identity across refreshes, search, and forks.
- Hardened the local server against drive-by browser requests: state-changing routes require `application/json` and a loopback origin.

### Fixed

- Assemble live assistant RPC deltas so streaming replies display as complete, coherent text.
- Show assistant output before blocking questions, instead of hiding it behind the prompt.
- Compaction and branch-summary retries now show "Retrying…" instead of a stuck "Compacting" state.

## [1.1.0] - 2026-08-05

### Added

- Run Pi Livecraft natively on Windows, including process launching, home-path resolution, terminal and directory completion.
- Manage sessions directly from the sidebar: rename them or close running Pi sessions without losing persisted history; the next nearby active session is selected automatically.
- Reclaim sidebar space by collapsing the sessions panel.
- Keep changes safer with CI checks (typecheck, lint, tests) against the latest Pi version.
- See GitHub project interest at a glance with a stars badge in the README.

### Changed

- Display Bash executable names like other tools, without repeating the `bash` prefix.
- Open long conversations much faster: Pi processes are reused instead of restarted; the first three sessions in each workspace keep their own process, and only a process idle for more than three minutes is reassigned afterward. Bursts can temporarily create additional processes.
- Browse conversations faster with cached Markdown rendering and lighter previews.
- Find recent work faster: sessions are sorted by latest activity, with active and ended states clearly distinguished in the sidebar.
- Understand session state at a glance: the sidebar now marks idle sessions that still have an attached Pi process; spacing, alignment and ended-session styling are also clearer.

### Fixed

- Avoid startup race failures: requests now wait briefly for the manager to connect.
- Open long conversations reliably: session histories up to 64 MiB no longer hit the default JSONL record limit.

## [1.0.0] - 2026-08-01

### Added

- Initial release.
