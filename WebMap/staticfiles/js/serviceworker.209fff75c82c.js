const CACHE_VERSION = "webmap-pwa-v8";
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
    '/static/images/3B.svg',
    '/static/images/2B.svg',
];

const CDN_ASSETS = [
    "https://unpkg.com/leaflet@1.6.0/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.6.0/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js",
    "https://cdn.jsdelivr.net/npm/leaflet-ant-path@1.3.0/dist/leaflet-ant-path.min.js",
    "https://unpkg.com/@elfalem/leaflet-curve",
    "https://cdn.jsdelivr.net/npm/leaflet-polylinedecorator@1.6.0/dist/leaflet.polylineDecorator.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
    // ✅ font awesome webfonts needed for icons to render
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
    if (keys.length > maxEntries) {
        await cache.delete(keys[0]);
        await trimCache(cacheName, maxEntries);
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request, { cache: "reload" });
    if (response.ok) {
        cache.put(request, response.clone());
        trimCache(cacheName, DYNAMIC_CACHE_LIMIT);
    }
    return response;
}

async function networkFirstStatic(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request, { cache: "reload" });
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
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
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }

        throw error;
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

    return cached || networkPromise || fetch(request);
}

// ✅ offline fallback for pathfinding — uses cached locations/connections
async function offlinePathfindFallback(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch {
        return new Response(
            JSON.stringify({
                error: "offline",
                offline: true,
                message: "You are offline. Using offline navigation."
            }),
            {
                status: 503,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then((cache) =>
                cache.addAll([...APP_PAGES, ...APP_STATIC].filter(Boolean))
            ),
            // ✅ CDN assets fail silently per-item
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

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => !key.startsWith(CACHE_VERSION))
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    if (event.data?.type === "CLEAR_EMERGENCY_CACHE") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.delete("/emergency-paths/");
        });
    }

    // ✅ pre-cache map data when user visits map page while online
    if (event.data?.type === "CACHE_MAP_DATA") {
        caches.open(DYNAMIC_CACHE).then((cache) => {
            const urlsToCache = [
                "/api/locations/",
                "/api/connections/",
                "/emergency-paths/",
            ];
            Promise.allSettled(
                urlsToCache.map((url) =>
                    fetch(url).then((res) => {
                        if (res.ok) cache.put(url, res.clone());
                    }).catch(() => { })
                )
            );
        });
    }
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET" && request.method !== "POST") {
        return;
    }

    const url = new URL(request.url);

    if (url.origin !== self.location.origin && !isCdnRequest(url)) {
        return;
    }

    // ✅ pathfind — try network, return offline signal if fails
    if (url.pathname.startsWith("/pathfind/")) {
        event.respondWith(offlinePathfindFallback(request));
        return;
    }

    // ✅ never cache other write endpoints
    if (isNoCacheApi(url)) {
        event.respondWith(
            fetch(request).catch(() =>
                new Response(
                    JSON.stringify({
                        error: "You are offline. This action requires an internet connection.",
                        offline: true,
                    }),
                    {
                        status: 503,
                        headers: { "Content-Type": "application/json" },
                    }
                )
            )
        );
        return;
    }

    if (request.method === "POST") {
        event.respondWith(
            fetch(request).catch(() =>
                new Response(
                    JSON.stringify({
                        error: "You are offline. This action requires an internet connection.",
                        offline: true,
                    }),
                    {
                        status: 503,
                        headers: { "Content-Type": "application/json" },
                    }
                )
            )
        );
        return;
    }

    // ✅ floor SVGs — cache first, they never change
    if (isFloorImage(url)) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (isNavigationRequest(request)) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE, OFFLINE_URL));
        return;
    }

    if (isApiGet(request, url)) {
        event.respondWith(networkFirst(request, DYNAMIC_CACHE));
        return;
    }

    if (isStaticAsset(url)) {
        event.respondWith(networkFirstStatic(request, STATIC_CACHE));
        return;
    }

    if (isCdnRequest(url)) {
        event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
        return;
    }

    event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});