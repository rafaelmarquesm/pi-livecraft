import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilitiesFromCommands, detectPiVersion } from '../server/pi-capabilities.ts'

test('maps command names onto a capabilities record', () => {
  assert.deepEqual(
    capabilitiesFromCommands('0.84.1', [
      { name: 'compact', source: 'builtin' },
      { name: 'set_model', source: 'builtin' },
      { source: 'prompt', name: '' },
      { source: 'prompt' },
      { name: 42 },
    ]),
    { version: '0.84.1', commands: { compact: true, set_model: true } },
  )
})

test('detectPiVersion resolves the trimmed version from the runner', async () => {
  const version = await detectPiVersion(
    { command: 'pi', argsPrefix: [] },
    async () => '0.84.1\n',
  )
  assert.equal(version, '0.84.1')
})

test('detectPiVersion falls back to unknown when Pi cannot run', async () => {
  const version = await detectPiVersion(
    { command: '/missing/pi', argsPrefix: [] },
    async () => {
      throw new Error('spawn ENOENT')
    },
  )
  assert.equal(version, 'unknown')
})
