// =========================
// MAP SETUP
// =========================

console.log("MAP JS LOADED - ADMIN PANEL");

// --- Use each floor plan's real SVG dimensions for accurate fit/zoom. ---
const floorPlans = {
    1: { imageUrl: '/static/images/1.svg', width: 934, height: 817 },
    2: { imageUrl: '/static/images/2.svg', width: 920, height: 639 },
    3: { imageUrl: '/static/images/3.svg', width: 920, height: 636 },
    4: { imageUrl: '/static/images/4.svg', width: 920, height: 635 },
    5: { imageUrl: '/static/images/5.svg', width: 918, height: 636 }
};

// In L.CRS.Simple, bounds are [[y_min, x_min], [y_max, x_max]]
function getFloorBounds(floor) {
    const plan = floorPlans[floor] || floorPlans[1];
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

function fitCurrentFloor() {
    map.setMinZoom(computeMinZoom());
    map.setMaxBounds(getPaddedFloorBounds(currentFloor));
    map.fitBounds(floors[currentFloor].bounds, getFitBoundsOptions());
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
            layer: L.layerGroup(),
            drawLayer: L.featureGroup(), // For drawn polygons
            nodeLayer: L.featureGroup()  // For hallway nodes
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
        f.drawLayer.addTo(map);
        f.nodeLayer.addTo(map);
        if (parseInt(key) !== currentFloor) {
            map.removeLayer(f.image);
            map.removeLayer(f.layer);
            map.removeLayer(f.drawLayer);
            map.removeLayer(f.nodeLayer);
        }
    });
}

initFloors();
fitCurrentFloorAfterLayout();

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

// =========================
// CSRF
// =========================

function getCSRFToken() {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='));
    return match ? match.split('=')[1] : null;
}
let connectionMode = false;
let selectedConnections = [];

// Toggle connection mode
document.getElementById("connectBtn").addEventListener("click", () => {
    connectionMode = !connectionMode;
    selectedConnections = [];

    alert(
        connectionMode
            ? "Connection mode enabled. Select 2 rooms."
            : "Connection mode disabled."
    );
});
// =========================
// ROOM MARKERS (VIEW ONLY)
// =========================
locations.forEach((loc) => {
    let marker = L.marker([
        loc.y_coordinate,
        loc.x_coordinate
    ]);

    marker.bindPopup(loc.room_name);

    floors[loc.floor].layer.addLayer(marker);

    marker.on("click", function () {

        // =========================
        // CONNECTION MODE CHECK
        // =========================
        if (!connectionMode) return;

        // prevent selecting same marker twice
        if (selectedConnections.includes(loc)) return;

        selectedConnections.push(loc);

        // visual feedback (selected state)
        marker.setOpacity(0.5);

        // =========================
        // WHEN TWO NODES SELECTED
        // =========================
        if (selectedConnections.length === 2) {

            const from = selectedConnections[0];
            const to = selectedConnections[1];

            fetch("/save-connection/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCSRFToken()
                },
                body: JSON.stringify({
                    from_room: from.room_name,
                    from_x: from.x_coordinate,
                    from_y: from.y_coordinate,

                    to_room: to.room_name,
                    to_x: to.x_coordinate,
                    to_y: to.y_coordinate,

                    cost: 20.0
                })
            })
                .then(async (res) => {
                    const data = await res.json();

                    if (!res.ok) {
                        throw new Error(data.error || "Request failed");
                    }

                    alert("Connection saved!");
                    console.log(data);

                    // reset selection
                    selectedConnections = [];
                    connectionMode = false;

                    // reset marker visuals
                    floors[loc.floor].layer.eachLayer(layer => {
                        if (layer instanceof L.Marker) {
                            layer.setOpacity(1);
                        }
                    });
                })
                .catch(err => {
                    console.error("Save failed:", err);
                    alert("Failed to save connection.");
                });
        }
    });
});
// =========================
// FLOOR SWITCH
// =========================

