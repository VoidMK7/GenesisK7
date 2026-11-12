// Minimal service worker: makes the app installable. It never caches API calls or the app shell, so you always get the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
