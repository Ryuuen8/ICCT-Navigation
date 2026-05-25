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

var bounds = [[0, 0], [1000, 1000]];

// IMAGE OVERLAY
L.imageOverlay('/static/hallways.svg', bounds).addTo(map);

map.fitBounds(bounds, {
    padding: window.innerWidth < 768 ? [40, 40] : [20, 20]
});

map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

// throttle resize (important for mobile FPS)
let resizeTimeout;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(bounds, {
            padding: window.innerWidth < 768 ? [40, 40] : [20, 20]
        });
    }, 150);
});

function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='));

    return match ? match.split('=')[1] : null;
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

var path = JSON.parse(document.getElementById("path-data").textContent);

let staticPathLayer = null;
let currentPath = null;

// initial path (ONLY ONE antPath)
if (path.length > 0) {
    staticPathLayer = L.polyline.antPath(path, {
        color: "#00E5FF",
        weight: 6,
        opacity: 0.4,
        delay: 800,
        pulseColor: "#FFFFFF"
    }).addTo(map);
}


let selected = [];

var locations = JSON.parse(
    document.getElementById("locations-data").textContent
);

locations.forEach((loc) => {

    let marker = L.marker([loc.y_coordinate, loc.x_coordinate])
        .addTo(map);

    marker.bindPopup(`<b>${loc.room_name}</b>`);

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

            if (!response.ok) return;

            const data = await response.json();

            // remove old dynamic path only
            if (currentPath) {
                map.removeLayer(currentPath);
            }

            currentPath = L.polyline.antPath(data.path, {
                color: "#00E5FF",
                weight: 5,
                delay: 600,
                pulseColor: "#FFFFFF"
            }).addTo(map);

        } catch (err) {
            console.error("PATH ERROR:", err);
        }

        selected = [];
    });
});