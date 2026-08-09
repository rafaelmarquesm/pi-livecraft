export const rightWidgetDefinitions = [
  { id: 'analysis', label: 'Session analysis' },
  { id: 'git', label: 'Git' },
  { id: 'quotas', label: 'Quotas' },
  { id: 'usage', label: 'Usage' },
  { id: 'todo', label: 'Todo' },
] as const

export type RightWidget = typeof rightWidgetDefinitions[number]['id']

export interface RightWidgetAvailability {
  analysis: boolean
  git: boolean
}

export function isRightWidget(value: string | null): value is RightWidget {
  return rightWidgetDefinitions.some(({ id }) => id === value)
}

/**
 * Decides whether the grid must allocate panel width for the active widget.
 * Keep this switch exhaustive: adding a widget to the registry without a
 * layout policy must fail typecheck instead of mounting it inside the 48 px rail.
 */
export function isRightPanelVisible(
  widget: RightWidget | null,
  availability: RightWidgetAvailability,
): boolean {
  switch (widget) {
    case null:
      return false
    case 'analysis':
      return availability.analysis
    case 'git':
      return availability.git
    case 'quotas':
    case 'usage':
    case 'todo':
      return true
    default:
      return assertNever(widget)
  }
}

export const defaultRightSidebarWidth = 300
export const minRightSidebarWidth = 240
export const maxRightSidebarWidth = 720

export function clampRightSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultRightSidebarWidth
  return Math.min(maxRightSidebarWidth, Math.max(minRightSidebarWidth, Math.round(width)))
}

export function readRightSidebarWidth(value: string | null): number {
  return value === null ? defaultRightSidebarWidth : clampRightSidebarWidth(Number(value))
}

function assertNever(value: never): never {
  throw new Error(`Unhandled right sidebar widget: ${String(value)}`)
}
