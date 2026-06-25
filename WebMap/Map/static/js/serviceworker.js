// ✅ add to your admin JS — fires after save_room or save_connection succeeds
function invalidateSWCache(keys) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'INVALIDATE_CACHE',
            keys: keys
        });
    }
}

// after save_room succeeds:
invalidateSWCache(['/api/locations/', '/api/connections/']);

// after save_connection succeeds:
invalidateSWCache(['/api/connections/', '/emergency-paths/']);