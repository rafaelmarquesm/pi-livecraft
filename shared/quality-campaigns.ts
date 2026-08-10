export type QualityCampaignInvalidReasonCode =
  | 'model_mismatch'
  | 'thinking_mismatch'
  | 'provider_mismatch'
  | 'auth_failure'
  | 'quota_failure'
  | 'rate_limited'
  | 'network_failure'
  | 'output_truncated'
  | 'workspace_dirty'
  | 'outside_workspace_mutation'
  | 'settle_missing'
  | 'grader_missing'
  | 'grader_parse_failure'
  | 'artifact_incomplete'
  | 'settings_drift'

export type QualityCampaignArm =
  | 'pi-direct'
  | 'livecraft-standard'
  | 'livecraft-validated'
  | `git:${string}`

export interface QualityCampaignListResponse {
  campaigns: QualityCampaignListItem[]
}

export interface QualityCampaignListItem {
  id: string
  generatedAt: string
  arms: QualityCampaignArm[]
  totalTrials: number
  validTrials: number
  invalidTrials: number
  smallSample: boolean
}

export interface QualityCampaignDetailResponse {
  id: string
  generatedAt: string
  provenance: QualityCampaignProvenance
  arms: QualityCampaignArmDetail[]
  pairedDeltas: QualityCampaignPairedDelta[]
  progress: QualityCampaignProgressSeries[]
  invalidReasons: Record<QualityCampaignInvalidReasonCode, number>
  winner: { arm: QualityCampaignArm; reason: string } | null
  winnerSuppressedReasons: string[]
  rawTrials: QualityCampaignRawTrial[]
}

export interface QualityCampaignProvenance {
  manifestFingerprint: string
  livecraftRevision: string | null
  piVersion: string | null
  piExecutableSha256: string | null
  environment: { node: string; os: string; arch: string } | null
  requested: { provider: string; model: string; thinking: string } | null
  observed: { provider: string; model: string; thinking: string } | null
  campaignUpdatedAt: string | null
}

export interface QualityCampaignArmDetail {
  arm: QualityCampaignArm
  totalTrials: number
  validTrials: number
  invalidTrials: number
  successes: number
  passAt1: number | null
  passAtK: number | null
  wilson: { lower: number; upper: number; center: number } | null
  costUsd: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  durationMs: number
  costPerSuccess: number | null
  timeToFirstPassMs: number | null
  score: {
    mean: number | null
    median: number | null
    sampleSd: number
    bootstrapMeanCi: { lower: number; upper: number; confidence: number; iterations: number } | null
  }
  invalidReasons: Record<string, number>
  rawTrialIds: string[]
}

export interface QualityCampaignPairedDelta {
  taskId: string
  seed: string
  leftArm: QualityCampaignArm
  rightArm: QualityCampaignArm
  left: number
  right: number
  delta: number
}

export interface QualityCampaignProgressSeries {
  arm: QualityCampaignArm
  points: Array<{ elapsedMs: number; bestScore: number | null; bestPassed: boolean }>
}

export interface QualityCampaignRawTrial {
  id: string
  arm: QualityCampaignArm
  taskId: string
  seed: string
  attempt: number
  valid: boolean
  invalidReasons: QualityCampaignInvalidReasonCode[]
  passed: boolean
  score: number | null
  costUsd: number
  durationMs: number
}
