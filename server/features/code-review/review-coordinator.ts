import type { CodeReviewReportV1 } from '../../../shared/code-review.ts'
import type { ValidatedWorkDetailsResponse } from '../../../shared/validated-work.ts'
import { buildCodeReviewPacket, type CodeReviewPacket } from './packet-builder.ts'
import { reportFromReviewerOutput, type ReviewerRunResult } from './review-output.ts'
import {
  CodeReviewStore,
  type CodeReviewDecision,
  type CodeReviewRunStatus,
  type CodeReviewStoreSnapshot,
} from './review-store.ts'

export interface CodeReviewRunOptions {
  mode: 'manual' | 'automatic'
  model: { provider: string; modelId: string }
  thinkingLevel: string
}

export interface CodeReviewSessionContext {
  sessionId: string
  sessionIdentity: string
  cwd: string
  details: ValidatedWorkDetailsResponse
  baseline?: { baseSha?: string | null; currentSha?: string | null; dirty?: boolean } | null
}

export interface CodeReviewManager {
  runReview(request: {
    sessionId: string
    packet: CodeReviewPacket
    model: { provider: string; modelId: string }
    thinkingLevel: string
  }): Promise<ReviewerRunResult>
  sendSummary(sessionId: string, summary: unknown): Promise<void>
  sendPrompt(sessionId: string, message: string): Promise<void>
}

export interface CodeReviewDetailsResponse {
  revision: number
  status: CodeReviewRunStatus
  activeReviewId?: string
  reports: CodeReviewReportV1[]
  lastError?: string
}

export class CodeReviewCoordinator {
  private readonly store: CodeReviewStore
  private readonly manager: CodeReviewManager
  private readonly onUpdate: (sessionId: string, revision: number) => void
  private readonly runningSessions = new Set<string>()
  private runningGlobal = 0
  private readonly globalLimit = 2

  constructor(options: {
    store?: CodeReviewStore
    manager: CodeReviewManager
    onUpdate: (sessionId: string, revision: number) => void
  }) {
    this.store = options.store ?? new CodeReviewStore()
    this.manager = options.manager
    this.onUpdate = options.onUpdate
  }

  key(context: { sessionIdentity: string }): string {
    return this.store.sessionKey(context.sessionIdentity)
  }

  async load(context: { sessionIdentity: string }): Promise<CodeReviewDetailsResponse> {
    return detailsFromSnapshot(await this.store.load(this.key(context)))
  }

  async estimate(
    context: CodeReviewSessionContext,
  ): Promise<{ estimatedInputTokens: number; diffHash: string }> {
    const packet = await buildCodeReviewPacket(context)
    return { estimatedInputTokens: packet.estimatedInputTokens, diffHash: packet.diffHash }
  }

  async runManual(
    context: CodeReviewSessionContext,
    options: CodeReviewRunOptions,
  ): Promise<CodeReviewDetailsResponse> {
    const snapshot = await this.enqueueRun(context, options)
    return detailsFromSnapshot(snapshot)
  }

  async updateFinding(
    context: { sessionId: string; sessionIdentity: string },
    reviewId: string,
    findingId: string,
    decision: { status: CodeReviewDecision['status']; reason?: string },
  ): Promise<CodeReviewDetailsResponse> {
    const key = this.key(context)
    const snapshot = await this.store.appendDecision(key, {
      reviewId,
      findingId,
      status: decision.status,
      ...(decision.reason ? { reason: decision.reason } : {}),
      createdAt: Date.now(),
    })
    await this.reconcileExtension(context.sessionId, snapshot)
    this.onUpdate(context.sessionId, snapshot.revision)
    return detailsFromSnapshot(snapshot)
  }

