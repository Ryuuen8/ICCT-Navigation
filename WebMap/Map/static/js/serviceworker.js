const CACHE_NAME = 'icct-navigation-v1';
const urlsToCache = [
    '/',
    '/offline/',
    '/static/css/main.css',
    '/static/css/emergency.css',
    '/static/css/floor-maps.css',
    '/static/js/mainscript.js',
    '/static/images/icct-logo-square.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://unpkg.com/leaflet@1.6.0/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.6.0/dist/leaflet.js',
];

// Install Service Worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate Service Worker
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - Network first, fallback to cache
self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // API requests - Network first
    if (request.url.includes('/api/') || request.url.includes('/locate/') || request.url.includes('/search/')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Cache successful responses
                    if (response.status === 200) {
                        const clonedResponse = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, clonedResponse);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if offline
                    return caches.match(request)
                        .then(response => response || new Response('Offline - Data unavailable', { status: 503 }));
                })
        );
        return;
    }

    // Static assets - Cache first
    if (request.url.includes('/static/')) {
        event.respondWith(
            caches.match(request)
                .then(response => response || fetch(request))
        );
        return;
    }

    // Pages - Network first, fallback to cache
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.status === 200) {
                    const clonedResponse = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clonedResponse);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(request)
                    .then(response => response || caches.match('/offline/'));
            })
    );
});

// Background sync for hazard reports
self.addEventListener('sync', event => {
    if (event.tag === 'sync-hazard-reports') {
        event.waitUntil(syncHazardReports());
    }
});

function syncHazardReports() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open('icct_navigation');

        dbRequest.onsuccess = () => {
            const db = dbRequest.result;
            const transaction = db.transaction(['pending_reports'], 'readonly');
            const store = transaction.objectStore('pending_reports');
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
                const reports = getAllRequest.result;
                Promise.all(reports.map(report =>
                    fetch('/submit-report/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(report)
                    })
                ))
                    .then(() => {
                        // Clear pending reports after sync
                        const deleteTransaction = db.transaction(['pending_reports'], 'readwrite');
                        deleteTransaction.objectStore('pending_reports').clear();
                        resolve();
                    })
                    .catch(reject);
            };
        };
    });
}