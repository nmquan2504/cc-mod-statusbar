// Self remote's service worker: a push carries no payload, so it asks the hub what happened, with
// a sealed call (e2e.js) under this phone's key.
importScripts('/e2e.js')
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('push', e => {
  e.waitUntil(
    self.E2E.call('notice')
      .then(r => (r.s === 200 ? r.b : Promise.reject(new Error(String(r.s)))))
      .catch(() => ({ title: 'Claude', body: 'Claude finished or needs you.' }))
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
