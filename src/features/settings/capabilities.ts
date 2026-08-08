import type { PiCapabilities } from '../../../shared/types.ts'

/** Capability name and whether the connected Pi session exposes it. */
export type CapabilityEntry = [name: string, available: boolean]

/**
 * Flattens the session capabilities into sorted [name, available] pairs so the
 * About section can render them as chips. Sorted alphabetically for a stable order.
 */
export function capabilityEntries(capabilities: PiCapabilities | null): CapabilityEntry[] {
  if (!capabilities) return []
  return Object
    .entries(capabilities.commands ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
}
