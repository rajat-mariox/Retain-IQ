/* RetainIQ web push service worker. */

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "RetainIQ", body: event.data.text() };
  }
  const title = payload.title || "RetainIQ";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      tag: payload.tag || undefined,
      data: { link: payload.link || "/notifications" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

// Clicking a notification focuses an existing tab (navigating it to the deep
// link) or opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