function switchFloor(floor) {
    if (!floors[floor]) {
        console.error(`❌ Floor ${floor} not found!`);
        return;
    }

    console.log(`🔄 Switching to floor ${floor}`);

    // Remove current floor layers
    if (floors[currentFloor]) {
        map.removeLayer(floors[currentFloor].image);
        map.removeLayer(floors[currentFloor].layer);
        if (floors[currentFloor].drawLayer) {
            map.removeLayer(floors[currentFloor].drawLayer);
        }
        if (floors[currentFloor].nodeLayer) {
            map.removeLayer(floors[currentFloor].nodeLayer);
        }
    }

    // Clear copy/paste selection — it doesn't carry across floors
    deselectPolygon();

    // Update current floor
    currentFloor = floor;

    // Add new floor layers
    map.addLayer(floors[currentFloor].image);
    map.addLayer(floors[currentFloor].layer);
    map.addLayer(floors[currentFloor].drawLayer);
    map.addLayer(floors[currentFloor].nodeLayer);

    // Recreate draw toolbar
    if (drawControl) {
        map.removeControl(drawControl);
    }

    drawControl = new L.Control.Draw({
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

    // Fit map to new floor
    fitCurrentFloor();

    // Update UI
    updateActiveFloor(floor);

    console.log(`✅ Switched to floor ${floor}`);
}

// =========================
// UPDATE ACTIVE FLOOR UI
// =========================

function updateActiveFloor(floor) {
    const floorItems = document.querySelectorAll(".floor-item");
    floorItems.forEach((item) => {
        const floorNum = parseInt(item.dataset.floor, 10);
        if (floorNum === floor) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'true');
        } else {
            item.classList.remove('active');
            item.removeAttribute('aria-current');
        }
    });

    // Update main floor button if it exists
    const mainFloorBtn = document.querySelector('.floors-box');
    if (mainFloorBtn) {
        const label = floor === 1 ? 'G' : String(floor);
        mainFloorBtn.textContent = label;
        mainFloorBtn.dataset.floor = floor;
        mainFloorBtn.classList.add('active');
    }
}

// =========================
// FLOOR ITEMS EVENT LISTENERS
// =========================

document.addEventListener("DOMContentLoaded", () => {
    const floorItems = document.querySelectorAll(".floor-item");

    if (!floorItems.length) {
        console.warn("⚠️ No floor items found!");
        return;
    }

    floorItems.forEach((btn) => {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            const floor = parseInt(this.dataset.floor, 10);
            if (!isNaN(floor)) {
                switchFloor(floor);
            }
        });
    });

    // Initialize active state
    updateActiveFloor(currentFloor);
});

// =========================
// DRAW CONTROL - ADMIN
// =========================

let drawControl = new L.Control.Draw({
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
    attachPolygonSelectHandler(layer);
    console.log(`✅ Polygon created on floor ${currentFloor}`);
});

// WHEN A ROOM IS EDITED
map.on(L.Draw.Event.EDITED, function (e) {
    const layers = e.layers;
    layers.eachLayer(function (layer) {
        console.log('✏️ Polygon edited:', layer);
    });
});

