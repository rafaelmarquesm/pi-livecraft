import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import type { SessionMessage } from '../../../shared/types.ts'
import type { Activity } from './activity.ts'
import { turnUsageByMessage } from './message-usage.ts'
import {
  assistantTurnParts,
  conversationMessageEntries,
  type LiveMessage,
} from './message-reconciliation.ts'
import { toolCallsInMessage, toolResultInMessage, type ToolExecution } from './tool-protocol.ts'
import type { SessionAnalysisTarget } from '../session-analysis/session-analysis.ts'
import { ActivityIndicator } from './ActivityIndicator.tsx'
import { Markdown } from './Markdown.tsx'
import { MessageCard, TurnUsage } from './MessageCard.tsx'
import { isVisibleConversationMessage } from './message-display.ts'
import { searchMessages, type SearchMatch } from './conversation-search.ts'
import { ToolCallCard } from './ToolCallCard.tsx'
import {
  conversationHistoryStart,
  resumesAutoScrollAfterDownwardScroll,
  suspendsAutoScrollAfterUpwardScroll,
} from './conversation-scroll.ts'

/** Assembles history, the live stream, and tool executions according to the selected detail level. */
export function Conversation(
  {
    activity,
    agentName,
    forkAvailable,
    messages,
    liveMessages,
    conversationView,
    navigationRequest,
    pendingSteering,
    repositoryRoot,
    scrollToBottomRequest,
    searchRequest,
    toolExecutions,
    workingDirectory,
    onError,
    onForkMessage,
  }: {
    activity: Activity | null
    agentName?: string
    forkAvailable?: boolean
    messages: SessionMessage[]
    liveMessages: LiveMessage[]
    conversationView: 'simple' | 'semi-detailed' | 'detailed'
    navigationRequest?: { id: number; target: SessionAnalysisTarget }
    pendingSteering: string[]
    repositoryRoot?: string | null
    scrollToBottomRequest: number
    searchRequest?: number
    toolExecutions: ToolExecution[]
    workingDirectory: string
    onError: (cause: unknown) => void
    onForkMessage?: (entryId: string) => void
  },
) {
  const showToolCalls = conversationView !== 'simple'
  const semiDetailed = conversationView === 'semi-detailed'
  const allMessages = messages
  const { visibleMessages, toolCallIds, resultsByCallId } = useMemo(
    () => {
      const visible = allMessages.filter((entry) => isVisibleConversationMessage(entry.message))
      const calls = allMessages.flatMap((entry) => toolCallsInMessage(entry.message))
      const results = new Map(allMessages.flatMap((entry) => {
        const result = toolResultInMessage(entry.message)
        return result ? [[result.toolCallId, result] as const] : []
      }))
      return {
        visibleMessages: visible,
        toolCallIds: new Set(calls.map((call) => call.id)),
        resultsByCallId: results,
      }
    },
    [allMessages],
  )
  const executionsByCallId = useMemo(
    () => new Map(toolExecutions.map((execution) => [execution.id, execution])),
    [toolExecutions],
  )
  /** Call IDs whose result has arrived, either from history or a live tool_execution_end. */
  const resolvedCallIds = useMemo(
    () =>
      new Set([
        ...resultsByCallId.keys(),
        ...toolExecutions.filter((execution) => execution.result !== undefined).map((execution) =>
          execution.id
        ),
      ]),
    [resultsByCallId, toolExecutions],
  )
  const { usagesByMessage, turnNumbers } = useMemo(
    () => {
      const usagesByMessage = turnUsageByMessage(allMessages, resolvedCallIds)
      const turnNumbers = new Map<number, number>()
      let turnNum = 0
      for (const idx of [...usagesByMessage.keys()].sort((a, b) => a - b)) {
        turnNumbers.set(idx, ++turnNum)
      }
      return { usagesByMessage, turnNumbers }
    },
    [allMessages, resolvedCallIds],
  )
  const liveToolCallIds = useMemo(
    () =>
      new Set(
        liveMessages
          .flatMap(({ message }) => toolCallsInMessage(message))
          .map((call) => call.id),
      ),
    [liveMessages],
  )
  const messageEntries = useMemo(() => conversationMessageEntries(allMessages, liveMessages), [
    allMessages,
    liveMessages,
  ])
  const initialHistoryStart = useMemo(
    () => conversationHistoryStart(allMessages, allMessages.length),
    [allMessages],
  )
  const [historyStart, setHistoryStart] = useState(initialHistoryStart)
  const renderedHistoryStart = Math.min(historyStart, initialHistoryStart)
  const renderedMessageEntries = useMemo(
    () =>
      messageEntries.filter((entry) =>
        entry.source === 'live' || entry.historyIndex >= renderedHistoryStart
      ),
    [messageEntries, renderedHistoryStart],
  )
  const visibleLiveMessages = messageEntries.filter((entry) => entry.source === 'live')
  const conversationRef = useRef<HTMLDivElement>(null)
  const conversationContentRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const previousScrollTopRef = useRef(0)
  const upwardScrollIntentRef = useRef(false)
  /** Prevents onScroll from re-enabling auto-scroll during a navigation scroll. */
  const navigationInProgressRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [highlightedTarget, setHighlightedTarget] = useState<string>()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [highlightedSearchKey, setHighlightedSearchKey] = useState<string>()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wasSearchOpenRef = useRef(false)

  /** Mounts older history in bounded batches after the recent conversation has painted. */
  useEffect(() => {
    if (renderedHistoryStart === 0) return
    const nextHistoryStart = conversationHistoryStart(allMessages, renderedHistoryStart)
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => {
        setHistoryStart((current) => Math.min(current, nextHistoryStart))
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [allMessages, renderedHistoryStart])

  /** Keeps a followed conversation pinned to its latest rendered content before paint. */
  const scrollToLiveBottom = useCallback(() => {
    const conversation = conversationRef.current
    if (!autoScrollRef.current || !conversation) return
    conversation.scrollTop = conversation.scrollHeight
    previousScrollTopRef.current = conversation.scrollTop
  }, [])

  useEffect(() => {
    const content = conversationContentRef.current
    if (!content) return
    const observer = new ResizeObserver(scrollToLiveBottom)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToLiveBottom])

  useLayoutEffect(scrollToLiveBottom, [
    activity,
    liveMessages,
    pendingSteering.length,
    scrollToLiveBottom,
    toolExecutions,
    visibleMessages.length,
  ])

  useEffect(() => {
    if (scrollToBottomRequest > 0) resumeAutoScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBottomRequest])

  // Mount hidden targets first, then disable resize-driven live scrolling before navigation.
  useLayoutEffect(() => {
    if (!navigationRequest) return
    if (renderedHistoryStart > 0) {
      setHistoryStart(0)
      return
    }
    const targetKey = navigationTargetKey(navigationRequest.target)
    const selector = navigationRequest.target.kind === 'tool'
      ? `[data-tool-call-id="${CSS.escape(navigationRequest.target.id)}"]`
      : `[data-message-index="${navigationRequest.target.index}"]`
    const conversation = conversationRef.current
    const target = conversation?.querySelector<HTMLElement>(selector)
    if (!conversation || !target) return
    autoScrollRef.current = false
    navigationInProgressRef.current = true
    setShowScrollToBottom(true)
    let cancelled = false
    let finished = false
    let highlightTimeout: number | undefined
    let fallbackRaf: number | undefined
    const finishNavigation = () => {
      if (cancelled || finished) return
      finished = true
      window.cancelAnimationFrame(fallbackRaf ?? 0)
      conversation.removeEventListener('scrollend', finishNavigation)
      navigationInProgressRef.current = false
      setHighlightedTarget(targetKey)
      highlightTimeout = window.setTimeout(() => {
        if (!cancelled) setHighlightedTarget(undefined)
      }, 1500)
    }
    // Wait two frames for the target to mount and its layout to settle before scrolling.
    requestAnimationFrame(() => {
      if (cancelled) return
      requestAnimationFrame(() => {
        if (cancelled) return
        conversation.addEventListener('scrollend', finishNavigation)
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: navigationRequest.target.kind === 'tool' ? 'center' : 'end',
        })
        // Fallback for browsers without scrollend: poll until position stabilizes.
        let stableFrames = 0
        let lastTop = conversation.scrollTop
        const poll = () => {
          if (cancelled || finished) return
          if (conversation.scrollTop === lastTop) {
            stableFrames += 1
            if (stableFrames >= 3) {
              finishNavigation()
              return
            }
          } else {
            lastTop = conversation.scrollTop
            stableFrames = 0
          }
          fallbackRaf = requestAnimationFrame(poll)
        }
        fallbackRaf = requestAnimationFrame(poll)
      })
    })
    return () => {
      cancelled = true
      conversation.removeEventListener('scrollend', finishNavigation)
      window.cancelAnimationFrame(fallbackRaf ?? 0)
      window.clearTimeout(highlightTimeout)
      navigationInProgressRef.current = false
    }
  }, [navigationRequest, renderedHistoryStart])

  const searchMatches = useMemo(
    () => searchMessages(allMessages, searchQuery),
    [allMessages, searchQuery],
  )

  /** Toggles the search bar each time the palette command fires. */
  useEffect(() => {
    if ((searchRequest ?? 0) > 0) setSearchOpen((open) => !open)
  }, [searchRequest])

  /** Focuses the input when opened and returns focus to the conversation when toggled closed. */
  useEffect(() => {
    const wasOpen = wasSearchOpenRef.current
    wasSearchOpenRef.current = searchOpen
    if (searchOpen) searchInputRef.current?.focus()
    else if (wasOpen) conversationRef.current?.focus()
  }, [searchOpen])

  /** Restarts from the first match whenever the query changes. */
  useEffect(() => {
    setSearchIndex(0)
  }, [searchQuery])

  /** Keeps the cursor valid when the match list shrinks without a query edit. */
  useEffect(() => {
    setSearchIndex((current) =>
      searchMatches.length === 0 ? 0 : Math.min(current, searchMatches.length - 1)
    )
  }, [searchMatches.length])

  const activeSearchMatch = searchMatches.length > 0
    ? searchMatches[Math.min(searchIndex, searchMatches.length - 1)]
    : undefined

  /** Scrolls to the current search match and flashes a temporary highlight. */
  useEffect(() => {
    if (!activeSearchMatch) return
    if (renderedHistoryStart > 0) {
      setHistoryStart(0)
      return
    }
    const conversation = conversationRef.current
    if (!conversation) return
    const target = findSearchTarget(conversation, activeSearchMatch)
    if (!target) return
    const wrapper = target.closest<HTMLElement>('[data-message-index]') ?? target
    const matchIndex = Number(wrapper.dataset.messageIndex)
    const searchKey = allMessages[matchIndex]?.entryId ?? `history:${matchIndex}`
    autoScrollRef.current = false
    navigationInProgressRef.current = true
    setShowScrollToBottom(true)
    setHighlightedSearchKey(searchKey)
    let cancelled = false
    let finished = false
    let highlightTimeout: number | undefined
    let settleRaf: number | undefined
    const finishSearchNavigation = () => {
      if (cancelled || finished) return
      finished = true
      window.cancelAnimationFrame(settleRaf ?? 0)
      conversation.removeEventListener('scrollend', finishSearchNavigation)
      navigationInProgressRef.current = false
      highlightTimeout = window.setTimeout(() => {
        if (!cancelled) setHighlightedSearchKey(undefined)
      }, 1500)
    }
    conversation.addEventListener('scrollend', finishSearchNavigation)
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
    // Fallback for browsers without scrollend: poll until position stabilizes.
    let stableFrames = 0
    let lastTop = conversation.scrollTop
    const poll = () => {
      if (cancelled || finished) return
      if (conversation.scrollTop === lastTop) {
        stableFrames += 1
        if (stableFrames >= 3) {
          finishSearchNavigation()
          return
        }
      } else {
        lastTop = conversation.scrollTop
        stableFrames = 0
      }
      settleRaf = requestAnimationFrame(poll)
    }
    settleRaf = requestAnimationFrame(poll)
    return () => {
      cancelled = true
      conversation.removeEventListener('scrollend', finishSearchNavigation)
      window.cancelAnimationFrame(settleRaf ?? 0)
      window.clearTimeout(highlightTimeout)
      navigationInProgressRef.current = false
    }
  }, [activeSearchMatch, renderedHistoryStart])

  /** Tracks scrolling without mistaking layout-driven Markdown reflows for user input. */
  function handleConversationScroll(): void {
    const el = conversationRef.current
    if (!el) return
    const previousScrollTop = previousScrollTopRef.current
    previousScrollTopRef.current = el.scrollTop
    if (navigationInProgressRef.current) return
    if (
      upwardScrollIntentRef.current
      && suspendsAutoScrollAfterUpwardScroll(previousScrollTop, el.scrollTop)
    ) {
      upwardScrollIntentRef.current = false
      suspendAutoScroll()
      return
    }
    if (
      autoScrollRef.current || !resumesAutoScrollAfterDownwardScroll(
        previousScrollTop,
        el.scrollTop,
        el.scrollHeight,
        el.clientHeight,
      )
    ) return
    autoScrollRef.current = true
    setShowScrollToBottom(false)
  }

  /** Stops following as soon as deliberate upward movement is observed. */
  function suspendAutoScroll(): void {
    autoScrollRef.current = false
    setShowScrollToBottom(true)
  }

  /** Marks the current frame as containing deliberate upward scrolling. */
  function markUpwardScrollIntent(): void {
    upwardScrollIntentRef.current = true
    requestAnimationFrame(() => {
      upwardScrollIntentRef.current = false
    })
  }

  function handleConversationWheel(event: WheelEvent<HTMLDivElement>): void {
    if (event.deltaY < 0) markUpwardScrollIntent()
  }

  function handleConversationKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
      markUpwardScrollIntent()
  }

  /** Resumes automatic scrolling and returns to the bottom of the conversation. */
  function resumeAutoScroll(): void {
    autoScrollRef.current = true
    setShowScrollToBottom(false)
    const conversation = conversationRef.current
    if (!conversation) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth'
    conversation.scrollTo({ top: conversation.scrollHeight, behavior })
  }

  /** Advances to the next match, wrapping around the end of the list. */
  function goToNextMatch(): void {
    if (searchMatches.length === 0) return
    setSearchIndex((current) => (current + 1) % searchMatches.length)
  }

  /** Steps back to the previous match, wrapping around the start of the list. */
  function goToPreviousMatch(): void {
    if (searchMatches.length === 0) return
    setSearchIndex((current) => (current - 1 + searchMatches.length) % searchMatches.length)
  }

  /** Closes the bar and returns focus to the conversation. */
  function closeSearch(): void {
    setSearchOpen(false)
    conversationRef.current?.focus()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSearch()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) goToPreviousMatch()
      else goToNextMatch()
    }
  }

  return (
    <section
      aria-live='polite'
      className='conversation'
      onKeyDown={handleConversationKeyDown}
      onPointerMove={(event) => {
        if (event.buttons > 0) markUpwardScrollIntent()
      }}
      onScroll={handleConversationScroll}
      onTouchMove={markUpwardScrollIntent}
      onWheel={handleConversationWheel}
      ref={conversationRef}
      tabIndex={0}
    >
      {searchOpen && (
        <div className='conversation-search'>
          <input
            aria-label='Search conversation'
            className='conversation-search-input'
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder='Search conversation'
            ref={searchInputRef}
            type='search'
            value={searchQuery}
          />
          <span className='conversation-search-count' role='status'>
            {searchMatches.length > 0 ? `${searchIndex + 1}/${searchMatches.length}` : '0/0'}
          </span>
          <button
            aria-label='Previous match'
            className='conversation-search-nav'
            disabled={searchMatches.length === 0}
            onClick={goToPreviousMatch}
            type='button'
          >
            ↑
          </button>
          <button
            aria-label='Next match'
            className='conversation-search-nav'
            disabled={searchMatches.length === 0}
            onClick={goToNextMatch}
            type='button'
          >
            ↓
          </button>
          <button
            aria-label='Close search'
            className='conversation-search-close'
            onClick={closeSearch}
            type='button'
          >
            ×
          </button>
        </div>
      )}
      <div className='conversation-content' ref={conversationContentRef}>
        {renderedMessageEntries.map((entry) => {
          const { message } = entry
          if (entry.source === 'history') {
            const index = entry.historyIndex
            const entryId = allMessages[index]?.entryId
            const searchKey = entryId ?? `history:${index}`
            const calls = showToolCalls ? toolCallsInMessage(message) : []
            const usage = usagesByMessage.get(index)
            if (!isVisibleConversationMessage(message) && calls.length === 0) return null
            return (
              <div
                className={highlightedTarget === `message:${index}`
                    || highlightedSearchKey === searchKey
                  ? 'conversation-target'
                  : undefined}
                data-message-index={index}
                key={entry.key}
              >
                {isVisibleConversationMessage(message) && (
                  <MessageCard
                    entryId={entryId}
                    forkAvailable={forkAvailable}
                    historyIndex={index}
                    message={message}
                    onError={onError}
                    onForkMessage={onForkMessage}
                  />
                )}
                {calls.map((call) => {
                  const execution = executionsByCallId.get(call.id)
                  const result = resultsByCallId.get(call.id) ?? execution?.result
                  return (
                    <ToolCallCard
                      args={call.args}
                      hasResult={result !== undefined}
                      semiDetailed={semiDetailed}
                      id={call.id}
                      interrupted={execution?.status === 'interrupted'}
                      key={call.id}
                      name={call.name}
                      onError={onError}
                      partialResultContent={execution?.partialResult?.content}
                      repositoryRoot={repositoryRoot}
                      resultContent={result?.content}
                      workingDirectory={workingDirectory}
                      resultDetails={result?.details}
                      resultError={result?.isError}
                      streaming={execution?.status === 'generating'}
                      targeted={highlightedTarget === `tool:${call.id}`}
                    />
                  )
                })}
                {usage && <TurnUsage turnNumber={turnNumbers.get(index)} usage={usage} />}
              </div>
            )
          }

          const parts = assistantTurnParts(message)
          const calls = showToolCalls
            ? parts.flatMap((part) => part.kind === 'tool' ? [part.call] : [])
            : []
          if (!isVisibleConversationMessage(message) && calls.length === 0) return null
          return (
            <div className='conversation-entry' key={entry.key}>
              {parts.map((part) => {
                if (part.kind === 'message')
                  return isVisibleConversationMessage(part.message)
                    ? (
                      <MessageCard
                        key='message'
                        message={part.message}
                        onError={onError}
                      />
                    )
                    : null
                if (!showToolCalls) return null
                const execution = executionsByCallId.get(part.call.id)
                const result = execution?.result
                return (
                  <ToolCallCard
                    animateLiveChanges
                    args={part.call.args}
                    hasResult={result !== undefined}
                    semiDetailed={semiDetailed}
                    id={part.call.id}
                    interrupted={execution?.status === 'interrupted'}
                    key={part.call.id}
                    name={part
                      .call
                      .name}
                    onError={onError}
                    partialResultContent={execution?.partialResult?.content}
                    repositoryRoot={repositoryRoot}
                    resultContent={result?.content}
                    workingDirectory={workingDirectory}
                    resultDetails={result?.details}
                    resultError={result?.isError}
                    streaming={execution?.status === 'generating'}
                    targeted={highlightedTarget === `tool:${part.call.id}`}
                  />
                )
              })}
            </div>
          )
        })}
        {showToolCalls && toolExecutions
          .filter((execution) =>
            !toolCallIds.has(execution.id) && !liveToolCallIds.has(execution.id)
          )
          .map((execution) => (
            <ToolCallCard
              animateLiveChanges
              args={execution.args}
              hasResult={execution.result !== undefined}
              semiDetailed={semiDetailed}
              id={execution.id}
              interrupted={execution.status === 'interrupted'}
              key={execution.id}
              name={execution.name}
              onError={onError}
              partialResultContent={execution.partialResult?.content}
              repositoryRoot={repositoryRoot}
              resultContent={execution.result?.content}
              workingDirectory={workingDirectory}
              resultDetails={execution.result?.details}
              resultError={execution.result?.isError}
              streaming={execution.status === 'generating'}
              targeted={highlightedTarget === `tool:${execution.id}`}
            />
          ))}
        {pendingSteering.map((message, index) => (
          <article
            className='message user pending-steering conversation-entry'
            key={`${message}-${index}`}
          >
            <div className='content'>
              <Markdown>{message || 'Image attached'}</Markdown>
            </div>
            <span className='pending-steering-status' role='status'>
              <i aria-hidden='true' />Waiting to steer…
            </span>
          </article>
        ))}
        {visibleMessages.length === 0 && visibleLiveMessages.length === 0 && pendingSteering
              .length === 0
          && (
            <div className='empty-conversation'>
              <span aria-hidden='true' className='brand-mark large'>π</span>
              <h2>Session ready</h2>
              <p>Send a message or use a command from your Pi installation.</p>
            </div>
          )}
        {activity && (
          <div className='conversation-activity'>
            <ActivityIndicator activity={activity} agentName={agentName} />
          </div>
        )}
      </div>
      <button
        aria-label='Resume automatic scrolling'
        className={`scroll-to-bottom${showScrollToBottom ? ' visible' : ''}`}
        onClick={resumeAutoScroll}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 16 16' width='16' height='16'>
          <path
            d='m4 6 4 4 4-4'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
        </svg>
      </button>
    </section>
  )
}

export { ActivityIndicator } from './ActivityIndicator.tsx'

function navigationTargetKey(target: SessionAnalysisTarget): string {
  return target.kind === 'tool' ? `tool:${target.id}` : `message:${target.index}`
}

/** Resolves a search match to a rendered element, landing on the nearest message when absent. */
function findSearchTarget(conversation: HTMLElement, match: SearchMatch): HTMLElement | null {
  if (match.entryId) {
    const byEntry = conversation.querySelector<HTMLElement>(
      `[data-entry-id="${CSS.escape(match.entryId)}"]`,
    )
    if (byEntry) return byEntry
  }
  const byHistory = conversation.querySelector<HTMLElement>(
    `[data-history-index="${match.index}"]`,
  )
  if (byHistory) return byHistory
  // toolResult and hidden matches have no card of their own; land on the closest rendered one.
  let nearest: HTMLElement | null = null
  let nearestDistance = Infinity
  for (const element of conversation.querySelectorAll<HTMLElement>('[data-message-index]')) {
    const candidate = Number(element.dataset.messageIndex)
    const distance = Math.abs(candidate - match.index)
    if (distance < nearestDistance) {
      nearest = element
      nearestDistance = distance
    }
  }
  return nearest
}
