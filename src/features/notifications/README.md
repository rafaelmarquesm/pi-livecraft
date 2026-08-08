# Notifications

`ToastStack` renders transient application notices and errors. `App.tsx` owns notification state
because backend connectivity, sessions, commands, and multiple features all publish messages.
Features report failures through callbacks such as `onError`; they do not create a parallel global
notification store.

Each toast has a stable id, a `notice` or `error` kind, a message, and an optional session identity.
`App.tsx` filters visibility for the selected session and coordinates dismissal timing.
`ToastStack` owns only accessible rendering: notices use status semantics, errors use alert
semantics, and every item remains explicitly dismissible.

Session-run notifications follow a single policy: `NotificationDecider` converts a per-session Pi
event stream into `'settled'` and `'retry-exhausted'` decisions (wrapping `settleEventForSession`).
`App.tsx` owns one decider per session and renders each decision as a toast; the decider never
carries cross-session state.

## Native notifications

Native browser notifications are additive to toasts and fire only while the page is hidden or
unfocused, so the user is never notified twice for the same decision. `App.tsx` keeps one
`NotificationDecider` per session and, on a decision while hidden, calls the injectable notifier
from `native-notifications.ts` (pure helpers `notificationTitle`/`notificationBody`, plus
`createNativeNotifier(api, isHidden)` — the app injects the real `Notification` adapter and the
hidden-tab check; tests inject fakes).

Permission is requested lazily and only in response to a decision: nothing happens on mount. A
decision with `'granted'` shows immediately, `'default'` requests permission and shows only if the
request resolves to `'granted'` while the tab is still hidden, and `'denied'` stays silent. Because
browsers may require a user gesture before honoring a permission prompt, a request fired from a
hidden tab can be denied; users can enable notifications for the site in their browser settings.
Clicking a native notification focuses the window and selects the session.

Keep notification state and cross-feature policy in `App.tsx`. Keep presentation and colocated
styles in this directory.
