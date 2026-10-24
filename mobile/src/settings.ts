// The app's own settings, set from the page's Settings (its Notifications, Privacy and App lock
// cards, which in the app speak to these instead of the browser's push and passkey): kept in the
// Keystore beside the device, read by the notices' service and the lock.
import * as SecureStore from 'expo-secure-store'

export type AppSettings = {
  notify: boolean // a notification when Claude answers or needs you
  readAloud: boolean // each notice read aloud, the screen off too
  privateNotices: boolean // only "Claude has responded" or "Claude needs you" in the shade
  secure: boolean // no screenshots; the app switcher shows nothing
  lockAfter: number // minutes away before the fingerprint, face or screen lock; 0 is off
  lang: 'vi' | 'en' // the page's language, for the words read and shown
}
export const DEFAULTS: AppSettings = { notify: true, readAloud: true, privateNotices: true, secure: true, lockAfter: 0, lang: 'vi' }
export const LOCK_AFTER = [0, 1, 5, 10, 30]

const KEY = 'settings'
let current = DEFAULTS
const listeners = new Set<(s: AppSettings) => void>()

export const settings = () => current

export async function loadSettings() {
  try { current = clean({ ...DEFAULTS, ...JSON.parse((await SecureStore.getItemAsync(KEY)) ?? '{}') }) } catch {}
  return current
}

// a change, from the page or the app: kept, then told to whoever reads them
export async function saveSettings(patch: Partial<AppSettings>) {
  current = clean({ ...current, ...patch })
  await SecureStore.setItemAsync(KEY, JSON.stringify(current))
  for (const fn of listeners) fn(current)
  return current
}

export function onSettings(fn: (s: AppSettings) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// what the page sends is checked: known keys, their own types, a lock time from the list
function clean(s: AppSettings): AppSettings {
  const flag = (k: 'notify' | 'readAloud' | 'privateNotices' | 'secure') => (typeof s[k] === 'boolean' ? s[k] : DEFAULTS[k])
  return {
    notify: flag('notify'),
    readAloud: flag('readAloud'),
    privateNotices: flag('privateNotices'),
    secure: flag('secure'),
    lockAfter: LOCK_AFTER.includes(Number(s.lockAfter)) ? Number(s.lockAfter) : 0,
    lang: s.lang === 'en' ? 'en' : 'vi',
  }
}
