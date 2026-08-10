import assert from 'node:assert/strict'
import test from 'node:test'
import { redactJson, redactText } from '../evals/quality/redaction.ts'

const bearerValue = `Bearer ${'a'.repeat(26)}`
const apiKeyValue = `sk_${'a'.repeat(26)}`
const awsKeyValue = `AKIA${'A'.repeat(16)}`

test('redacts bearer tokens, auth headers, cookies, API keys, and home paths in text', () => {
  const input = [
    `Authorization: ${bearerValue}`,
    'Cookie: session=abcdef123456; other=value',
    `OPENAI_API_KEY=${apiKeyValue}`,
    `aws ${awsKeyValue}`,
    'path /Users/rafaelmoura/project/.env and /home/alice/work',
  ]
    .join('\n')

  const output = redactText(input)
  assert.doesNotMatch(output, new RegExp('a'.repeat(26)))
  assert.doesNotMatch(output, /session=abcdef/)
  assert.doesNotMatch(output, new RegExp(`AKIA${'A'.repeat(16)}`))
  assert.doesNotMatch(output, /rafaelmoura|alice/)
  assert.match(output, /Authorization: \[REDACTED\]/)
  assert.match(output, /OPENAI_API_KEY=\[REDACTED\]/)
  assert.match(output, /path ~\/project\/\.env and ~\/work/)
})

test('redacts sensitive JSON keys recursively without deleting public fields', () => {
  const input = {
    apiKey: apiKeyValue,
    nested: {
      command: 'read /Users/rafaelmoura/project/file.ts',
      token: 'plain-secret-value',
    },
    public: ['kept', bearerValue],
  }

  const output = redactJson(input)
  assert.equal(output.apiKey, '[REDACTED]')
  assert.equal(output.nested.token, '[REDACTED]')
  assert.equal(output.nested.command, 'read ~/project/file.ts')
  assert.deepEqual(output.public, ['kept', '[REDACTED]'])
})
