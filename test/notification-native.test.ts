import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNativeNotifier,
  nativeNotificationApi,
  notificationBody,
  notificationTitle,
  type NativeNotificationApi,
  type NativeNotificationOptions,
  type NotificationPermissionState,
} from '../src/features/notifications/native-notifications.ts'
import {
  defaultFaviconHref,
  documentTitleFor,
  faviconDataUrl,
  type FaviconCanvas,
} from '../src/features/notifications/tab-title.ts'

/** Records notification shows and permission requests for assertions. */
class FakeNotificationApi implements NativeNotificationApi {
  permission: NotificationPermissionState
  shown: Array<{ title: string; options: NativeNotificationOptions }> = []
  requested = 0
  /** Permission granted to the next requestPermission call. */
  nextPermission: NotificationPermissionState = 'granted'

  constructor(permission: NotificationPermissionState = 'granted') {
    this.permission = permission
  }

  requestPermission(): Promise<NotificationPermissionState> {
    this.requested += 1
    this.permission = this.nextPermission
    return Promise.resolve(this.nextPermission)
  }

  show(title: string, options: NativeNotificationOptions): void {
    this.shown.push({ title, options })
  }
}

function fakeCanvas(): FaviconCanvas {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      beginPath: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
    }),
    toDataURL: () => 'data:image/png;base64,ZmFrZQ==',
  }
}

test('notificationTitle keeps the Livecraft brand and the session name', () => {
  assert.equal(notificationTitle('Code review'), 'Livecraft — Code review')
})

test('notificationBody matches the decision reason', () => {
  assert.equal(notificationBody('settled'), 'Agent run finished')
  assert.equal(notificationBody('retry-exhausted'), 'Agent run failed after retries')
})

test('nativeNotificationApi returns null where the API is unsupported', () => {
  assert.equal(nativeNotificationApi(), null)
})

test('show returns false when notifications are unsupported', () => {
  const show = createNativeNotifier(null, () => true)
  assert.equal(show({ sessionName: 'Code review', reason: 'settled', sessionId: 's1' }), false)
})

test('show returns false while the tab is visible', () => {
  const api = new FakeNotificationApi('granted')
  const show = createNativeNotifier(api, () => false)
  assert.equal(show({ sessionName: 'Code review', reason: 'settled', sessionId: 's1' }), false)
  assert.equal(api.shown.length, 0)
})

test('show returns false when permission is denied', () => {
  const api = new FakeNotificationApi('denied')
  const show = createNativeNotifier(api, () => true)
  assert.equal(show({ sessionName: 'Code review', reason: 'settled', sessionId: 's1' }), false)
  assert.equal(api.requested, 0)
  assert.equal(api.shown.length, 0)
})

test('show displays immediately when permission is granted', () => {
  const api = new FakeNotificationApi('granted')
  const clicked: string[] = []
  const show = createNativeNotifier(api, () => true)
  const shown = show({
    sessionName: 'Code review',
    reason: 'settled',
    sessionId: 's1',
    onClick: () => clicked.push('s1'),
  })
  assert.equal(shown, true)
  assert.equal(api.shown.length, 1)
  assert.equal(api.shown[0].title, 'Livecraft — Code review')
  assert.equal(api.shown[0].options.body, 'Agent run finished')
  assert.equal(api.shown[0].options.tag, 's1')
  api.shown[0].options.onClick?.()
  assert.deepEqual(clicked, ['s1'])
})

test('show requests permission once on default and displays when granted', async () => {
  const api = new FakeNotificationApi('default')
  const show = createNativeNotifier(api, () => true)
  const shown = show({ sessionName: 'Build', reason: 'retry-exhausted', sessionId: 's2' })
  assert.equal(shown, true)
  assert.equal(api.requested, 1)
  assert.equal(api.shown.length, 0) // waits for the permission response
  await Promise.resolve()
  assert.equal(api.shown.length, 1)
  assert.equal(api.shown[0].title, 'Livecraft — Build')
  assert.equal(api.shown[0].options.body, 'Agent run failed after retries')
  assert.equal(api.shown[0].options.tag, 's2')
})

test('show stays silent when the permission request is denied', async () => {
  const api = new FakeNotificationApi('default')
  api.nextPermission = 'denied'
  const show = createNativeNotifier(api, () => true)
  show({ sessionName: 'Build', reason: 'settled', sessionId: 's3' })
  await Promise.resolve()
  assert.equal(api.shown.length, 0)
})

test('show skips the delayed display when the tab becomes visible again', async () => {
  const api = new FakeNotificationApi('default')
  let hidden = true
  const show = createNativeNotifier(api, () => hidden)
  show({ sessionName: 'Build', reason: 'settled', sessionId: 's4' })
  hidden = false
  await Promise.resolve()
  assert.equal(api.shown.length, 0)
})

test('documentTitleFor prefers the extension title', () => {
  assert.equal(documentTitleFor('Livecraft — Code review', '● Build'), 'Livecraft — Code review')
  assert.equal(documentTitleFor('Livecraft — Code review', undefined), 'Livecraft — Code review')
})

test('documentTitleFor appends the activity suffix to the base title', () => {
  assert.equal(documentTitleFor(undefined, '● Build'), 'Livecraft — ● Build')
})

test('documentTitleFor falls back to the base title', () => {
  assert.equal(documentTitleFor(undefined, undefined), 'Livecraft')
  assert.equal(documentTitleFor('', undefined), 'Livecraft')
})

test('faviconDataUrl restores the default href when nothing runs', () => {
  assert.equal(faviconDataUrl(false), defaultFaviconHref)
})

test('faviconDataUrl draws a distinct data URL while a session runs', () => {
  const running = faviconDataUrl(true, fakeCanvas)
  assert.notEqual(running, defaultFaviconHref)
  assert.ok(running.startsWith('data:image/png;base64,'))
})
