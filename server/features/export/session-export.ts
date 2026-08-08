import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'

export type ExportFormat = 'html' | 'md' | 'jsonl'

export const exportContentTypes: Record<ExportFormat, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return value === 'html' || value === 'md' || value === 'jsonl'
}

/** The subset of ManagerClient needed to issue the export_html RPC. */
export interface ExportCommandClient {
  request(
    request: { action: 'command'; sessionId: string; command: JsonObject },
    timeoutMs?: number,
  ): Promise<unknown>
}

/**
 * Builds a download filename from the session name. Strips path separators,
 * control characters and anything outside a conservative allowlist so the
 * Content-Disposition header can never be used for header injection.
 */
export function exportFileName(
  sessionName: string,
  format: ExportFormat,
  date = new Date(),
): string {
  const base = sessionName
    .normalize('NFKD')
    .replace(/[̃̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'session'
  const stamp = date.toISOString().slice(0, 10)
  return `${base}-${stamp}.${format === 'jsonl' ? 'jsonl' : format}`
}

/**
 * Reads the session JSONL for download, refusing anything that does not
 * resolve to exactly the session file the manager knows about (§5.1: the path
 * comes from the manager, never from the client, and is canonicalized before
 * reading to defeat symlink tricks).
 */
export async function readSessionJsonl(expectedSessionPath: string): Promise<Buffer> {
  const canonical = await realpath(expectedSessionPath)
  if (canonical !== resolve(expectedSessionPath))
    throw new Error('Session file path failed canonical validation')
  return readFile(canonical)
}

/**
 * Asks Pi to export the session as HTML into a backend-controlled temporary
 * directory, reads the result and cleans up. The output path is generated
 * here (never client-supplied), so export_html cannot be turned into an
 * arbitrary-file-write primitive (§5.1).
 */
export async function exportSessionHtml(
  client: ExportCommandClient,
  sessionId: string,
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-export-'))
  try {
    const outputPath = join(directory, 'session.html')
    const response = await client.request(
      { action: 'command', sessionId, command: { type: 'export_html', outputPath } },
      60_000,
    )
    if (!isObject(response) || response.success !== true)
      throw new Error(
        isObject(response) && typeof response.error === 'string'
          ? response.error
          : 'Pi refused the HTML export',
      )
    const data = isObject(response.data) ? response.data : null
    const produced = typeof data?.path === 'string' ? data.path : outputPath
    // Only ever read inside the directory this process created.
    if (resolve(produced) !== outputPath) throw new Error('Pi exported to an unexpected path')
    return await readFile(outputPath)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
