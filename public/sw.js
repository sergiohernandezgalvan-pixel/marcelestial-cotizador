/* Service worker — Cotizador Marcelestial
   La aplicación (HTML, JS, CSS) SIEMPRE se busca primero en la red, para que cada
   actualización publicada llegue de inmediato. El caché solo sirve de respaldo cuando
   no hay señal. Íconos y manifiesto sí se sirven desde caché. */

const CACHE = "mc-cotizador-v10";
const ESTATICOS = [
  "/icons/logo.png", "/icons/logo-blanco.png",
  "/icons/icon-192.png", "/icons/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "actualizar") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;            // la API siempre en vivo

  const esIcono = url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest");

  if (esIcono) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      }))
    );
    return;
  }

  // Aplicación: primero la red; el caché solo si falla la conexión
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
  );
});
