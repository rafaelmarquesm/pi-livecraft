import assert from 'node:assert/strict'
import test from 'node:test'
import { contextGaugeState } from '../src/features/composer/context-gauge.ts'

test('classifies value boundaries at 20/30/40', () => {
  assert.deepEqual(contextGaugeState({ percent: 0 }), { kind: 'value', percent: 0, className: '' })
  assert.deepEqual(contextGaugeState({ percent: 19 }), {
    kind: 'value',
    percent: 19,
    className: '',
  })
  assert.deepEqual(contextGaugeState({ percent: 20 }), {
    kind: 'value',
    percent: 20,
    className: 'context-warning',
  })
  assert.deepEqual(contextGaugeState({ percent: 29 }), {
    kind: 'value',
    percent: 29,
    className: 'context-warning',
  })
  assert.deepEqual(contextGaugeState({ percent: 30 }), {
    kind: 'value',
    percent: 30,
    className: 'context-warning-strong',
  })
  assert.deepEqual(contextGaugeState({ percent: 39 }), {
    kind: 'value',
    percent: 39,
    className: 'context-warning-strong',
  })
  assert.deepEqual(contextGaugeState({ percent: 40 }), {
    kind: 'value',
    percent: 40,
    className: 'context-danger',
  })
  assert.deepEqual(contextGaugeState({ percent: 100 }), {
    kind: 'value',
    percent: 100,
    className: 'context-danger',
  })
})

test('rounds the displayed percent but classifies on the raw value', () => {
  assert.deepEqual(contextGaugeState({ percent: 39.6 }), {
    kind: 'value',
    percent: 40,
    className: 'context-warning-strong',
  })
})

test('reports unknown when the percent is null after compaction', () => {
  assert.deepEqual(contextGaugeState({ tokens: 0, contextWindow: 100_000, percent: null }), {
    kind: 'unknown',
    className: '',
  })
})

test('reports unknown for an empty context usage object', () => {
  assert.deepEqual(contextGaugeState({}), { kind: 'unknown', className: '' })
})

test('reports missing when context usage is omitted entirely', () => {
  assert.deepEqual(contextGaugeState(undefined), { kind: 'missing', className: '' })
})
