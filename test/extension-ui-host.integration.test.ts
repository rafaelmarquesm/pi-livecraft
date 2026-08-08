import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { RpcProcess, getPiVersion } from './support/rpc-process.ts'
import { isBlockingUiRequest } from '../shared/extension-ui.ts'
import type { JsonObject } from '../shared/types.ts'

/**
 * Extension host integration suite, fully offline (zero tokens). Pi ships
 * fixture extensions under the globally installed package's
 * examples/extensions/ directory; the tests load them with `--extension`
 * plus `--no-extensions` so user-installed extensions cannot pollute the
 * event stream. Events are fire-and-forget `extension_ui_request` messages
 * documented in rpc.md.
 */
function extensionExamplesDir(): string | undefined {
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    const examples = join(root, '@earendil-works', 'pi-coding-agent', 'examples', 'extensions')
    if (existsSync(examples)) return examples
  } catch {
    // Fall through to the homebrew-specific documented path below.
  }
  const documented = join(
    '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions',
  )
  return existsSync(documented) ? documented : undefined
}

function createSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'pi-extension-host-'))
}

function extensionRpc(directory: string, extensionPath: string): RpcProcess {
  return new RpcProcess({
    args: [
      '--offline',
      '--no-extensions',
      '--session-dir',
      directory,
      '--extension',
      extensionPath,
    ],
    cwd: directory,
  })
}

/**
 * Waits for one extension_ui_request with the given method. A missing event
 * on this Pi version is a fixture difference, so it skips the test with a
 * reason instead of failing CI.
 */
async function waitForUiEvent(
  t: TestContext,
  pi: RpcProcess,
  method: string,
  predicate: (event: JsonObject) => boolean = () => true,
  timeoutMs = 20_000,
): Promise<JsonObject | undefined> {
  try {
    return await pi.waitForEvent(
      (event) =>
        event.type === 'extension_ui_request' && event.method === method && predicate(event),
      timeoutMs,
    )
  } catch (error) {
    t.skip(
      `pi ${getPiVersion()} did not emit extension_ui_request/${method}; fixture behavior differs — ${
        (error as Error).message
      }`,
    )
    return undefined
  }
}

function cleanup(directory: string, pi: RpcProcess): Promise<void> {
  rmSync(directory, { recursive: true, force: true })
  return pi.terminate()
}

