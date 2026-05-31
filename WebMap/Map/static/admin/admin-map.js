// =========================
// MAP SETUP
// =========================

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

// =========================
// FLOORS SYSTEM (UPDATED)
// =========================

const floors = {
    1: {
        image: L.imageOverlay('/static/images/first-floor.svg', bounds),
        layer: L.layerGroup(),
        drawLayer: L.featureGroup()
    },
    2: {
        image: L.imageOverlay('/static/images/second-floor.svg', bounds),
        layer: L.layerGroup(),
        drawLayer: L.featureGroup()
    },
    3: {
        image: L.imageOverlay('/static/images/third-floor.svg', bounds),
        layer: L.layerGroup(),
        drawLayer: L.featureGroup()
    },
    4: {
        image: L.imageOverlay('/static/images/fourth-floor.svg', bounds),
        layer: L.layerGroup(),
        drawLayer: L.featureGroup()
    },
    5: {
        image: L.imageOverlay('/static/images/fifth-floor.svg', bounds),
        layer: L.layerGroup(),
        drawLayer: L.featureGroup()
    }
};

let currentFloor = 1;
let currentPath = null;
let selected = [];

// =========================
// INIT FLOORS
// =========================

function initFloors() {
    Object.keys(floors).forEach((key) => {
        const f = floors[key];

        f.image.addTo(map);
        f.layer.addTo(map);
        f.drawLayer.addTo(map);

        if (parseInt(key) !== currentFloor) {
            map.removeLayer(f.image);
            map.removeLayer(f.layer);
            map.removeLayer(f.drawLayer);
        }
    });
}

initFloors();

// =========================
// FIT MAP
// =========================

map.fitBounds(bounds, {
    padding: window.innerWidth < 768 ? [40, 40] : [20, 20]
});

map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

// =========================
// RESIZE FIX
// =========================

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

// =========================
// COORD DISPLAY
// =========================

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

// =========================
// DATA FROM DJANGO
// =========================

var locations = JSON.parse(
    document.getElementById("locations-data").textContent
);

var path = JSON.parse(
    document.getElementById("path-data").textContent
);

// =========================
// ANT PATH
// =========================

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

// =========================
// CSRF
// =========================

function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='));

    return match ? match.split('=')[1] : null;
}

// =========================
// ROOM MARKERS + PATHFINDING
// =========================

locations.forEach((loc) => {

    let marker = L.marker([
        loc.y_coordinate,
        loc.x_coordinate
    ]);

    marker.bindPopup(`<b>${loc.room_name}</b>`);

    if (floors[loc.floor]) {
        floors[loc.floor].layer.addLayer(marker);
    }

    marker.on("click", async function () {

        selected.push(loc.room_name);

        if (selected.length < 2) return;

        const csrftoken = getCSRFToken();
        if (!csrftoken) return;

        try {
            const response = await fetch("/pathfind/", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrftoken
                },
                body: JSON.stringify({
                    start: selected[0],
                    end: selected[1]
                })
            });

            const data = await response.json();
            drawPath(data.path);

        } catch (err) {
            console.error(err);
        }

        selected = [];
    });
});

// =========================
// FLOOR SWITCH
// =========================

function switchFloor(floor) {
    if (!floors[floor]) return;

    // remove current
    map.removeLayer(floors[currentFloor].image);
    map.removeLayer(floors[currentFloor].layer);
    map.removeLayer(floors[currentFloor].drawLayer);
    if (currentPath) {
        map.removeLayer(currentPath);
    }
    currentFloor = floor;

    // add new
    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);
    map.addLayer(floors[currentFloor].drawLayer);

    if (drawControl && drawControl.options && drawControl.options.edit) {
        drawControl.options.edit.featureGroup = floors[currentFloor].drawLayer;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".floor-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const floor = parseInt(btn.dataset.floor, 10);
            switchFloor(floor);
        });
    });
});


/// ======================================================
// 🧩 POLYGON ROOM EDITOR (NEW ADDITION)
// ======================================================

// DRAW CONTROL
const drawControl = new L.Control.Draw({
    draw: {
        polygon: true,
        rectangle: true,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false
    },
    edit: {
        featureGroup: floors[currentFloor].drawLayer
    }
});

map.addControl(drawControl);

// WHEN A ROOM IS DRAWN
map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;

    floors[currentFloor].drawLayer.addLayer(layer);
});

// =========================
// CENTER CALCULATION
// =========================

function getCenter(points) {

    let area = 0;
    let x = 0;
    let y = 0;

    for (let i = 0; i < points.length; i++) {

        const j = (i + 1) % points.length;

        const p1 = points[i];
        const p2 = points[j];

        const f = (p1.lng * p2.lat) - (p2.lng * p1.lat);

        area += f;
        x += (p1.lng + p2.lng) * f;
        y += (p1.lat + p2.lat) * f;
    }

    area *= 0.5;

    if (area === 0) {
        // fallback for straight line / invalid polygon
        let sx = 0, sy = 0;

        points.forEach(p => {
            sx += p.lng;
            sy += p.lat;
        });

        return {
            x: sx / points.length,
            y: sy / points.length
        };
    }

    x = x / (6 * area);
    y = y / (6 * area);

    return { x, y };
}
// =========================
// SAVE ROOMS TO DJANGO
// =========================

 
async function saveRooms() {

    const layers = floors[currentFloor].drawLayer.getLayers();

    if (layers.length === 0) {
        alert("No rooms drawn yet.");
        return;
    }

    // 🔥 Ask names BEFORE mapping (safe context)
    window.saveRooms = async function () {

        console.log("saveRooms STARTED");

        const drawLayer = floors[currentFloor].drawLayer;

        console.log("currentFloor:", currentFloor);
        console.log("drawLayer:", drawLayer);

        const layers = drawLayer.getLayers();

        console.log("layers found:", layers);

        if (!layers || layers.length === 0) {
            alert("No rooms drawn yet!");
            console.log("EXIT: no layers");
            return;
        }

        const rooms = layers.map((layer, i) => {

            const points = layer.getLatLngs()[0];
            const center = getCenter(points);

            return {
                room_name: `Room ${currentFloor}-${i + 1}`,
                floor: currentFloor,
                polygon: points.map(p => [p.lat, p.lng]),
                center_x: center.x,
                center_y: center.y
            };
        });

        console.log("📤 rooms payload:", rooms);

        try {
            const res = await fetch("save-room/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify({ rooms })
            });

            console.log("📡 response status:", res.status);

            const text = await res.text();
            console.log("📥 raw response:", text);

            alert("Save complete (check console)");

        } catch (err) {
            console.error("💥 FETCH ERROR:", err);
        }
    }
}
map.on('draw:created', function (e) {
    console.log("DRAW WORKS:", e.layer);
    e.layer.addTo(map);
}); 