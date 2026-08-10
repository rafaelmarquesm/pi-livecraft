import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CODE_REVIEW_FINDING_STATUSES,
  parseCodeReviewReportV1,
  type CodeReviewFindingStatus,
  type CodeReviewReportV1,
} from '../../../shared/code-review.ts'
import { isObject } from '../../../shared/is-object.ts'

export type CodeReviewRunStatus =
  | 'never_run'
  | 'queued'
  | 'running'
  | 'complete'
  | 'stale'
  | 'failed'

export interface CodeReviewDecision {
  reviewId: string
  findingId: string
  status: Extract<CodeReviewFindingStatus, 'confirmed' | 'dismissed' | 'sent_to_agent' | 'resolved'>
  reason?: string
  createdAt: number
}

export interface StoredCodeReviewReport extends CodeReviewReportV1 {
  decisions: CodeReviewDecision[]
}

export interface CodeReviewStoreSnapshot {
  revision: number
  status: CodeReviewRunStatus
  activeReviewId?: string
  reports: StoredCodeReviewReport[]
  lastError?: string
}

type ReviewStoreEvent =
  | { type: 'report'; report: CodeReviewReportV1; createdAt: number }
  | { type: 'decision'; decision: CodeReviewDecision }
  | {
    type: 'status'
    status: CodeReviewRunStatus
    reviewId?: string
    error?: string
    createdAt: number
  }

export class CodeReviewStore {
  private readonly root: string
  private writes = new Map<string, Promise<unknown>>()

  constructor(root = join(homedir(), '.pi-livecraft', 'reviews')) {
    this.root = root
  }

  sessionKey(sessionIdentity: string): string {
    return createHash('sha256').update(sessionIdentity).digest('hex')
  }

  async load(key: string): Promise<CodeReviewStoreSnapshot> {
    const events = await this.readEvents(key)
    return snapshotFromEvents(events)
  }

  async appendStatus(
    key: string,
    status: CodeReviewRunStatus,
    options: { reviewId?: string; error?: string } = {},
  ): Promise<CodeReviewStoreSnapshot> {
    return await this.enqueue(key, async () => {
      const events = await this.readEvents(key)
      events.push({
        type: 'status',
        status,
        ...(options.reviewId ? { reviewId: options.reviewId } : {}),
        ...(options.error ? { error: options.error.slice(0, 1_000) } : {}),
        createdAt: Date.now(),
      })
      await this.writeEvents(key, events)
      return snapshotFromEvents(events)
    })
  }

  async appendReport(key: string, report: CodeReviewReportV1): Promise<CodeReviewStoreSnapshot> {
    return await this.enqueue(key, async () => {
      const events = await this.readEvents(key)
      const duplicate = snapshotFromEvents(events).reports.some((candidate) =>
        candidate.diffHash === report.diffHash && candidate.model === report.model
        && candidate.provider === report.provider && candidate.thinking === report.thinking
      )
      if (!duplicate) events.push({ type: 'report', report, createdAt: Date.now() })
      events.push({
        type: 'status',
        status: 'complete',
        reviewId: report.id,
        createdAt: Date.now(),
      })
      await this.writeEvents(key, events)
      return snapshotFromEvents(events)
    })
  }

  async appendDecision(
    key: string,
    decision: CodeReviewDecision,
  ): Promise<CodeReviewStoreSnapshot> {
    return await this.enqueue(key, async () => {
      const events = await this.readEvents(key)
      events.push({ type: 'decision', decision })
      await this.writeEvents(key, events)
      return snapshotFromEvents(events)
    })
  }

  async hasDuplicate(
    key: string,
    diffHash: string,
    model: { provider: string; modelId: string },
    thinking: string,
  ): Promise<boolean> {
    const snapshot = await this.load(key)
    return snapshot.status === 'running' || snapshot.status === 'queued'
      || snapshot.reports.some((report) =>
        report.diffHash === diffHash && report.provider === model.provider
        && report.model === model.modelId && report.thinking === thinking
      )
  }

