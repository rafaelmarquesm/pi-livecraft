import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Dev-only respawn wrapper for the backend (test spec §5 C5).
 *
 * `node --watch server/backend.ts` restarts on file changes but stays dead
 * after a crash that is not caused by a file change (the real incident: the
 * watcher read `backend.ts` truncated mid-write and the process exited with
 * a SyntaxError, leaving the UI on "Connection to backend lost" forever).
 *
 * This wrapper spawns the watched process and respawns it whenever it exits
 * for any reason other than a deliberate stop (SIGTERM/SIGINT from
 * `concurrently --kill-others` when the user stops the stack). A crash that
 * survives less than {@link STABLE_UPTIME_MS} doubles the backoff; a process
 * that stays up longer resets it.
 */

/** Below this uptime a respawn is a crash, not a healthy restart; backoff doubles. */
export const STABLE_UPTIME_MS = 10_000
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/** Next backoff for a crash that did not survive long enough to be stable. */
export function nextBackoff(current: number, uptimeMs: number): number {
  if (uptimeMs >= STABLE_UPTIME_MS) return INITIAL_BACKOFF_MS
  return Math.min(current * 2, MAX_BACKOFF_MS)
}

/** Whether an exit should trigger a respawn. Deliberate stops never respawn. */
export function shouldRespawn(signal: NodeJS.Signals | null): boolean {
  return signal !== 'SIGTERM' && signal !== 'SIGINT'
}

const entry = fileURLToPath(new URL('../server/backend.ts', import.meta.url))

/** Starts the respawn loop, but only when this file is the process entry point —
 * importing it from unit tests must not spawn a backend. */
const isEntry = typeof process.argv[1] === 'string'
  && fileURLToPath(import.meta.url) === process.argv[1]

function start(): void {
  const startedAt = Date.now()
  const child = spawn(process.execPath, ['--watch', entry], { stdio: 'inherit' })
  child.on('error', (error) => {
    console.error('[dev-backend] failed to spawn backend:', error)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (!shouldRespawn(signal)) {
      console.log(`[dev-backend] stopping (${signal ?? `exit ${code}`})`)
      return
    }
    const uptime = Date.now() - startedAt
    backoff = nextBackoff(backoff, uptime)
    console.log(
      `[dev-backend] backend exited (${signal ?? `code ${code ?? 'unknown'}`}, `
        + `uptime ${uptime} ms); respawning in ${backoff} ms…`,
    )
    setTimeout(start, backoff)
  })
}

let backoff = INITIAL_BACKOFF_MS
if (isEntry) start()
