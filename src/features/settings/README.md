# Settings and preferences

`SettingsPanel` exposes user-editable local preferences. `App.tsx` owns values that coordinate the application; feature-only persistence stays beside the feature that uses it.

## Current ownership

- `commands/` defines commands, default shortcuts, normalization, and conflict detection.
- `settings/` captures shortcut changes and resets them.
- `App.tsx` persists shortcuts, theme, conversation view, workspace restoration, left and right sidebar state, and quality defaults.
- `quality/quality-settings.ts` parses `pi-livecraft.quality.*` preferences defensively for the Settings Quality tab.
- `composer/` persists drafts per session.

All values stay in browser `localStorage`; never store secrets there. Readers must tolerate missing, malformed, and documented legacy values so a preference cannot prevent startup. The palette and Settings shortcuts remain fixed to keep both surfaces recoverable.

## Add a preference

Keep the value with its narrowest owner, expose it in `SettingsPanel` only when users should configure it, and persist it under the `pi-livecraft.` prefix. Add a focused test when parsing, migration, or validation is non-trivial.

## Quality tab

The Quality tab stores only local, non-secret preferences under `pi-livecraft.quality.*`:

- default mode, defaulting to `standard`;
- max automatic follow-up turns, clamped by the parser to 0-5 with default `2`;
- attributed automation budget USD, clamped to 0-100 with default `1`;
- automatic independent review, auto-send high findings, and retain review reports toggles;
- reviewer model text, defaulting to `inherit`, and reviewer thinking, defaulting to `medium`;
- a reset action for the first-use acknowledgement key.

`quality/quality-settings.ts` owns these parsers so malformed localStorage falls back safely before the Settings UI renders.

Read [how to add a settings tab](/docs/HOW-TO-SETTINGS.md) for the tabbed modal structure, or [commands](/src/features/commands/README.md) for palette entries and shortcuts, or [right sidebar](/src/features/right-sidebar/README.md) for widget state.
