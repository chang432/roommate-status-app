// Service worker for the Roomie Status PWA.
//
// Minimal by design (PoC): it exists to receive Web Push events and show
// notifications even when the app/tab is closed. No offline caching yet.
// Served from the site root so its scope covers the whole app.

// Activate immediately on first install / update instead of waiting for all
// tabs to close, so push works as soon as the user enables it.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A push arrived from the server. The payload is JSON:
// { title, body, url, eventType? }.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Fall back to raw text if the payload wasn't JSON.
    data = { body: event.data && event.data.text() }
  }

  const title = data.title || 'Roomie Status'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Carried through to notificationclick so we know where to navigate.
    data: { url: data.url || '/' },
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Open app windows refresh the affected feed immediately when the server
      // marks a push as a data-changing event. Closed apps still receive the
      // visible push.
      data.eventType
        ? self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((windows) =>
              windows.forEach((client) =>
                client.postMessage({ type: data.eventType }),
              ),
            )
        : Promise.resolve(),
    ]),
  )
})

// Tapping the notification focuses an existing app window (or opens one).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })(),
  )
})
