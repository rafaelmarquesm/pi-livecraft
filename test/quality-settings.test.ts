import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultQualitySettings,
  qualitySettingsKeys,
  readQualitySettings,
  resetQualityAcknowledgement,
  writeQualitySettings,
  type QualitySettingsStorage,
} from '../src/features/quality/quality-settings.ts'

function storage(
  seed: Record<string, string> = {},
): QualitySettingsStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(seed))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

test('quality settings parser returns safe defaults for missing and malformed values', () => {
  const parsed = readQualitySettings(storage({
    [qualitySettingsKeys.attributedBudgetUsd]: '101',
    [qualitySettingsKeys.autoReview]: 'maybe',
    [qualitySettingsKeys.autoSendFindings]: 'definitely',
    [qualitySettingsKeys.defaultMode]: 'turbo',
    [qualitySettingsKeys.maxFollowups]: '6',
    [qualitySettingsKeys.retainReports]: '???',
    [qualitySettingsKeys.reviewerModel]: '   ',
    [qualitySettingsKeys.reviewerThinking]: 'extreme',
  }))

  assert.deepEqual(parsed, defaultQualitySettings)
})

test('quality settings parser accepts documented bounds and legacy boolean spellings', () => {
  const parsed = readQualitySettings(storage({
    [qualitySettingsKeys.attributedBudgetUsd]: '0',
    [qualitySettingsKeys.autoReview]: 'yes',
    [qualitySettingsKeys.autoSendFindings]: 'on',
    [qualitySettingsKeys.defaultMode]: 'validated',
    [qualitySettingsKeys.maxFollowups]: '5',
    [qualitySettingsKeys.retainReports]: 'no',
    [qualitySettingsKeys.reviewerModel]: 'anthropic/claude-sonnet-4-20250514',
    [qualitySettingsKeys.reviewerThinking]: 'high',
  }))

  assert.deepEqual(parsed, {
    attributedBudgetUsd: 0,
    autoReview: true,
    autoSendFindings: true,
    defaultMode: 'validated',
    maxFollowups: 5,
    retainReports: false,
    reviewerModel: 'anthropic/claude-sonnet-4-20250514',
    reviewerThinking: 'high',
  })
})

test('quality settings persistence uses pi-livecraft.quality keys and resets acknowledgement only', () => {
  const store = storage({ [qualitySettingsKeys.acknowledged]: 'yes' })
  writeQualitySettings(store, {
    attributedBudgetUsd: 12.5,
    autoReview: true,
    autoSendFindings: false,
    defaultMode: 'plan',
    maxFollowups: 3,
    retainReports: true,
    reviewerModel: 'inherit',
    reviewerThinking: 'max',
  })
  resetQualityAcknowledgement(store)

  assert.equal(store.values.get(qualitySettingsKeys.defaultMode), 'plan')
  assert.equal(store.values.get(qualitySettingsKeys.maxFollowups), '3')
  assert.equal(store.values.get(qualitySettingsKeys.attributedBudgetUsd), '12.5')
  assert.equal(store.values.get(qualitySettingsKeys.acknowledged), undefined)
  for (const key of store.values.keys()) assert.match(key, /^pi-livecraft\.quality\./u)
})
