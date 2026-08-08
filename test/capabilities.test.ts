import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilityEntries } from '../src/features/settings/capabilities.ts'

test('returns an empty list without capabilities', () => {
  assert.deepEqual(capabilityEntries(null), [])
})

test('returns sorted name/available pairs', () => {
  const entries = capabilityEntries({
    version: '0.1.0',
    commands: { set_auto_retry: true, abort: true, fork: false, clone: true },
  })
  assert.deepEqual(entries, [
    ['abort', true],
    ['clone', true],
    ['fork', false],
    ['set_auto_retry', true],
  ])
})

test('returns an empty list when no commands are exposed', () => {
  assert.deepEqual(capabilityEntries({ version: '0.1.0', commands: {} }), [])
})
