// MAP SETUP
console.log("MAP JS LOADED");
console.log("navbtn at load:", document.getElementById("navbtn"));
var map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 3,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 120,
    touchZoom: true,
    tap: true,
    bounceAtZoomLimits: false
});

const bounds = [[0, 0], [1000, 1000]];

const floors = {
    1: {
        image: L.imageOverlay('/static/images/first-floor.svg', bounds),
        layer: L.layerGroup()
    },
    2: {
        image: L.imageOverlay('/static/images/second-floor.svg', bounds),
        layer: L.layerGroup()
    },
    3: {
        image: L.imageOverlay('/static/images/third-floor.svg', bounds),
        layer: L.layerGroup()
    },
    4: {
        image: L.imageOverlay('/static/images/fourth-floor.svg', bounds),
        layer: L.layerGroup()
    },
    5: {
        image: L.imageOverlay('/static/images/fifth-floor.svg', bounds),
        layer: L.layerGroup()
    }
};

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

let currentFloor = normalizeFloorId(
    new URLSearchParams(window.location.search).get('floor')
) ?? 1;
let currentPath = null;
let selected = [];
let currentMarker = null;
let currentMarkerTimeout = null;
const searchMarkerLayer = L.layerGroup().addTo(map);

// Brief: client-side map controller used on the floor map pages.
// - Shows floor overlays, handles floor switching
// - Toggles a one-time "pathfinding" mode via the nav button
// - Collects two location clicks, POSTs to `/pathfind/`, and draws the returned path

// PATHFINDING MODE TOGGLE
let pathfindingMode = false;

function setPathfindingMode(active) {
    pathfindingMode = active;

    if (compassBtn) {
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
            // Clear selections when disabling pathfinding so users start fresh
            selected = [];
        }
    }
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

map.fitBounds(bounds, {
    padding: window.innerWidth < 768 ? [40, 40] : [20, 20]
});

map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

let resizeTimer;

window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
        map.invalidateSize();

        map.fitBounds(bounds, {
            padding: window.innerWidth < 768 ? [40, 40] : [20, 20]
        });
    }, 150);
});

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
            history.replaceState(null, '', window.location.pathname);
        }
    }

    if (!scannedData) return;

    try {
        const location = JSON.parse(scannedData);
        sessionStorage.removeItem('scannedLocation');

        // Switch to the correct floor
        currentFloor = location.floor;
        switchFloor(location.floor);

        // Create a marker at the scanned coordinates
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

        // Center map on the scanned location
        //map.setView([location.y, location.x], 2);

        console.log('Scanned location displayed:', location);
    } catch (error) {
        console.error('Error handling scanned location:', error);
    }
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
    let currentFloor = null;
    let currentSegment = [];

    pathCoords.forEach((coord) => {
        const [lat, lng, floor] = coord;

        if (currentFloor === null) {
            currentFloor = floor;
            currentSegment = [[lat, lng]];
            return;
        }

        if (floor !== currentFloor) {
            if (currentSegment.length >= 2) {
                segments.push({
                    floor: currentFloor,
                    coords: currentSegment
                });
            }
            currentFloor = floor;
            currentSegment = [[lat, lng]];
        } else {
            currentSegment.push([lat, lng]);
        }
    });

    if (currentSegment.length >= 2) {
        segments.push({
            floor: currentFloor,
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

// Helper: split returned path coordinates into contiguous floor segments



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
        // Full path with floor as third coordinate
        if (Array.isArray(pathData[0]) && pathData[0].length >= 3) {
            segments = splitPathIntoFloorSegments(pathData);
        } else {
            segments = [{ floor: currentFloor, coords: pathData }];
        }
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
            hardwareAccelerated: true
        });

        layer.segmentFloor = segment.floor;
        currentPathLayers.push(layer);

        if (segment.floor === currentFloor) {
            map.addLayer(layer);
        }
    });
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
    drawPath(result);
    alert(`Path found from ${start} to ${end}!`);
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
            drawPath(result);
            alert(`✅ Path found from ${start} to ${end}!`);
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

    if (!csrftoken) {
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
            drawPath(data);
            alert(`✅ Path found from ${start} to ${end}!`);
        })
        .catch((error) => {
            console.error('FETCH ERROR:', error);
            if (findOfflinePath(start, end)) {
                return;
            }
            alert('❌ Error finding path. Check console for details.');
        });
}

