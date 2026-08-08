import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RpcProcess } from './support/rpc-process.ts'
import { isObject } from '../shared/is-object.ts'

test('exposes current Pi commands over RPC', { timeout: 60_000 }, async (t) => {
  const pi = new RpcProcess({
    args: ['--offline', '--no-session'],
    cwd: join(homedir(), '.pi'),
  })
  try {
    const commandsResponse = await pi.request({ type: 'get_commands' })
    assert.equal(commandsResponse.success, true)
    const hasAgentCommand = isObject(commandsResponse.data)
      && Array.isArray(commandsResponse.data.commands)
      && commandsResponse.data.commands.some((command) =>
        isObject(command) && command.name === 'agent'
      )
    if (!hasAgentCommand) {
      t.skip('Pi /agent extension is not installed')
      return
    }

    const dialogRequest = pi.waitForEvent(
      (value) => value.type === 'extension_ui_request' && value.method === 'select',
    )
    const promptResponse = pi.request({ type: 'prompt', message: '/agent' })
    const dialog = await dialogRequest
    assert.equal(dialog.title, 'Select an agent')
    assert.ok(Array.isArray(dialog.options) && dialog.options.length > 0)
    assert.ok(dialog.options.every((option) => typeof option === 'string'))
    pi.sendRaw({ type: 'extension_ui_response', id: dialog.id, cancelled: true })
    assert.equal((await promptResponse).success, true)
  } finally {
    await pi.terminate()
  }
})
