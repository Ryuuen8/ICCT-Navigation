// MAP SETUP
console.log("MAP JS LOADED");
console.log("navbtn at load:", document.getElementById("navbtn"));
let scannedLocationMarker = null;

// --- Use each floor plan's real SVG dimensions for accurate fit/zoom. ---
// Added defaultZoom + defaultCenter so each floor can open already zoomed in
// on a specific area instead of always fitting the whole SVG to screen.
// - defaultZoom: the Leaflet zoom level to open this floor at.
// - defaultCenter: [y, x] point (same coordinate space as the bottom-left
//   "Y / X" readout already in this file) to center the view on.
// Leave both undefined on a floor to fall back to the old fitBounds(whole
// image) behavior.
const floorPlans = {
    1: { imageUrl: '/static/images/1.svg', width: 934, height: 817, defaultZoom: 1.4954560748550518, defaultCenter: [241.17471666211208, 455.7492807511971,] },
    2: { imageUrl: '/static/images/2.svg', width: 920, height: 639, defaultZoom: 1.498296103390921, defaultCenter: [222.64788599801707, 472.9055257445959] },
    3: { imageUrl: '/static/images/3.svg', width: 920, height: 636, defaultZoom: 0, defaultCenter: [320, 460] },
    4: { imageUrl: '/static/images/4.svg', width: 920, height: 635, defaultZoom: 0, defaultCenter: [320, 460] },
    5: { imageUrl: '/static/images/5.svg', width: 918, height: 636, defaultZoom: 0, defaultCenter: [320, 460] }
};

// In L.CRS.Simple, bounds are [[y_min, x_min], [y_max, x_max]]
function getFloorBounds(floor) {
    const plan = floorPlans[floor] || floorPlans[1];
    // In L.CRS.Simple, bounds are [[y_min, x_min], [y_max, x_max]]
    return [[0, 0], [plan.height, plan.width]];
}

function getPaddedFloorBounds(floor) {
    const plan = floorPlans[floor] || floorPlans[1];
    const padX = plan.width * 0.08;
    const padY = plan.height * 0.12;

    return [[-padY, -padX], [plan.height + padY, plan.width + padX]];
}

function getMapPadding() {
    return window.innerWidth < 768 ? L.point(12, 12) : L.point(24, 24);
}

function getFitBoundsOptions() {
    if (window.innerWidth < 768) {
        return {
            paddingTopLeft: L.point(52, 76),
            paddingBottomRight: L.point(52, 132),
            animate: false
        };
    }

    return {
        padding: getMapPadding(),
        animate: false
    };
}

// --- Default-view aware. If the current floor defines a defaultZoom, open
//     on that zoom/center instead of fitting the entire SVG to the screen.
//     minZoom/maxBounds are still computed from the full image so the user
//     can always zoom back out to see everything and can't pan off the map. ---
function fitCurrentFloor() {
    const plan = floorPlans[currentFloor] || floorPlans[1];

    map.setMinZoom(computeMinZoom());
    map.setMaxBounds(getPaddedFloorBounds(currentFloor));

    // Always zoom to show the entire map
    map.fitBounds(floors[currentFloor].bounds, {
        padding: getMapPadding(),
        animate: false,
        maxZoom: map.getMinZoom() // This prevents zooming in closer than the min zoom
    });
}

function fitCurrentFloorAfterLayout() {
    requestAnimationFrame(() => {
        map.invalidateSize();
        fitCurrentFloor();
    });
}

let currentFloor = normalizeFloorId(
    new URLSearchParams(window.location.search).get('floor')
) ?? 1;

var map = L.map('map', {
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
        const floorBounds = getFloorBounds(floorNumber);

        return [floorNumber, {
            bounds: floorBounds,
            image: L.imageOverlay(plan.imageUrl, floorBounds),
            layer: L.layerGroup()
        }];
    })
);

// --- ONE function that computes "zoomed all the way out shows the whole
//     map" zoom level, using the same padding everywhere. This is the
//     ONLY place minZoom is computed. ---
function computeMinZoom() {
    return map.getBoundsZoom(floors[currentFloor].bounds, false, getMapPadding());
}

map.setMinZoom(computeMinZoom());
map.setMaxZoom(3);

