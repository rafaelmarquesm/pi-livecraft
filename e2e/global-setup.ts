import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const defaultWorkspace = '/tmp/pi-livecraft-e2e-workspace'
const workspace = process.env.PI_LIVECRAFT_E2E_WORKSPACE ?? defaultWorkspace

/**
 * Creates a deterministic Git workspace before the E2E web server starts.
 * CI runners do not have the /tmp workspace that local runs happened to reuse;
 * without this setup the New Session request fails and every UI test times out
 * waiting for the composer. Only the known default fixture is removed — a
 * caller-provided workspace is never deleted.
 */
export default function globalSetup(): void {
  if (workspace === defaultWorkspace) rmSync(workspace, { force: true, recursive: true })
  rmSync(join(homedir(), '.pi', 'agent', 'sessions', 'pi-livecraft-e2e'), {
    force: true,
    recursive: true,
  })
  mkdirSync(workspace, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: workspace })
  execFileSync('git', ['config', 'user.email', 'e2e@pi-livecraft.local'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'Pi Livecraft E2E'], { cwd: workspace })
  const readme = join(workspace, 'README.md')
  writeFileSync(readme, '# Pi Livecraft E2E workspace\n')
  execFileSync('git', ['add', 'README.md'], { cwd: workspace })
  execFileSync('git', ['commit', '-q', '-m', 'test: initialize E2E workspace'], { cwd: workspace })
}
