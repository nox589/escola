/* clases service worker: shows push notifications and opens the right screen when tapped.
 * No offline caching on purpose: the app always loads fresh from the server. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch (_) {
    msg = { title: 'clases', body: event.data ? event.data.text() : '' };
  }
  const data = msg.data || {};
  event.waitUntil(
    self.registration.showNotification(msg.title || 'clases', {
      body: msg.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.itemId || data.tag || undefined,
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const path = d.url || (d.itemId ? '/item/' + d.itemId : '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(path).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(path);
    }),
  );
});
