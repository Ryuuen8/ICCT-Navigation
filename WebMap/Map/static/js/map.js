console.log("MAP JS LOADED");

// ✅ tell SW to pre-cache map data for offline use
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_MAP_DATA' });
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let scannedLocationMarker = null;
let currentPath = null;
let selected = [];
let currentMarker = null;
let currentMarkerTimeout = null;
let pathfindingMode = false;
let emergencyCache = null;
let isLoadingEmergency = false;
let pulseTimers = [];
let resizeTimer;

const PENDING_DESTINATION_KEY = 'pendingNavigationDestination';

// ─── FLOOR PLANS ──────────────────────────────────────────────────────────────
const floorPlans = {
    1: { imageUrl: '/static/images/1.svg', width: 865, height: 860, defaultZoom: 1.4954560748550518, defaultCenter: [241.17471666211208, 455.7492807511971] },
    2: { imageUrl: '/static/images/2.svg', width: 920, height: 639, defaultZoom: 1.498296103390921, defaultCenter: [222.64788599801707, 472.9055257445959] },
    31: { imageUrl: '/static/images/2B.svg', width: 1036, height: 832 },
    3: { imageUrl: '/static/images/3.svg', width: 920, height: 636, defaultZoom: 0, defaultCenter: [320, 460] },
    21: { imageUrl: '/static/images/3B.svg', width: 869, height: 631 },
    4: { imageUrl: '/static/images/4.svg', width: 920, height: 635, defaultZoom: 0, defaultCenter: [320, 460] },
    5: { imageUrl: '/static/images/5.svg', width: 918, height: 636, defaultZoom: 0, defaultCenter: [320, 460] },
    6: { imageUrl: '/static/images/6.svg', width: 894, height: 560, defaultZoom: 0, defaultCenter: [320, 460] }
};

let currentFloor = normalizeFloorId(
    new URLSearchParams(window.location.search).get('floor')
) ?? 1;

// ─── MAP INIT ─────────────────────────────────────────────────────────────────
function getFloorBounds(floor) {
    const plan = floorPlans[floor] || floorPlans[1];
    return [[0, 0], [plan.height, plan.width]];
}

function getPaddedFloorBounds(floor) {
    const plan = floorPlans[floor] || floorPlans[1];
    return [
        [-(plan.height * 0.12), -(plan.width * 0.08)],
        [plan.height * 1.12, plan.width * 1.08]
    ];
}

function getMapPadding() {
    return window.innerWidth < 768 ? L.point(12, 12) : L.point(24, 24);
}

function normalizeFloorId(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'g') return 1;
    const parsed = parseInt(normalized, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -5,
    zoomSnap: 0,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 120,
    touchZoom: true,
    tap: true,
    tapTolerance: 15,
    doubleClickZoom: true,
    bounceAtZoomLimits: false,
    maxBounds: getPaddedFloorBounds(currentFloor),
    maxBoundsViscosity: 1.0
});

const floors = Object.fromEntries(
    Object.entries(floorPlans).map(([floor, plan]) => {
        const floorNumber = parseInt(floor, 10);
        return [floorNumber, {
            bounds: getFloorBounds(floorNumber),
            image: L.imageOverlay(plan.imageUrl, getFloorBounds(floorNumber)),
            layer: L.layerGroup()
        }];
    })
);

function computeMinZoom() {
    return map.getBoundsZoom(floors[currentFloor].bounds, false, getMapPadding());
}

map.setMinZoom(computeMinZoom());
map.setMaxZoom(3);

function fitCurrentFloor() {
    map.setMinZoom(computeMinZoom());
    map.setMaxBounds(getPaddedFloorBounds(currentFloor));
    map.fitBounds(floors[currentFloor].bounds, {
        padding: getMapPadding(),
        animate: false,
        maxZoom: map.getMinZoom()
    });
}

function fitCurrentFloorAfterLayout() {
    requestAnimationFrame(() => {
        map.invalidateSize();
        fitCurrentFloor();
    });
}

function initFloors() {
    Object.keys(floors).forEach((key) => {
        const f = floors[key];
        f.image.addTo(map);
        f.layer.addTo(map);
        if (parseInt(key) !== currentFloor) {
            map.removeLayer(f.image);
            map.removeLayer(f.layer);
        }
    });
}

initFloors();
fitCurrentFloorAfterLayout();

// ─── RESIZE ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        map.invalidateSize();
        fitCurrentFloorAfterLayout();
    }, 150);
});

