import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyExtensionUiRequest,
  createExtensionUiState,
  extensionEditorTextLimit,
  extensionStatusTextLimit,
  extensionTitleLimit,
  extensionWidgetColumnLimit,
  extensionWidgetLineLimit,
  isReservedStatusKey,
  reservedStatusKeys,
  sanitizeExtensionUiRequest,
  stripAnsi,
} from '../shared/extension-ui.ts'
import type { JsonObject } from '../shared/types.ts'

function request(method: string, fields: Record<string, unknown> = {}): JsonObject {
  return { type: 'extension_ui_request', id: 'uuid-1', method, ...fields }
}

test('setStatus stores sanitized text per key and clears on omission', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setStatus', { statusKey: 'my-ext', statusText: '\u001b[32mTurn 3\u001b[0m running' }),
  )
  assert.deepEqual([...state.status], [['my-ext', 'Turn 3 running']])
  const cleared = applyExtensionUiRequest(
    state,
    request('setStatus', { statusKey: 'my-ext' }),
  )
  assert.equal(cleared.status.size, 0)
})

test('reserved status keys never reach the status bar', () => {
  assert.deepEqual(reservedStatusKeys, [
    'agent',
    'pi-livecraft.quotas',
    'pi-livecraft.validated-work',
  ])
  assert.equal(isReservedStatusKey('agent'), true)
  assert.equal(isReservedStatusKey('pi-livecraft.quotas'), true)
  assert.equal(isReservedStatusKey('pi-livecraft.validated-work'), true)
  assert.equal(isReservedStatusKey('my-ext'), false)
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setStatus', { statusKey: 'agent', statusText: 'Agent: researcher' }),
  )
  assert.equal(state.status.size, 0)
})

test('setStatus truncates long text with a visible marker', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setStatus', { statusKey: 'my-ext', statusText: 'x'.repeat(600) }),
  )
  const text = state.status.get('my-ext')
  assert.equal(text?.length, 500)
  assert.ok(text?.endsWith('…'))
})

test('setWidget stores lines with placement and clears on omission', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setWidget', {
      widgetKey: 'my-ext',
      widgetLines: ['--- My Widget ---', 'Line 1'],
      widgetPlacement: 'belowEditor',
    }),
  )
  assert.deepEqual(state.widgets.get('my-ext'), {
    lines: ['--- My Widget ---', 'Line 1'],
    placement: 'belowEditor',
  })
  const cleared = applyExtensionUiRequest(state, request('setWidget', { widgetKey: 'my-ext' }))
  assert.equal(cleared.widgets.size, 0)
})

test('setWidget defaults placement to aboveEditor and strips ANSI', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setWidget', {
      widgetKey: 'my-ext',
      widgetLines: ['\u001b[1mBold\u001b[0m'],
    }),
  )
  assert.deepEqual(state.widgets.get('my-ext'), {
    lines: ['Bold'],
    placement: 'aboveEditor',
  })
})

test('setWidget enforces hard line and column limits with visible truncation', () => {
  const shortLines = Array.from({ length: 39 }, (_, index) => `line-${index}`)
  const longLine = 'c'.repeat(500)
  const tailLines = Array.from({ length: 20 }, (_, index) => `tail-${index}`)
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setWidget', {
      widgetKey: 'my-ext',
      widgetLines: [...shortLines, longLine, ...tailLines],
    }),
  )
  const widget = state.widgets.get('my-ext')
  assert.equal(widget?.lines.length, 41)
  assert.equal(widget?.lines[39]?.length, 200)
  assert.ok(widget?.lines[39]?.endsWith('…'))
  assert.equal(widget?.lines[40], '…')
})

test('setWidget rejects non-string arrays', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setWidget', { widgetKey: 'my-ext', widgetLines: [1, 2] }),
  )
  assert.equal(state.widgets.size, 0)
})

test('setTitle stores a sanitized title and clears on omission', () => {
  const state = applyExtensionUiRequest(
    createExtensionUiState(),
    request('setTitle', { title: 'pi - my project\u001b[0m' }),
  )
  assert.equal(state.title, 'pi - my project')
  assert.equal(
    applyExtensionUiRequest(
      createExtensionUiState(),
      request('setTitle', {
        title: '\u001b]0;pi - my project\u0007',
      }),
    )
      .title,
    undefined,
  )
  const cleared = applyExtensionUiRequest(state, request('setTitle'))
  assert.equal(cleared.title, undefined)
})

test('set_editor_text increments a nonce so consumers detect new prefills', () => {
  const first = applyExtensionUiRequest(
    createExtensionUiState(),
    request('set_editor_text', { text: 'first' }),
  )
  assert.deepEqual(first.editorText, { text: 'first', nonce: 1 })
  const second = applyExtensionUiRequest(first, request('set_editor_text', { text: 'second' }))
  assert.deepEqual(second.editorText, { text: 'second', nonce: 2 })
  const cleared = applyExtensionUiRequest(second, request('set_editor_text'))
  assert.equal(cleared.editorText, undefined)
})

test('stripAnsi removes CSI, OSC, and charset escapes', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(stripAnsi('\u001b]0;title\u0007text'), 'text')
  assert.equal(stripAnsi('plain'), 'plain')
  assert.equal(stripAnsi('\u001b(Bplain'), 'plain')
})

test('unknown methods leave the state untouched', () => {
  const state = createExtensionUiState()
  assert.equal(applyExtensionUiRequest(state, request('notify', { message: 'Hi' })), state)
})

