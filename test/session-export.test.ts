import assert from 'node:assert/strict'
import { mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  exportFileName,
  exportSessionHtml,
  isExportFormat,
  readSessionJsonl,
  type ExportCommandClient,
} from '../server/features/export/session-export.ts'
import { isObject } from '../shared/is-object.ts'
import type { JsonObject } from '../shared/types.ts'

const fixedDate = new Date('2026-01-01T00:00:00Z')

test('builds safe download filenames from the session name', () => {
  // Slashes, quotes and control characters are stripped entirely.
  assert.equal(exportFileName('a/b\n"evil"', 'md', fixedDate), 'abevil-2026-01-01.md')
  // Unicode letters normalize to ASCII; symbols outside the allowlist drop.
  assert.equal(exportFileName('café ☕', 'jsonl', fixedDate), 'cafe-2026-01-01.jsonl')
  // The base is truncated at 60 characters.
  assert.equal(
    exportFileName('a'.repeat(70), 'html', fixedDate),
    `${'a'.repeat(60)}-2026-01-01.html`,
  )
  // A name with no safe characters falls back to "session".
  assert.equal(exportFileName('///\n', 'md', fixedDate), 'session-2026-01-01.md')
  assert.equal(exportFileName('', 'md', fixedDate), 'session-2026-01-01.md')
  // The JSONL extension is produced verbatim.
  assert.equal(exportFileName('Session', 'jsonl', fixedDate), 'Session-2026-01-01.jsonl')
})

test('accepts only the three supported export formats', () => {
  assert.equal(isExportFormat('html'), true)
  assert.equal(isExportFormat('md'), true)
  assert.equal(isExportFormat('jsonl'), true)
  assert.equal(isExportFormat('pdf'), false)
  assert.equal(isExportFormat(''), false)
  assert.equal(isExportFormat(null), false)
  assert.equal(isExportFormat(undefined), false)
  assert.equal(isExportFormat(42), false)
})

describe('readSessionJsonl', () => {
  let directory: string

  before(async () => {
    // realpath keeps the fixture canonical so the resolved and real paths match.
    directory = await realpath(await mkdtemp(join(tmpdir(), 'pi-livecraft-test-export-')))
  })
  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  test('reads a real session file', async () => {
    const sessionPath = join(directory, 'session.jsonl')
    const content = '{"type":"session","version":3}\n'
    await writeFile(sessionPath, content)
    const buffer = await readSessionJsonl(sessionPath)
    assert.equal(buffer.toString('utf8'), content)
  })

  test('rejects a symlink pointing outside the session path', async () => {
    const realPath = join(directory, 'real.jsonl')
    await writeFile(realPath, '{"type":"session"}\n')
    const symlinkPath = join(directory, 'evil.jsonl')
    await symlink(realPath, symlinkPath)
    await assert.rejects(readSessionJsonl(symlinkPath), /canonical validation/)
  })
})

describe('exportSessionHtml', () => {
  let directory: string

  before(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'pi-livecraft-test-export-')))
  })
  after(async () => {
    await rm(directory, { force: true, recursive: true })
  })

  async function assertNoExportTempDirs(): Promise<void> {
    const leftovers = (await readdir(tmpdir())).filter((name) =>
      name.startsWith('pi-livecraft-export-')
    )
    assert.deepEqual(leftovers, [])
  }

  function writingClient(content: string): ExportCommandClient {
    return {
      async request(request: { action: 'command'; sessionId: string; command: JsonObject }) {
        assert.equal(request.action, 'command')
        assert.equal(request.sessionId, 's1')
        const outputPath = isObject(request.command)
            && typeof request.command.outputPath === 'string'
          ? request.command.outputPath
          : null
        assert.ok(outputPath, 'export_html must receive a backend-generated outputPath')
        await writeFile(outputPath as string, content)
        return { success: true, data: { path: outputPath } }
      },
    }
  }

  test('returns the exported file and removes the temporary directory', async () => {
    const result = await exportSessionHtml(writingClient('<html>exported</html>'), 's1')
    assert.equal(result.toString('utf8'), '<html>exported</html>')
    await assertNoExportTempDirs()
  })

  test('surfaces Pi failures and still removes the temporary directory', async () => {
    const failingClient: ExportCommandClient = {
      async request() {
        return { success: false, error: 'Pi refused the HTML export' }
      },
    }
    await assert.rejects(exportSessionHtml(failingClient, 's1'), /Pi refused the HTML export/)
    await assertNoExportTempDirs()
  })

  test('rejects output outside the temporary directory', async () => {
    const hostileClient: ExportCommandClient = {
      async request() {
        return { success: true, data: { path: '/etc/passwd' } }
      },
    }
    await assert.rejects(exportSessionHtml(hostileClient, 's1'), /unexpected path/)
    await assertNoExportTempDirs()
  })

  test('reads the generated file when Pi omits the produced path', async () => {
    const client: ExportCommandClient = {
      async request(request: { action: 'command'; sessionId: string; command: JsonObject }) {
        const outputPath = isObject(request.command)
            && typeof request.command.outputPath === 'string'
          ? request.command.outputPath
          : null
        assert.ok(outputPath)
        await writeFile(outputPath as string, '<html>default path</html>')
        return { success: true, data: {} }
      },
    }
    const result = await exportSessionHtml(client, 's1')
    assert.equal(result.toString('utf8'), '<html>default path</html>')
    await assertNoExportTempDirs()
  })
})
