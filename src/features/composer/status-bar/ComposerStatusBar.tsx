import { memo } from 'react'
import type { SessionSummary } from '../../../../shared/types.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats } from './SessionStats.tsx'

/** Status bar shown below the composer: session name, directory, cost, and context usage. */
export const ComposerStatusBar = memo(function ComposerStatusBar(
  {
    session,
    running,
    compacting,
    cost,
    contextClass,
    contextTokens,
    contextPercent,
    contextPercentValue,
    contextUnknown,
  }: {
    session: SessionSummary
    running: boolean
    compacting: boolean
    cost: string
    contextClass: string
    contextTokens: string
    contextPercent: string
    contextPercentValue: number | null
    /** True when context usage exists but the percent is null (post-compaction). */
    contextUnknown: boolean
  },
) {
  return (
    <div className='composer-info' aria-label='Session information'>
      {compacting
        ? (
          <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
            <span aria-hidden='true' className='composer-compacting-spinner' /> Compaction en cours…
          </div>
        )
        : <SessionInfo name={session.name} cwd={session.cwd} active={running} />}
      <SessionStats
        cost={cost}
        contextClass={contextClass}
        contextTokens={contextTokens}
        contextPercent={contextPercent}
        contextPercentValue={contextPercentValue}
        contextUnknown={contextUnknown}
      />
    </div>
  )
})
