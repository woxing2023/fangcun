const CACHE_NAME = "fangcun-v280-20260913-agent-280";
const APP_SHELL = ["./", "./index.html", "./privacy.html", "./styles.css?v=2.8.0", "./v22-layout.css?v=2.8.0", "./smart-parser.js?v=2.8.0", "./docx-schedule-parser.js?v=2.8.0", "./app.js?v=2.8.0", "./manifest.webmanifest?v=2.8.0", "./icon.svg", "./appearance.css?v=6", "./xuan.css?v=3", "./xuan-fibers.svg?v=1", "./xuan-fibers-mobile.png?v=1", "./xuan-sans.woff2?v=2", "./xuan-serif.woff2?v=2", "./material-light.js?v=5", "./touch-material.js?v=2", "./mobile-ui.css?v=2", "./mobile-material.css?v=2", "./mobile-calendar.css?v=1", "./calendar-surface.css?v=1", "./appearance-controls.js?v=1", "./liquid.css?v=5", "./liquid-select.js?v=6", "./appearance.js?v=7", "./liquid-renderer.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/calendar/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows[0];
    if (existing) return existing.focus();
    return clients.openWindow(event.notification.data?.url || "./");
  }));
});
