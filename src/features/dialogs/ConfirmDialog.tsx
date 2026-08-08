import { useEffect, useRef } from 'react'

/**
 * Modal confirmation host replacing window.confirm (M7).
 *
 * Modeled on the extension dialogs: same backdrop/modal classes, Cancel on the
 * left of Confirm (matching the dialog action order), ESC or overlay click
 * resolves as Cancel, and the Cancel button receives initial focus so the safe
 * action is the default for destructive confirmations.
 */
export function ConfirmDialog(
  { cancelLabel = 'Cancel', confirmLabel = 'Confirm', message, onCancel, onConfirm, title }: {
    cancelLabel?: string
    confirmLabel?: string
    message: string
    onCancel: () => void
    onConfirm: () => void
    title: string
  },
) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      className='modal-backdrop'
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      role='presentation'
    >
      <section aria-modal='true' className='modal' role='alertdialog'>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className='modal-actions'>
          <button className='primary' onClick={onConfirm} type='button'>
            {confirmLabel}
          </button>
          <button onClick={onCancel} ref={cancelRef} type='button'>{cancelLabel}</button>
        </div>
      </section>
    </div>
  )
}
