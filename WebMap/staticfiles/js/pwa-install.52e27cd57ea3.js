let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.dispatchEvent(new CustomEvent("pwa-install-available"));
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.dispatchEvent(new CustomEvent("pwa-installed"));
});

window.installPwa = async function installPwa() {
    if (!deferredInstallPrompt) {
        return false;
    }

    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return choice.outcome === "accepted";
};

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.ready.then((registration) => {
            registration.addEventListener("updatefound", () => {
                const newWorker = registration.installing;
                if (!newWorker) {
                    return;
                }

                newWorker.addEventListener("statechange", () => {
                    if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                        newWorker.postMessage({ type: "SKIP_WAITING" });
                    }
                });
            });
        });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
    });
}