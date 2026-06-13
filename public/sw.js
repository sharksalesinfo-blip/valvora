// Web push service worker — TOONT ALLEEN neutrale meldingen.
// De push payload bevat GEEN berichtinhoud. De app haalt + ontsleutelt het
// werkelijke bericht pas wanneer de gebruiker de app opent.
//
// Badge-teller: best-effort lokale benadering van het aantal ongelezen
// meldingen. De server stuurt bewust GEEN aantal mee (zou metadata lekken),
// dus de teller kan afwijken van het exacte aantal ongelezen berichten
// (bijv. na een herstart of na een gemiste push). Op platforms zonder
// Badging API verschijnt er gewoon geen badge — dat is acceptabel.

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// --- Lokale ongelezen-teller (IndexedDB, SW-scope) -------------------------
const DB_NAME = "sw-badge";
const STORE = "kv";
const KEY = "unread";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readUnread() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(Number(r.result) || 0);
      r.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

async function writeUnread(n) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(n, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

async function applyBadge(n) {
  try {
    if (n > 0 && "setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(n);
    } else if ("clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge();
    }
  } catch {}
}

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
  event.waitUntil((async () => {
    const next = (await readUnread()) + 1;
    await writeUnread(next);
    await applyBadge(next);
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "chat-msg",
      renotify: false,
      data: { url: data.url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    await writeUnread(0);
    await applyBadge(0);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) {
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});

// Reset-signaal vanuit de app (visibilitychange of openen van chat).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "BADGE_RESET") {
    event.waitUntil((async () => {
      await writeUnread(0);
      await applyBadge(0);
    })());
  }
});
