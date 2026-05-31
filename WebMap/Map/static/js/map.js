// =========================
// MAP SETUP
// =========================
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

let currentFloor = 1;
let currentPath = null;
let selected = [];

// =========================
// PATHFINDING MODE TOGGLE
// =========================
let pathfindingMode = false;

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

function drawPath(pathData) {
    if (!pathData || pathData.length === 0) return;

    if (currentPath) {
        map.removeLayer(currentPath);
    }

    currentPath = L.polyline.antPath(pathData, {
        color: "#00E5FF",
        weight: 6,
        delay: 100,
        dashArray: [10, 25],
        pulseColor: "#ffffff",
        paused: false,
        reverse: false,
        hardwareAccelerated: true
    }).addTo(map);
}

drawPath(path);

function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrftoken='));

    return match ? match.split('=')[1] : null;
}

// =========================
// TOGGLE PATHFINDING MODE WITH COMPASS BUTTON
// =========================
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
            // Change cursor style on map container
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

// =========================
// LOCATION CLICK HANDLER WITH MODE CHECK
// =========================
locations.forEach(function (loc) {
    // CREATE POLYGON
    const polygon = L.polygon(loc.coordinates, {
        color: "transparent",
        weight: 2,
        fillOpacity: 0.15
    }).addTo(map);

    // popup
    polygon.bindPopup(`<b>${loc.room_name}</b>`);

    // CLICK EVENT ON POLYGON
    polygon.on("click", function () {
        // CHECK IF PATHFINDING MODE IS ACTIVE
        if (!pathfindingMode) {
            console.log("Pathfinding mode disabled. Click the compass button first!");
            return; // EXIT - don't proceed
        }
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

            fetch("/pathfind/", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrftoken
                },
                body: JSON.stringify({
                    start: start,
                    end: end
                })
            })
                .then(async (response) => {
                    if (!response.ok) {
                        const text = await response.text();
                        console.error("SERVER ERROR:", text);
                        return;
                    }

                    return response.json();
                })
                .then((data) => {
                    if (!data) return;

                    console.log("PATH:", data.path);

                    // remove old path
                    if (currentPath) {
                        map.removeLayer(currentPath);
                    }

                    // draw new path
                    currentPath = L.polyline.antPath(data.path, {
                        color: "#00E5FF",
                        weight: 6,
                        delay: 800,
                        pulseColor: "#FFFFFF"
                    }).addTo(map);

                    // Show success feedback
                    alert(`✅ Path found from ${start} to ${end}!`);
                })
                .catch((error) => {
                    console.error("FETCH ERROR:", error);
                    alert("❌ Error finding path. Check console for details.");
                });

            selected = [];
        }
    });
});

function switchFloor(floor) {
    if (!floors[floor]) return;

    // remove current
    map.removeLayer(floors[currentFloor].image);
    map.removeLayer(floors[currentFloor].layer);
    if (currentPath) {
        map.removeLayer(currentPath);
    }
    currentFloor = floor;

    // add new
    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);
}

document.querySelectorAll(".floor-item").forEach((btn) => {
    btn.addEventListener("click", () => {
        const floor = parseInt(btn.dataset.floor);
        switchFloor(floor);
    });
});
