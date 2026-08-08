# Session metadata (pin/tags/note)

Editable per-session metadata used by the workspace sidebar (Fase 4.4).
Owner: `server/features/sessions/session-meta-store.ts`.

## Store (M6 pattern)

- Path: `~/.pi-livecraft/session-meta.json`, overridable with
  `PI_LIVECRAFT_SESSION_META_STORE`. The environment override is read at call
  time (not module load) so tests can swap the file without re-importing.
- Written via tmp + `rename`, `mode: 0o600`, through a serialized write queue.
- Strict boundary validation (`parseSessionMetaStore` / `validateSessionMeta`):
  only `pinned`, `tags`, `note` keys; `pinned` boolean; `tags` array of at most
  8 trimmed non-empty strings of at most 40 characters; `note` string of at most
  2000 characters. Unknown keys or out-of-bound values are rejected.
- Saving an empty meta object removes the session's entry from the store, so
  unpinning and clearing tags/note leaves no residue.

## Scoping

The store is **global and keyed by the canonical absolute `sessionPath`** — not
by `sessionId` and not per workspace — so metadata survives fork/clone (the Pi
reuses the manager session id but writes a new session file). The `cwd` sent to
the routes is resolved only for display and informational purposes; it never
filters storage or responses.

## Routes

- `GET /api/sessions/meta?cwd=…` → `{ cwd, meta: Record<sessionPath, SessionMeta> }`.
  Returns the full store: the sidebar needs pins for every session it lists.
- `PUT /api/sessions/meta` body `{ cwd, sessionPath, meta }` → validates with
  the same strictness as the store, saves, and returns the normalized meta
  (`400` on invalid input).

## API

- `loadSessionMeta(path?)` — full store (missing file → `{}`)
- `saveSessionMeta(sessionPath, meta, path?)` — atomic per-session merge
- `parseSessionMetaStore(content)` / `validateSessionMeta(value)` — pure
  boundary validators shared with the backend routes
