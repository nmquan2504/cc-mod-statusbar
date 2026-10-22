// Self remote's service worker: a push carries no payload, so it asks the server what happened.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('push', e => {
  e.waitUntil(
    fetch('/api/notice', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .catch(() => ({ title: 'Claude', body: 'Claude finished or needs you.' }))
      .then(n => self.registration.showNotification(n.title, { body: n.body, tag: 'qsb', renotify: true, icon: '/icon.svg' })),
  )
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