// WHEN A ROOM IS DELETED
map.on(L.Draw.Event.DELETED, function (e) {
    const layers = e.layers;
    layers.eachLayer(function (layer) {
        if (layer === selectedPolygonLayer) {
            deselectPolygon();
        }
        console.log('🗑️ Polygon deleted:', layer);
    });
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
// HALLWAY NODE FUNCTIONS
// =========================

// Custom node icon
const nodeIcon = L.divIcon({
    className: 'hallway-node',
    html: '●',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

// Variable to track node placement mode
let isNodePlacementMode = false;

// Toggle node placement mode
function toggleNodePlacement() {
    isNodePlacementMode = !isNodePlacementMode;

    if (isNodePlacementMode) {
        document.body.style.cursor = 'crosshair';
        console.log('✏️ Node placement mode ENABLED - Click on map to add nodes');
        alert('Node placement mode enabled. Click on the map to add hallway nodes.');
        map.on('click', placeNodeOnClick);
    } else {
        document.body.style.cursor = '';
        console.log('✏️ Node placement mode DISABLED');
        map.off('click', placeNodeOnClick);
    }
}

// Place node on click
function placeNodeOnClick(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // Get node name from user
    const nodeName = prompt('Enter node name (e.g., "Hallway Node 1", "Corner A", "Junction"):', `Node_${floors[currentFloor].nodeLayer.getLayers().length + 1}`);

    if (nodeName === null) return; // User cancelled

    const name = nodeName.trim() || `Node_${floors[currentFloor].nodeLayer.getLayers().length + 1}`;

    // Create node marker
    const marker = L.marker([lat, lng], {
        icon: nodeIcon,
        draggable: true
    });

    // Popup with node info
    marker.bindPopup(`
        <b>${name}</b><br>
        Floor: ${currentFloor}<br>
        Y: ${lat.toFixed(2)}<br>
        X: ${lng.toFixed(2)}
    `);

    // Store node data
    marker.nodeData = {
        name: name,
        floor: currentFloor,
        y_coordinate: lat,
        x_coordinate: lng,
        id: Date.now() // Temporary ID
    };

    // Add to node layer
    floors[currentFloor].nodeLayer.addLayer(marker);

    // Add drag event to update position
    marker.on('dragend', function () {
        const pos = marker.getLatLng();
        marker.nodeData.y_coordinate = pos.lat;
        marker.nodeData.x_coordinate = pos.lng;
        marker.setPopupContent(`
            <b>${marker.nodeData.name}</b><br>
            Floor: ${marker.nodeData.floor}<br>
            Y: ${pos.lat.toFixed(2)}<br>
            X: ${pos.lng.toFixed(2)}
        `);
        console.log('📍 Node moved:', marker.nodeData);
    });

    console.log('📍 Node placed:', marker.nodeData);
}

// Place node at specific coordinates
function placeNodeAt(lat, lng, name = null) {
    const nodeName = name || prompt('Enter node name:', `Node_${floors[currentFloor].nodeLayer.getLayers().length + 1}`);

    if (nodeName === null) return;

    const marker = L.marker([lat, lng], {
        icon: nodeIcon,
        draggable: true
    });

    marker.bindPopup(`
        <b>${nodeName}</b><br>
        Floor: ${currentFloor}<br>
        Y: ${lat.toFixed(2)}<br>
        X: ${lng.toFixed(2)}
    `);

    marker.nodeData = {
        name: nodeName,
        floor: currentFloor,
        y_coordinate: lat,
        x_coordinate: lng,
        id: Date.now()
    };

    floors[currentFloor].nodeLayer.addLayer(marker);

    marker.on('dragend', function () {
        const pos = marker.getLatLng();
        marker.nodeData.y_coordinate = pos.lat;
        marker.nodeData.x_coordinate = pos.lng;
        marker.setPopupContent(`
            <b>${marker.nodeData.name}</b><br>
            Floor: ${marker.nodeData.floor}<br>
            Y: ${pos.lat.toFixed(2)}<br>
            X: ${pos.lng.toFixed(2)}
        `);
    });

    return marker;
}

// Save nodes to Django
async function saveNodes() {
    const nodes = floors[currentFloor].nodeLayer.getLayers();

    if (nodes.length === 0) {
        alert('No hallway nodes to save.');
        return;
    }

    const nodeData = nodes.map(marker => marker.nodeData);

    console.log('📦 Saving nodes:', nodeData);

    try {
        const response = await fetch('/save-node/', {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCSRFToken()
            },
            body: JSON.stringify({
                center_x: x_coordinate,
                center_y: y_coordinate,
                floor: currentFloor
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text);
        }

        const data = await response.json();
        console.log('✅ Nodes saved:', data);
        alert(`✅ ${nodes.length} nodes saved successfully!`);

    } catch (err) {
        console.error('💥 Save failed:', err);
        alert('❌ Save failed. Check console for details.');
    }
}

// Load nodes from Django
async function loadNodes() {
    try {
        const response = await fetch(`/get-nodes/?floor=${currentFloor}`, {
            method: "GET",
            headers: {
                "X-CSRFToken": getCSRFToken()
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📥 Loaded nodes:', data);

        // Clear existing nodes
        floors[currentFloor].nodeLayer.clearLayers();

        // Add loaded nodes
        data.nodes.forEach(node => {
            const marker = L.marker([node.y_coordinate, node.x_coordinate], {
                icon: nodeIcon,
                draggable: true
            });

            marker.bindPopup(`
                <b>${node.name}</b><br>
                Floor: ${node.floor}<br>
                Y: ${node.y_coordinate.toFixed(2)}<br>
                X: ${node.x_coordinate.toFixed(2)}
            `);

            marker.nodeData = node;

            marker.on('dragend', function () {
                const pos = marker.getLatLng();
                marker.nodeData.y_coordinate = pos.lat;
                marker.nodeData.x_coordinate = pos.lng;
                marker.setPopupContent(`
                    <b>${marker.nodeData.name}</b><br>
                    Floor: ${marker.nodeData.floor}<br>
                    Y: ${pos.lat.toFixed(2)}<br>
                    X: ${pos.lng.toFixed(2)}
                `);
            });

            floors[currentFloor].nodeLayer.addLayer(marker);
        });

        alert(`✅ Loaded ${data.nodes.length} nodes for floor ${currentFloor}`);

    } catch (err) {
        console.error('💥 Load failed:', err);
        alert('❌ Failed to load nodes. Check console for details.');
    }
}

// Clear all nodes
function clearAllNodes() {
    const nodes = floors[currentFloor].nodeLayer.getLayers();
    if (nodes.length === 0) {
        alert('No nodes to clear.');
        return;
    }

    if (confirm(`Delete all ${nodes.length} nodes on floor ${currentFloor}?`)) {
        floors[currentFloor].nodeLayer.clearLayers();
        console.log(`🗑️ Cleared all nodes on floor ${currentFloor}`);
        alert('✅ All nodes cleared!');
    }
}

// Delete selected node
function deleteSelectedNode() {
    const nodeLayer = floors[currentFloor].nodeLayer;
    const nodes = nodeLayer.getLayers();

    if (nodes.length === 0) {
        alert('No nodes to delete.');
        return;
    }

    if (nodes.length === 1) {
        if (confirm(`Delete node "${nodes[0].nodeData.name}"?`)) {
            nodeLayer.removeLayer(nodes[0]);
            console.log('🗑️ Node deleted');
            alert('✅ Node deleted!');
        }
        return;
    }

    alert('Click on a node to delete it.');

    const tempClickHandler = function (e) {
        const targetLayer = e.target;
        if (confirm(`Delete node "${targetLayer.nodeData.name}"?`)) {
            nodeLayer.removeLayer(targetLayer);
            console.log('🗑️ Node deleted');
            alert('✅ Node deleted!');
        }
        nodeLayer.off('click', tempClickHandler);
    };

    nodeLayer.on('click', tempClickHandler);
}

// Export nodes as JSON
function exportNodes() {
    const nodes = floors[currentFloor].nodeLayer.getLayers();

    if (nodes.length === 0) {
        alert('No nodes to export.');
        return;
    }

    const nodeData = nodes.map(marker => marker.nodeData);
    const json = JSON.stringify({
        floor: currentFloor,
        nodes: nodeData
    }, null, 2);

    // Create download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nodes_floor_${currentFloor}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('📤 Nodes exported:', nodeData);
    alert('✅ Nodes exported successfully!');
}

// Import nodes from JSON
function importNodes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            try {
                const data = JSON.parse(event.target.result);

                if (!data.nodes || !Array.isArray(data.nodes)) {
                    throw new Error('Invalid node data format');
                }

                if (confirm(`Import ${data.nodes.length} nodes to floor ${currentFloor}?`)) {
                    // Clear existing nodes
                    floors[currentFloor].nodeLayer.clearLayers();

                    // Add imported nodes
                    data.nodes.forEach(node => {
                        const marker = L.marker([node.y_coordinate, node.x_coordinate], {
                            icon: nodeIcon,
                            draggable: true
                        });

                        marker.bindPopup(`
                            <b>${node.name}</b><br>
                            Floor: ${node.floor || currentFloor}<br>
                            Y: ${node.y_coordinate.toFixed(2)}<br>
                            X: ${node.x_coordinate.toFixed(2)}
                        `);

                        marker.nodeData = {
                            ...node,
                            floor: node.floor || currentFloor
                        };

                        marker.on('dragend', function () {
                            const pos = marker.getLatLng();
                            marker.nodeData.y_coordinate = pos.lat;
                            marker.nodeData.x_coordinate = pos.lng;
                            marker.setPopupContent(`
                                <b>${marker.nodeData.name}</b><br>
                                Floor: ${marker.nodeData.floor}<br>
                                Y: ${pos.lat.toFixed(2)}<br>
                                X: ${pos.lng.toFixed(2)}
                            `);
                        });

                        floors[currentFloor].nodeLayer.addLayer(marker);
                    });

                    alert(`✅ Imported ${data.nodes.length} nodes!`);
                }

            } catch (err) {
                console.error('💥 Import failed:', err);
                alert('❌ Failed to import nodes. Invalid file format.');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

// =========================
// SAVE ROOMS TO DJANGO
// =========================

async function saveRooms() {
    const layers = floors[currentFloor].drawLayer.getLayers();

    if (!layers || layers.length === 0) {
        alert("No rooms drawn yet.");
        return;
    }

    const rooms = [];

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];

        // SAFETY CHECK: ensure it's actually a polygon
        if (!layer.getLatLngs) {
            console.warn("Skipping non-polygon layer:", layer);
            continue;
        }

        const rawPoints = layer.getLatLngs();

        // some Leaflet shapes return nested arrays
        const points = Array.isArray(rawPoints[0]) ? rawPoints[0] : rawPoints;

        if (!points || points.length < 3) {
            console.warn("Invalid polygon skipped:", points);
            continue;
        }

        const center = getCenter(points);

        let name = prompt(`Name for Room ${i + 1}:`);
        if (!name || name.trim() === "") {
            name = `Room_${i + 1}`;
        }

        rooms.push({
            room_name: name.trim(),
            floor: currentFloor,
            polygon: points.map(p => [p.lat, p.lng]),
            center_x: center.x,
            center_y: center.y
        });
    }

    if (rooms.length === 0) {
        alert("No valid rooms to save.");
        return;
    }

    console.log("📦 Saving rooms (cleaned):", rooms);

    try {
        const response = await fetch("/save-room/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCSRFToken()
            },
            body: JSON.stringify({ rooms })
        });

        const text = await response.text();  // ALWAYS read raw first

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error("❌ Not JSON response:", text);
            throw new Error("Server returned HTML (likely Django error)");
        }

        if (!response.ok) {
            throw new Error(data.error || "Server error");
        }

        console.log("✅ Saved:", data);
        alert(`✅ ${rooms.length} rooms saved successfully!`);

    } catch (err) {
        console.error("💥 Save failed:", err);
        alert("❌ Save failed. Check console for details.");
    }
}

// =========================
// CLEAR ALL POLYGONS
// =========================

function clearAllPolygons() {
    const layers = floors[currentFloor].drawLayer.getLayers();
    if (layers.length === 0) {
        alert('No polygons to clear.');
        return;
    }

    if (confirm(`Delete all ${layers.length} polygons on floor ${currentFloor}?`)) {
        floors[currentFloor].drawLayer.clearLayers();
        deselectPolygon();
        console.log(`🗑️ Cleared all polygons on floor ${currentFloor}`);
        alert('✅ All polygons cleared!');
    }
}

// =========================
// LOAD SAVED ROOMS
// =========================

async function loadRooms() {
    try {
        const response = await fetch(`/get-rooms/?floor=${currentFloor}`, {
            method: "GET",
            headers: {
                "X-CSRFToken": getCSRFToken()
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📥 Loaded rooms:', data);

        // Clear existing polygons
        floors[currentFloor].drawLayer.clearLayers();
        deselectPolygon();

        // Draw saved polygons
        data.rooms.forEach(room => {
            const polygon = L.polygon(room.polygon, {
                color: '#00E5FF',
                weight: 2,
                fillColor: '#00E5FF',
                fillOpacity: 0.1
            });

            polygon.bindPopup(`<b>${room.room_name}</b>`);
            attachPolygonSelectHandler(polygon);
            floors[currentFloor].drawLayer.addLayer(polygon);
        });

        alert(`✅ Loaded ${data.rooms.length} rooms for floor ${currentFloor}`);

    } catch (err) {
        console.error('💥 Load failed:', err);
        alert('❌ Failed to load rooms. Check console for details.');
    }
}

// =========================
// DELETE SELECTED POLYGON
// =========================

function deleteSelectedPolygon() {
    const drawLayer = floors[currentFloor].drawLayer;
    const layers = drawLayer.getLayers();

    if (layers.length === 0) {
        alert('No polygons to delete.');
        return;
    }

    if (layers.length === 1) {
        if (confirm('Delete this polygon?')) {
            drawLayer.removeLayer(layers[0]);
            deselectPolygon();
            console.log('🗑️ Polygon deleted');
            alert('✅ Polygon deleted!');
        }
        return;
    }

    alert('Click on a polygon to delete it.');

    const tempClickHandler = function (e) {
        const targetLayer = e.target;
        if (confirm(`Delete this polygon?`)) {
            drawLayer.removeLayer(targetLayer);
            if (targetLayer === selectedPolygonLayer) {
                deselectPolygon();
            }
            console.log('🗑️ Polygon deleted');
            alert('✅ Polygon deleted!');
        }
        drawLayer.off('click', tempClickHandler);
    };

    drawLayer.on('click', tempClickHandler);
}

// =========================
// COPY / PASTE FOR ROOM POLYGONS
// =========================
// Click a room to select it (highlighted orange), then Copy it, then Paste
// to duplicate the same shape — handy for repeated identical rooms
// (e.g. a row of same-size classrooms). The pasted copy is offset slightly
// so it doesn't sit exactly on top of the original; drag its vertices with
// the existing edit tool to reposition, then Save as usual.

let selectedPolygonLayer = null;
let copiedPolygonShape = null; // array of [lat, lng]

const DEFAULT_STYLE = { color: '#00E5FF', weight: 2, fillColor: '#00E5FF', fillOpacity: 0.1 };
const SELECTED_STYLE = { color: '#FF6B00', weight: 3, fillColor: '#FF6B00', fillOpacity: 0.15 };

function attachPolygonSelectHandler(layer) {
    layer.on('click', function (e) {
        selectPolygonLayer(layer);
        L.DomEvent.stopPropagation(e);
    });
}

function selectPolygonLayer(layer) {
    if (selectedPolygonLayer && floors[currentFloor].drawLayer.hasLayer(selectedPolygonLayer)) {
        selectedPolygonLayer.setStyle(DEFAULT_STYLE);
    }

    selectedPolygonLayer = layer;
    layer.setStyle(SELECTED_STYLE);
    console.log('🟧 Room selected for copy/paste');
}

function deselectPolygon() {
    if (selectedPolygonLayer && floors[currentFloor].drawLayer.hasLayer(selectedPolygonLayer)) {
        selectedPolygonLayer.setStyle(DEFAULT_STYLE);
    }
    selectedPolygonLayer = null;
}

function copySelectedPolygon() {
    if (!selectedPolygonLayer) {
        alert('Click a room to select it first, then copy.');
        return;
    }

    const points = selectedPolygonLayer.getLatLngs()[0];
    copiedPolygonShape = points.map(p => [p.lat, p.lng]);
    console.log('📋 Room shape copied:', copiedPolygonShape);
}

function pasteCopiedPolygon(offset = 30) {
    if (!copiedPolygonShape) {
        alert('Nothing copied yet. Select a room and copy it first.');
        return;
    }

    const newPoints = copiedPolygonShape.map(([lat, lng]) => [lat + offset, lng + offset]);

    const newLayer = L.polygon(newPoints, DEFAULT_STYLE);
    attachPolygonSelectHandler(newLayer);
    floors[currentFloor].drawLayer.addLayer(newLayer);
    selectPolygonLayer(newLayer);

    console.log(`📥 Room pasted on floor ${currentFloor} — drag into place, then Save`);
}

// Keyboard shortcuts: Ctrl/Cmd+C to copy, Ctrl/Cmd+V to paste
document.addEventListener('keydown', function (e) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't hijack normal typing

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        copySelectedPolygon();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        pasteCopiedPolygon();
    }
});
// =========================
// EXPOSE ADMIN FUNCTIONS GLOBALLY
// =========================

// Room functions
window.saveRooms = saveRooms;
window.loadRooms = loadRooms;
window.clearAllPolygons = clearAllPolygons;
window.deleteSelectedPolygon = deleteSelectedPolygon;
window.copySelectedPolygon = copySelectedPolygon;
window.pasteCopiedPolygon = pasteCopiedPolygon;

// Node functions
window.toggleNodePlacement = toggleNodePlacement;
window.placeNodeAt = placeNodeAt;
window.saveNodes = saveNodes;
window.loadNodes = loadNodes;
window.clearAllNodes = clearAllNodes;
window.deleteSelectedNode = deleteSelectedNode;
window.exportNodes = exportNodes;
window.importNodes = importNodes;

// Floor switch
window.switchFloor = switchFloor;

console.log('✅ Map initialized with admin features');
console.log('📌 Room functions available:');
console.log('  - saveRooms() - Save drawn polygons');
console.log('  - loadRooms() - Load saved rooms');
console.log('  - clearAllPolygons() - Clear all polygons');
console.log('  - deleteSelectedPolygon() - Delete selected polygon');
console.log('  - copySelectedPolygon() / pasteCopiedPolygon() - Duplicate a room shape (or Ctrl+C / Ctrl+V)');
console.log('📌 Node functions available:');
console.log('  - toggleNodePlacement() - Toggle node placement mode');
console.log('  - placeNodeAt(lat, lng, name) - Place node at coordinates');
console.log('  - saveNodes() - Save hallway nodes');
console.log('  - loadNodes() - Load saved nodes');
console.log('  - clearAllNodes() - Clear all nodes');
console.log('  - deleteSelectedNode() - Delete selected node');
console.log('  - exportNodes() - Export nodes as JSON');
console.log('  - importNodes() - Import nodes from JSON');