import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionMetaStore, SessionSummary } from '../shared/types.ts'
import {
  groupSessionChildren,
  otherWorkspaceSessions,
  pickSessionOnOpen,
  pinFirst,
  sidebarSessions,
} from '../src/features/workspace/sidebar-sessions.ts'

const persisted: RecentSession = {
  id: 'persisted-id',
  cwd: '/workspace',
  name: 'Premier message',
  sessionPath: '/sessions/new.jsonl',
  updatedAt: 456,
}

test('shows persisted sessions from the current workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/workspace'), [persisted])
})

test('hides persisted sessions from another workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/another-workspace'), [])
})

test('keeps a sent session visible when persistence temporarily omits it', () => {
  assert.deepEqual(sidebarSessions([], '/workspace', [persisted]), [persisted])
})

test('uses persisted order once the sent session is returned', () => {
  const other = {
    ...persisted,
    id: 'other-id',
    sessionPath: '/sessions/other.jsonl',
    updatedAt: 999,
  }
  const refreshed = { ...persisted, name: 'Generated title', updatedAt: 789 }

  assert.deepEqual(sidebarSessions([other, refreshed], '/workspace', [persisted]), [
    other,
    refreshed,
  ])
})

test('orders sessions by their latest activity', () => {
  const older = { ...persisted, updatedAt: 100 }
  const newer = {
    ...persisted,
    id: 'newer-id',
    sessionPath: '/sessions/newer.jsonl',
    updatedAt: 200,
  }

  assert.deepEqual(sidebarSessions([older, newer], '/workspace'), [newer, older])
})

// -- otherWorkspaceSessions ------------------------------------------------

const remoteSession: SessionSummary = {
  id: 'remote-1',
  cwd: '/remote',
  name: 'Remote session',
  sessionPath: '/sessions/remote.jsonl',
  status: 'running',
  pendingUi: [],
}

test('shows active and unviewed completed sessions from other workspaces, active first', () => {
  const completed = {
    ...remoteSession,
    id: 'completed',
    sessionPath: '/sessions/completed.jsonl',
    status: 'idle' as const,
  }
  const starting = {
    ...remoteSession,
    id: 'starting',
    sessionPath: '/sessions/starting.jsonl',
    status: 'starting' as const,
  }

  assert.deepEqual(
    otherWorkspaceSessions(
      [completed, starting],
      '/workspace',
      new Set(),
      new Set(['/sessions/completed.jsonl']),
    ),
    [starting, completed],
  )
})

test('hides current, idle viewed, and exited sessions from other workspaces', () => {
  const current = { ...remoteSession, cwd: '/workspace' }
  const idle = { ...remoteSession, id: 'idle', status: 'idle' as const }
  const exited = { ...remoteSession, id: 'exited', status: 'exited' as const }

  assert.deepEqual(
    otherWorkspaceSessions([current, idle, exited], '/workspace', new Set(), new Set()),
    [],
  )
})

// -- pickSessionOnOpen ------------------------------------------------------

const runningSession: SessionSummary = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  status: 'running',
  pendingUi: [],
}

const idleCompletedSession: SessionSummary = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  status: 'idle',
  pendingUi: [],
}

const startingSession: SessionSummary = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  status: 'starting',
  pendingUi: [],
}

const exitedSession: SessionSummary = {
  id: 'exited-1',
  cwd: '/workspace',
  name: 'Exited session',
  sessionPath: '/sessions/exited.jsonl',
  status: 'exited',
  pendingUi: [],
}

const visibleCompleted: RecentSession = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  updatedAt: 200,
}

const visibleRunning: RecentSession = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  updatedAt: 300,
}

const visibleStarting: RecentSession = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  updatedAt: 100,
}

