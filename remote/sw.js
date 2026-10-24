// Self remote's service worker: a push carries no payload, so it asks the hub what happened, with
// a sealed call (e2e.js) under this phone's key, and shows it in the language the page last saved
// (i18n.js; the page keeps it in the Cache Storage both share).
importScripts('/e2e.js', '/i18n.js')
const langNow = () => caches.open('qsb-prefs').then(c => c.match('/lang')).then(r => (r ? r.text() : 'en')).catch(() => 'en')
// Settings' private notifications (on unless turned off): the status alone, no folder, no words
const isPrivate = () => caches.open('qsb-prefs').then(c => c.match('/private')).then(r => (r ? r.text() : '1')).then(v => v !== '0').catch(() => true)
async function worded(n) {
  const lang = await langNow()
  if (!(await isPrivate())) return self.I18N ? self.I18N.localNotice(lang, n) : n
  const said = /^Done\b/.test(n.title) ? 'Claude has responded' : 'Claude needs you'
  return { ...n, title: self.I18N ? self.I18N.translate(lang, said) : said, body: '' }
}
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('push', e => {
  e.waitUntil(
    self.E2E.call('notice')
      .then(r => (r.s === 200 ? r.b : Promise.reject(new Error(String(r.s)))))
      .catch(() => ({ title: 'Claude', body: 'Claude finished or needs you.' }))
      .then(worded)
      .then(n => self.registration.showNotification(n.title, { body: n.body, tag: 'qsb', renotify: true, icon: '/icon.svg', data: { session: n.session || '' } })),
  )
})
// a tap opens the session the notice came from: the open app is told, else it opens on it
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const session = e.notification.data?.session || ''
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin)
      if (open) {
        if (session) open.postMessage({ open: session })
        return open.focus()
      }
      return self.clients.openWindow(session ? `/?s=${encodeURIComponent(session)}` : '/')
    }),
  )
})
