import assert from 'node:assert/strict'
import test from 'node:test'
import { piCommandMutatesState } from '../server/pi-command-state.ts'

test('identifies commands whose effects must be reconciled through get_state', () => {
  for (
    const type of [
      'cycle_model',
      'cycle_thinking_level',
      'set_auto_compaction',
      'set_model',
      'set_thinking_level',
    ]
  ) assert.equal(piCommandMutatesState({ type }), true, type)

  for (const type of ['prompt', 'get_entries', 'compact', 'set_auto_retry']) {
    assert.equal(piCommandMutatesState({ type }), false, type)
  }
})
