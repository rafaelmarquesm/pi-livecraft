import { useMemo } from 'react'

/**
 * Renders the selected session's extension status entries as a horizontal
 * strip of key: value chips directly above the composer. Renders nothing when
 * the map is empty so there is no layout shift.
 */
export function ExtensionStatusBar({ status }: {
  status: ReadonlyMap<string, string>
}) {
  const entries = useMemo(() => [...status.entries()], [status])
  if (entries.length === 0) return null
  return (
    <div aria-label='Extension status' className='extension-status-bar' role='status'>
      {entries.map(([key, text]) => (
        <span className='extension-status-chip' key={key}>
          <strong>{key}</strong>
          <span>{text}</span>
        </span>
      ))}
    </div>
  )
}
