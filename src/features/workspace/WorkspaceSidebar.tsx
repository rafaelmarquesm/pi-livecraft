import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  RecentSession,
  SessionMeta,
  SessionMetaStore,
  SessionSummary,
} from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import {
  groupSessionChildren,
  otherWorkspaceSessions,
  pinFirst,
  sidebarSessions,
  type SessionActionTarget,
} from './sidebar-sessions.ts'
import { SessionRenameDialog } from './SessionRenameDialog.tsx'
import { maxWorkspaceSidebarWidth, minWorkspaceSidebarWidth } from './workspace-sidebar.ts'

interface ContextMenuState {
  target: SessionActionTarget
  x: number
  y: number
}

interface WorkspaceSidebarProps {
  collapsed: boolean
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  isRefreshing: boolean
  recentSessions: RecentSession[]
  sentSessions: RecentSession[]
  sessions: SessionSummary[]
  selectedId: string
  width: number
  workspacePath: string
  onChooseWorkspace: () => void
  onCloseSession: (sessionId: string) => Promise<void>
  onCreate: () => Promise<void>
  onOpenSession: (session: RecentSession) => Promise<void>
  onSelectOtherWorkspaceSession: (session: SessionSummary) => void
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onRenameSession: (target: SessionActionTarget, name: string) => Promise<void>
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  sessionMeta: SessionMetaStore
  onUpdateSessionMeta: (sessionPath: string, meta: SessionMeta) => Promise<void>
  onError: (cause: unknown) => void
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({
  collapsed,
  compactingSessionIds,
  completedSessionIds,
  isRefreshing,
  recentSessions,
  sentSessions,
  sessions,
  selectedId,
  width,
  workspacePath,
  onChooseWorkspace,
  onCloseSession,
  onCreate,
  onOpenSession,
  onSelectOtherWorkspaceSession,
  onSelectSession,
  onOpenSettings,
  onRenameSession,
  onResize,
  onToggleCollapsed,
  sessionMeta,
  onUpdateSessionMeta,
  onError,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null)
  const [metaEdit, setMetaEdit] = useState<
    { target: SessionActionTarget; field: 'tags' | 'note'; x: number; y: number } | null
  >(null)
  const [metaEditText, setMetaEditText] = useState('')
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const metaEditRef = useRef<HTMLDivElement>(null)
  const visibleSessions = useMemo(
    () => sidebarSessions(recentSessions, workspacePath, sentSessions),
    [recentSessions, sentSessions, workspacePath],
  )
  // Pins reorder the input list; groupSessionChildren preserves that order for roots.
  const pinnedSessions = useMemo(() => pinFirst(visibleSessions, sessionMeta), [
    sessionMeta,
    visibleSessions,
  ])
  const sessionTree = useMemo(() => groupSessionChildren(pinnedSessions), [pinnedSessions])
  const otherSessions = useMemo(
    () =>
      otherWorkspaceSessions(sessions, workspacePath, compactingSessionIds, completedSessionIds),
    [compactingSessionIds, completedSessionIds, sessions, workspacePath],
  )

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, visibleSessions])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const { width: menuWidth, height: menuHeight } = contextMenuRef.current.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, contextMenu.x),
      Math.max(8, window.innerWidth - menuWidth - 8),
    )
    const top = Math.min(
      Math.max(8, contextMenu.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    )
    setContextMenuPosition({ left, top })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) {
        setContextMenu(null)
      }
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setContextMenu(null)
      contextMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!metaEdit) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !metaEditRef.current?.contains(event.target)) {
        setMetaEdit(null)
      }
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMetaEdit(null)
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [metaEdit])

  function dismissContextMenu(): void {
    setContextMenu(null)
    contextMenuTriggerRef.current?.focus()
  }

  function openContextMenu(
    target: SessionActionTarget,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    contextMenuTriggerRef.current = event.currentTarget
    setContextMenu({ target, x: event.clientX, y: event.clientY })
  }

  function openContextMenuFromKeyboard(
    target: SessionActionTarget,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    contextMenuTriggerRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({ target, x: rect.left, y: rect.bottom })
  }

  function startRename(): void {
    if (!contextMenu) return
    const { target } = contextMenu
    dismissContextMenu()
    setRenameTarget(target)
  }

  function dismissRename(): void {
    setRenameTarget(null)
    contextMenuTriggerRef.current?.focus()
  }

  async function closeTarget(): Promise<void> {
    const sessionId = contextMenu?.target.sessionId
    dismissContextMenu()
    if (!sessionId) return
    try {
      await onCloseSession(sessionId)
    } catch (cause) {
      onError(cause)
    }
  }

  /** Toggles the pinned flag of the context-menu session through the App-owned store. */
  async function togglePinned(): Promise<void> {
    const sessionPath = contextMenu?.target.sessionPath
    if (!sessionPath) return
    dismissContextMenu()
    try {
      const current = sessionMeta[sessionPath] ?? {}
      await onUpdateSessionMeta(sessionPath, { ...current, pinned: !current.pinned })
    } catch (cause) {
      onError(cause)
    }
  }

  /** Opens the tags/note editor for the context-menu session at the menu position. */
  function startMetaEdit(field: 'tags' | 'note'): void {
    if (!contextMenu) return
    const { target } = contextMenu
    const current = target.sessionPath ? sessionMeta[target.sessionPath] : undefined
    setMetaEditText(field === 'tags' ? (current?.tags ?? []).join(', ') : current?.note ?? '')
    setMetaEdit({ target, field, x: contextMenuPosition.left, y: contextMenuPosition.top })
    setContextMenu(null)
  }

  function cancelMetaEdit(): void {
    setMetaEdit(null)
    contextMenuTriggerRef.current?.focus()
  }

  /** Saves the edited tags or note through the App-owned store. */
  async function saveMetaEdit(): Promise<void> {
    if (!metaEdit) return
    const { target, field } = metaEdit
    const sessionPath = target.sessionPath
    setMetaEdit(null)
    if (!sessionPath) return
    try {
      const current = sessionMeta[sessionPath] ?? {}
      const next: SessionMeta = field === 'tags'
        ? { ...current, tags: parseTags(metaEditText) }
        : { ...current, note: metaEditText }
      await onUpdateSessionMeta(sessionPath, next)
    } catch (cause) {
      onError(cause)
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + moveEvent.clientX - initialX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minWorkspaceSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxWorkspaceSidebarWidth)
    }
  }

  function renderSessionRow(recentSession: RecentSession, child = false) {
    const activeSession = sessions.find((session) =>
      session.sessionPath === recentSession.sessionPath && session.status !== 'exited'
    )
    const indicator = sessionIndicator(
      activeSession,
      selectedId,
      compactingSessionIds,
      completedSessionIds,
    )
    const sessionLabel = openingSessionPath === recentSession.sessionPath
      ? 'Opening…'
      : recentSession.name
    const actionTarget: SessionActionTarget = {
      cwd: recentSession.cwd,
      name: recentSession.name,
      sessionId: activeSession?.id,
      sessionPath: recentSession.sessionPath,
    }
    return (
      <Tooltip
        hint='Right-click to rename or close the session'
        label={`${recentSession.name}\n${
          new Date(recentSession.updatedAt).toLocaleString('en-US')
        }`}
      >
        <button
          aria-haspopup='menu'
          className={`session-item${child ? ' session-child' : ''}${
            activeSession?.id === selectedId ? ' selected' : ''
          }${indicator ? ` ${indicator}` : ''}${
            sessionMeta[recentSession.sessionPath]?.pinned ? ' pinned' : ''
          }`}
          disabled={openingSessionPath === recentSession.sessionPath}
          onContextMenu={(event) => openContextMenu(actionTarget, event)}
          onKeyDown={(event) => openContextMenuFromKeyboard(actionTarget, event)}
          onClick={() => {
            if (activeSession) {
              onSelectSession(activeSession.id)
              return
            }
            setOpeningSessionPath(recentSession.sessionPath)
            void onOpenSession(recentSession).catch(onError).finally(() =>
              setOpeningSessionPath('')
            )
          }}
          ref={activeSession?.id === selectedId ? selectedSessionRef : undefined}
          type='button'
        >
          {indicator && <SessionStatusIndicator status={indicator} />}
          <span>
            <strong>{sessionLabel}</strong>
          </span>
        </button>
      </Tooltip>
    )
  }

  return (
    <aside
      aria-label='Session sidebar'
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
    >
      <div className='sidebar-rail'>
        <Tooltip label='Expand session sidebar'>
          <button
            aria-expanded={false}
            aria-label='Expand session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed />
          </button>
        </Tooltip>
      </div>
      <div
        aria-label='Resize session sidebar'
        aria-orientation='vertical'
        aria-valuemax={maxWorkspaceSidebarWidth}
        aria-valuemin={minWorkspaceSidebarWidth}
        aria-valuenow={width}
        className='sidebar-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='brand'>
        <span className='brand-mark'>π</span>
        <div>
          <strong>Pi Livecraft</strong>
          <small>Local workspace</small>
        </div>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='settings-button'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
        <Tooltip label='Collapse session sidebar'>
          <button
            aria-expanded={true}
            aria-label='Collapse session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed={false} />
          </button>
        </Tooltip>
      </div>
      <div className='workspace-group'>
        <Tooltip label={workspacePath}>
          <button
            aria-label={`Choose workspace: ${workspacePath}`}
            className='workspace-path'
            onClick={onChooseWorkspace}
            type='button'
          >
            <WorkspaceIcon />
            <div className='workspace-path-copy'>
              <span>Current directory</span>
              <strong>{workspacePath}</strong>
            </div>
            <ChevronIcon />
          </button>
        </Tooltip>
      </div>
      <NewSessionButton onCreate={onCreate} onError={onError} />
      <nav className='session-list' aria-label='Recent Pi sessions'>
        {isRefreshing && visibleSessions.length === 0 && (
          <p className='session-list-loading' role='status'>Loading sessions…</p>
        )}
        {sessionTree.roots.map((recentSession) => {
          const children = sessionTree.childrenByParentPath.get(recentSession.sessionPath) ?? []
          return (
            <Fragment key={recentSession.sessionPath}>
              {renderSessionRow(recentSession)}
              {children.map((child) => renderSessionRow(child, true))}
            </Fragment>
          )
        })}
        {visibleSessions.length === 0 && !isRefreshing && (
          <p className='empty-sidebar'>No Pi sessions in this directory.</p>
        )}
      </nav>
      {otherSessions.length > 0 && (
        <section className='other-workspace-sessions'>
          <h2>Other workspaces</h2>
          <nav
            aria-label='Active and completed sessions in other workspaces'
            className='other-session-list'
          >
            {otherSessions.map((session) => {
              const indicator = sessionIndicator(
                session,
                selectedId,
                compactingSessionIds,
                completedSessionIds,
              )
              const actionTarget: SessionActionTarget = {
                cwd: session.cwd,
                name: session.name,
                sessionId: session.id,
                sessionPath: session.sessionPath,
              }
              return (
                <Tooltip
                  hint='Right-click to rename or close the session'
                  key={session.id}
                  label={`${session.name}\n${session.cwd}`}
                >
                  <button
                    aria-haspopup='menu'
                    aria-label={`${session.name} in workspace ${session.cwd}`}
                    className={`session-item${indicator ? ` ${indicator}` : ''}`}
                    onContextMenu={(event) => openContextMenu(actionTarget, event)}
                    onKeyDown={(event) => openContextMenuFromKeyboard(actionTarget, event)}
                    onClick={() => onSelectOtherWorkspaceSession(session)}
                    type='button'
                  >
                    {indicator && <SessionStatusIndicator status={indicator} />}
                    <span>
                      <strong>{session.name}</strong>
                      <small>{session.cwd}</small>
                    </span>
                  </button>
                </Tooltip>
              )
            })}
          </nav>
        </section>
      )}
      {contextMenu && (
        <div
          aria-label='Session actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <button autoFocus onClick={startRename} role='menuitem' type='button'>
            Rename…
          </button>
          {contextMenu.target.sessionPath && (
            <button onClick={() => void togglePinned()} role='menuitem' type='button'>
              {sessionMeta[
                  contextMenu
                    .target
                    .sessionPath
                ]
                  ?.pinned
                ? 'Unpin'
                : 'Pin'}
            </button>
          )}
          {contextMenu.target.sessionPath && (
            <button onClick={() => startMetaEdit('tags')} role='menuitem' type='button'>
              Edit tags…
            </button>
          )}
          {contextMenu.target.sessionPath && (
            <button onClick={() => startMetaEdit('note')} role='menuitem' type='button'>
              Edit note…
            </button>
          )}
          {contextMenu.target.sessionId && (
            <button
              className='danger'
              onClick={() => void closeTarget()}
              role='menuitem'
              type='button'
            >
              Close session
            </button>
          )}
        </div>
      )}
      {metaEdit && (
        <div
          aria-label={metaEdit.field === 'tags' ? 'Edit session tags' : 'Edit session note'}
          className='session-context-menu session-meta-editor'
          ref={metaEditRef}
          role='dialog'
          style={{ left: metaEdit.x, top: metaEdit.y }}
        >
          <label className='session-meta-label' htmlFor='session-meta-input'>
            {metaEdit.field === 'tags' ? 'Tags (comma separated)' : 'Note'}
          </label>
          {metaEdit.field === 'tags'
            ? (
              <input
                autoFocus
                className='session-meta-input'
                id='session-meta-input'
                onChange={(event) => setMetaEditText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveMetaEdit()
                  }
                }}
                type='text'
                value={metaEditText}
              />
            )
            : (
              <textarea
                autoFocus
                className='session-meta-input'
                id='session-meta-input'
                onChange={(event) => setMetaEditText(event.target.value)}
                rows={4}
                value={metaEditText}
              />
            )}
          <div className='session-meta-actions'>
            <button onClick={() => void saveMetaEdit()} type='button'>
              Save
            </button>
            <button onClick={cancelMetaEdit} type='button'>
              Cancel
            </button>
          </div>
        </div>
      )}
      {renameTarget && (
        <SessionRenameDialog
          initialName={renameTarget.name}
          key={renameTarget.sessionPath ?? renameTarget.sessionId ?? renameTarget.name}
          onClose={dismissRename}
          onConfirm={(name) => onRenameSession(renameTarget, name)}
        />
      )}
    </aside>
  )
}

/** Splits comma-separated tag input, trimming and dropping empty entries. */
function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

/** Prevents duplicate session creation and reports errors to the container. */
function NewSessionButton(
  { onCreate, onError }: { onCreate: () => Promise<void>; onError: (cause: unknown) => void },
) {
  const [busy, setBusy] = useState(false)

  async function create(): Promise<void> {
    setBusy(true)
    try {
      await onCreate()
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className='new-session'
      disabled={busy}
      onClick={() => void create()}
      type='button'
    >
      {busy ? 'Starting…' : '＋ New session'}
    </button>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3 3v18' />
      <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
    </svg>
  )
}

function WorkspaceIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8A1.5 1.5 0 0 1 20.5 8.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z' />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='m9 6 6 6-6 6' />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
      <path d='m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z' />
    </svg>
  )
}
