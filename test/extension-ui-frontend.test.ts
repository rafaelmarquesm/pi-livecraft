import assert from 'node:assert/strict'
import test from 'node:test'
import { applyExtensionUiRequest, createExtensionUiState } from '../shared/extension-ui.ts'
import type { JsonObject } from '../shared/types.ts'
import { extensionDocumentTitle } from '../src/features/extension-ui/document-title.ts'
import { applyEditorPrefill } from '../src/features/extension-ui/editor-prefill.ts'

function request(method: string, fields: Record<string, unknown> = {}): JsonObject {
  return { type: 'extension_ui_request', id: 'uuid-1', method, ...fields }
}

test('extensionDocumentTitle applies the fixed Livecraft prefix only when a title exists', () => {
  assert.equal(extensionDocumentTitle('Weather agent'), 'Livecraft — Weather agent')
  assert.equal(extensionDocumentTitle(undefined), undefined)
  assert.equal(extensionDocumentTitle(''), undefined)
})

test('applyEditorPrefill applies to an empty draft and asks otherwise', () => {
  assert.equal(applyEditorPrefill('', 'extension text'), 'apply')
  assert.equal(applyEditorPrefill('   ', 'extension text'), 'apply')
  assert.equal(applyEditorPrefill('my draft', 'extension text'), 'ask')
})

test('an extension_ui_request sequence drives status, widgets, title, and editor text', () => {
  let state = createExtensionUiState()
  state = applyExtensionUiRequest(
    state,
    request('setStatus', { statusKey: 'weather', statusText: 'sunny 21°C' }),
  )
  state = applyExtensionUiRequest(
    state,
    request('setWidget', {
      widgetKey: 'report',
      widgetLines: ['building…', 'done'],
      widgetPlacement: 'aboveEditor',
    }),
  )
  state = applyExtensionUiRequest(
    state,
    request('setWidget', {
      widgetKey: 'note',
      widgetLines: ['remember x'],
      widgetPlacement: 'belowEditor',
    }),
  )
  state = applyExtensionUiRequest(state, request('setTitle', { title: 'Running the report' }))
  state = applyExtensionUiRequest(
    state,
    request('set_editor_text', { text: 'draft from extension' }),
  )

  assert.deepEqual([...state.status], [['weather', 'sunny 21°C']])
  assert.deepEqual([...state.widgets], [
    ['report', { lines: ['building…', 'done'], placement: 'aboveEditor' }],
    ['note', { lines: ['remember x'], placement: 'belowEditor' }],
  ])
  assert.equal(state.title, 'Running the report')
  assert.deepEqual(state.editorText, { text: 'draft from extension', nonce: 1 })
})

test('set_editor_text nonce is monotonic across requests', () => {
  let state = createExtensionUiState()
  state = applyExtensionUiRequest(state, request('set_editor_text', { text: 'first' }))
  state = applyExtensionUiRequest(state, request('set_editor_text', { text: 'second' }))
  assert.deepEqual(state.editorText, { text: 'second', nonce: 2 })
})

test('spoofed reserved status keys never reach the status bar (E13 rule 8)', () => {
  let state = createExtensionUiState()
  state = applyExtensionUiRequest(
    state,
    request('setStatus', { statusKey: 'agent', statusText: 'Agent: researcher' }),
  )
  state = applyExtensionUiRequest(
    state,
    request('setStatus', { statusKey: 'pi-livecraft.quotas', statusText: '15k used' }),
  )
  assert.equal(state.status.size, 0)
  state = applyExtensionUiRequest(
    state,
    request('setStatus', { statusKey: 'weather', statusText: 'ok' }),
  )
  assert.deepEqual([...state.status], [['weather', 'ok']])
})