window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        map.invalidateSize();
        fitCurrentFloorAfterLayout();
    }, 200);
});

// ─── COORD DISPLAY ────────────────────────────────────────────────────────────
const coordControl = L.control({ position: 'bottomleft' });
coordControl.onAdd = function () {
    this._div = L.DomUtil.create('div', 'coords-display');
    this._div.innerHTML = "Move around map";
    return this._div;
};
coordControl.addTo(map);
map.on('mousemove', (e) => {
    coordControl._div.innerHTML = `Y: ${e.latlng.lat.toFixed(1)} | X: ${e.latlng.lng.toFixed(1)}`;
});

// ─── DATA ─────────────────────────────────────────────────────────────────────
const locations = JSON.parse(document.getElementById("locations-data").textContent);
const path = JSON.parse(document.getElementById("path-data").textContent);
const searchMarkerLayer = L.layerGroup().addTo(map);

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function getCSRFToken() {
    const match = document.cookie.split('; ').find((row) => row.startsWith('csrftoken='));
    return match ? match.split('=')[1] : null;
}

function findLocationByName(roomName) {
    if (!roomName) return null;
    const normalized = String(roomName).trim().toLowerCase();
    const exact = locations.find((loc) => loc.room_name.toLowerCase() === normalized);
    if (exact) return exact;
    const partial = locations.filter((loc) => loc.room_name.toLowerCase().includes(normalized));
    return partial.length === 1 ? partial[0] : null;
}

function createDestinationOptions() {
    return locations
        .filter((loc) => loc.room_name && !loc.room_name.toLowerCase().startsWith('point'))
        .map((loc) => `<option value="${escapeHtml(loc.room_name)}"></option>`)
        .join('');
}

// ─── TOASTS ───────────────────────────────────────────────────────────────────
function dismissToast(toast) {
    if (!toast) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
}

function createToast(id) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = id;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '110px',
        left: '50%',
        transform: 'translateX(-50%) translateY(8px)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'rgba(15, 23, 42, 0.97)',
        padding: '12px 16px',
        borderRadius: '14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        zIndex: 2000,
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        maxWidth: '320px',
        opacity: '0',
        transition: 'opacity 0.25s ease, transform 0.25s ease'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    return toast;
}

function showPathFoundToast(destinationName) {
    const destination = findLocationByName(destinationName);
    const roomName = destination ? destination.room_name : destinationName;
    const floorLabel = destination ? `Floor ${destination.floor}` : '';

    const toast = createToast('pathfound-toast');
    toast.style.border = '1px solid rgba(0,229,255,0.4)';
    toast.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,229,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-route" style="color:#00E5FF;font-size:16px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
            <div style="font-size:11px;letter-spacing:1px;color:#94A3B8;text-transform:uppercase;">Path found</div>
            <div style="font-size:15px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(roomName)}</div>
            ${floorLabel ? `<div style="font-size:12px;color:#7DD3FC;margin-top:2px;">${escapeHtml(floorLabel)}</div>` : ''}
        </div>
        <button type="button" aria-label="Close" style="background:none;border:none;color:#94A3B8;cursor:pointer;font-size:14px;padding:4px;line-height:1;">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    toast.querySelector('button').addEventListener('click', () => dismissToast(toast));
    toast._dismissTimer = setTimeout(() => dismissToast(toast), 4000);
}