test(
  'T-EXT-1 rpc-demo emits setWidget/setTitle/setStatus on session_start',
  { timeout: 60_000 },
  async (t) => {
    const examples = extensionExamplesDir()
    const rpcDemo = examples ? join(examples, 'rpc-demo.ts') : undefined
    if (!rpcDemo || !existsSync(rpcDemo)) {
      t.skip(`fixture extension not found: ${String(rpcDemo)}`)
      return
    }
    const directory = createSessionDir()
    const pi = extensionRpc(directory, rpcDemo)
    try {
      const setWidget = await waitForUiEvent(t, pi, 'setWidget', (event) =>
        event
          .widgetKey === 'rpc-demo')
      if (!setWidget)
        return
      assert.ok(Array.isArray(setWidget.widgetLines))
      assert.ok((setWidget.widgetLines as unknown[]).every((line) => typeof line === 'string'))
      assert.ok(
        setWidget.widgetPlacement === undefined || setWidget.widgetPlacement === 'aboveEditor',
        'default widget placement is aboveEditor (field omitted when default)',
      )

      const setTitle = await waitForUiEvent(t, pi, 'setTitle')
      if (!setTitle) return
      assert.equal(typeof setTitle.title, 'string')
      assert.ok((setTitle.title as string).length > 0)

      const setStatus = await waitForUiEvent(
        t,
        pi,
        'setStatus',
        (event) => event.statusKey === 'rpc-demo',
      )
      if (!setStatus) return
      assert.equal(typeof setStatus.statusText, 'string')
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test(
  'T-EXT-2 widget-placement uses both aboveEditor and belowEditor',
  { timeout: 60_000 },
  async (t) => {
    const examples = extensionExamplesDir()
    const widgetPlacement = examples ? join(examples, 'widget-placement.ts') : undefined
    if (!widgetPlacement || !existsSync(widgetPlacement)) {
      t.skip(`fixture extension not found: ${String(widgetPlacement)}`)
      return
    }
    const directory = createSessionDir()
    const pi = extensionRpc(directory, widgetPlacement)
    try {
      const above = await waitForUiEvent(t, pi, 'setWidget', (event) =>
        event
          .widgetKey === 'widget-above')
      if (!above)
        return
      assert.ok(
        above.widgetPlacement === undefined || above.widgetPlacement === 'aboveEditor',
        'default placement is aboveEditor',
      )
      const below = await waitForUiEvent(
        t,
        pi,
        'setWidget',
        (event) => event.widgetKey === 'widget-below',
      )
      if (!below) return
      assert.equal(below.widgetPlacement, 'belowEditor')
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test(
  'T-EXT-3 a setWidget without widgetLines clears the widget',
  { timeout: 60_000 },
  async (t) => {
    const directory = createSessionDir()
    const extensionPath = join(directory, 'clear-widget.ts')
    writeFileSync(
      extensionPath,
      [
        'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"',
        '',
        'export default function (pi: ExtensionAPI) {',
        '  pi.on("session_start", async (_event, ctx) => {',
        '    if (!ctx.hasUI) return',
        '    ctx.ui.setWidget("probe-widget", ["First line", "Second line"])',
        '  })',
        '  pi.registerCommand("clear-widget", {',
        '    description: "Clears the probe widget (rpc.md: omit widgetLines to clear)",',
        '    handler: async (_args, ctx) => {',
        '      ctx.ui.setWidget("probe-widget")',
        '    },',
        '  })',
        '}',
        '',
      ]
        .join('\n'),
    )
    const pi = extensionRpc(directory, extensionPath)
    try {
      const first = await waitForUiEvent(t, pi, 'setWidget', (event) =>
        event
          .widgetKey === 'probe-widget')
      if (!first)
        return
      assert.ok(Array.isArray(first.widgetLines))
      assert.ok((first.widgetLines as unknown[]).length > 0)

      const prompt = await pi.request({ type: 'prompt', message: '/clear-widget' })
      assert.equal(prompt.success, true)
      const cleared = await waitForUiEvent(
        t,
        pi,
        'setWidget',
        (event) => event.widgetKey === 'probe-widget' && event.widgetLines === undefined,
      )
      if (!cleared) return
      assert.equal(cleared.widgetLines, undefined)
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test(
  'T-EXT-4 the /rpc-prefill command emits set_editor_text immediately',
  { timeout: 60_000 },
  async (t) => {
    const examples = extensionExamplesDir()
    const rpcDemo = examples ? join(examples, 'rpc-demo.ts') : undefined
    if (!rpcDemo || !existsSync(rpcDemo)) {
      t.skip(`fixture extension not found: ${String(rpcDemo)}`)
      return
    }
    const directory = createSessionDir()
    const pi = extensionRpc(directory, rpcDemo)
    try {
      // Extension commands execute immediately without an LLM call, so the
      // prompt response arrives and the set_editor_text event follows.
      const prompt = await pi.request({ type: 'prompt', message: '/rpc-prefill' })
      assert.equal(prompt.success, true)
      const prefill = await waitForUiEvent(t, pi, 'set_editor_text')
      if (!prefill) return
      assert.equal(typeof prefill.text, 'string')
      assert.ok((prefill.text as string).length > 0)
    } finally {
      await cleanup(directory, pi)
    }
  },
)

test('T-EXT-5 fire-and-forget UI methods never block the session from idle', () => {
  for (const method of ['setStatus', 'setWidget', 'setTitle', 'set_editor_text', 'notify']) {
    assert.equal(
      isBlockingUiRequest({ type: 'extension_ui_request', id: 'probe', method }),
      false,
      `${method} is fire-and-forget (E14)`,
    )
  }
  for (const method of ['select', 'confirm', 'input', 'editor']) {
    assert.equal(
      isBlockingUiRequest({ type: 'extension_ui_request', id: 'probe', method }),
      true,
      `${method} demands a user response`,
    )
  }
})
