import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

export interface ValidatedWorkBaseline {
  cwd: string
  provenance: 'git' | 'non_git'
  headSha: string | null
  initialDirty: boolean
  initialChangedPaths: string[]
  initialDiffHash: string | null
  capturedAt: number
}

/** Captures the review baseline metadata without persisting raw diff content. */
export async function captureValidatedWorkBaseline(
  cwd: string,
  now = Date.now(),
): Promise<ValidatedWorkBaseline> {
  const head = await git(cwd, ['rev-parse', 'HEAD']).catch(() => null)
  if (head === null) {
    return {
      cwd,
      provenance: 'non_git',
      headSha: null,
      initialDirty: false,
      initialChangedPaths: [],
      initialDiffHash: null,
      capturedAt: now,
    }
  }
  const status = await git(cwd, ['status', '--porcelain=v1', '-z'])
  const changedPaths = parseStatusPaths(status)
  const diff = await git(cwd, ['diff', '--binary']).catch(() => '')
  return {
    cwd,
    provenance: 'git',
    headSha: head.trim(),
    initialDirty: changedPaths.length > 0,
    initialChangedPaths: changedPaths,
    initialDiffHash: createHash('sha256').update(diff).digest('hex'),
    capturedAt: now,
  }
}

export function parseStatusPaths(status: string): string[] {
  const paths = new Set<string>()
  for (const record of status.split('\0')) {
    if (record.length < 4 || record[2] !== ' ') continue
    const path = record.slice(3)
    if (!path) continue
    const separator = path.indexOf('\0')
    paths.add(separator === -1 ? path : path.slice(0, separator))
  }
  return [...paths].sort((left, right) => left.localeCompare(right))
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'))
        return
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8') || `git exited with ${code}`))
    })
  })
}
