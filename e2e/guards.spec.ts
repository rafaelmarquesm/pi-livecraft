import { test, expect } from '@playwright/test'

// §2.9 / §3.6 — security regressions against the live backend. The frontend
// proxies /api to the backend, so these go through the same guard.
test.describe('guards', () => {
  test('S1: non-JSON Content-Type on a POST route is rejected (415)', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { 'Content-Type': 'text/plain' },
      data: 'not json',
    })
    expect(res.status()).toBe(415)
  })

  test('S2a: cross-site Origin on a POST is rejected (403)', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' },
      data: '{}',
    })
    expect(res.status()).toBe(403)
  })

  test('S2b: cross-site Sec-Fetch-Site on a POST is rejected (403)', async ({ request }) => {
    const res = await request.post('/api/sessions', {
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      data: '{}',
    })
    expect(res.status()).toBe(403)
  })
})