test('pickSessionOnOpen returns the most recent completed unviewed session first', () => {
  const visible = [visibleRunning, visibleCompleted]
  const active = [runningSession, idleCompletedSession]
  const completed = new Set(['/sessions/idle.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), 'idle-1')
})

test('pickSessionOnOpen falls back to the most recent active session when no completed unviewed', () => {
  const visible = [visibleStarting, visibleRunning]
  const active = [startingSession, runningSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), 'starting-1')
})

test('pickSessionOnOpen skips idle sessions not flagged as completed', () => {
  const visible = [visibleCompleted]
  const active = [idleCompletedSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen skips exited sessions', () => {
  const visibleExited: RecentSession = {
    ...visibleCompleted,
    sessionPath: '/sessions/exited.jsonl',
  }
  const visible = [visibleExited]
  const active = [exitedSession]
  const completed = new Set(['/sessions/exited.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen returns null when no candidate exists', () => {
  assert.equal(pickSessionOnOpen([], [], new Set()), null)
})

test('pickSessionOnOpen picks a starting session as active', () => {
  const visible = [visibleStarting]
  const active = [startingSession]

  assert.equal(pickSessionOnOpen(visible, active, new Set()), 'starting-1')
})

// -- groupSessionChildren ----------------------------------------------------

const treeParent: RecentSession = {
  id: 'tree-parent',
  cwd: '/workspace',
  name: 'Parent session',
  sessionPath: '/sessions/parent.jsonl',
  updatedAt: 300,
}

test('groupSessionChildren nests a child under its listed parent', () => {
  const child: RecentSession = {
    ...treeParent,
    id: 'tree-child',
    name: 'Child session',
    sessionPath: '/sessions/child.jsonl',
    updatedAt: 200,
    parentSession: treeParent.sessionPath,
  }

  assert.deepEqual(groupSessionChildren([child, treeParent]), {
    roots: [treeParent],
    childrenByParentPath: new Map([[treeParent.sessionPath, [child]]]),
  })
})

test('groupSessionChildren treats sessions whose parent is absent as roots', () => {
  const orphan: RecentSession = {
    ...treeParent,
    id: 'tree-orphan',
    name: 'Orphan session',
    sessionPath: '/sessions/orphan.jsonl',
    updatedAt: 200,
    parentSession: '/sessions/missing.jsonl',
  }

  assert.deepEqual(groupSessionChildren([orphan, treeParent]), {
    roots: [orphan, treeParent],
    childrenByParentPath: new Map(),
  })
})

test('groupSessionChildren breaks parent cycles by treating every member as a root', () => {
  const first: RecentSession = {
    ...treeParent,
    id: 'tree-first',
    sessionPath: '/sessions/first.jsonl',
    updatedAt: 200,
    parentSession: '/sessions/second.jsonl',
  }
  const second: RecentSession = {
    ...treeParent,
    id: 'tree-second',
    sessionPath: '/sessions/second.jsonl',
    updatedAt: 100,
    parentSession: '/sessions/first.jsonl',
  }

  assert.deepEqual(groupSessionChildren([first, second]), {
    roots: [first, second],
    childrenByParentPath: new Map(),
  })
})

test('groupSessionChildren groups multiple children under one parent in input order', () => {
  const firstChild: RecentSession = {
    ...treeParent,
    id: 'tree-child-1',
    name: 'Child 1',
    sessionPath: '/sessions/child-1.jsonl',
    updatedAt: 200,
    parentSession: treeParent.sessionPath,
  }
  const secondChild: RecentSession = {
    ...treeParent,
    id: 'tree-child-2',
    name: 'Child 2',
    sessionPath: '/sessions/child-2.jsonl',
    updatedAt: 100,
    parentSession: treeParent.sessionPath,
  }

  assert.deepEqual(groupSessionChildren([firstChild, secondChild, treeParent]), {
    roots: [treeParent],
    childrenByParentPath: new Map([[treeParent.sessionPath, [firstChild, secondChild]]]),
  })
})

// -- pinFirst ----------------------------------------------------------------

test('pinFirst moves pinned sessions before unpinned ones', () => {
  const pinned = {
    ...persisted,
    id: 'pinned-id',
    sessionPath: '/sessions/pinned.jsonl',
    updatedAt: 100,
  }
  const unpinned = {
    ...persisted,
    id: 'unpinned-id',
    sessionPath: '/sessions/unpinned.jsonl',
    updatedAt: 200,
  }
  const meta: SessionMetaStore = { '/sessions/pinned.jsonl': { pinned: true } }

  assert.deepEqual(pinFirst([unpinned, pinned], meta), [pinned, unpinned])
})

test('pinFirst keeps relative order within pinned and unpinned groups', () => {
  const first = {
    ...persisted,
    id: 'first-id',
    sessionPath: '/sessions/first.jsonl',
    updatedAt: 100,
  }
  const second = {
    ...persisted,
    id: 'second-id',
    sessionPath: '/sessions/second.jsonl',
    updatedAt: 200,
  }
  const third = {
    ...persisted,
    id: 'third-id',
    sessionPath: '/sessions/third.jsonl',
    updatedAt: 300,
  }
  const meta: SessionMetaStore = {
    '/sessions/first.jsonl': { pinned: true },
    '/sessions/third.jsonl': { pinned: true },
  }

  assert.deepEqual(pinFirst([first, second, third], meta), [first, third, second])
})

test('pinFirst leaves an empty metadata store untouched', () => {
  const sessions = [persisted, { ...persisted, id: 'other', sessionPath: '/sessions/o.jsonl' }]

  assert.deepEqual(pinFirst(sessions, {}), sessions)
})

test('pinFirst treats an explicit false pin like no pin', () => {
  const session = { ...persisted, sessionPath: '/sessions/false.jsonl' }
  const meta: SessionMetaStore = { '/sessions/false.jsonl': { pinned: false } }

  assert.deepEqual(pinFirst([session], meta), [session])
})

test('pinFirst orders roots before groupSessionChildren without detaching children', () => {
  const parent = { ...treeParent, updatedAt: 100 }
  const child: RecentSession = {
    ...treeParent,
    id: 'tree-child',
    name: 'Child session',
    sessionPath: '/sessions/child.jsonl',
    updatedAt: 200,
    parentSession: treeParent.sessionPath,
  }
  const other = {
    ...treeParent,
    id: 'other-id',
    sessionPath: '/sessions/other.jsonl',
    updatedAt: 300,
  }
  const meta: SessionMetaStore = { [treeParent.sessionPath]: { pinned: true } }

  assert.deepEqual(groupSessionChildren(pinFirst([other, child, parent], meta)), {
    roots: [parent, other],
    childrenByParentPath: new Map([[treeParent.sessionPath, [child]]]),
  })
})
