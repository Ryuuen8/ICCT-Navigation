// ✅ replace your current SW message at the top of map.js with this
// fires after page is fully loaded and idle — not during initial render
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // ✅ requestIdleCallback waits until browser is not busy
        const notify = () => {
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CACHE_MAP_DATA' });
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(notify, { timeout: 5000 });
        } else {
            setTimeout(notify, 3000); // fallback for Safari
        }
    });
}