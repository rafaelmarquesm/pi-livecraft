import type { JsonObject } from './types.ts'

/**
 * Extension UI contract shared by the manager and the frontend (M4).
 *
 * `extension_ui_request` carries five fire-and-forget methods. Rules enforced
 * here (each covered by a test): reserved status keys never reach the status
 * bar, all extension text is ANSI-stripped and size-limited with visible
 * truncation, and `set_editor_text` is carried as a nonce-tagged value so the
 * composer can apply its never-overwrite policy (E15).
 */

export const reservedStatusKeys = [
  'agent',
  'pi-livecraft.quotas',
  'pi-livecraft.validated-work',
] as const

export type ExtensionWidgetPlacement = 'aboveEditor' | 'belowEditor'

export const extensionStatusTextLimit = 500
export const extensionTitleLimit = 200
export const extensionWidgetLineLimit = 40
export const extensionWidgetColumnLimit = 200
export const extensionEditorTextLimit = 100_000

export interface ExtensionWidget {
  lines: string[]
  placement: ExtensionWidgetPlacement
}

export interface ExtensionEditorText {
  text: string
  /** Monotonic id so consumers can detect a new prefill request. */
  nonce: number
}

export interface ExtensionUiState {
  /** statusKey -> visible text. Reserved keys are never stored here (E13). */
  status: Map<string, string>
  widgets: Map<string, ExtensionWidget>
  title?: string
  editorText?: ExtensionEditorText
}

export function createExtensionUiState(): ExtensionUiState {
  return { status: new Map(), widgets: new Map() }
}

export function isReservedStatusKey(statusKey: string): boolean {
  return (reservedStatusKeys as readonly string[]).includes(statusKey)
}

/**
 * Whether an `extension_ui_request` demands a user response. Only dialog
 * methods enter `pendingUi`; the five fire-and-forget methods never block the
 * session from reaching idle (E14).
 */
export function isBlockingUiRequest(request: JsonObject): boolean {
  return request.method === 'select' || request.method === 'confirm'
    || request.method === 'input' || request.method === 'editor'
}

/** Removes ANSI CSI/OSC escape sequences from extension-provided text. */
export function stripAnsi(text: string): string {
  return text.replace(
    /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-Z]/g,
    '',
  )
}

/** Applies one extension_ui_request to the state, returning a new state. Pure. */
export function applyExtensionUiRequest(
  state: ExtensionUiState,
  request: JsonObject,
): ExtensionUiState {
  const method = request.method
  if (method === 'setStatus') return applySetStatus(state, request)
  if (method === 'setWidget') return applySetWidget(state, request)
  if (method === 'setTitle') return applySetTitle(state, request)
  if (method === 'set_editor_text') return applySetEditorText(state, request)
  return state
}

function applySetStatus(state: ExtensionUiState, request: JsonObject): ExtensionUiState {
  const statusKey = request.statusKey
  if (typeof statusKey !== 'string' || isReservedStatusKey(statusKey)) return state
  const statusText = request.statusText
  const text = typeof statusText === 'string'
    ? truncateWithMarker(stripAnsi(statusText), extensionStatusTextLimit)
    : ''
  if (text === '') {
    if (!state.status.has(statusKey)) return state
    const status = new Map(state.status)
    status.delete(statusKey)
    return { ...state, status }
  }
  if (state.status.get(statusKey) === text) return state
  const status = new Map(state.status)
  status.set(statusKey, text)
  return { ...state, status }
}

function applySetWidget(state: ExtensionUiState, request: JsonObject): ExtensionUiState {
  const widgetKey = request.widgetKey
  if (typeof widgetKey !== 'string') return state
  const widgetLines = request.widgetLines
  if (!Array.isArray(widgetLines) || !widgetLines.every((line) => typeof line === 'string')) {
    if (!state.widgets.has(widgetKey)) return state
    const widgets = new Map(state.widgets)
    widgets.delete(widgetKey)
    return { ...state, widgets }
  }
  const placement: ExtensionWidgetPlacement = request.widgetPlacement === 'belowEditor'
    ? 'belowEditor'
    : 'aboveEditor'
  const sanitizedLines = widgetLines.map((line) =>
    truncateWithMarker(stripAnsi(line), extensionWidgetColumnLimit)
  )
  const visibleLines = sanitizedLines.length > extensionWidgetLineLimit
    ? [...sanitizedLines.slice(0, extensionWidgetLineLimit), '…']
    : sanitizedLines
  const existing = state.widgets.get(widgetKey)
  if (
    existing && existing.placement === placement
    && existing.lines.length === visibleLines.length
    && existing.lines.every((line, index) => line === visibleLines[index])
  ) return state
  const widgets = new Map(state.widgets)
  widgets.set(widgetKey, { lines: visibleLines, placement })
  return { ...state, widgets }
}

