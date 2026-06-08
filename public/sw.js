const CACHE_NAME = 'tyrepulse-v1'
const STATIC_ASSETS = [
  '/',
  '/index.html',
]

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET and Supabase API calls (always fresh)
  if (request.method !== 'GET') return
  if (url.hostname.includes('supabase')) return

  // Cache-first for static assets (JS, CSS, fonts, images)
  if (/\.(js|css|woff2?|png|svg|ico)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          return response
        })
      })
    )
    return
  }

  // Network-first for HTML navigation (SPA fallback)
  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/index.html')
    )
  )
})
