const CACHE_NAME = 'erp-evolution-shell-v3'
const SHELL_URL = '/'
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch(SHELL_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error('Não foi possível preparar a aplicação para utilização offline.')
    const html = await response.clone().text()
    await cache.put(SHELL_URL, response)
    const builtAssets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g), match => match[1])
    await cache.addAll([...CORE_ASSETS, ...new Set(builtAssets)])
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith('erp-evolution-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (url.pathname === '/' && response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(SHELL_URL, response.clone())
        }
        return response
      } catch {
        return (await caches.match(SHELL_URL)) || Response.error()
      }
    })())
    return
  }

  // Só os recursos visuais versionados entram em cache. Pedidos SQL/API e ficheiros contabilísticos
  // ficam sempre fora do service worker, evitando respostas financeiras antigas.
  const isStaticAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pwa/')
  if (!isStaticAsset) return
  event.respondWith((async () => {
    const cached = await caches.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    }
    return response
  })())
})
