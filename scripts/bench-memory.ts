#!/usr/bin/env node
/**
 * §4.4 — Memory leak check. Uses the backend's public process monitor
 * (GET /api/processes) to read the RSS of the backend and manager processes,
 * then runs N cycles of session create → snapshot refresh → close and reports
 * the RSS delta. Linear growth across many cycles signals a leak (suspects:
 * liveSessionEvents, caches not cleared on session_exited).
 *
 * Gate (spec §4.4): delta RSS < 50 MB after the cycle count.
 *
 * Usage:  node scripts/bench-memory.ts [cycles]
 * Requires the backend (npm run dev) running on PI_LIVECRAFT_BACKEND_PORT (43121).
 */

const base = `http://127.0.0.1:${process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'}`
const CYCLES = Number(process.argv[2] ?? 10)
const cwd = process.env.PI_LIVECRAFT_BENCH_CWD ?? '/tmp/pi-livecraft-e2e-workspace'

interface ProcessInfo {
  pid: number
  rssKb: number
  name: string
  args: string
}

async function processRssKb(): Promise<number> {
  const res = await fetch(`${base}/api/processes`)
  const data = await res.json() as { available: boolean; processes: ProcessInfo[] }
  if (!data.available) throw new Error('Process monitor unavailable (ps missing)')
  return data.processes.reduce((sum, p) => sum + (p.rssKb || 0), 0)
}

async function createSession(): Promise<string> {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  })
  const body = await res.json() as { id?: string }
  if (!body.id) throw new Error(`createSession failed: ${JSON.stringify(body)}`)
  return body.id
}

async function closeSession(id: string): Promise<void> {
  await fetch(`${base}/api/sessions/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .catch(() => undefined)
}

async function snapshot(id: string): Promise<void> {
  await fetch(`${base}/api/sessions/${id}/snapshot`).catch(() => undefined)
}

async function main(): Promise<void> {
  const baseline = await processRssKb()
  console.log(`Baseline RSS (backend+manager): ${(baseline / 1024).toFixed(1)} MiB`)

  for (let i = 0; i < CYCLES; i += 1) {
    const id = await createSession()
    for (let j = 0; j < 3; j += 1) await snapshot(id)
    await closeSession(id)
  }

  // Let the manager reap the exited Pi processes before the final read.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const final = await processRssKb()
  const deltaKb = final - baseline
  const deltaMiB = deltaKb / 1024
  console.log(`After ${CYCLES} cycles: RSS ${(final / 1024).toFixed(1)} MiB`)
  console.log(`Delta RSS: ${deltaMiB.toFixed(1)} MiB`)
  console.log(`${deltaMiB < 50 ? 'PASS' : 'FAIL'}  delta < 50 MiB`)
  if (deltaMiB < 0) console.log('(negative delta: GC reclaimed memory; no leak)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
