import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { JsonLineDecoder, encodeJsonLine } from '../../server/jsonl.ts'
import { resolvePiLauncher } from '../../server/pi-launcher.ts'
import { isObject } from '../../shared/is-object.ts'
import type { JsonObject } from '../../shared/types.ts'

export interface RpcProcessOptions {
  /** Extra `pi` arguments appended after `--mode rpc` (e.g. `--offline`, `--session-dir <dir>`, `--extension <path>`). */
  args?: readonly string[]
  /** Working directory for the `pi` process (defaults to `~/.pi`, matching the legacy RPC test). */
  cwd?: string
  /** Extra environment variables merged over `process.env`; `PI_OFFLINE=1` is always set. */
  env?: NodeJS.ProcessEnv
}

/** Selects an event by its `type` field or by an arbitrary predicate. */
export type RpcEventSelector = string | ((event: JsonObject) => boolean)

const DEFAULT_TIMEOUT_MS = 30_000

// Node >= 24 ships Promise.withResolvers, but the project's ES2023 lib does
// not declare it; supply the minimal ambient types from lib.es2024.promise.
declare global {
  interface PromiseWithResolvers<T> {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  }
  interface PromiseConstructor {
    withResolvers<T>(): PromiseWithResolvers<T>
  }
}

/**
 * Drives one `pi --mode rpc` subprocess over JSONL stdin/stdout.
 *
 * `request()` always resolves with the full response object — `success: false`
 * is the documented invalidation signal for `get_entries {since}` and must
 * reach the caller for assertion, so it never rejects on a failed command.
 * The child stdin stays open until `terminate()` so late responses (e.g. a
 * session-swapping `fork`) are not lost to the stdin-close shutdown race.
 */
export class RpcProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #events = new EventEmitter()
  readonly #pending = new Map<
    string,
    {
      resolve: (value: JsonObject) => void
      reject: (reason: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  readonly #exited: Promise<void>
  /** Every received stdout event, in arrival order. */
  readonly #log: JsonObject[] = []
  /** Events still available to `waitForEvent`; matched events are removed. */
  readonly #queue: JsonObject[] = []
  #nextRequestId = 0
  #stderr = ''

  /** Process id for resource measurements performed by integration benchmarks. */
  get pid(): number | undefined {
    return this.#child.pid
  }

  constructor(options: RpcProcessOptions = {}) {
    const launcher = resolvePiLauncher()
    this.#child = spawn(launcher.command, [
      ...launcher.argsPrefix,
      '--mode',
      'rpc',
      ...(options.args ?? []),
    ], {
      cwd: options.cwd ?? join(homedir(), '.pi'),
      env: { ...process.env, PI_OFFLINE: '1', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const { promise: exited, resolve: resolveExit } = Promise.withResolvers<void>()
    this.#child.once('close', () => resolveExit())
    this.#exited = exited
    const decoder = new JsonLineDecoder((value) => this.#receive(value))
    this.#child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    this.#child.stdout.on('end', () => decoder.end())
    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-8_192)
    })
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on('close', () => this.#fail(new Error(`Pi exited (${this.#stderr.trim()})`)))
  }

  /** Sends one command and resolves with the full response object (never rejects on `success: false`). */
  request(command: JsonObject, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonObject> {
    const id = `rpc-${this.#nextRequestId += 1}`
    const { promise, resolve, reject } = Promise.withResolvers<JsonObject>()
    const timeout = setTimeout(() => {
      this.#pending.delete(id)
      reject(new Error(`Pi RPC command ${String(command.type)} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    this.#pending.set(id, { resolve, reject, timeout })
    this.#child.stdin.write(encodeJsonLine({ ...command, id }))
    return promise
  }

  /**
   * Writes one JSON line to stdin without request/response correlation. Used
   * for `extension_ui_response` replies to dialog requests emitted by
   * extensions, whose id must match the dialog request exactly.
   */
  sendRaw(value: JsonObject): void {
    this.#child.stdin.write(encodeJsonLine(value))
  }

  /** Waits for the next event matching `selector`, removing it from the stream. */
  waitForEvent(selector: RpcEventSelector, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JsonObject> {
    const { promise, resolve, reject } = Promise.withResolvers<JsonObject>()
    const timeout = setTimeout(() => {
      this.#events.off('event', check)
      this.#child.off('close', onClose)
      reject(new Error(`Timed out waiting for Pi RPC event. stderr: ${this.#stderr}`))
    }, timeoutMs)
    const onClose = (): void => {
      clearTimeout(timeout)
      this.#events.off('event', check)
      reject(new Error(`Pi exited before the event arrived. stderr: ${this.#stderr}`))
    }
    const check = (): void => {
      const matches = (event: JsonObject): boolean =>
        typeof selector === 'string'
          ? event.type === selector
          : selector(event)
      const index = this.#queue.findIndex(matches)
      if (index === -1) return
      clearTimeout(timeout)
      this.#events.off('event', check)
      this.#child.off('close', onClose)
      resolve(this.#queue.splice(index, 1)[0])
    }
    this.#events.on('event', check)
    this.#child.once('close', onClose)
    check()
    return promise
  }

  /** Returns a snapshot of every event received so far, including consumed ones. */
  collectEvents(): JsonObject[] {
    return [...this.#log]
  }

  /** SIGTERM, then SIGKILL after a bounded grace period (matching existing Pi test patterns). */
  async terminate(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    if (!this.#child.stdin.destroyed) this.#child.stdin.end()
    this.#child.kill('SIGTERM')
    const { promise: grace, resolve: resolveGrace } = Promise.withResolvers<void>()
    const timer = setTimeout(resolveGrace, 2_000)
    await Promise.race([this.#exited, grace])
    clearTimeout(timer)
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL')
      await this.#exited
    }
  }

  #receive(value: unknown): void {
    if (!isObject(value)) return
    this.#log.push(value)
    this.#queue.push(value)
    if (value.type === 'response' && typeof value.id === 'string') {
      const pending = this.#pending.get(value.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.#pending.delete(value.id)
      pending.resolve(value)
      return
    }
    this.#events.emit('event', value)
  }

  #fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    for (const { reject, timeout } of this.#pending.values()) {
      clearTimeout(timeout)
      reject(error)
    }
    this.#pending.clear()
  }
}

let cachedPiVersion: string | undefined

/** Runs `pi --version` once and caches it, for skip messages about version differences. */
export function getPiVersion(): string {
  if (cachedPiVersion === undefined) {
    try {
      const launcher = resolvePiLauncher()
      cachedPiVersion = execFileSync(launcher.command, [...launcher.argsPrefix, '--version'], {
        encoding: 'utf8',
      })
        .trim()
    } catch {
      cachedPiVersion = 'unknown'
    }
  }
  return cachedPiVersion
}
