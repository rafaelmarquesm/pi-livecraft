import { Tooltip } from '../../../components/Tooltip.tsx'

/** Displays session cost and context window usage with a progress bar. */
export function SessionStats(
  { cost, contextClass, contextTokens, contextPercent, contextPercentValue, contextUnknown }: {
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
    <div className='composer-stats'>
      <span>
        <b>Cost</b>
        {cost}
      </span>
      <span className={contextClass}>
        <b>Context</b>
        <small>{contextTokens}</small>
        {contextPercentValue !== null
          ? (
            <>
              {contextPercent}
              <progress
                aria-label={`Context usage: ${contextTokens} (${contextPercent})`}
                max={100}
                value={contextPercentValue}
              />
            </>
          )
          : contextUnknown
          ? (
            <Tooltip label='Context usage unknown after compaction'>
              <span className='context-unknown'>{contextPercent}</span>
            </Tooltip>
          )
          : <span className='context-unknown'>{contextPercent}</span>}
      </span>
    </div>
  )
}
