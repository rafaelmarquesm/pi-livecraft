import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonObject, PiCapabilities } from '../shared/types.ts'
import { resolvePiLauncher, type PiLauncherInvocation } from './pi-launcher.ts'

const execFileAsync = promisify(execFile)

/** Runs `pi --version` and resolves with the trimmed stdout, or throws when Pi cannot run. */
export type VersionCommandRunner = (command: string, args: string[]) => Promise<string>

const defaultVersionRunner: VersionCommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: 10_000 })
  return stdout
}

/** Maps the session's available commands onto a capabilities record used to gate UI (M5). */
export function capabilitiesFromCommands(
  version: string,
  commands: JsonObject[],
): PiCapabilities {
  const commandNames: Record<string, boolean> = {}
  for (const command of commands) {
    if (typeof command.name === 'string' && command.name) commandNames[command.name] = true
  }
  return { version, commands: commandNames }
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
