import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One Pi/Livecraft process matched by the monitor. `rssKb` is resident set size in KiB. */
export interface ProcessInfo {
  pid: number
  rssKb: number
  /** Command name reported by `ps` (comm column, truncated by the OS). */
  name: string
  /** Full command line after the command name. */
  args: string
}

/** Response of the process monitor. `available` is false when `ps` cannot run (e.g. Windows). */
export interface ProcessSnapshot {
  available: boolean
  processes: ProcessInfo[]
}

/** Runs `ps` and resolves with stdout. Injectable so tests never spawn a real process. */
export type ProcessCommandRunner = (command: string, args: string[]) => Promise<string>

const defaultProcessRunner: ProcessCommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: 10_000 })
  return stdout
}

/**
 * Parses `ps -eo pid,rss,comm,args` output (macOS/Linux) and returns the rows
 * whose command line mentions `pi-coding-agent` or `server/manager`, sorted by
 * pid. The header line and malformed rows are skipped defensively: any row
 * whose pid or rss is not a non-negative integer is ignored.
 */
export function parseProcessLines(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = []
  for (const line of output.split('\n')) {
    const info = parseProcessLine(line)
    if (!info) continue
    if (!isLivecraftProcess(info.args)) continue
    processes.push(info)
  }
  processes.sort((left, right) => left.pid - right.pid)
  return processes
}

/** True when the command line belongs to the Pi agent or the Livecraft manager family. */
export function isLivecraftProcess(args: string): boolean {
  return args.includes('pi-coding-agent') || args.includes('server/manager')
}

function parseProcessLine(line: string): ProcessInfo | null {
  const fields = line.trim().split(/\s+/)
  if (fields.length < 3) return null
  const pid = Number(fields[0])
  const rssKb = Number(fields[1])
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  if (!Number.isSafeInteger(rssKb) || rssKb < 0) return null
  return {
    pid,
    rssKb,
    name: fields[2],
    args: fields.slice(3).join(' '),
  }
}

/**
 * Snapshot of Pi/Livecraft processes. When `ps` is missing or fails (Windows,
 * sandboxes), the result degrades to `{ available: false, processes: [] }` so
 * callers can render "not available" instead of breaking.
 */
export async function readProcesses(
  runner: ProcessCommandRunner = defaultProcessRunner,
): Promise<ProcessSnapshot> {
  try {
    const output = await runner('ps', ['-eo', 'pid,rss,comm,args'])
    return { available: true, processes: parseProcessLines(output) }
  } catch {
    return { available: false, processes: [] }
  }
}
