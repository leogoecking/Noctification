self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Se clicar na notificação, tenta focar a aba e avisar o app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    let focused = false;
    for (const c of allClients) {
      if ("focus" in c) {
        await c.focus();
        focused = true;
        c.postMessage({ type: "NOC_NOTIFICATION_CLICK" });
        break;
      }
    }

    if (!focused && self.clients.openWindow) {
      await self.clients.openWindow("./#/dashboard");
    }
  })());
});