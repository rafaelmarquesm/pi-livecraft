/** Base title shown whenever no extension title or activity is present. */
export const appTitle = 'Livecraft'
/** The favicon href restored when no session is running (matches index.html). */
export const defaultFaviconHref = '/favicon.svg'

/**
 * Composes the document title. The extension title wins (it already carries
 * the Livecraft prefix); otherwise the activity suffix (e.g. `● Build`) is
 * appended to the base title; otherwise the base title alone is used.
 */
export function documentTitleFor(
  extensionTitle: string | undefined,
  activitySuffix: string | undefined,
): string {
  if (extensionTitle !== undefined && extensionTitle !== '') return extensionTitle
  if (activitySuffix !== undefined && activitySuffix !== '') {
    return `${appTitle} — ${activitySuffix}`
  }
  return appTitle
}

/** The 2D drawing surface the favicon badge needs; kept DOM-free for tests. */
export interface FaviconContext {
  fillStyle: string
  beginPath(): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  fill(): void
}

/** The subset of a canvas the favicon badge needs; kept DOM-free for tests. */
export interface FaviconCanvas {
  width: number
  height: number
  toDataURL(type?: string): string
  getContext(contextId: string): FaviconContext | null
}

/** Creates the favicon canvas in a browser; null where none is available. */
function defaultFaviconCanvas(): FaviconCanvas | null {
  const element = (globalThis as { document?: { createElement(tagName: string): unknown } })
    .document
    ?.createElement('canvas') as FaviconCanvas | undefined
  return element ?? null
}

/**
 * Returns the favicon to display. While any session runs, draws a red dot
 * badge on a transparent 32x32 canvas; otherwise returns the default href.
 */
export function faviconDataUrl(
  running: boolean,
  createCanvas: () => FaviconCanvas | null = defaultFaviconCanvas,
): string {
  if (!running) return defaultFaviconHref
  const canvas = createCanvas()
  if (canvas === null) return defaultFaviconHref
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (ctx === null) return defaultFaviconHref
  ctx.fillStyle = '#e5484d'
  ctx.beginPath()
  ctx.arc(24, 8, 6, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL()
}