function applySetTitle(state: ExtensionUiState, request: JsonObject): ExtensionUiState {
  const title = request.title
  if (typeof title !== 'string') {
    if (state.title === undefined) return state
    return { ...state, title: undefined }
  }
  const sanitized = truncateWithMarker(stripAnsi(title), extensionTitleLimit)
  if (sanitized === '') {
    if (state.title === undefined) return state
    return { ...state, title: undefined }
  }
  if (state.title === sanitized) return state
  return { ...state, title: sanitized }
}

function applySetEditorText(state: ExtensionUiState, request: JsonObject): ExtensionUiState {
  const text = request.text
  if (typeof text !== 'string') {
    if (state.editorText === undefined) return state
    const { editorText: _dropped, ...next } = state
    return next
  }
  const sanitized = truncateWithMarker(stripAnsi(text), extensionEditorTextLimit)
  return {
    ...state,
    editorText: { text: sanitized, nonce: (state.editorText?.nonce ?? 0) + 1 },
  }
}

function truncateWithMarker(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

/**
 * Returns a sanitized copy of an `extension_ui_request` event for transport.
 * The manager applies this before broadcasting so extension-provided text never
 * reaches the frontend with ANSI escapes or unbounded size; the frontend
 * reducer re-applies the same limits as defense in depth. Only the five
 * fire-and-forget methods are rewritten with their known fields. Every other
 * method passes through unchanged because the frontend owns their protocol.
 */
export function sanitizeExtensionUiRequest(request: JsonObject): JsonObject {
  const method = request.method
  if (method === 'setStatus') return sanitizeSetStatus(request)
  if (method === 'setWidget') return sanitizeSetWidget(request)
  if (method === 'setTitle') return sanitizeSetTitle(request)
  if (method === 'set_editor_text') return sanitizeSetEditorText(request)
  return request
}

function sanitizeEnvelope(request: JsonObject): JsonObject {
  const sanitized: JsonObject = {}
  if (typeof request.type === 'string') sanitized.type = request.type
  if (typeof request.id === 'string') sanitized.id = request.id
  if (typeof request.method === 'string') sanitized.method = request.method
  return sanitized
}

function sanitizeSetStatus(request: JsonObject): JsonObject {
  const sanitized = sanitizeEnvelope(request)
  if (typeof request.statusKey === 'string') sanitized.statusKey = request.statusKey
  if (typeof request.statusText === 'string') {
    sanitized.statusText = truncateWithMarker(
      stripAnsi(request.statusText),
      extensionStatusTextLimit,
    )
  }
  return sanitized
}

function sanitizeSetWidget(request: JsonObject): JsonObject {
  const sanitized = sanitizeEnvelope(request)
  if (typeof request.widgetKey === 'string') sanitized.widgetKey = request.widgetKey
  const widgetLines = request.widgetLines
  if (Array.isArray(widgetLines) && widgetLines.every((line) => typeof line === 'string')) {
    const sanitizedLines = widgetLines.map((line) =>
      truncateWithMarker(stripAnsi(line), extensionWidgetColumnLimit)
    )
    sanitized.widgetLines = sanitizedLines.length > extensionWidgetLineLimit
      ? [...sanitizedLines.slice(0, extensionWidgetLineLimit), '…']
      : sanitizedLines
  }
  sanitized.widgetPlacement = request.widgetPlacement === 'belowEditor'
    ? 'belowEditor'
    : 'aboveEditor'
  return sanitized
}

function sanitizeSetTitle(request: JsonObject): JsonObject {
  const sanitized = sanitizeEnvelope(request)
  if (typeof request.title === 'string') {
    sanitized.title = truncateWithMarker(stripAnsi(request.title), extensionTitleLimit)
  }
  return sanitized
}

function sanitizeSetEditorText(request: JsonObject): JsonObject {
  const sanitized = sanitizeEnvelope(request)
  if (typeof request.text === 'string') {
    sanitized.text = truncateWithMarker(stripAnsi(request.text), extensionEditorTextLimit)
  }
  return sanitized
}
