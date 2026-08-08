import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseProcessLines,
  readProcesses,
  type ProcessCommandRunner,
} from '../server/features/process-monitor.ts'

// Fixed `ps -eo pid,rss,comm,args` output (macOS shape: comm and args share the
// COMMAND header label). Mixed rows exercise header, filtering, and malformed input.
const psFixture = `  PID    RSS COMMAND         COMMAND
  418  39696 loginwindow     /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console
  1234 102400 node           /usr/local/bin/pi-coding-agent --model gpt-5 --cwd /Users/me/project
  3456  2048 node           /usr/local/bin/pi-coding-agent
  5678  51200 node           /Users/me/pi-livecraft/server/manager.ts --port 43120
  9012  8192 node           /Users/me/pi-livecraft/server/manager-supervisor.ts
  7777  1024 Finder          /System/Library/CoreServices/Finder.app
  not-a-pid 100 foo bar
  9999 not-rss baz qux
  1111
  2222  4096 kernel_task
`

test('skips the header line and keeps only pi-coding-agent / server/manager rows, sorted by pid', () => {
  assert.deepEqual(parseProcessLines(psFixture), [
    {
      pid: 1234,
      rssKb: 102400,
      name: 'node',
      args: '/usr/local/bin/pi-coding-agent --model gpt-5 --cwd /Users/me/project',
    },
    { pid: 3456, rssKb: 2048, name: 'node', args: '/usr/local/bin/pi-coding-agent' },
    {
      pid: 5678,
      rssKb: 51200,
      name: 'node',
      args: '/Users/me/pi-livecraft/server/manager.ts --port 43120',
    },
    // Substring match: the supervisor command line contains "server/manager".
    {
      pid: 9012,
      rssKb: 8192,
      name: 'node',
      args: '/Users/me/pi-livecraft/server/manager-supervisor.ts',
    },
  ])
})

test('drops unrelated, malformed, and field-less rows without throwing', () => {
  const output = parseProcessLines(psFixture)
  const pids = output.map((process) => process.pid)
  assert.ok(!pids.includes(7777), 'unrelated Finder process must be filtered')
  assert.ok(!pids.includes(2222), 'process without args cannot match the filter')
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid)))
})

test('returns an empty list for empty output', () => {
  assert.deepEqual(parseProcessLines(''), [])
})

test('handles a Linux-style single-COMMAND header and CRLF line endings', () => {
  const linuxFixture =
    '  PID    RSS COMMAND\r\n  4242 16384 node /opt/pi-coding-agent/bin/pi-coding-agent --version\r\n'
  assert.deepEqual(parseProcessLines(linuxFixture), [
    {
      pid: 4242,
      rssKb: 16384,
      name: 'node',
      args: '/opt/pi-coding-agent/bin/pi-coding-agent --version',
    },
  ])
})

test('readProcesses runs ps with the expected arguments and parses the output', async () => {
  let invoked: [string, string[]] | null = null
  const runner: ProcessCommandRunner = async (command, args) => {
    invoked = [command, args]
    return psFixture
  }
  const snapshot = await readProcesses(runner)
  assert.deepEqual(invoked, ['ps', ['-eo', 'pid,rss,comm,args']])
  assert.equal(snapshot.available, true)
  assert.deepEqual(snapshot.processes, parseProcessLines(psFixture))
})

test('readProcesses degrades to not available when ps cannot run', async () => {
  const runner: ProcessCommandRunner = async () => {
    throw new Error('spawn ps ENOENT')
  }
  assert.deepEqual(await readProcesses(runner), { available: false, processes: [] })
})
