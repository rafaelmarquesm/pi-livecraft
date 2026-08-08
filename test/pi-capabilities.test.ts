import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commandPresentFromResponse,
  detectPiCapabilities,
  detectPiVersion,
  probedRpcCommands,
} from '../server/pi-capabilities.ts'

test('every probed command carries a payload whose type matches its name', () => {
  for (const { name, payload } of probedRpcCommands) assert.equal(payload.type, name)
  // fork must be probed WITHOUT entryId so the probe fails before acting.
  assert.equal(probedRpcCommands.find((c) => c.name === 'fork')?.payload.entryId, undefined)
})

test('unknown-command responses mark the command absent', () => {
  assert.equal(
    commandPresentFromResponse({
      type: 'response',
      success: false,
      error: 'Unknown command: definitely_not_a_command',
    }),
    false,
  )
})

test('argument or state errors prove the command exists', () => {
  assert.equal(
    commandPresentFromResponse({
      type: 'response',
      success: false,
      error: 'Invalid entry ID for forking',
    }),
    true,
  )
  assert.equal(
    commandPresentFromResponse({
      type: 'response',
      success: false,
      error:
        'This session has not been saved yet. Wait for the first assistant response before cloning or forking it.',
    }),
    true,
  )
})

test('success and missing responses mark presence and absence respectively', () => {
  assert.equal(commandPresentFromResponse({ type: 'response', success: true, data: {} }), true)
  assert.equal(commandPresentFromResponse(null), false)
})

test('detectPiCapabilities resolves empty commands when Pi cannot run', async () => {
  const capabilities = await detectPiCapabilities({ command: '/missing/pi', argsPrefix: [] })
  assert.equal(capabilities.version, 'unknown')
  assert.deepEqual(capabilities.commands, {})
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
