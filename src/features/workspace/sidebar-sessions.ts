import type { RecentSession, SessionMetaStore, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'

export interface SessionActionTarget {
  cwd: string
  name: string
  sessionId?: string
  sessionPath?: string
}

/** Adds pending sessions and orders the visible list by latest activity. */
export function sidebarSessions(
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): RecentSession[] {
  const recentIds = new Set(recentSessions.map((session) => session.id))
  const recentPaths = new Set(recentSessions.map((session) => session.sessionPath))
  const pending = sentSessions.filter((session) =>
    !recentIds.has(session.id) && !recentPaths.has(session.sessionPath)
  )
  return [...pending, ...recentSessions]
    .filter(({ cwd }) => cwd === workspacePath)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Orders sessions so pinned ones sort before unpinned, stable within each group. */
export function pinFirst(sessions: RecentSession[], meta: SessionMetaStore): RecentSession[] {
  return [
    ...sessions.filter((session) => meta[session.sessionPath]?.pinned === true),
    ...sessions.filter((session) => meta[session.sessionPath]?.pinned !== true),
  ]
}

export interface SessionTree {
  /** Sessions with no parent in the list (or on a parent cycle), in input order. */
  roots: RecentSession[]
  /** Children grouped by their parent's session path, in input order. */
  childrenByParentPath: ReadonlyMap<string, readonly RecentSession[]>
}

/**
 * Groups recent sessions into a parent/child tree using the `parentSession` header field.
 * A session is a child only when its parent appears in the same list; orphans (a parent
 * outside the list) render as roots. Sessions on a parent cycle (A→B→A) render as roots
 * too, since no child can be its own ancestor.
 */
export function groupSessionChildren(sessions: RecentSession[]): SessionTree {
  const byPath = new Map(sessions.map((session) => [session.sessionPath, session]))
  // Only parent links that resolve to another listed session can make a child.
  const parentPaths = new Map<string, string>()
  for (const session of sessions) {
    if (session.parentSession !== undefined && byPath.has(session.parentSession)) {
      parentPaths.set(session.sessionPath, session.parentSession)
    }
  }
  const cyclic = cyclicPaths(parentPaths)
  const childrenByParentPath = new Map<string, RecentSession[]>()
  const childPaths = new Set<string>()
  for (const session of sessions) {
    const parent = session.parentSession
    if (parent === undefined || cyclic.has(session.sessionPath) || !byPath.has(parent)) continue
    childPaths.add(session.sessionPath)
    const siblings = childrenByParentPath.get(parent)
    if (siblings) siblings.push(session)
    else childrenByParentPath.set(parent, [session])
  }
  return {
    roots: sessions.filter((session) => !childPaths.has(session.sessionPath)),
    childrenByParentPath,
  }
}

/** Session paths that sit on a parent loop (A→B→A); those sessions are treated as roots. */
function cyclicPaths(parentPaths: ReadonlyMap<string, string>): Set<string> {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cyclic = new Set<string>()
  const visit = (path: string, trail: string[]): void => {
    if (visited.has(path)) return
    if (visiting.has(path)) {
      const start = trail.indexOf(path)
      if (start >= 0) { for (const node of trail.slice(start)) cyclic.add(node) }
      return
    }
    visiting.add(path)
    const parent = parentPaths.get(path)
    if (parent !== undefined) visit(parent, [...trail, path])
    visiting.delete(path)
    visited.add(path)
  }
  for (const path of parentPaths.keys()) visit(path, [])
  return cyclic
}

/** Picks the next visible active session after closing the selected one. */
export function nextActiveSessionId(
  closedSessionId: string,
  sessions: SessionSummary[],
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): string | null {
  const activeIds = sidebarSessions(recentSessions, workspacePath, sentSessions).flatMap(
    (recent) => {
      const active = sessions.find((session) =>
        session.sessionPath === recent.sessionPath && session.status !== 'exited'
      )
      return active ? [active.id] : []
    },
  )
  const closedIndex = activeIds.indexOf(closedSessionId)
  return closedIndex >= 0
    ? activeIds[closedIndex + 1] ?? activeIds[closedIndex - 1] ?? null
    : activeIds[0] ?? null
}

/** Lists attention-worthy sessions outside the current workspace, with active work first. */
export function otherWorkspaceSessions(
  sessions: SessionSummary[],
  workspacePath: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
): SessionSummary[] {
  const relevant = sessions.filter((session) =>
    session.cwd !== workspacePath
    && session.status !== 'exited'
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== null
    && sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== 'idle'
  )
  return [
    ...relevant.filter((session) =>
      sessionIndicator(session, '', compactingSessionIds, completedSessionIds) !== 'complete'
    ),
    ...relevant.filter((session) =>
      sessionIndicator(session, '', compactingSessionIds, completedSessionIds) === 'complete'
    ),
  ]
}

/**
 * Picks the session to auto-select when opening a workspace.
 * Priority: most recent completed unviewed session → most recent active session → none.
 */
export function pickSessionOnOpen(
  visibleSessions: RecentSession[],
  activeSessions: SessionSummary[],
  completedSessionIds: ReadonlySet<string>,
): string | null {
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && active.status === 'idle' && completedSessionIds.has(visible.sessionPath)) {
      return active.id
    }
  }
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && (active.status === 'starting' || active.status === 'running')) {
      return active.id
    }
  }
  return null
}