function normalizeFloorId(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();

    if (normalized === 'g') {
        return 1;
    }

    const parsed = parseInt(normalized, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

// --- ONE resize handler, debounced. Recomputes minZoom only — does NOT
//     call fitBounds/setView, so it won't yank the user's current view. ---
let resizeTimer;
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

let currentPath = null;
let selected = [];
let currentMarker = null;
let currentMarkerTimeout = null;
const searchMarkerLayer = L.layerGroup().addTo(map);
const PENDING_DESTINATION_KEY = 'pendingNavigationDestination';

// Brief: client-side map controller used on the floor map pages.
// - Shows floor overlays, handles floor switching
// - Toggles a one-time "pathfinding" mode via the nav button
// - Collects two location clicks, POSTs to `/pathfind/`, and draws the returned path

// PATHFINDING MODE TOGGLE
let pathfindingMode = false;

function setPathfindingMode(active) {
    pathfindingMode = active;
    setNavigateButtonActive(active);

    if (!active) {
        // Clear selections when disabling pathfinding so users start fresh
        selected = [];
    }
}

function setNavigateButtonActive(active) {
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

// PATH-FOUND TOAST (replaces the plain alert() shown when a route finishes)
function dismissPathFoundToast(toast) {
    if (!toast) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
}

function showPathFoundToast(destinationName) {
    const destination = findLocationByName(destinationName);
    const roomName = destination ? destination.room_name : destinationName;
    const floorLabel = destination ? `Floor ${destination.floor}` : '';

    const existing = document.getElementById('pathfound-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pathfound-toast';
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
        border: '1px solid rgba(0,229,255,0.4)',
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

    toast.querySelector('button').addEventListener('click', () => dismissPathFoundToast(toast));

    clearTimeout(toast._dismissTimer);
    toast._dismissTimer = setTimeout(() => dismissPathFoundToast(toast), 4000);
}

function closeNavigatePopup() {
    const existingPopup = document.getElementById('navigate-choice-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
}

function findLocationByName(roomName) {
    if (!roomName) return null;

    const normalizedRoomName = String(roomName).trim().toLowerCase();
    const exactMatch = locations.find((loc) => loc.room_name.toLowerCase() === normalizedRoomName);
    if (exactMatch) return exactMatch;

    const partialMatches = locations.filter((loc) =>
        loc.room_name.toLowerCase().includes(normalizedRoomName)
    );

    return partialMatches.length === 1 ? partialMatches[0] : null;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createDestinationOptions() {
    return locations
        .filter((loc) => loc.room_name && !loc.room_name.toLowerCase().startsWith('point'))
        .map((loc) => `<option value="${escapeHtml(loc.room_name)}"></option>`)
        .join('');
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
const emergencyAllExitsBtn = document.getElementById('emergencyAllExitsBtn');
if (emergencyAllExitsBtn) {
    emergencyAllExitsBtn.addEventListener('click', toggleEmergencyPaths);
}

let emergencyLayer = L.layerGroup();
let emergencyCache = null;
let isLoadingEmergency = false;
let pulseTimers = [];

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
                pathOptions: {
                    color: 'red',
                    weight: 2,
                    opacity: opacity
                }
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

        if (!emergencyCache) {
            const res = await fetch('emergency-paths/');
            if (!res.ok) throw new Error("Failed to load emergency paths");
            emergencyCache = await res.json();
        }

        emergencyLayer.clearLayers();
        clearPulseAnimations();

        emergencyCache.forEach(path => {
            const from = path.from;
            const to = path.to;

            if (String(from[2]) !== String(currentFloor) ||
                String(to[2]) !== String(currentFloor)) return;

            const coords = [
                [from[0], from[1]],
                [to[0], to[1]]
            ];

            const decorator = L.polylineDecorator(coords, {
                patterns: [
                    {
                        offset: 0,
                        repeat: 20,
                        symbol: L.Symbol.arrowHead({
                            pixelSize: 10,
                            polygon: false,
                            pathOptions: {
                                color: 'red',
                                weight: 2,
                                opacity: 0.9
                            }
                        })
                    }
                ]
            }).addTo(emergencyLayer);

            startPulse(decorator);
        });

        emergencyLayer.addTo(map);

    } catch (err) {
        console.error("Emergency paths error:", err);
        alert("Could not load emergency paths. Please try again.");
    } finally {
        isLoadingEmergency = false;
    }
}

// auto-trigger from ?emergency=true redirect
const params = new URLSearchParams(window.location.search);
if (params.get('emergency') === 'true') {
    map.whenReady(() => toggleEmergencyPaths());
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
                <input
                    id="navigateDestination"
                    type="text"
                    list="navigateDestinationList"
                    placeholder="Search destination"
                    autocomplete="off"
                >
                <datalist id="navigateDestinationList">
                    ${createDestinationOptions()}
                </datalist>
                <button type="submit" class="navigate-choice-option navigate-choice-scan">
                    <i class="fa-solid fa-qrcode"></i>
                    <span>Scan QR</span>
                </button>
            </form>
        `;

    document.body.appendChild(popup);

    popup.querySelector('.navigate-choice-close').addEventListener('click', closeNavigatePopup);
    popup.querySelector('[data-nav-mode="manual"]').addEventListener('click', startManualNavigation);
    popup.querySelector('.navigate-choice-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const destinationInput = popup.querySelector('#navigateDestination');
        startQrNavigation(destinationInput.value);
    });
}

var coordControl = L.control({ position: 'bottomleft' });

coordControl.onAdd = function () {
    this._div = L.DomUtil.create('div', 'coords-display');
    this._div.innerHTML = "Move around map";
    return this._div;
};

coordControl.addTo(map);

map.on('mousemove', function (e) {
    coordControl._div.innerHTML =
        "Y: " + e.latlng.lat.toFixed(1) +
        " | X: " + e.latlng.lng.toFixed(1);
});

var locations = JSON.parse(
    document.getElementById("locations-data").textContent
);

var path = JSON.parse(
    document.getElementById("path-data").textContent
);

// HANDLE SCANNED QR CODE LOCATION
function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

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

        currentFloor = location.floor;
        switchFloor(location.floor);

        // ✅ clear any previous scanned marker first
        if (scannedLocationMarker) {
            floors[currentFloor]?.layer.removeLayer(scannedLocationMarker);
            if (map.hasLayer(scannedLocationMarker)) map.removeLayer(scannedLocationMarker);
            scannedLocationMarker = null;
        }

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
            <div style="text-align: center; padding: 10px;">
                <strong>${location.name || 'QR Location'}</strong><br>
                X: ${location.x.toFixed(2)}<br>
                Y: ${location.y.toFixed(2)}<br>
                Floor: ${location.floor}
            </div>
        `);

        floors[location.floor].layer.addLayer(marker);
        marker.openPopup();

        // ✅ assign to scannedLocationMarker so switchFloor can remove it
        scannedLocationMarker = marker;

        const pendingDestination = sessionStorage.getItem(PENDING_DESTINATION_KEY);
        if (pendingDestination) {
            sessionStorage.removeItem(PENDING_DESTINATION_KEY);
            if (location.name) {
                requestPath(location.name, pendingDestination);
            } else {
                alert('QR location found, but it does not include a room name.');
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

function showStartToast(locationName) {
    const existing = document.getElementById('pathfound-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pathfound-toast';
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
        border: '1px solid rgba(255,107,107,0.4)',
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

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}
const currentPathLayers = [];

function clearCurrentPath() {
    currentPathLayers.forEach((layer) => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    currentPathLayers.length = 0;
}

function splitPathIntoFloorSegments(pathCoords) {
    const segments = [];
    let segFloor = null;
    let currentSegment = [];

    pathCoords.forEach((coord) => {
        const [lat, lng, floor] = coord;

        if (segFloor === null) {
            segFloor = floor;
            currentSegment = [[lat, lng]];
            return;
        }

        if (floor !== segFloor) {
            if (currentSegment.length >= 2) {
                segments.push({
                    floor: segFloor,
                    coords: currentSegment
                });
            }
            segFloor = floor;
            currentSegment = [[lat, lng]];
        } else {
            currentSegment.push([lat, lng]);
        }
    });

    if (currentSegment.length >= 2) {
        segments.push({
            floor: segFloor,
            coords: currentSegment
        });
    }

    return segments;
}

function getFirstPathFloor(pathData) {
    if (Array.isArray(pathData)) {
        if (pathData.length > 0 && Array.isArray(pathData[0]) && pathData[0].length >= 3) {
            return normalizeFloorId(pathData[0][2]);
        }

        return null;
    }

    if (pathData && Array.isArray(pathData.segments) && pathData.segments.length > 0) {
        return normalizeFloorId(pathData.segments[0].floor);
    }

    return null;
}


function drawPath(pathData) {
    if (!pathData) return;

    const firstPathFloor = getFirstPathFloor(pathData);
    if (firstPathFloor && firstPathFloor !== currentFloor && floors[firstPathFloor]) {
        switchFloor(firstPathFloor);
    }

    clearCurrentPath();

    let segments = [];

    if (Array.isArray(pathData)) {
        if (pathData.length === 0) return;
        if (Array.isArray(pathData[0]) && pathData[0].length >= 3) {
            segments = splitPathIntoFloorSegments(pathData);
        } else {
            segments = [{ floor: currentFloor, coords: pathData }];
        }
    } else if (pathData.segments) {
        segments = pathData.segments;
    }

    segments.forEach((segment) => {
        const layer = L.polyline.antPath((segment.coords), {
            color: "#00E5FF",
            weight: 6,
            delay: 100,
            dashArray: [10, 25],
            pulseColor: "#ffffff",
            paused: false,
            reverse: false,
            hardwareAccelerated: true,
            lineJoin: 'round',   // rounds the corner where two segments meet
            lineCap: 'round'
        });

        layer.segmentFloor = segment.floor;
        currentPathLayers.push(layer);

        if (segment.floor === currentFloor) {
            map.addLayer(layer);
        }
    });
}

function finishPathfinding(pathData) {
    drawPath(pathData);
    setPathfindingMode(false);
}

function findOfflinePath(start, end) {
    const graph = window.OfflinePathfinder?.loadGraphFromPage?.();

    if (!graph) {
        return false;
    }

    const result = window.OfflinePathfinder.findPath(
        graph.locations,
        graph.connections,
        start,
        end
    );

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
    if (!navigator.onLine) {
        const graph = window.OfflinePathfinder?.loadGraphFromPage?.();

        if (graph) {
            const result = window.OfflinePathfinder.findPath(
                graph.locations,
                graph.connections,
                start,
                end
            );

            if (result.error) {
                alert(`❌ ${result.error}`);
                return;
            }

            console.log('PATH (offline):', result.path);
            finishPathfinding(result);
            showPathFoundToast(end);
            return;
        }
    }

    const csrftoken = getCSRFToken();

    if (!csrftoken) {
        if (findOfflinePath(start, end)) {
            return;
        }

        console.error('CSRF token missing — request blocked');
        return;
    }

    fetch('/pathfind/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrftoken
        },
        body: JSON.stringify({
            start,
            end
        })
    })
        .then(async (response) => {
            if (!response.ok) {
                const text = await response.text();
                console.error('SERVER ERROR:', text);
                if (findOfflinePath(start, end)) {
                    return null;
                }
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
            if (findOfflinePath(start, end)) {
                return;
            }
            alert('❌ Error finding path. Check console for details.');
        });
}

drawPath(path);

// Check if a QR code location was scanned and display it
handleScannedLocation();

function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrftoken='));

    return match ? match.split('=')[1] : null;
}

// TOGGLE PATHFINDING MODE WITH COMPASS BUTTON
const compassBtn = document.getElementById('navbtn');
if (compassBtn) {
    compassBtn.addEventListener('click', (e) => {
        e.preventDefault();

        if (pathfindingMode) {
            setPathfindingMode(false);
        } else {
            openNavigatePopup();
        }
    });
} else {
    console.error("Compass button not found");
}

// LOCATION CLICK HANDLER WITH MODE CHECK
locations.forEach(function (loc) {
    const polygon = L.polygon(loc.coordinates, {
        color: "transparent",
        weight: 2,
        fillOpacity: 0.15
    }).addTo(floors[loc.floor].layer);
    polygon.bindPopup(`<b>${loc.room_name}</b>`);

    polygon.on("click", function () {
        if (!pathfindingMode) {
            console.log("Pathfinding mode disabled. Click the compass button first!");
            return;
        }

        console.log("CLICKED (pathfinding mode):", loc.room_name);

        selected.push(loc.room_name);
        console.log("Selected:", selected);

        const csrftoken = getCSRFToken();

        if (!csrftoken) {
            console.error("CSRF token missing — request blocked");
            selected = [];
            return;
        }

        if (selected.length === 1) {
            polygon.bindPopup(`
                    Start Detected
                    `).openPopup();
            setTimeout(() => polygon.closePopup(), 1500);
        }

        if (selected.length === 2) {
            console.log("Sending pathfind request...");

            const start = selected[0];
            const end = selected[1];
            setPathfindingMode(false);
            requestPath(start, end);
        }
    });
});
function switchFloor(floor) {
    if (!floors[floor]) return;

    const previousFloor = currentFloor;

    // Remove previous floor layers
    if (floors[previousFloor]) {
        map.removeLayer(floors[previousFloor].image);
        map.removeLayer(floors[previousFloor].layer);
    }

    // Remove current path layers
    currentPathLayers.forEach((layer) => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });

    // Remove scanned location marker
    if (scannedLocationMarker) {
        if (floors[previousFloor] && floors[previousFloor].layer) {
            floors[previousFloor].layer.removeLayer(scannedLocationMarker);
        }
        if (map.hasLayer(scannedLocationMarker)) {
            map.removeLayer(scannedLocationMarker);
        }
        scannedLocationMarker = null;
    }

    // ✅ clear emergency paths on floor switch
    const emergencyWasShowing = map.hasLayer(emergencyLayer);
    emergencyLayer.clearLayers();
    map.removeLayer(emergencyLayer);

    currentFloor = floor;

    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);
    fitCurrentFloor();

    // Re-add path layers for the new floor
    currentPathLayers.forEach((layer) => {
        if (layer.segmentFloor === currentFloor) {
            map.addLayer(layer);
        }
    });

    // ✅ re-render emergency paths for new floor if they were active
    if (emergencyWasShowing) {
        toggleEmergencyPaths();
    }
}

document.querySelectorAll(".floor-item").forEach((btn) => {
    btn.addEventListener("click", () => {
        const floor = parseInt(btn.dataset.floor);
        switchFloor(floor);
    });
});

// search.js
document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const suggestionsList = document.getElementById('suggestionsList');
    let searchLocationsCache = [];
    let searchTimer;

    function loadLocations() {
        try {
            const locationsElem = document.getElementById('locations-data');
            if (locationsElem && locationsElem.textContent) {
                const parsed = JSON.parse(locationsElem.textContent);
                searchLocationsCache = Array.isArray(parsed) ? parsed : [];
                console.log(`✅ Loaded ${searchLocationsCache.length} locations for search`);
            }
        } catch (error) {
            console.error('Failed to load locations:', error);
            searchLocationsCache = [];
        }
    }

    function removeCurrentMarker() {
        if (currentMarkerTimeout) {
            clearTimeout(currentMarkerTimeout);
            currentMarkerTimeout = null;
        }

        searchMarkerLayer.clearLayers();
        currentMarker = null;
    }

    function searchLocations(query) {
        if (!query || query.length < 2) return [];

        return searchLocationsCache.filter(loc =>
            loc.room_name.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 10);
    }

    function displaySuggestions(suggestions) {
        suggestionsList.innerHTML = '';

        if (suggestions.length === 0) {
            suggestionsList.classList.remove('show');
            return;
        }

        suggestions.forEach(loc => {
            const li = document.createElement('li');
            li.className = 'suggestion-item';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'suggestion-name';
            nameDiv.textContent = loc.room_name;

            const floorDiv = document.createElement('div');
            floorDiv.className = 'suggestion-floor';
            floorDiv.textContent = `Floor ${loc.floor}`;

            li.appendChild(nameDiv);
            li.appendChild(floorDiv);

            li.addEventListener('click', (e) => {
                e.preventDefault();
                searchInput.value = loc.room_name;
                suggestionsList.classList.remove('show');

                if (typeof window.switchFloor === 'function') {
                    window.switchFloor(loc.floor);

                    setTimeout(() => {
                        if (loc.y_coordinate && loc.x_coordinate) {
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
                                    <div style="text-align: center; padding: 10px;">
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

                                if (currentMarkerTimeout) {
                                    currentMarkerTimeout = null;
                                }
                            }, 5000);

                            console.log(`✅ Navigated to: ${loc.room_name}`);
                        } else {
                            console.warn('No coordinates for location:', loc);
                        }
                    }, 300);
                } else {
                    if (typeof window.findAndZoomToLocation === 'function') {
                        window.findAndZoomToLocation(loc.room_name);
                    }
                }
            });

            suggestionsList.appendChild(li);
        });

        suggestionsList.classList.add('show');
    }

    searchInput.addEventListener('input', function (e) {
        clearTimeout(searchTimer);
        const query = this.value.trim();

        if (query.length < 2) {
            suggestionsList.classList.remove('show');
            return;
        }

        searchTimer = setTimeout(() => {
            const results = searchLocations(query);
            displaySuggestions(results);
        }, 250);
    });

    document.addEventListener('click', function (e) {
        if (!searchInput.contains(e.target) && !suggestionsList.contains(e.target)) {
            suggestionsList.classList.remove('show');
        }
    });

    loadLocations();
});

function urlOutside() {
    const params = new URLSearchParams(window.location.search);

    const start = params.get("start");
    const end = params.get("end");

    if (start && end) {
        requestPath(start, end);
    }
}

urlOutside();   