  async sendFindings(
    context: { sessionId: string; sessionIdentity: string },
    findingIds: string[],
  ): Promise<{ prompt: string; details: CodeReviewDetailsResponse }> {
    const snapshot = await this.store.load(this.key(context))
    const latest = snapshot.reports[0]
    if (!latest) throw new Error('No review findings are available to send.')
    const selected = latest.findings.filter((finding) => findingIds.includes(finding.id))
    if (selected.length === 0) throw new Error('Select at least one finding to send.')
    const prompt = [
      'Review these independent code review findings before making any correction. Verify each finding against the code and tests first.',
      ...selected.map((finding) =>
        [
          `- ${finding.id} ${finding.severity}/${finding.confidence}: ${finding.title}`,
          `  path: ${finding.path ?? 'n/a'}${finding.line ? `:${finding.line}` : ''}`,
          `  evidence: ${finding.evidence}`,
          `  recommendation: ${finding.recommendation}`,
        ]
          .join('\n')
      ),
    ]
      .join('\n')
    await this.manager.sendPrompt(context.sessionId, prompt)
    let next = snapshot
    for (const finding of selected) {
      next = await this.store.appendDecision(this.key(context), {
        reviewId: latest.id,
        findingId: finding.id,
        status: 'sent_to_agent',
        createdAt: Date.now(),
      })
    }
    await this.reconcileExtension(context.sessionId, next)
    this.onUpdate(context.sessionId, next.revision)
    return { prompt, details: detailsFromSnapshot(next) }
  }

  private async enqueueRun(
    context: CodeReviewSessionContext,
    options: CodeReviewRunOptions,
  ): Promise<CodeReviewStoreSnapshot> {
    if (this.runningSessions.has(context.sessionId))
      throw new Error('A review is already running for this session.')
    if (this.runningGlobal >= this.globalLimit) throw new Error('The global review queue is full.')
    const key = this.key(context)
    const packet = await buildCodeReviewPacket(context)
    if (await this.store.hasDuplicate(key, packet.diffHash, options.model, options.thinkingLevel)) {
      return await this.store.load(key)
    }
    this.runningSessions.add(context.sessionId)
    this.runningGlobal += 1
    let snapshot = await this.store.appendStatus(key, 'queued')
    this.onUpdate(context.sessionId, snapshot.revision)
    try {
      snapshot = await this.store.appendStatus(key, 'running')
      this.onUpdate(context.sessionId, snapshot.revision)
      const startedAt = Date.now()
      const result = await this.manager.runReview({
        sessionId: context.sessionId,
        packet,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
      })
      const cycleId = context.details.state?.cycleId ?? 'standard'
      const report = reportFromReviewerOutput(result, packet, cycleId, startedAt)
      snapshot = await this.store.appendReport(key, report)
      await this.reconcileExtension(context.sessionId, snapshot)
      this.onUpdate(context.sessionId, snapshot.revision)
      return snapshot
    } catch (error) {
      snapshot = await this.store.appendStatus(key, 'failed', { error: errorMessage(error) })
      this.onUpdate(context.sessionId, snapshot.revision)
      throw error
    } finally {
      this.runningSessions.delete(context.sessionId)
      this.runningGlobal -= 1
    }
  }

  private async reconcileExtension(
    sessionId: string,
    snapshot: CodeReviewStoreSnapshot,
  ): Promise<void> {
    const latest = snapshot.reports[0]
    if (!latest) return
    await this.manager.sendSummary(sessionId, {
      action: 'review_summary',
      review: {
        id: latest.id,
        diffHash: latest.diffHash,
        status: snapshot.status,
        confirmedP0P1: latest
          .findings
          .filter((finding) =>
            finding.status === 'confirmed'
            && (finding.severity === 'P0' || finding.severity === 'P1')
          )
          .map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title })),
      },
    })
  }
}

function detailsFromSnapshot(snapshot: CodeReviewStoreSnapshot): CodeReviewDetailsResponse {
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    ...(snapshot.activeReviewId ? { activeReviewId: snapshot.activeReviewId } : {}),
    reports: snapshot.reports,
    ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
