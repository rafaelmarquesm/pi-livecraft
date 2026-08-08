import type { NotificationDecision } from './notification-decider.ts'

/** The settle reasons a native notification can report. */
export type NotificationReason = NotificationDecision['reason']

/** Browser permission states; declared locally so the module stays DOM-free. */
export type NotificationPermissionState = 'granted' | 'denied' | 'default'

/** The subset of the browser Notification API the notifier depends on. */
export interface NativeNotificationApi {
  readonly permission: NotificationPermissionState
  requestPermission(): Promise<NotificationPermissionState>
  show(title: string, options: NativeNotificationOptions): void
}

export interface NativeNotificationOptions {
  body: string
  /** Groups notifications per session: a new decision replaces the previous one. */
  tag: string
  /** Attached by the browser adapter; the app uses it to focus and select the session. */
  onClick?: () => void
}

export interface NativeNotificationRequest {
  sessionName: string
  reason: NotificationReason
  sessionId: string
  onClick?: () => void
}

export type ShowNativeNotification = (request: NativeNotificationRequest) => boolean

/** Returns true when the injected Notification API is usable. */
export function notificationSupported(
  api: NativeNotificationApi | null,
): api is NativeNotificationApi {
  return api !== null
}

/** Title shown in the native notification; the Livecraft brand stays visible. */
export function notificationTitle(sessionName: string): string {
  return `Livecraft — ${sessionName}`
}

/** Body text for a settle decision. */
export function notificationBody(reason: NotificationReason): string {
  return reason === 'settled' ? 'Agent run finished' : 'Agent run failed after retries'
}

/** The browser Notification constructor surface the adapter uses. */
type NotificationConstructor = {
  permission: NotificationPermissionState
  requestPermission(): Promise<NotificationPermissionState>
  new(
    title: string,
    options: { body: string; tag: string },
  ): { onclick: ((ev: unknown) => void) | null; close(): void }
}

/** Wraps the browser Notification API, or returns null when unsupported. */
export function nativeNotificationApi(): NativeNotificationApi | null {
  const constructor = (globalThis as { Notification?: unknown }).Notification
  if (typeof constructor !== 'function' || !('permission' in constructor)) return null
  const NotificationCtor = constructor as NotificationConstructor
  return {
    permission: NotificationCtor.permission,
    requestPermission: () => NotificationCtor.requestPermission(),
    show: (title, options) => {
      const notification = new NotificationCtor(title, { body: options.body, tag: options.tag })
      if (options.onClick !== undefined) {
        notification.onclick = () => {
          notification.close()
          options.onClick?.()
        }
      }
    },
  }
}

/**
 * Builds the app's show function. Returns false (and shows nothing) when
 * notifications are unsupported, the tab is visible, or permission is denied;
 * returns true when a notification was shown or a permission request was
 * initiated. Permission is requested lazily: a 'default' decision requests
 * once and shows only if the request resolves to 'granted' while still hidden.
 */
export function createNativeNotifier(
  api: NativeNotificationApi | null,
  isHidden: () => boolean = () => false,
): ShowNativeNotification {
  return (request) => {
    if (!notificationSupported(api) || !isHidden()) return false
    if (api.permission === 'denied') return false
    const show = () => {
      api.show(notificationTitle(request.sessionName), {
        body: notificationBody(request.reason),
        tag: request.sessionId,
        onClick: request.onClick,
      })
    }
    if (api.permission === 'granted') {
      show()
      return true
    }
    void api.requestPermission().then((next) => {
      if (next === 'granted' && isHidden()) show()
    })
    return true
  }
}