  private async enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    this.writes.set(
      key,
      next.finally(() => {
        if (this.writes.get(key) === next) this.writes.delete(key)
      }),
    )
    return await next
  }

  private async readEvents(key: string): Promise<ReviewStoreEvent[]> {
    let content = ''
    try {
      content = await readFile(this.pathFor(key), 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }
    const events: ReviewStoreEvent[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed: unknown = JSON.parse(line)
        const event = parseStoreEvent(parsed)
        if (event) events.push(event)
      } catch {
        break
      }
    }
    return events
  }

  private async writeEvents(key: string, events: readonly ReviewStoreEvent[]): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    const content = events.map((event) => JSON.stringify(event)).join('\n')
      + (events.length ? '\n' : '')
    await writeFile(tmp, content, { mode: 0o600 })
    await rename(tmp, path)
  }

  private pathFor(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid review store key')
    return join(this.root, `${key}.jsonl`)
  }
}

function snapshotFromEvents(events: readonly ReviewStoreEvent[]): CodeReviewStoreSnapshot {
  const reports = new Map<string, StoredCodeReviewReport>()
  let status: CodeReviewRunStatus = 'never_run'
  let activeReviewId: string | undefined
  let lastError: string | undefined
  for (const event of events) {
    if (event.type === 'report') {
      reports.set(event.report.id, { ...event.report, decisions: [] })
      status = 'complete'
      activeReviewId = event.report.id
      lastError = undefined
    } else if (event.type === 'decision') {
      const report = reports.get(event.decision.reviewId)
      if (!report) continue
      report.decisions.push(event.decision)
      const finding = report.findings.find((candidate) => candidate.id === event.decision.findingId)
      if (!finding) continue
      finding.status = event.decision.status
      if (event.decision.status === 'dismissed') finding.dismissalReason = event.decision.reason
    } else {
      status = event.status
      activeReviewId = event.reviewId
      lastError = event.error
    }
  }
  return {
    revision: events.length,
    status,
    ...(activeReviewId ? { activeReviewId } : {}),
    reports: [...reports.values()].sort((left, right) => right.completedAt - left.completedAt),
    ...(lastError ? { lastError } : {}),
  }
}

function parseStoreEvent(value: unknown): ReviewStoreEvent | undefined {
  if (!isObject(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'report') {
    return {
      type: 'report',
      report: parseCodeReviewReportV1(value.report),
      createdAt: numberOrNow(value.createdAt),
    }
  }
  if (value.type === 'status' && isStatus(value.status)) {
    return {
      type: 'status',
      status: value.status,
      ...(typeof value.reviewId === 'string' ? { reviewId: value.reviewId } : {}),
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      createdAt: numberOrNow(value.createdAt),
    }
  }
  if (value.type === 'decision' && isObject(value.decision)) {
    const decision = value.decision
    if (
      typeof decision.reviewId !== 'string' || typeof decision.findingId !== 'string'
      || !isDecisionStatus(decision.status)
    ) return undefined
    return {
      type: 'decision',
      decision: {
        reviewId: decision.reviewId,
        findingId: decision.findingId,
        status: decision.status,
        ...(typeof decision.reason === 'string' ? { reason: decision.reason.slice(0, 2_000) } : {}),
        createdAt: numberOrNow(decision.createdAt),
      },
    }
  }
  return undefined
}

function isStatus(value: unknown): value is CodeReviewRunStatus {
  return value === 'never_run' || value === 'queued' || value === 'running' || value === 'complete'
    || value === 'stale' || value === 'failed'
}

function isDecisionStatus(value: unknown): value is CodeReviewDecision['status'] {
  return CODE_REVIEW_FINDING_STATUSES.includes(value as CodeReviewFindingStatus)
    && value !== 'open'
}

function numberOrNow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Date.now()
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
