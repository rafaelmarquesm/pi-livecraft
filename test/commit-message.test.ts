import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  EmptyDiffError,
  MAX_DIFF_BYTES,
  TRUNCATION_MARKER,
  buildCommitPrompt,
  collectGitDiff,
  filterBinaryDiff,
  normalizeCommitMessage,
  truncateDiff,
} from '../server/features/git/commit-message.ts'

const execFile = promisify(execFileCallback)

/** A diff just past the truncation limit: 60 KB of added rows under one header. */
function oversizedDiff(): string {
  const header = [
    'diff --git a/src/generated/data.ts b/src/generated/data.ts',
    'index 0000000..ccccccc 100644',
    '--- a/src/generated/data.ts',
    '+++ b/src/generated/data.ts',
    '@@ -1,0 +1,8000 @@',
  ]
    .join('\n')
  const rows: string[] = []
  for (let index = 0; index < 8000; index += 1) {
    rows.push(`+export const row${index} = 'generated value ${index}'`)
  }
  return `${header}\n${rows.join('\n')}`
}

test('keeps diffs under the limit intact and truncates larger ones with a visible marker', () => {
  const small = 'diff --git a/src/api.ts b/src/api.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n'
  assert.equal(truncateDiff(small), small)

  const truncated = truncateDiff(oversizedDiff())
  assert.ok(truncated.includes(TRUNCATION_MARKER))
  assert.ok(truncated.endsWith(TRUNCATION_MARKER))
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= MAX_DIFF_BYTES)
  assert.match(truncated, /^diff --git a\/src\/generated\/data\.ts/)
})

test('filters binary noise while keeping the changed-file headers and text hunks', () => {
  const diff = [
    'diff --git a/assets/logo.png b/assets/logo.png',
    'index 1234567..89abcde 100644',
    'Binary files a/assets/logo.png and b/assets/logo.png differ',
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
  ]
    .join('\n')

  const filtered = filterBinaryDiff(diff)

  assert.doesNotMatch(filtered, /Binary files/)
  assert.match(filtered, /diff --git a\/assets\/logo\.png b\/assets\/logo\.png/)
  assert.match(filtered, /diff --git a\/src\/app\.ts/)
  assert.match(filtered, /\+new/)
})

test('drops the base85 payload of GIT binary patch blocks', () => {
  const diff = [
    'diff --git a/fonts/icon.woff2 b/fonts/icon.woff2',
    'index 0000000..abcdef0 100644',
    'GIT binary patch',
    'literal 42',
    'zcmeAS@N?(=eEMHU&JdFfC!~yTQN&0Uu',
    '',
    'literal 0',
    'HcmV?d00001',
    '',
    'diff --git a/src/theme.ts b/src/theme.ts',
    '--- a/src/theme.ts',
    '+++ b/src/theme.ts',
    '@@ -1,1 +1,1 @@',
    '-dark',
    '+light',
  ]
    .join('\n')

  const filtered = filterBinaryDiff(diff)

  assert.doesNotMatch(filtered, /GIT binary patch/)
  assert.doesNotMatch(filtered, /literal/)
  assert.match(filtered, /diff --git a\/fonts\/icon\.woff2/)
  assert.match(filtered, /diff --git a\/src\/theme\.ts/)
  assert.match(filtered, /\+light/)
})

test('wraps the filtered, truncated diff in the prompt tags', () => {
  const prompt = buildCommitPrompt(
    'diff --git a/src/app.ts b/src/app.ts\nBinary files a/img.bin and b/img.bin differ\n@@ -1,1 +1,1 @@\n-old\n+new\n',
  )
  assert.match(prompt, /^<git_diff>\n/)
  assert.match(prompt, /\n<\/git_diff>$/)
  assert.doesNotMatch(prompt, /Binary files/)
  assert.match(prompt, /\+new/)
})

test('normalizes model responses to the first line and strips backticks', () => {
  assert.equal(
    normalizeCommitMessage('feat: add session export\n\nExports Markdown, JSONL, or HTML.'),
    'feat: add session export',
  )
  assert.equal(normalizeCommitMessage('```\nfix: parse empty diffs\n```'), 'fix: parse empty diffs')
  assert.equal(normalizeCommitMessage('```ts\nfeat: add export\n```'), 'feat: add export')
  assert.equal(normalizeCommitMessage('`feat`: add `export` button'), 'feat: add export button')
  assert.equal(normalizeCommitMessage('  \nchore: bump deps\n'), 'chore: bump deps')
})

test('rejects an empty diff with the 409-mapped error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-commit-message-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await assert.rejects(
      collectGitDiff(directory),
      (error: unknown) => error instanceof EmptyDiffError && error.message === 'Nothing to commit',
    )
    // Untracked-only changes are not part of any diff, so they still count as empty.
    await writeFile(join(directory, 'untracked.ts'), 'new\n')
    await assert.rejects(collectGitDiff(directory), EmptyDiffError)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('prefers the staged diff and falls back to the unstaged diff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-livecraft-commit-message-'))
  try {
    await execFile('git', ['init', '--quiet'], { cwd: directory })
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: directory })
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: directory })
    await writeFile(join(directory, 'tracked.ts'), 'before\n')
    await execFile('git', ['add', 'tracked.ts'], { cwd: directory })
    await execFile('git', ['commit', '--quiet', '-m', 'Initial'], { cwd: directory })

    await writeFile(join(directory, 'tracked.ts'), 'after\n')
    const unstaged = await collectGitDiff(directory)
    assert.match(unstaged, /-before\n\+after/)

    await execFile('git', ['add', 'tracked.ts'], { cwd: directory })
    const staged = await collectGitDiff(directory)
    assert.match(staged, /-before\n\+after/)

    // Once something is staged, later unstaged edits are excluded from the payload.
    await writeFile(join(directory, 'tracked.ts'), 'after again\n')
    await writeFile(join(directory, 'second.ts'), 'second\n')
    const stagedOnly = await collectGitDiff(directory)
    assert.match(stagedOnly, /-before\n\+after/)
    assert.doesNotMatch(stagedOnly, /after again/)
    assert.doesNotMatch(stagedOnly, /second\.ts/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
