/**
 * Composer prefill policy for `set_editor_text` (E15).
 *
 * An extension prefill never overwrites a draft: an empty (or whitespace-only)
 * composer is filled silently, while any real draft is preserved and the user
 * is asked first. The decision is pure so the composer effect and the tests
 * share the same rule.
 */
export function applyEditorPrefill(
  currentText: string,
  _prefill: string,
): 'apply' | 'ask' {
  return currentText.trim() === '' ? 'apply' : 'ask'
}
