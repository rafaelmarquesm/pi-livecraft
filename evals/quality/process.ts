import { spawn } from 'node:child_process'

export interface BoundedProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  input?: string
}

export interface BoundedProcessResult {
  command: string
  args: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

function appendBounded(current: Buffer, chunk: Buffer, limit: number): Buffer {
  const combined = Buffer.concat([current, chunk])
  return combined.byteLength <= limit ? combined : combined.subarray(combined.byteLength - limit)
}

/** Runs an executable without a shell, bounds runtime and captured output, and reports timeout explicitly. */
export function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const startedAt = Date.now()
  const maxStdoutBytes = options.maxStdoutBytes ?? 64 * 1024
  const maxStderrBytes = options.maxStderrBytes ?? 64 * 1024
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let timedOut = false

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 1_000)
        .unref()
    }, options.timeoutMs)
    timeout.unref()

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk, maxStdoutBytes)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk, maxStderrBytes)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout)
      resolve({
        args: [...args],
        command,
        durationMs: Date.now() - startedAt,
        exitCode,
        signal,
        stderr: stderr.toString('utf8'),
        stdout: stdout.toString('utf8'),
        timedOut,
      })
    })

    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

export async function assertSuccessfulProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const result = await runBoundedProcess(command, args, options)
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `${command} ${args.join(' ')} failed${result.timedOut ? ' after timeout' : ''}: ${
        result.stderr || result.stdout
      }`,
    )
  }
  return result
}