// Draws the path layers for the current floor and stores them in
// `currentPathLayers` so they can be cleared or toggled when switching floors.

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
        pathfindingMode = !pathfindingMode;

        if (pathfindingMode) {
            compassBtn.style.backgroundColor = '#00E5FF';
            compassBtn.style.color = '#000';
            compassBtn.style.borderRadius = '8px';
            compassBtn.style.transition = 'all 0.3s ease';
            document.getElementById('map').style.cursor = 'crosshair';
        } else {
            compassBtn.style.backgroundColor = 'transparent';
            compassBtn.style.color = '';
            document.getElementById('map').style.cursor = '';
            selected = [];
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
            return; // EXIT - don't proceed
        }
        // When active: collect the clicked room name. After two clicks a
        // POST is sent to the server to compute a route. The client will
        // then draw the route and automatically deactivate the nav button
        // so the user must re-enable pathfinding for another route.
        // Only proceed if mode is active
        console.log("CLICKED (pathfinding mode):", loc.room_name);

        selected.push(loc.room_name);
        console.log("Selected:", selected);

        const csrftoken = getCSRFToken();

        if (!csrftoken) {
            console.error("CSRF token missing — request blocked");
            selected = [];
            return;
        }

        // Show feedback for first selection
        if (selected.length === 1) {
            polygon.bindPopup(`
                BACOOR
                `).openPopup();
            setTimeout(() => polygon.closePopup(), 1500);
        }

        // WAIT UNTIL TWO SELECTIONS
        if (selected.length === 2) {
            console.log("Sending pathfind request...");

            const start = selected[0];
            const end = selected[1];
            requestPath(start, end);

            selected = [];
        }
    });
});

function switchFloor(floor) {
    if (!floors[floor]) return;

    const previousFloor = currentFloor;

    // remove current
    if (floors[previousFloor]) {
        map.removeLayer(floors[previousFloor].image);
        map.removeLayer(floors[previousFloor].layer);
    }
    currentPathLayers.forEach((layer) => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });

    currentFloor = floor;

    // add new
    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);

    currentPathLayers.forEach((layer) => {
        if (layer.segmentFloor === currentFloor) {
            map.addLayer(layer);
        }
    });
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
    let locations = [];
    let searchTimer;

    // Load locations from your Django JSON script tag
    function loadLocations() {
        try {
            const locationsElem = document.getElementById('locations-data');
            if (locationsElem && locationsElem.textContent) {
                const parsed = JSON.parse(locationsElem.textContent);
                locations = Array.isArray(parsed) ? parsed : [];
                console.log(`✅ Loaded ${locations.length} locations for search`);
            }
        } catch (error) {
            console.error('Failed to load locations:', error);
            locations = [];
        }
    }
    function removeCurrentMarker() {
        if (currentMarkerTimeout) {
            clearTimeout(currentMarkerTimeout);
            currentMarkerTimeout = null;
        }

        searchMarkerLayer.clearLayers();

        if (currentMarker) {
            console.log('Previous marker removed');
        }

        currentMarker = null;
    }
    // Search and display suggestions
    function searchLocations(query) {
        if (!query || query.length < 2) return [];

        return locations.filter(loc =>
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

                // Trigger map navigation
                if (typeof window.switchFloor === 'function') {
                    window.switchFloor(loc.floor);

                    // Wait for floor to switch before adding marker
                    setTimeout(() => {
                        // Check if coordinates exist
                        if (loc.y_coordinate && loc.x_coordinate) {
                            removeCurrentMarker();

                            // Create marker
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

                            // Add popup to marker
                            currentMarker.bindPopup(`
                                <div style="text-align: center; padding: 10px;">
                                    <strong>📍 ${loc.room_name}</strong><br>
                                    Floor: ${loc.floor}<br>
                                    <small>Search result</small>
                                </div>
                            `).openPopup();

                            // Center map on marker

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
                    // Fallback if switchFloor isn't available
                    if (typeof window.findAndZoomToLocation === 'function') {
                        window.findAndZoomToLocation(loc.room_name);
                    }
                }
            });

            suggestionsList.appendChild(li);
        });

        suggestionsList.classList.add('show');
    }

    // Event listeners
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

    // Close suggestions on outside click
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
