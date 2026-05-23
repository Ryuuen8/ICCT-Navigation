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

// =========================
// MAP BOUNDS
// =========================

var bounds = [
    [0, 0],
    [1000, 1000]
];

// =========================
// SVG MAP
// =========================

L.imageOverlay(
    '/static/hallways.svg',
    bounds
).addTo(map);

// =========================
// OPTIONAL GIF OVERLAY
// =========================

var videoUrl = "/static/evernight-everknight.gif";

L.videoOverlay(videoUrl, bounds, {
    opacity: 0.15
}).addTo(map);

// =========================
// FIT MAP TO SCREEN
// =========================

if (window.innerWidth < 768) {

    map.fitBounds(bounds, {
        padding: [40, 40]
    });

} else {

    map.fitBounds(bounds, {
        padding: [20, 20]
    });
}

// Prevent dragging outside map

map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

// =========================
// FIX MOBILE RESIZE BUGS
// =========================

window.addEventListener("resize", () => {
    map.invalidateSize();

    map.fitBounds(bounds, {
        padding: [20, 20]
    });
});

// =========================
// COORD DISPLAY
// =========================

var coordControl = L.control({
    position: 'bottomleft'
});

coordControl.onAdd = function () {

    this._div = L.DomUtil.create(
        'div',
        'coords-display'
    );

    this._div.innerHTML = "Move around map";

    return this._div;
};

coordControl.addTo(map);

// =========================
// LIVE COORDINATES
// =========================

map.on('mousemove', function (e) {

    coordControl._div.innerHTML =
        "Y: " +
        e.latlng.lat.toFixed(1) +
        " | X: " +
        e.latlng.lng.toFixed(1);
});

// =========================
// LOCATION DATA
// =========================

var locations = JSON.parse(
    document.getElementById(
        "locations-data"
    ).textContent
);

// =========================
// PATH DATA
// =========================

var path = JSON.parse(
    document.getElementById(
        "path-data"
    ).textContent
);

console.log("PATH:", path);

// =========================
// INITIAL PATH VISUALIZATION
// =========================

if (path.length > 0) {

    L.polyline.antPath(path, {
        color: "#00E5FF",
        weight: 12,
        opacity: 0.2,
        delay: 1200
    }).addTo(map);

    L.polyline.antPath(path, {
        color: "#00E5FF",
        weight: 5,
        opacity: 1,
        delay: 800,
        pulseColor: "#FFFFFF"
    }).addTo(map);
}

// =========================
// ROOM SELECTION
// =========================

let selected = [];
let currentPath = null;

// =========================
// CREATE MARKERS
// =========================

locations.forEach(function(loc) {

    let marker = L.marker([
        loc.y_coordinate,
        loc.x_coordinate
    ]).addTo(map);

    marker.bindPopup(`
        <b>${loc.room_name}</b>
    `);

    // =====================
    // CLICK EVENT
    // =====================

    
function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='));

    return match ? match.split('=')[1] : null;
}

marker.on("click", function () {

    console.log("CLICKED:", loc.room_name);
    selected.push(loc.room_name);
    console.log("Selected:", selected);

    const csrftoken = getCSRFToken();

    if (!csrftoken) {
        console.error("CSRF token missing — request blocked");
        return;
    }

    if (selected.length === 2) {

        console.log("Sending pathfind request...");

        fetch("/pathfind/", {
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
        })
        .then(async (response) => {

            if (!response.ok) {
                const text = await response.text();
                console.error("SERVER ERROR:", text);
                return;
            }

            return response.json();
        })
        .then(data => {

            if (!data) return;

            console.log("PATH:", data.path);

            // Remove old path safely
            if (currentPath) {
                map.removeLayer(currentPath);
            }

            // Draw new path
            currentPath = L.polyline.antPath(data.path, {
                color: "#00E5FF",
                weight: 6,
                delay: 800,
                pulseColor: "#FFFFFF"
            }).addTo(map);

        })
        .catch(error => {
            console.error("FETCH ERROR:", error);
        });

        selected = [];
        }
    });
});