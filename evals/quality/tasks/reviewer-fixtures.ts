export interface SeededReviewerFixture {
  id: string
  title: string
  diff: string
  expected: Array<{ severity: 'P0' | 'P1'; path: string; evidence: string }>
}

export const seededReviewerFixtures: SeededReviewerFixture[] = [{
  id: 'auth-token-log-p0',
  title: 'Logs bearer tokens from an auth header',
  diff: `diff --git a/server/auth.ts b/server/auth.ts
--- a/server/auth.ts
+++ b/server/auth.ts
@@ -1,3 +1,4 @@
 export function authorize(header: string) {
+  console.log('auth header', header)
   return header.startsWith('Bearer ')
 }
`,
  expected: [{
    severity: 'P0',
    path: 'server/auth.ts',
    evidence: 'The changed code logs the raw Authorization header, exposing bearer credentials.',
  }],
}, {
  id: 'jsonl-non-atomic-p1',
  title: 'Replaces atomic JSONL write with direct overwrite',
  diff: `diff --git a/server/store.ts b/server/store.ts
--- a/server/store.ts
+++ b/server/store.ts
@@ -1,5 +1,3 @@
 export async function save(path: string, content: string) {
-  await writeFile(path + '.tmp', content, { mode: 0o600 })
-  await rename(path + '.tmp', path)
+  await writeFile(path, content)
 }
`,
  expected: [{
    severity: 'P1',
    path: 'server/store.ts',
    evidence: 'The changed persistence path no longer uses tmp + rename or explicit 0600 mode.',
  }],
}]
