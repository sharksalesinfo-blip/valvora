// Web push service worker — TOONT ALLEEN neutrale meldingen.
// De push payload bevat GEEN berichtinhoud. De app haalt + ontsleutelt het
// werkelijke bericht pas wanneer de gebruiker de app opent.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Nieuw bericht", body: "Open de app om te lezen", url: "/" };
  try {
    if (event.data) {
      const payload = event.data.json();
      // Aanvaard alleen neutrale velden — NOOIT berichtinhoud.
      data.title = typeof payload.title === "string" ? payload.title : data.title;
      data.body = typeof payload.body === "string" ? payload.body : data.body;
      data.url = typeof payload.url === "string" ? payload.url : data.url;
    }
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "chat-msg",
      renotify: false,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
