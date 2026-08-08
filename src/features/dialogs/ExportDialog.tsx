import { useEffect, useRef } from 'react'

export type ExportFormat = 'html' | 'md' | 'jsonl'

/**
 * Modal download picker for the session export command. Modeled on
 * ConfirmDialog: same backdrop/modal classes, ESC or overlay click cancels,
 * and the primary (first available) format button receives initial focus.
 */
export function ExportDialog(
  { htmlAvailable, onCancel, onPick }: {
    htmlAvailable: boolean
    onCancel: () => void
    onPick: (format: ExportFormat) => void
  },
) {
  const htmlRef = useRef<HTMLButtonElement>(null)
  const markdownRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    // Focus the primary action; fall back to Markdown when the connected Pi
    // build cannot produce HTML exports.
    if (htmlAvailable) htmlRef.current?.focus()
    else markdownRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [htmlAvailable])

  return (
    <div
      className='modal-backdrop'
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      role='presentation'
    >
      <section aria-modal='true' className='modal' role='dialog'>
        <h2>Export session</h2>
        <p>Download the current session conversation.</p>
        <div className='modal-actions'>
          <button
            className='primary'
            disabled={!htmlAvailable}
            onClick={() => onPick('html')}
            ref={htmlRef}
            title={htmlAvailable ? undefined : 'Requires a Pi version with export_html'}
            type='button'
          >
            HTML
          </button>
          <button onClick={() => onPick('md')} ref={markdownRef} type='button'>Markdown</button>
          <button onClick={() => onPick('jsonl')} type='button'>JSONL</button>
          <button onClick={onCancel} type='button'>Cancel</button>
        </div>
      </section>
    </div>
  )
}
