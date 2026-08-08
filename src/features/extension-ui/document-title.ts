/**
 * Pure title helper for extension-provided titles (`setTitle`, E23).
 *
 * document.title writes are owned by the notifications feature (single
 * writer); extension titles flow through this pure helper. The notifications
 * effect calls `extensionDocumentTitle` with the selected session's extension
 * title and applies the result itself — this module never touches
 * document.title.
 */

const documentTitlePrefix = 'Livecraft — '

/**
 * Returns the document title for an extension-provided title, or undefined
 * when no extension title is set. The prefix is fixed and cannot be removed
 * by an extension: it is applied unconditionally whenever a title exists.
 */
export function extensionDocumentTitle(
  extensionTitle: string | undefined,
): string | undefined {
  if (extensionTitle === undefined || extensionTitle === '') return undefined
  return `${documentTitlePrefix}${extensionTitle}`
}
