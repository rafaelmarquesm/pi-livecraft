import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, normalize, relative, resolve, sep } from 'node:path'

/** JSON value accepted by the deterministic fingerprinting helpers. */
export type FingerprintJson =
  | null
  | boolean
  | number
  | string
  | FingerprintJson[]
  | { [key: string]: FingerprintJson }

/** Returns a JSON string with recursively sorted object keys. */
export function stableStringify(value: FingerprintJson): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot fingerprint non-finite numbers')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${
    entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')
  }}`
}

/** Hashes text with SHA-256 and returns the lowercase hex digest. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Hashes bytes with SHA-256 and returns the lowercase hex digest. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Fingerprints a JSON-compatible value after stable canonicalization. */
export function fingerprintJson(value: FingerprintJson): string {
  return sha256Text(stableStringify(value))
}

/** Rejects IDs that would be unsafe in artifact paths or shell output. */
export function assertSafeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must use only safe identifier characters`)
  }
  if (value.includes('..')) throw new Error(`${label} must not contain path traversal`)
  return value
}

/** Resolves a relative path under root and rejects absolute paths and traversal. */
export function resolveInsideRoot(root: string, requestedPath: string): string {
  if (requestedPath.length === 0) throw new Error('Path must not be empty')
  if (requestedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(requestedPath)) {
    throw new Error('Path must be relative to the results root')
  }

  const rootPath = resolve(root)
  const target = resolve(rootPath, normalize(requestedPath))
  const pathRelativeToRoot = relative(rootPath, target)
  if (
    pathRelativeToRoot === '' || pathRelativeToRoot.startsWith('..')
    || pathRelativeToRoot.includes(`..${sep}`)
  ) {
    throw new Error('Path escapes the configured root')
  }
  return target
}

/** Fingerprints one file by bytes. */
export async function fingerprintFile(path: string): Promise<string> {
  return sha256Bytes(await readFile(path))
}

/** Fingerprints a directory tree by relative path, file mode, and file bytes. */
export async function fingerprintDirectory(root: string): Promise<string> {
  const rootPath = resolve(root)
  const entries: FingerprintJson[] = []

  async function visit(current: string): Promise<void> {
    const names = (await readdir(current)).sort((left, right) => left.localeCompare(right))
    for (const name of names) {
      const path = join(current, name)
      const stat = await lstat(path)
      const relPath = relative(rootPath, path).split(sep).join('/')
      if (stat.isSymbolicLink()) throw new Error(`Refusing to fingerprint symlink ${relPath}`)
      if (stat.isDirectory()) {
        entries.push({ kind: 'directory', path: relPath })
        await visit(path)
      } else if (stat.isFile()) {
        entries.push({
          hash: await fingerprintFile(path),
          kind: 'file',
          mode: stat.mode & 0o777,
          path: relPath,
        })
      }
    }
  }

  await visit(rootPath)
  return fingerprintJson({ entries })
}
