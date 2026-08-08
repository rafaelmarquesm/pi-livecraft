import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUDGET_STORAGE_KEY,
  budgetExceeded,
  readBudgetUsd,
  writeBudgetUsd,
  type BudgetStorage,
} from '../src/features/settings/budget.ts'

/** In-memory BudgetStorage substitute: the test seam for localStorage. */
function memoryStorage(initial: Record<string, string> = {}): BudgetStorage & {
  entries: Map<string, string>
} {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

test('budgetExceeded requires a positive finite budget', () => {
  assert.equal(budgetExceeded(5, null), false)
  assert.equal(budgetExceeded(5, 0), false)
  assert.equal(budgetExceeded(5, -1), false)
  assert.equal(budgetExceeded(5, Number.NaN), false)
  assert.equal(budgetExceeded(5, Number.POSITIVE_INFINITY), false)
})

test('budgetExceeded never blocks without a comparable cost', () => {
  assert.equal(budgetExceeded(undefined, 5), false)
  // A NaN cost compares false against any budget.
  assert.equal(budgetExceeded(Number.NaN, 5), false)
})

test('budgetExceeded blocks at or above the ceiling, not below', () => {
  assert.equal(budgetExceeded(4.99, 5), false)
  assert.equal(budgetExceeded(5, 5), true)
  assert.equal(budgetExceeded(5.01, 5), true)
})

test('readBudgetUsd returns null without storage', () => {
  assert.equal(readBudgetUsd(null), null)
})

test('readBudgetUsd round-trips persisted values and clears on null', () => {
  const storage = memoryStorage()
  assert.equal(readBudgetUsd(storage), null)
  writeBudgetUsd(12.5, storage)
  assert.equal(readBudgetUsd(storage), 12.5)
  writeBudgetUsd(null, storage)
  assert.equal(readBudgetUsd(storage), null)
  assert.equal(storage.entries.has(BUDGET_STORAGE_KEY), false)
})

test('readBudgetUsd treats malformed or non-positive stored values as null', () => {
  assert.equal(readBudgetUsd(memoryStorage({ [BUDGET_STORAGE_KEY]: 'not-a-number' })), null)
  assert.equal(readBudgetUsd(memoryStorage({ [BUDGET_STORAGE_KEY]: '' })), null)
  assert.equal(readBudgetUsd(memoryStorage({ [BUDGET_STORAGE_KEY]: '0' })), null)
  assert.equal(readBudgetUsd(memoryStorage({ [BUDGET_STORAGE_KEY]: '-3' })), null)
})

test('readBudgetUsd tolerates a throwing storage', () => {
  const throwing: BudgetStorage = {
    getItem: () => {
      throw new Error('quota exceeded')
    },
    setItem: () => {
      throw new Error('quota exceeded')
    },
    removeItem: () => {
      throw new Error('quota exceeded')
    },
  }
  assert.equal(readBudgetUsd(throwing), null)
  assert.doesNotThrow(() => writeBudgetUsd(5, throwing))
})
