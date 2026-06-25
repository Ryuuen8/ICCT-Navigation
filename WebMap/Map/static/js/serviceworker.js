const CACHE_VERSION = "webmap-pwa-v11";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const OFFLINE_URL = "/offline/";

// ✅ only cache pages needed for offline fallback
const APP_PAGES = [
    "/",
    "/map/",
    "/emergency/",
    "/offline/",
    "/offline-map/",
];

const APP_STATIC = [
    "/static/css/main.css",
    "/static/css/emergency.css",
    "/static/css/floor-maps.css",
    "/static/css/style.css",
    "/static/js/mainscript.js",
    "/static/js/script.js",
    "/static/js/map.js",
    "/static/js/offline/pathfind.js",
    "/static/js/pwa-install.js",
    "/static/images/icct-logo-square.png",
    "/static/images/Exit_icon.svg",
    "/static/images/1.svg",
    "/static/images/2.svg",
    "/static/images/3.svg",
    "/static/images/4.svg",
    "/static/images/5.svg",
    "/static/images/2B.svg",
    "/static/images/3B.svg",
    "/static/images/6.svg",
];

const CDN_ASSETS = [
    "https://unpkg.com/leaflet@1.6.0/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.6.0/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js",
    "https://cdn.jsdelivr.net/npm/leaflet-ant-path@1.3.0/dist/leaflet-ant-path.min.js",
    "https://unpkg.com/@elfalem/leaflet-curve",
    "https://cdn.jsdelivr.net/npm/leaflet-polylinedecorator@1.6.0/dist/leaflet.polylineDecorator.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2",
];

const API_NO_CACHE = [
    "/pathfind/",
    "/save-room/",
    "/save-connection/",
    "/report/",
    "/locate/",
];

const CDN_HOSTS = [
    "cdnjs.cloudflare.com",
    "unpkg.com",
    "cdn.jsdelivr.net",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function isNavigationRequest(request) {
    return request.mode === "navigate";
}

function isStaticAsset(url) {
    return url.pathname.startsWith("/static/") || url.pathname.startsWith("/media/");
}

function isFloorImage(url) {
    return url.pathname.startsWith("/static/images/") &&
        (url.pathname.endsWith(".svg") || url.pathname.endsWith(".png"));
}

function isNoCacheApi(url) {
    return API_NO_CACHE.some((prefix) => url.pathname.startsWith(prefix));
}

function isCdnRequest(url) {
    return CDN_HOSTS.some((host) => url.hostname.endsWith(host));
}

async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map(key => cache.delete(key)));
}

// ─── STRATEGIES ───────────────────────────────────────────────────────────────

// ✅ cacheFirst — instant for repeat visits, no network overhead
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
}

// ✅ networkFirst — only used for HTML, falls back to cache when offline
async function networkFirst(request, cacheName, fallbackUrl) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }
        throw new Error(`Offline and no cache for ${request.url}`);
    }
}

// ✅ staleWhileRevalidate — CDN assets, instant from cache + updates background
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
                trimCache(cacheName, 60);
            }
            return response;
        })
        .catch(() => null);

    return cached ?? networkPromise;
}

function offlineFallback(message) {
    return new Response(
        JSON.stringify({ error: message, offline: true }),
        { status: 503, headers: { "Content-Type": "application/json" } }
    );
}

// ─── INSTALL — defer heavy caching so it doesn't block page load ──────────────
self.addEventListener("install", (event) => {
    event.waitUntil(
        // ✅ only cache critical static assets on install
        // CDN assets cached lazily on first use via staleWhileRevalidate
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll([...APP_PAGES, ...APP_STATIC].filter(Boolean)))
            .then(() => self.skipWaiting())
    );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => !key.startsWith(CACHE_VERSION))
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    // ✅ lazily pre-cache map data AFTER page is fully loaded
    // called from map.js only when page is idle
    if (event.data?.type === "CACHE_MAP_DATA") {
        const urlsToCache = [
            "/api/locations/",
            "/api/connections/",
            "/emergency-paths/",
        ];
        caches.open(DYNAMIC_CACHE).then((cache) => {
            Promise.allSettled(
                urlsToCache.map((url) =>
                    cache.match(url).then((cached) => {
                        if (cached) return; // skip if already cached
                        return fetch(url).then((res) => {
                            if (res.ok) cache.put(url, res.clone());
                        });
                    }).catch(() => { })
                )
            );
        });
    }

    if (event.data?.type === "INVALIDATE_CACHE") {
        const keys = event.data.keys ?? [];
        caches.open(DYNAMIC_CACHE).then((cache) => {
            Promise.all(keys.map((key) => cache.delete(key)));
        });
    }

    if (event.data?.type === "CLEAR_EMERGENCY_CACHE") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.delete("/emergency-paths/");
        });
    }
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // ✅ only handle GET (and specific POSTs below)
    if (request.method !== "GET" && request.method !== "POST") return;

    // ✅ ignore cross-origin except CDN
    if (url.origin !== self.location.origin && !isCdnRequest(url)) return;

    // ── write/no-cache endpoints — pass through, offline fallback ────────────
    if (request.method === "POST" || isNoCacheApi(url)) {
        event.respondWith(
            fetch(request).catch(() =>
                offlineFallback("You are offline. This action requires an internet connection.")
            )
        );
        return;
    }

    // ── floor SVGs + images — cache first, instant on repeat visits ──────────
    if (isFloorImage(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // ── HTML pages — network first, offline fallback ──────────────────────────
    if (isNavigationRequest(request)) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE, OFFLINE_URL));
        return;
    }

    // ── static JS/CSS — cache first ───────────────────────────────────────────
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // ── CDN assets — stale while revalidate, instant + stays fresh ───────────
    if (isCdnRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
        return;
    }

    // ── everything else — network, cache fallback if offline ─────────────────
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});