import { Component, useMemo, type ReactNode } from 'react'
import type { ExtensionWidget, ExtensionWidgetPlacement } from '../../../shared/extension-ui.ts'

/** Renders null when a widget throws so one bad widget cannot take down the composer area. */
class WidgetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Renders the widgets of one placement in map (DOM) order, each wrapped in its
 * own error boundary. Renders nothing when the placement has no widgets.
 */
export function ExtensionWidgetHost({ widgets, placement }: {
  widgets: ReadonlyMap<string, ExtensionWidget>
  placement: ExtensionWidgetPlacement
}) {
  const visible = useMemo(
    () => [...widgets.entries()].filter(([, widget]) => widget.placement === placement),
    [placement, widgets],
  )
  if (visible.length === 0) return null
  return (
    <div className='extension-widgets' data-placement={placement}>
      {visible.map(([key, widget]) => (
        <WidgetErrorBoundary key={key}>
          <pre className='extension-widget'>{widget.lines.join('\n')}</pre>
        </WidgetErrorBoundary>
      ))}
    </div>
  )
}
