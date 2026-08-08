/** localStorage key holding the per-session budget ceiling in USD (Fase 4.3). */
export const BUDGET_STORAGE_KEY = 'pi-livecraft.budget-usd'

/** Minimal storage surface the budget helpers depend on (localStorage-compatible). */
export interface BudgetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Returns the browser localStorage when available, else null (SSR/test-safe). */
export function defaultBudgetStorage(): BudgetStorage | null {
  try {
    return (globalThis as typeof globalThis & { localStorage?: BudgetStorage }).localStorage ?? null
  } catch {
    return null
  }
}

/**
 * True when the session cost has reached the configured budget ceiling:
 * a positive finite budget AND a numeric cost at or above it. Missing or
 * malformed inputs never block a send.
 */
export function budgetExceeded(cost: number | undefined, budgetUsd: number | null): boolean {
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return false
  if (typeof cost !== 'number') return false
  return cost >= budgetUsd
}

/** Reads the persisted budget ceiling; missing or malformed values yield null. */
export function readBudgetUsd(
  storage: BudgetStorage | null = defaultBudgetStorage(),
): number | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(BUDGET_STORAGE_KEY)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** Persists the budget ceiling; null clears it. Unavailable storage is ignored. */
export function writeBudgetUsd(
  value: number | null,
  storage: BudgetStorage | null = defaultBudgetStorage(),
): void {
  if (!storage) return
  try {
    if (value === null) storage.removeItem(BUDGET_STORAGE_KEY)
    else storage.setItem(BUDGET_STORAGE_KEY, String(value))
  } catch {
    // Storage can be unavailable in private browsing; the in-memory value still works.
  }
}