test('sanitizeSetStatus strips ANSI, truncates, and keeps the envelope', () => {
  const sanitized = sanitizeExtensionUiRequest(request('setStatus', {
    statusKey: 'my-ext',
    statusText: `\u001b[32m${'x'.repeat(600)}\u001b[0m tail`,
  })) as Record<string, unknown>
  assert.equal(sanitized.type, 'extension_ui_request')
  assert.equal(sanitized.id, 'uuid-1')
  assert.equal(sanitized.method, 'setStatus')
  assert.equal(sanitized.statusKey, 'my-ext')
  const text = sanitized.statusText
  assert.equal(typeof text, 'string')
  assert.equal((text as string).length, extensionStatusTextLimit)
  assert.ok((text as string).endsWith('…'))
  assert.doesNotMatch(text as string, /\u001b/)
})

test('sanitizeSetStatus drops invalid payload fields', () => {
  const sanitized = sanitizeExtensionUiRequest(request('setStatus', {
    statusKey: 42,
    statusText: 7,
  }))
  assert.deepEqual(sanitized, {
    type: 'extension_ui_request',
    id: 'uuid-1',
    method: 'setStatus',
  })
})

test('sanitizeSetWidget enforces line and column limits and normalizes placement', () => {
  const sanitized = sanitizeExtensionUiRequest(request('setWidget', {
    widgetKey: 'my-ext',
    widgetLines: [
      ...Array.from({ length: 39 }, (_, index) => `\u001b[1mline-${index}\u001b[0m`),
      'c'.repeat(500),
      ...Array.from({ length: 10 }, (_, index) => `tail-${index}`),
    ],
    widgetPlacement: 'sidePanel',
  })) as Record<string, unknown>
  assert.equal(sanitized.method, 'setWidget')
  assert.equal(sanitized.widgetKey, 'my-ext')
  assert.equal(sanitized.widgetPlacement, 'aboveEditor')
  const lines = sanitized.widgetLines as string[]
  assert.equal(lines.length, extensionWidgetLineLimit + 1)
  assert.equal(lines[extensionWidgetLineLimit], '…')
  assert.equal(lines[0], 'line-0')
  assert.equal(lines[extensionWidgetLineLimit - 1]?.length, extensionWidgetColumnLimit)
  assert.ok(lines[extensionWidgetLineLimit - 1]?.endsWith('…'))
  assert.ok(lines.every((line) => !/\u001b/.test(line)))
})

test('sanitizeSetWidget preserves belowEditor and omits non-array lines', () => {
  const preserved = sanitizeExtensionUiRequest(request('setWidget', {
    widgetKey: 'my-ext',
    widgetLines: ['a'],
    widgetPlacement: 'belowEditor',
  }))
  assert.equal(
    (preserved as Record<string, unknown>).widgetPlacement,
    'belowEditor',
  )
  const dropped = sanitizeExtensionUiRequest(request('setWidget', {
    widgetKey: 'my-ext',
    widgetLines: 'not-an-array',
  }))
  assert.deepEqual(dropped, {
    type: 'extension_ui_request',
    id: 'uuid-1',
    method: 'setWidget',
    widgetKey: 'my-ext',
    widgetPlacement: 'aboveEditor',
  })
})

test('sanitizeSetTitle strips ANSI and truncates to the title limit', () => {
  const sanitized = sanitizeExtensionUiRequest(request('setTitle', {
    title: `\u001b]0;window\u0007${'t'.repeat(300)}`,
  })) as Record<string, unknown>
  assert.equal(sanitized.method, 'setTitle')
  assert.equal(typeof sanitized.title, 'string')
  assert.equal((sanitized.title as string).length, extensionTitleLimit)
  assert.ok((sanitized.title as string).endsWith('…'))
  assert.doesNotMatch(sanitized.title as string, /\u001b/)
  const dropped = sanitizeExtensionUiRequest(request('setTitle', { title: 5 }))
  assert.deepEqual(dropped, {
    type: 'extension_ui_request',
    id: 'uuid-1',
    method: 'setTitle',
  })
})

test('sanitizeSetEditorText strips ANSI and truncates to the editor limit', () => {
  const sanitized = sanitizeExtensionUiRequest(request('set_editor_text', {
    text: `\u001b[31m${'e'.repeat(extensionEditorTextLimit + 50)}\u001b[0m`,
  })) as Record<string, unknown>
  assert.equal(sanitized.method, 'set_editor_text')
  assert.equal(typeof sanitized.text, 'string')
  assert.equal((sanitized.text as string).length, extensionEditorTextLimit)
  assert.ok((sanitized.text as string).endsWith('…'))
  assert.doesNotMatch(sanitized.text as string, /\u001b/)
  const dropped = sanitizeExtensionUiRequest(request('set_editor_text', { text: null }))
  assert.deepEqual(dropped, {
    type: 'extension_ui_request',
    id: 'uuid-1',
    method: 'set_editor_text',
  })
})

test('sanitizeExtensionUiRequest passes non-fire-and-forget methods through unchanged', () => {
  const blocking = request('confirm', { id: 'confirm-1', title: 'Question', message: 'Go?' })
  assert.equal(sanitizeExtensionUiRequest(blocking), blocking)
  const notify = request('notify', { message: '\u001b[31mHi\u001b[0m' })
  assert.equal(sanitizeExtensionUiRequest(notify), notify)
})

test('sanitizeExtensionUiRequest never mutates the input request', () => {
  const original = request('setStatus', {
    statusKey: 'my-ext',
    statusText: `\u001b[32m${'x'.repeat(600)}`,
  })
  const snapshot = JSON.parse(JSON.stringify(original))
  sanitizeExtensionUiRequest(original)
  assert.deepEqual(original, snapshot)
})
