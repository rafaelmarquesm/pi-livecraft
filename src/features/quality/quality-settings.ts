import type { ValidatedWorkMode } from '../../../shared/validated-work.ts'
import { VALIDATED_WORK_MODES } from '../../../shared/validated-work.ts'
import { qualityAcknowledgementKey } from './quality-state.ts'

export type QualityReviewerThinking = 'low' | 'medium' | 'high' | 'max'

export interface QualitySettings {
  defaultMode: ValidatedWorkMode
  maxFollowups: number
  attributedBudgetUsd: number
  autoReview: boolean
  reviewerModel: string
  reviewerThinking: QualityReviewerThinking
  autoSendFindings: boolean
  retainReports: boolean
}

export interface QualitySettingsStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

export const defaultQualitySettings: QualitySettings = {
  defaultMode: 'standard',
  maxFollowups: 2,
  attributedBudgetUsd: 1,
  autoReview: false,
  reviewerModel: 'inherit',
  reviewerThinking: 'medium',
  autoSendFindings: false,
  retainReports: true,
}

export const qualitySettingsKeys = {
  acknowledged: qualityAcknowledgementKey,
  attributedBudgetUsd: 'pi-livecraft.quality.attributed-budget-usd',
  autoReview: 'pi-livecraft.quality.auto-review',
  autoSendFindings: 'pi-livecraft.quality.auto-send',
  defaultMode: 'pi-livecraft.quality.default-mode',
  maxFollowups: 'pi-livecraft.quality.max-followups',
  retainReports: 'pi-livecraft.quality.retain-reports',
  reviewerModel: 'pi-livecraft.quality.reviewer-model',
  reviewerThinking: 'pi-livecraft.quality.reviewer-thinking',
} as const

/** Reads quality preferences defensively so malformed localStorage cannot block startup. */
export function readQualitySettings(
  storage: Pick<QualitySettingsStorage, 'getItem'>,
): QualitySettings {
  return {
    attributedBudgetUsd: boundedNumber(
      storage.getItem(qualitySettingsKeys.attributedBudgetUsd),
      0,
      100,
      defaultQualitySettings.attributedBudgetUsd,
    ),
    autoReview: booleanValue(
      storage.getItem(qualitySettingsKeys.autoReview),
      defaultQualitySettings.autoReview,
    ),
    autoSendFindings: booleanValue(
      storage.getItem(qualitySettingsKeys.autoSendFindings),
      defaultQualitySettings.autoSendFindings,
    ),
    defaultMode: modeValue(storage.getItem(qualitySettingsKeys.defaultMode)),
    maxFollowups: boundedInteger(
      storage.getItem(qualitySettingsKeys.maxFollowups),
      0,
      5,
      defaultQualitySettings.maxFollowups,
    ),
    retainReports: booleanValue(
      storage.getItem(qualitySettingsKeys.retainReports),
      defaultQualitySettings.retainReports,
    ),
    reviewerModel: reviewerModelValue(storage.getItem(qualitySettingsKeys.reviewerModel)),
    reviewerThinking: thinkingValue(storage.getItem(qualitySettingsKeys.reviewerThinking)),
  }
}

export function writeQualitySettings(
  storage: Pick<QualitySettingsStorage, 'setItem'>,
  settings: QualitySettings,
): void {
  storage.setItem(qualitySettingsKeys.defaultMode, settings.defaultMode)
  storage.setItem(qualitySettingsKeys.maxFollowups, String(settings.maxFollowups))
  storage.setItem(qualitySettingsKeys.attributedBudgetUsd, String(settings.attributedBudgetUsd))
  storage.setItem(qualitySettingsKeys.autoReview, String(settings.autoReview))
  storage.setItem(qualitySettingsKeys.reviewerModel, settings.reviewerModel)
  storage.setItem(qualitySettingsKeys.reviewerThinking, settings.reviewerThinking)
  storage.setItem(qualitySettingsKeys.autoSendFindings, String(settings.autoSendFindings))
  storage.setItem(qualitySettingsKeys.retainReports, String(settings.retainReports))
}

export function resetQualityAcknowledgement(
  storage: Pick<QualitySettingsStorage, 'removeItem'>,
): void {
  storage.removeItem(qualitySettingsKeys.acknowledged)
}

function modeValue(value: string | null): ValidatedWorkMode {
  return value !== null && (VALIDATED_WORK_MODES as readonly string[]).includes(value)
    ? value as ValidatedWorkMode
    : defaultQualitySettings.defaultMode
}

function thinkingValue(value: string | null): QualityReviewerThinking {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : defaultQualitySettings.reviewerThinking
}

function reviewerModelValue(value: string | null): string {
  if (value === null) return defaultQualitySettings.reviewerModel
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 120 || containsControlCharacter(trimmed)) {
    return defaultQualitySettings.reviewerModel
  }
  return trimmed
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function boundedInteger(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function boundedNumber(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function booleanValue(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return fallback
}
