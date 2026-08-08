import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionToMarkdown } from '../server/features/export/session-markdown.ts'
import type { SessionMessage } from '../shared/types.ts'

const exportedAt = new Date('2026-01-01T00:00:00Z')

test('serializes the visible conversation to a deterministic Markdown snapshot', () => {
  const messages: SessionMessage[] = [
    { entryId: 'u1', message: { role: 'user', content: 'Hello world' } },
    {
      entryId: 'u2',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        ],
      },
    },
    {
      entryId: 'a1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'thinking', thinking: 'First I run ls' },
          { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
    },
    {
      entryId: 'r1',
      message: {
        role: 'toolResult',
        toolName: 'bash',
        content: [{ type: 'text', text: 'file1\nfile2' }],
      },
    },
    {
      entryId: 'r2',
      message: {
        role: 'toolResult',
        toolName: 'bash',
        isError: true,
        content: [{ type: 'text', text: 'boom' }],
      },
    },
    {
      entryId: 'r3',
      message: {
        role: 'toolResult',
        toolName: 'bash',
        content: [{ type: 'text', text: 'has ``` inside' }],
      },
    },
    {
      entryId: 'r4',
      message: {
        role: 'toolResult',
        toolName: 'bash',
        content: [{ type: 'text', text: 'x'.repeat(10_001) }],
      },
    },
    {
      entryId: 'c1',
      message: {
        role: 'custom',
        customType: 'compaction',
        display: true,
        content: 'Context summarized',
      },
    },
    // Outside the display filter: must not appear in the document.
    {
      entryId: 'c2',
      message: {
        role: 'custom',
        customType: 'compaction',
        display: false,
        content: 'Hidden compaction',
      },
    },
  ]

  const expected = `# Demo session

_Exported 2026-01-01T00:00:00.000Z_
_Workspace: \`/tmp/project\`_

## User

Hello world

## User

Look at this

_[image attached]_

## Assistant

Let me check.

> **Thinking**
> First I run ls

**Tool call: \`bash\`**

\`\`\`json
{
  "command": "ls"
}
\`\`\`

**Tool result: \`bash\`**

\`\`\`
file1
file2
\`\`\`

**Tool result: \`bash\` (error)**

\`\`\`
boom
\`\`\`

**Tool result: \`bash\`**

\`\`\`
has \`\u200B\`\` inside
\`\`\`

**Tool result: \`bash\`**

\`\`\`
${'x'.repeat(10_000)}
… (truncated)
\`\`\`

## Note — compaction

Context summarized
`

  assert.equal(
    sessionToMarkdown(messages, { name: 'Demo session', cwd: '/tmp/project', exportedAt }),
    expected,
  )
})

test('omits unknown roles and messages outside the display filter', () => {
  const messages: SessionMessage[] = [
    { entryId: 's1', message: { role: 'system', content: 'hidden system prompt' } },
    {
      entryId: 'c1',
      message: { role: 'custom', customType: 'compaction', display: false, content: 'hidden' },
    },
  ]
  assert.equal(
    sessionToMarkdown(messages, { name: 'Empty', exportedAt }),
    '# Empty\n\n_Exported 2026-01-01T00:00:00.000Z_\n',
  )
})
