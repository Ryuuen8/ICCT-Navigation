const CACHE_VERSION = "webmap-pwa-v10";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const OFFLINE_URL = "/offline/";
const OFFLINE_MAP_URL = "/offline-map/";

const APP_PAGES = [
    "/",
    "/map/",
    "/emergency/",
    "/floormap/",
    "/offline-map/",
    OFFLINE_URL,
    OFFLINE_MAP_URL,
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

const API_CACHE_PREFIXES = [
    "/api/locations/",
    "/api/connections/",
    "/api/announcements/",
    "/api/hazards/",
    "/emergency-paths/",
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

const DYNAMIC_CACHE_LIMIT = 60;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function isNavigationRequest(request) {
    return request.mode === "navigate" ||
        (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

function isStaticAsset(url) {
    return url.pathname.startsWith("/static/") || url.pathname.startsWith("/media/");
}

function isFloorImage(url) {
    return url.pathname.startsWith("/static/images/") &&
        (url.pathname.endsWith(".svg") || url.pathname.endsWith(".png"));
}

function isApiGet(request, url) {
    return request.method === "GET" &&
        API_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
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
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
        cache.put(request, response.clone());
    }
    return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
            trimCache(cacheName, DYNAMIC_CACHE_LIMIT);
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }

        throw new Error(`Network error and no cache for ${request.url}`);
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
                trimCache(cacheName, DYNAMIC_CACHE_LIMIT);
            }
            return response;
        })
        .catch(() => null);

    return cached ?? networkPromise;
}

function networkOnlyWithFallback(offlineMessage) {
    return (request) =>
        fetch(request).catch(() =>
            new Response(
                JSON.stringify({ error: offlineMessage, offline: true }),
                { status: 503, headers: { "Content-Type": "application/json" } }
            )
        );
}

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then((cache) =>
                cache.addAll([...APP_PAGES, ...APP_STATIC].filter(Boolean))
            ),
            caches.open(DYNAMIC_CACHE).then((cache) =>
                Promise.allSettled(
                    CDN_ASSETS.map((url) =>
                        cache.add(url).catch((err) =>
                            console.warn(`SW: failed to cache ${url}`, err)
                        )
                    )
                )
            ),
        ]).then(() => self.skipWaiting())
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
                        .map((key) => {
                            console.log(`SW: deleting old cache ${key}`);
                            return caches.delete(key);
                        })
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

    // ✅ clear emergency cache — called when admin updates emergency connections
    if (event.data?.type === "CLEAR_EMERGENCY_CACHE") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.delete("/emergency-paths/");
            console.log("SW: emergency cache cleared");
        });
    }

    // ✅ pre-cache map data when user visits map page while online
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
                        if (cached) return;
                        return fetch(url).then((res) => {
                            if (res.ok) cache.put(url, res.clone());
                        });
                    }).catch(() => { })
                )
            );
        });
    }

    // ✅ pre-cache search locations for home page search
    if (event.data?.type === "CACHE_SEARCH_DATA") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.match("/api/locations/").then((cached) => {
                if (cached) return;
                return fetch("/api/locations/").then((res) => {
                    if (res.ok) cache.put("/api/locations/", res.clone());
                });
            }).catch(() => { });
        });
    }

    // ✅ pre-cache emergency paths for home page emergency button
    if (event.data?.type === "CACHE_EMERGENCY_DATA") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.match("/emergency-paths/").then((cached) => {
                if (cached) return;
                return fetch("/emergency-paths/").then((res) => {
                    if (res.ok) cache.put("/emergency-paths/", res.clone());
                });
            }).catch(() => { });
        });
    }

    // ✅ invalidate specific keys — called after admin saves data
    if (event.data?.type === "INVALIDATE_CACHE") {
        const keys = event.data.keys ?? [];
        caches.open(DYNAMIC_CACHE).then((cache) => {
            Promise.all(keys.map((key) => cache.delete(key))).then(() => {
                console.log(`SW: invalidated keys: ${keys.join(', ')}`);
            });
        });
    }

    // ✅ force refresh all map data — called after bulk admin updates
    if (event.data?.type === "REFRESH_ALL_MAP_DATA") {
        const urlsToRefresh = [
            "/api/locations/",
            "/api/connections/",
            "/emergency-paths/",
        ];
        caches.open(DYNAMIC_CACHE).then((cache) => {
            Promise.allSettled(
                urlsToRefresh.map((url) =>
                    fetch(url).then((res) => {
                        if (res.ok) cache.put(url, res.clone());
                    }).catch(() => { })
                )
            ).then(() => console.log("SW: all map data refreshed"));
        });
    }
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET" && request.method !== "POST") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin && !isCdnRequest(url)) return;

    // ── pathfind — network only, offline signal on failure ───────────────────
    if (url.pathname.startsWith("/pathfind/")) {
        event.respondWith(
            networkOnlyWithFallback("You are offline. Using offline navigation.")(request)
        );
        return;
    }

    // ── write endpoints — never cache ─────────────────────────────────────────
    if (isNoCacheApi(url)) {
        event.respondWith(
            networkOnlyWithFallback("You are offline. This action requires an internet connection.")(request)
        );
        return;
    }

    // ── all remaining POSTs ───────────────────────────────────────────────────
    if (request.method === "POST") {
        event.respondWith(
            networkOnlyWithFallback("You are offline. This action requires an internet connection.")(request)
        );
        return;
    }

    // ── floor SVGs + images — cache first ────────────────────────────────────
    if (isFloorImage(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // ── HTML navigation — network first, offline fallback ────────────────────
    if (isNavigationRequest(request)) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE, OFFLINE_URL));
        return;
    }

    // ── API GET — network first, serve stale if offline ───────────────────────
    if (isApiGet(request, url)) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE));
        return;
    }

    // ── static assets — cache first ──────────────────────────────────────────
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    // ── CDN — stale while revalidate ─────────────────────────────────────────
    if (isCdnRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
        return;
    }

    // ── everything else — network with cache fallback ─────────────────────────
    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});