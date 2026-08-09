import assert from 'node:assert/strict'
import test from 'node:test'
import { nextBackoff, shouldRespawn, STABLE_UPTIME_MS } from '../scripts/dev-backend.ts'

test('shouldRespawn: deliberate stops never respawn', () => {
  assert.equal(shouldRespawn('SIGTERM'), false)
  assert.equal(shouldRespawn('SIGINT'), false)
})

test('shouldRespawn: crashes respawn regardless of code/signal', () => {
  assert.equal(shouldRespawn(null), true)
  assert.equal(shouldRespawn(null), true)
  assert.equal(shouldRespawn(null), true)
  // A crash that happens to surface as a generic signal still respawns.
  assert.equal(shouldRespawn('SIGKILL'), true)
})

test('nextBackoff: resets to the initial value after a stable uptime', () => {
  assert.equal(nextBackoff(16_000, STABLE_UPTIME_MS), 1_000)
  assert.equal(nextBackoff(16_000, STABLE_UPTIME_MS + 1), 1_000)
})

test('nextBackoff: doubles on short-lived crashes, capped at the maximum', () => {
  assert.equal(nextBackoff(1_000, 100), 2_000)
  assert.equal(nextBackoff(2_000, 100), 4_000)
  assert.equal(nextBackoff(16_000, 100), 30_000)
  assert.equal(nextBackoff(30_000, 100), 30_000)
})
