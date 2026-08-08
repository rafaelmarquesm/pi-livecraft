import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject, PiCapabilities } from '../shared/types.ts'
import { encodeJsonLine, JsonLineDecoder } from './jsonl.ts'
import { resolvePiLauncher, type PiLauncherInvocation } from './pi-launcher.ts'

const execFileAsync = promisify(execFile)

/** Runs `pi --version` and resolves with the trimmed stdout, or throws when Pi cannot run. */
export type VersionCommandRunner = (command: string, args: string[]) => Promise<string>

/**
 * Optional RPC commands the Livecraft UI gates on (M5), each with a payload
 * chosen to fail harmlessly in a throwaway `--no-session` process when the
 * command exists — `fork` without `entryId` is rejected before acting, `clone`
 * of an ephemeral session is rejected, `export_html` writes into the probe's
 * temporary cwd. Probing in a disposable process is what keeps the live
 * session free of side effects (a `clone` probe against a real session would
 * swap its session file).
 */
export const probedRpcCommands: ReadonlyArray<{ name: string; payload: JsonObject }> = [
  { name: 'fork', payload: { type: 'fork' } },
  { name: 'clone', payload: { type: 'clone' } },
  { name: 'get_fork_messages', payload: { type: 'get_fork_messages' } },
  { name: 'export_html', payload: { type: 'export_html' } },
  { name: 'abort_retry', payload: { type: 'abort_retry' } },
  { name: 'abort_bash', payload: { type: 'abort_bash' } },
  { name: 'get_last_assistant_text', payload: { type: 'get_last_assistant_text' } },
  { name: 'get_messages', payload: { type: 'get_messages' } },
  { name: 'get_tree', payload: { type: 'get_tree' } },
  { name: 'set_session_name', payload: { type: 'set_session_name', name: 'probe' } },
  { name: 'cycle_thinking_level', payload: { type: 'cycle_thinking_level' } },
  { name: 'set_auto_compaction', payload: { type: 'set_auto_compaction', enabled: true } },
  { name: 'set_auto_retry', payload: { type: 'set_auto_retry', enabled: true } },
]

/**
 * Decides command presence from an RPC response. Pi answers commands it does
 * not know with `success: false` and an "Unknown command: …" error; every
 * other outcome (including argument or state errors) proves the command
 * exists. A missing response (timeout/crash) is treated as absent so the UI
 * fails closed.
 */
export function commandPresentFromResponse(response: JsonObject | null): boolean {
  if (response === null) return false
  if (response.success === true) return true
  const error = typeof response.error === 'string' ? response.error : ''
  return !/^unknown command/i.test(error.trim())
}

/**
 * Probes {@link probedRpcCommands} against a throwaway offline Pi process and
 * caches the result for the backend lifetime. Any failure resolves to empty
 * capabilities (UI hides optional features) rather than rejecting.
 */
export function detectPiCapabilities(launcher?: PiLauncherInvocation): Promise<PiCapabilities> {
  if (launcher)
    return probeCapabilities(launcher).catch(() => ({ version: 'unknown', commands: {} }))
  cachedCapabilities ??= probeCapabilities(resolvePiLauncher()).catch(
    (): PiCapabilities => ({ version: 'unknown', commands: {} }),
  )
  return cachedCapabilities
}

let cachedCapabilities: Promise<PiCapabilities> | undefined

async function probeCapabilities(launcher: PiLauncherInvocation): Promise<PiCapabilities> {
  const version = await resolvePiVersion(launcher, defaultVersionRunner)
  const probeCwd = await mkdtemp(join(tmpdir(), 'pi-livecraft-probe-'))
  const child = spawn(launcher.command, [
    ...launcher.argsPrefix,
    '--mode',
    'rpc',
    '--no-session',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
  ], {
    cwd: probeCwd,
    env: { ...process.env, PI_OFFLINE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  try {
    const commands = await probeCommands(child)
    return { version, commands }
  } finally {
    child.kill()
    await rm(probeCwd, { force: true, recursive: true })
  }
}

function probeCommands(child: ChildProcessWithoutNullStreams): Promise<Record<string, boolean>> {
  return new Promise((resolve, reject) => {
    const pending = new Map<number, (response: JsonObject | null) => void>()
    const results: Record<string, boolean> = {}
    let settled = 0

    const finish = (name: string, response: JsonObject | null): void => {
      results[name] = commandPresentFromResponse(response)
      if (++settled === probedRpcCommands.length) resolve(results)
    }
    const failAll = (): void => {
      for (const [id, done] of pending) {
        pending.delete(id)
        done(null)
      }
    }

    const decoder = new JsonLineDecoder((value) => {
      if (!isObject(value) || value.type !== 'response') return
      const done = pending.get(Number(value.id))
      if (!done) return
      pending.delete(Number(value.id))
      done(value)
    })
    child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk.toString('utf8')))
    child.once('error', () => reject(new Error('Failed to spawn Pi for capability probe')))
    child.once('close', failAll)

    probedRpcCommands.forEach(({ name, payload }, index) => {
      const timer = setTimeout(() => {
        if (pending.delete(index)) finish(name, null)
      }, 5_000)
      pending.set(index, (response) => {
        clearTimeout(timer)
        finish(name, response)
      })
      child.stdin.write(encodeJsonLine({ id: index, ...payload }))
    })
  })
}

const defaultVersionRunner: VersionCommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: 10_000 })
  return stdout
}

let cachedVersion: Promise<string> | undefined

/**
 * Resolves the installed Pi version once per process. Failures resolve to
 * 'unknown' so capability gating never throws. Optional injectables allow
 * deterministic tests without spawning Pi.
 */
export function detectPiVersion(
  launcher: PiLauncherInvocation | undefined = undefined,
  runner: VersionCommandRunner | undefined = undefined,
): Promise<string> {
  if (launcher !== undefined && runner !== undefined) {
    return resolvePiVersion(launcher, runner)
  }
  cachedVersion ??= resolvePiVersion(resolvePiLauncher(), defaultVersionRunner)
  return cachedVersion
}

async function resolvePiVersion(
  launcher: PiLauncherInvocation,
  runner: VersionCommandRunner,
): Promise<string> {
  try {
    return (await runner(launcher.command, [...launcher.argsPrefix, '--version'])).trim()
      || 'unknown'
  } catch {
    return 'unknown'
  }
}
