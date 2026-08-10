import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  buildCodeReviewPacket,
  isSecretPath,
  maxReviewDiffBytes,
} from '../server/features/code-review/packet-builder.ts'

const exec = promisify(execFile)

test('builds a deterministic bounded git packet and excludes known secret paths', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'livecraft-review-'))
  await git(cwd, ['init'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
  await writeFile(join(cwd, 'README.md'), 'base\n')
  await git(cwd, ['add', 'README.md'])
  await git(cwd, ['commit', '-m', 'base'])
  await writeFile(join(cwd, 'server.ts'), 'export const value = 1\n')
  await writeFile(join(cwd, '.env'), 'SECRET_TOKEN=abc123\n')

  const packet = await buildCodeReviewPacket({
    cwd,
    sessionId: 's1',
    details: { state: null, summary: null, review: null, stale: false },
  })
  assert.equal(packet.changedPaths.includes('server.ts'), true)
  assert.equal(packet.changedPaths.includes('.env'), false)
  assert.deepEqual(packet.truncation.secretExcludedPaths, ['.env'])
  assert.match(packet.packet, /<UNTRUSTED_UNIFIED_DIFF>/)
  assert.equal(packet.packet.includes('SECRET_TOKEN'), false)
  assert.equal(packet.estimatedInputTokens, Math.ceil(packet.packet.length / 4))
})

test('truncates oversized diffs with an explicit manifest', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'livecraft-review-large-'))
  await git(cwd, ['init'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
  await writeFile(join(cwd, 'big.ts'), 'base\n')
  await git(cwd, ['add', 'big.ts'])
  await git(cwd, ['commit', '-m', 'base'])
  await writeFile(
    join(cwd, 'big.ts'),
    `export const payload = ${JSON.stringify('x'.repeat(maxReviewDiffBytes + 10_000))}\n`,
  )

  const packet = await buildCodeReviewPacket({
    cwd,
    sessionId: 's1',
    details: { state: null, summary: null, review: null, stale: false },
  })
  assert.equal(packet.truncation.diffBytes, maxReviewDiffBytes)
  assert.equal(packet.truncation.omittedPaths.some((path) => path.reason === 'diff_limit'), true)
})

test('recognizes common secret paths', () => {
  assert.equal(isSecretPath('.env.local'), true)
  assert.equal(isSecretPath('config/credentials/prod.json'), true)
  assert.equal(isSecretPath('src/app.ts'), false)
})

async function git(cwd: string, args: string[]): Promise<void> {
  await exec('git', args, { cwd })
}
