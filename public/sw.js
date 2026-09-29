// Service worker: aplikacja ma dzialac bez sieci.
// Strategia: nawigacja z sieci z fallbackiem na cache (swieza wersja gdy jest internet),
// zasoby z cache (sa haszowane, wiec nigdy nie sa nieaktualne).

const CACHE = 'pomodore-v4-diag'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          // Bez sprawdzenia res.ok strona bledu GitHuba wchodzi do pamieci
          // podrecznej pod kluczem index.html i zatruwa powloke offline.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error()))
    )
    return
  }

  e.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
    )
  )
})