function showStartToast(locationName) {
    const toast = createToast('pathfound-toast');
    toast.style.border = '1px solid rgba(255,107,107,0.4)';
    toast.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,107,107,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fa-solid fa-location-dot" style="color:#FF6B6B;font-size:16px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
            <div style="font-size:11px;letter-spacing:1px;color:#94A3B8;text-transform:uppercase;">Start set</div>
            <div style="font-size:15px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(locationName)}</div>
            <div style="font-size:12px;color:#94A3B8;margin-top:2px;">Tap a destination on the map</div>
        </div>
    `;
    setTimeout(() => dismissToast(toast), 4000);
}

// ─── PATHFINDING MODE ─────────────────────────────────────────────────────────
// ✅ declared early so setNavigateButtonActive can reference compassBtn safely
const compassBtn = document.getElementById('navbtn');

function setPathfindingMode(active) {
    pathfindingMode = active;
    if (!active) selected = [];
    if (!compassBtn) return;
    if (active) {
        compassBtn.style.backgroundColor = '#00E5FF';
        compassBtn.style.color = '#000';
        compassBtn.style.borderRadius = '8px';
        compassBtn.style.transition = 'all 0.3s ease';
        document.getElementById('map').style.cursor = 'crosshair';
    } else {
        compassBtn.style.backgroundColor = 'transparent';
        compassBtn.style.color = '';
        document.getElementById('map').style.cursor = '';
    }
}

if (compassBtn) {
    compassBtn.addEventListener('click', (e) => {
        e.preventDefault();
        pathfindingMode ? setPathfindingMode(false) : openNavigatePopup();
    });
} else {
    console.error("navbtn not found");
}

// ─── NAVIGATE POPUP ───────────────────────────────────────────────────────────
function closeNavigatePopup() {
    document.getElementById('navigate-choice-popup')?.remove();
}

function startManualNavigation() {
    closeNavigatePopup();
    selected = [];
    setPathfindingMode(true);
}

function startQrNavigation(destinationName) {
    const destination = findLocationByName(destinationName);
    if (!destination) {
        alert('Please choose a valid destination.');
        return;
    }
    sessionStorage.setItem(PENDING_DESTINATION_KEY, destination.room_name);
    closeNavigatePopup();
    if (typeof scan === 'function') {
        scan();
    } else {
        alert('QR scanner is not available on this page.');
    }
}

function openNavigatePopup() {
    closeNavigatePopup();
    const popup = document.createElement('div');
    popup.id = 'navigate-choice-popup';
    popup.className = 'navigate-choice-popup';
    popup.innerHTML = `
        <div class="navigate-choice-header">
            <strong>Navigate</strong>
            <button type="button" class="navigate-choice-close" aria-label="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <button type="button" class="navigate-choice-option" data-nav-mode="manual">
            <i class="fa-solid fa-hand-pointer"></i>
            <span>Manual path</span>
        </button>
        <form class="navigate-choice-form">
            <label for="navigateDestination">Destination</label>
            <input id="navigateDestination" type="text" list="navigateDestinationList"
                   placeholder="Search destination" autocomplete="off">
            <datalist id="navigateDestinationList">${createDestinationOptions()}</datalist>
            <button type="submit" class="navigate-choice-option navigate-choice-scan">
                <i class="fa-solid fa-qrcode"></i>
                <span>Scan QR</span>
            </button>
        </form>
    `;
    document.body.appendChild(popup);
    popup.querySelector('.navigate-choice-close').addEventListener('click', closeNavigatePopup);
    popup.querySelector('[data-nav-mode="manual"]').addEventListener('click', startManualNavigation);
    popup.querySelector('.navigate-choice-form').addEventListener('submit', (e) => {
        e.preventDefault();
        startQrNavigation(popup.querySelector('#navigateDestination').value);
    });
}

// ─── PATH DRAWING ─────────────────────────────────────────────────────────────
const currentPathLayers = [];

function clearCurrentPath() {
    currentPathLayers.forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    currentPathLayers.length = 0;
}

function clearScannedMarker() {
    if (!scannedLocationMarker) return;
    if (map.hasLayer(scannedLocationMarker)) map.removeLayer(scannedLocationMarker);
    scannedLocationMarker = null;
}

function splitPathIntoFloorSegments(pathCoords) {
    const segments = [];
    let segFloor = null;
    let currentSegment = [];

    pathCoords.forEach(([lat, lng, floor]) => {
        if (segFloor === null) {
            segFloor = floor;
            currentSegment = [[lat, lng]];
            return;
        }
        if (floor !== segFloor) {
            if (currentSegment.length >= 2) segments.push({ floor: segFloor, coords: currentSegment });
            segFloor = floor;
            currentSegment = [[lat, lng]];
        } else {
            currentSegment.push([lat, lng]);
        }
    });

    if (currentSegment.length >= 2) segments.push({ floor: segFloor, coords: currentSegment });
    return segments;
}

function getFirstPathFloor(pathData) {
    if (Array.isArray(pathData)) {
        if (pathData.length > 0 && Array.isArray(pathData[0]) && pathData[0].length >= 3) {
            return normalizeFloorId(pathData[0][2]);
        }
        return null;
    }
    if (pathData?.segments?.length > 0) return normalizeFloorId(pathData.segments[0].floor);
    return null;
}

function drawPath(pathData) {
    if (!pathData) return;

    const firstFloor = getFirstPathFloor(pathData);
    if (firstFloor && firstFloor !== currentFloor && floors[firstFloor]) {
        switchFloor(firstFloor);
    }

    clearCurrentPath();

    let segments = [];
    if (Array.isArray(pathData)) {
        if (pathData.length === 0) return;
        segments = (Array.isArray(pathData[0]) && pathData[0].length >= 3)
            ? splitPathIntoFloorSegments(pathData)
            : [{ floor: currentFloor, coords: pathData }];
    } else if (pathData.segments) {
        segments = pathData.segments;
    }

    segments.forEach((segment) => {
        const layer = L.polyline.antPath(segment.coords, {
            color: "#00E5FF",
            weight: 6,
            delay: 100,
            dashArray: [10, 25],
            pulseColor: "#ffffff",
            paused: false,
            reverse: false,
            hardwareAccelerated: true,
            lineJoin: 'round',
            lineCap: 'round'
        });
        layer.segmentFloor = segment.floor;
        currentPathLayers.push(layer);
        if (segment.floor === currentFloor) map.addLayer(layer);
    });
}

function finishPathfinding(pathData) {
    drawPath(pathData);
    setPathfindingMode(false);
    clearScannedMarker(); // ✅ clear start marker after route drawn
}

// ─── OFFLINE PATHFINDING ──────────────────────────────────────────────────────
function findOfflinePath(start, end) {
    const graph = window.OfflinePathfinder?.loadGraphFromPage?.();
    if (!graph) return false;

    const result = window.OfflinePathfinder.findPath(graph.locations, graph.connections, start, end);
    if (result.error) {
        alert(`Navigation error: ${result.error}`);
        return true;
    }

    console.log('PATH (offline):', result.path);
    finishPathfinding(result);
    showPathFoundToast(end);
    return true;
}

function requestPath(start, end) {
    // ✅ offline check first
    if (!navigator.onLine) {
        if (findOfflinePath(start, end)) return;
        alert('You are offline and no offline pathfinder is available.');
        return;
    }

    const csrftoken = getCSRFToken();
    if (!csrftoken) {
        if (findOfflinePath(start, end)) return;
        console.error('CSRF token missing');
        return;
    }

    fetch('/pathfind/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrftoken
        },
        body: JSON.stringify({ start, end })
    })
        .then(async (response) => {
            if (!response.ok) {
                const text = await response.text();
                // ✅ handle SW offline signal
                try {
                    const json = JSON.parse(text);
                    if (json.offline) {
                        findOfflinePath(start, end);
                        return null;
                    }
                } catch { }
                console.error('SERVER ERROR:', text);
                findOfflinePath(start, end);
                return null;
            }
            return response.json();
        })
        .then((data) => {
            if (!data) return;
            console.log('PATH:', data.path);
            finishPathfinding(data);
            showPathFoundToast(end);
        })
        .catch((error) => {
            console.error('FETCH ERROR:', error);
            if (!findOfflinePath(start, end)) {
                alert('❌ Error finding path. Check console for details.');
            }
        });
}

// ─── EMERGENCY PATHS ──────────────────────────────────────────────────────────
const emergencyLayer = L.layerGroup();

function startPulse(decorator) {
    let opacity = 0.9;
    let direction = -1;
    const timer = setInterval(() => {
        opacity += direction * 0.05;
        if (opacity <= 0.3) direction = 1;
        if (opacity >= 0.9) direction = -1;
        decorator.setPatterns([{
            offset: 0,
            repeat: 20,
            symbol: L.Symbol.arrowHead({
                pixelSize: 10,
                polygon: false,
                pathOptions: { color: 'red', weight: 2, opacity }
            })
        }]);
    }, 80);
    pulseTimers.push(timer);
}

function clearPulseAnimations() {
    pulseTimers.forEach(t => clearInterval(t));
    pulseTimers = [];
}

async function toggleEmergencyPaths() {
    if (map.hasLayer(emergencyLayer)) {
        map.removeLayer(emergencyLayer);
        clearPulseAnimations();
        return;
    }

    if (isLoadingEmergency) return;

    try {
        isLoadingEmergency = true;

        // Fetch from your API endpoint
        const res = await fetch('emergency-paths/');  // Your URL
        if (!res.ok) throw new Error("Failed to load emergency paths");
        const data = await res.json();

        emergencyLayer.clearLayers();
        clearPulseAnimations();

        // Filter paths for current floor
        const floorPaths = data.filter(path => {
            // Check if either from or to is on current floor
            // Or if both are on the same floor
            return String(path.from[2]) === String(currentFloor) &&
                String(path.to[2]) === String(currentFloor);
        });

        console.log(`Found ${floorPaths.length} emergency paths for floor ${currentFloor}`);

        if (floorPaths.length === 0) {
            alert(`No emergency paths found for floor ${currentFloor}`);
            emergencyLayer.addTo(map);
            return;
        }

        // Add each path with pulsing arrows
        floorPaths.forEach((path, index) => {
            const fromCoords = [path.from[0], path.from[1]];
            const toCoords = [path.to[0], path.to[1]];

            console.log(`Path ${index + 1}: From [${fromCoords}] to [${toCoords}]`);

            const decorator = L.polylineDecorator(
                [fromCoords, toCoords],
                {
                    patterns: [{
                        offset: 0,
                        repeat: 10,
                        symbol: L.Symbol.arrowHead({
                            pixelSize: 10,
                            polygon: false,
                            pathOptions: {
                                color: 'red',
                                weight: 2,
                                opacity: 0.9
                            }
                        })
                    }]
                }
            ).addTo(emergencyLayer);

            startPulse(decorator);
        });

        emergencyLayer.addTo(map);
        console.log(`Added ${floorPaths.length} emergency paths to map`);

    } catch (err) {
        console.error("Emergency paths error:", err);
        alert("Could not load emergency paths. Please try again.");
    } finally {
        isLoadingEmergency = false;
    }
}

// ✅ auto-trigger from ?emergency=true
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('emergency') === 'true') {
    map.whenReady(() => toggleEmergencyPaths());
}

const emergencyAllExitsBtn = document.getElementById('emergencyAllExitsBtn');
if (emergencyAllExitsBtn) {
    emergencyAllExitsBtn.addEventListener('click', toggleEmergencyPaths);
}

// ─── FLOOR SWITCHING ──────────────────────────────────────────────────────────
function switchFloor(floor) {
    if (!floors[floor]) return;

    const previousFloor = currentFloor;

    if (floors[previousFloor]) {
        map.removeLayer(floors[previousFloor].image);
        map.removeLayer(floors[previousFloor].layer);
    }

    currentPathLayers.forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });

    // ✅ use centralized clearScannedMarker
    clearScannedMarker();

    // ✅ clear emergency paths + pulse
    const emergencyWasShowing = map.hasLayer(emergencyLayer);
    emergencyLayer.clearLayers();
    clearPulseAnimations();
    map.removeLayer(emergencyLayer);

    currentFloor = floor;

    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);
    fitCurrentFloor();

    currentPathLayers.forEach((layer) => {
        if (layer.segmentFloor === currentFloor) map.addLayer(layer);
    });

    if (emergencyWasShowing) toggleEmergencyPaths();
}

document.querySelectorAll(".floor-item").forEach((btn) => {
    btn.addEventListener("click", () => switchFloor(parseInt(btn.dataset.floor)));
});

// ─── QR SCAN HANDLER ──────────────────────────────────────────────────────────
function handleScannedLocation() {
    let scannedData = sessionStorage.getItem('scannedLocation');

    if (!scannedData) {
        const x = getQueryParam('x');
        const y = getQueryParam('y');
        const floor = getQueryParam('floor');
        const name = getQueryParam('name');

        if (x && y && floor) {
            scannedData = JSON.stringify({
                x: parseFloat(x),
                y: parseFloat(y),
                floor: parseInt(floor, 10),
                name: name
            });
            sessionStorage.setItem('scannedLocation', scannedData);
            history.replaceState(null, '', window.location.pathname);
        }
    }

    if (!scannedData) return;

    try {
        const location = JSON.parse(scannedData);

        // ✅ switch floor first, then clear old marker using updated currentFloor
        switchFloor(location.floor);
        clearScannedMarker();

        const marker = L.circleMarker([location.y, location.x], {
            radius: 15,
            fillColor: '#FF6B6B',
            color: '#FF0000',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.7,
            zIndex: 1000
        });

        marker.bindPopup(`
            <div style="text-align:center;padding:10px;">
                <strong>${location.name || 'QR Location'}</strong><br>
                X: ${location.x.toFixed(2)}<br>
                Y: ${location.y.toFixed(2)}<br>
                Floor: ${location.floor}
            </div>
        `);

        // ✅ add directly to map so removal is straightforward
        marker.addTo(map);
        marker.openPopup();
        scannedLocationMarker = marker;

        const pendingDestination = sessionStorage.getItem(PENDING_DESTINATION_KEY);
        if (pendingDestination) {
            sessionStorage.removeItem(PENDING_DESTINATION_KEY);
            if (location.name) {
                requestPath(location.name, pendingDestination);
            } else {
                alert('QR location found, but it has no room name for navigation.');
            }
            return;
        }

        if (location.name) {
            selected = [location.name];
            setPathfindingMode(true);
            showStartToast(location.name);
        }

    } catch (error) {
        console.error('Error handling scanned location:', error);
    }
}

// ─── LOCATION POLYGONS ────────────────────────────────────────────────────────
locations.forEach((loc) => {
    const polygon = L.polygon(loc.coordinates, {
        color: "transparent",
        weight: 2,
        fillOpacity: 0.15
    }).addTo(floors[loc.floor].layer);

    polygon.bindPopup(`<b>${loc.room_name}</b>`);

    polygon.on("click", function () {
        if (!pathfindingMode) return;

        selected.push(loc.room_name);
        console.log("Selected:", selected);

        if (!getCSRFToken()) {
            console.error("CSRF token missing");
            selected = [];
            return;
        }

        if (selected.length === 1) {
            polygon.bindPopup('Start Detected').openPopup();
            setTimeout(() => polygon.closePopup(), 1500);
        }

        if (selected.length === 2) {
            const [start, end] = selected;
            setPathfindingMode(false);
            requestPath(start, end);
        }
    });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const suggestionsList = document.getElementById('suggestionsList');
    if (!searchInput || !suggestionsList) return;

    let searchLocationsCache = [];
    let searchTimer;

    try {
        const parsed = JSON.parse(document.getElementById('locations-data').textContent);
        searchLocationsCache = Array.isArray(parsed) ? parsed : [];
        console.log(`✅ Loaded ${searchLocationsCache.length} locations for search`);
    } catch (e) {
        console.error('Failed to load locations for search:', e);
    }

    function removeCurrentMarker() {
        if (currentMarkerTimeout) {
            clearTimeout(currentMarkerTimeout);
            currentMarkerTimeout = null;
        }
        searchMarkerLayer.clearLayers();
        currentMarker = null;
    }

    function displaySuggestions(suggestions) {
        suggestionsList.innerHTML = '';
        if (!suggestions.length) {
            suggestionsList.classList.remove('show');
            return;
        }

        suggestions.forEach((loc) => {
            const li = document.createElement('li');
            li.className = 'suggestion-item';
            li.innerHTML = `
                <div class="suggestion-name">${loc.room_name}</div>
                <div class="suggestion-floor">Floor ${loc.floor}</div>
            `;

            li.addEventListener('click', (e) => {
                e.preventDefault();
                searchInput.value = loc.room_name;
                suggestionsList.classList.remove('show');

                switchFloor(loc.floor);

                setTimeout(() => {
                    if (!loc.y_coordinate || !loc.x_coordinate) {
                        console.warn('No coordinates for location:', loc);
                        return;
                    }

                    removeCurrentMarker();

                    currentMarker = L.circleMarker([loc.y_coordinate, loc.x_coordinate], {
                        radius: 15,
                        fillColor: '#FF6B6B',
                        color: '#FF0000',
                        weight: 3,
                        opacity: 1,
                        fillOpacity: 0.7,
                        zIndex: 1000
                    });

                    searchMarkerLayer.addLayer(currentMarker);
                    currentMarker.bindPopup(`
                        <div style="text-align:center;padding:10px;">
                            <strong>📍 ${loc.room_name}</strong><br>
                            Floor: ${loc.floor}<br>
                            <small>Search result</small>
                        </div>
                    `).openPopup();

                    const markerToClear = currentMarker;
                    currentMarkerTimeout = setTimeout(() => {
                        if (currentMarker === markerToClear) {
                            searchMarkerLayer.clearLayers();
                            currentMarker = null;
                        }
                        currentMarkerTimeout = null;
                    }, 5000);

                }, 300);
            });

            suggestionsList.appendChild(li);
        });

        suggestionsList.classList.add('show');
    }

    searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        const query = this.value.trim();
        if (query.length < 2) {
            suggestionsList.classList.remove('show');
            return;
        }
        searchTimer = setTimeout(() => {
            const results = searchLocationsCache
                .filter((loc) => loc.room_name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 10);
            displaySuggestions(results);
        }, 250);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsList.contains(e.target)) {
            suggestionsList.classList.remove('show');
        }
    });
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────
drawPath(path);
handleScannedLocation();

// ✅ handle ?start=&end= from external links (e.g. announcement navigate button)
(function urlOutside() {
    const start = urlParams.get("start");
    const end = urlParams.get("end");
    if (start && end) requestPath(start, end);
})();