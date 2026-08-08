import assert from 'node:assert/strict'
import test from 'node:test'
import { requestContentTypeAllowed, requestOriginAllowed } from '../server/request-guard.ts'

test('rejects non-JSON content types for requests with bodies', () => {
  assert.equal(requestContentTypeAllowed('text/plain'), false)
  assert.equal(requestContentTypeAllowed('text/plain; charset=utf-8'), false)
  assert.equal(requestContentTypeAllowed(undefined), false)
})

test('accepts JSON content types with any charset and nothing else', () => {
  assert.equal(requestContentTypeAllowed('application/json'), true)
  assert.equal(requestContentTypeAllowed('application/json; charset=utf-8'), true)
  assert.equal(requestContentTypeAllowed('application/json; charset=UTF-8'), true)
  assert.equal(requestContentTypeAllowed('APPLICATION/JSON'), true)
  assert.equal(requestContentTypeAllowed('application/json; charset=utf-8; boundary=x'), false)
})

test('accepts only localhost origins with any port', () => {
  assert.equal(requestOriginAllowed('http://127.0.0.1:5173', undefined), true)
  assert.equal(requestOriginAllowed('http://localhost:5173', undefined), true)
  assert.equal(requestOriginAllowed('http://[::1]:5173', undefined), true)
  assert.equal(requestOriginAllowed('http://127.0.0.1', undefined), true)
})

test('rejects foreign origins', () => {
  assert.equal(requestOriginAllowed('https://evil.example', undefined), false)
  assert.equal(requestOriginAllowed('https://evil.example', 'cross-site'), false)
  assert.equal(requestOriginAllowed('http://127.0.0.1.evil.example', undefined), false)
  assert.equal(requestOriginAllowed('not a url', undefined), false)
})

test('rejects cross-site fetches and accepts absent origins', () => {
  assert.equal(requestOriginAllowed(undefined, undefined), true)
  assert.equal(requestOriginAllowed(undefined, 'same-origin'), true)
  assert.equal(requestOriginAllowed('http://127.0.0.1:5173', 'cross-site'), false)
  assert.equal(requestOriginAllowed(undefined, 'cross-site'), false)
})
