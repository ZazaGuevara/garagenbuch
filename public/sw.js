/* Service Worker: hält die App-Dateien im Gerät, damit das Garagenbuch auch ohne Internet startet.
   Bei jeder neuen Version VERSION erhöhen – dann holt sich die App die neuen Dateien. */
const VERSION = "gb-1";
const FILES = [
  "./", "index.html", "platform.js", "manifest.webmanifest",
  "fonts/fonts.css",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/ibm-plex-sans-latin-400-normal.woff2", "fonts/ibm-plex-sans-latin-500-normal.woff2", "fonts/ibm-plex-sans-latin-600-normal.woff2",
  "fonts/ibm-plex-mono-latin-500-normal.woff2",
  "vendor/jspdf.umd.min.js", "vendor/qrcode.js", "vendor/jszip.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Seite selbst: zuerst Internet (neuste Version), sonst gespeicherte Kopie
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put("index.html", c)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // Übrige Dateien: gespeicherte Kopie, sonst Internet
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
});
