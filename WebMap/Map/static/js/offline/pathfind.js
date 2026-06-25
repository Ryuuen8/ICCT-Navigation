window.OfflinePathfinder = (function () {

    function loadGraphFromPage() {
        try {
            const locationsEl = document.getElementById('locations-data');
            const connectionsEl = document.getElementById('connections-data');
            if (!locationsEl || !connectionsEl) return null;

            const locations = JSON.parse(locationsEl.textContent);
            const connections = JSON.parse(connectionsEl.textContent);

            if (!locations?.length || !connections?.length) return null;

            return { locations, connections };
        } catch (e) {
            console.error('OfflinePathfinder: failed to load graph', e);
            return null;
        }
    }

    function findPath(locations, connections, startName, endName, isEmergency = false) {

        // ─── BUILD NODES ──────────────────────────────────────────────────────
        const nodes = {};

        const stairX = locations
            .filter(loc => loc.room_name.toLowerCase().includes('stair'))
            .map(loc => loc.x_coordinate);

        const stairThreshold = stairX.length
            ? (Math.min(...stairX) + Math.max(...stairX)) / 2
            : 0;

        const emergencyRooms = new Set(
            locations
                .filter(loc => loc.room_name.toLowerCase().includes('emergency node'))
                .map(loc => loc.room_name)
        );

        const bridgeRooms = new Set(
            locations
                .filter(loc => loc.room_name.toLowerCase().includes('bridge node'))
                .map(loc => loc.room_name)
        );

        locations.forEach(loc => {
            let stairType = loc.stair_type || null;

            if (!stairType && loc.room_name.toLowerCase().includes('stair')) {
                stairType = loc.x_coordinate > stairThreshold ? 'entrance' : 'exit';
            }

            nodes[loc.room_name] = {
                x: loc.x_coordinate,
                y: loc.y_coordinate,
                floor: loc.floor_location,
                stair_type: stairType
            };
        });

        if (!nodes[startName]) {
            return { error: `Start room '${startName}' not found` };
        }
        if (!nodes[endName]) {
            return { error: `Destination room '${endName}' not found` };
        }

        // ─── BUILD EDGES ──────────────────────────────────────────────────────
        const adj = {}; // adjacency list: adj[room] = [{to, cost, floorDiff}]

        Object.keys(nodes).forEach(name => { adj[name] = []; });

        connections.forEach(conn => {
            const from = conn.from;
            const to = conn.to;

            if (!nodes[from] || !nodes[to]) return;

            // ✅ skip emergency-only connections when not in emergency mode
            if (conn.is_emergency && !isEmergency) return;

            const fromFloor = conn.from_floor ?? nodes[from].floor;
            const toFloor = conn.to_floor ?? nodes[to].floor;
            const floorDiff = toFloor - fromFloor;

            adj[from].push({ to, cost: conn.cost, floorDiff });
            adj[to].push({ to: from, cost: conn.cost, floorDiff: -floorDiff });
        });

        // ─── FLOOR DIRECTION ──────────────────────────────────────────────────
        const startFloor = nodes[startName].floor;
        const endFloor = nodes[endName].floor;
        const sameFloor = startFloor === endFloor;
        const allowedDirection = sameFloor
            ? null
            : startFloor < endFloor ? 'up' : 'down';

        const blockedRooms = new Set(['Library']);
        const allowedEndpoints = new Set([startName, endName]);

        // ─── A* ───────────────────────────────────────────────────────────────
        const INFINITY = Infinity;
        const gScore = {};
        const fScore = {};
        const cameFrom = {};
        const openSet = new Set();

        Object.keys(nodes).forEach(name => {
            gScore[name] = INFINITY;
            fScore[name] = INFINITY;
        });

        gScore[startName] = 0;
        fScore[startName] = heuristic(startName, endName, nodes);
        openSet.add(startName);

        function heuristic(a, b, nodeMap) {
            const na = nodeMap[a];
            const nb = nodeMap[b];
            const floorPenalty = Math.abs(na.floor - nb.floor) * 100;
            return Math.hypot(na.x - nb.x, na.y - nb.y) + floorPenalty;
        }

        function getLowestF() {
            let lowest = null;
            let lowestScore = INFINITY;
            for (const name of openSet) {
                if (fScore[name] < lowestScore) {
                    lowestScore = fScore[name];
                    lowest = name;
                }
            }
            return lowest;
        }

        while (openSet.size > 0) {
            const current = getLowestF();
            if (current === endName) break;

            openSet.delete(current);

            for (const edge of (adj[current] || [])) {
                const { to: neighbor, cost, floorDiff } = edge;

                // ─── same rules as backend filter ───────────────────────────

                if (sameFloor && floorDiff !== 0) continue;

                if (blockedRooms.has(current) && !allowedEndpoints.has(current)) continue;
                if (blockedRooms.has(neighbor) && !allowedEndpoints.has(neighbor)) continue;

                if (!isEmergency) {
                    if (emergencyRooms.has(current) && !allowedEndpoints.has(current)) continue;
                    if (emergencyRooms.has(neighbor) && !allowedEndpoints.has(neighbor)) continue;
                }

                const uType = nodes[current]?.stair_type;
                const vType = nodes[neighbor]?.stair_type;

                if (allowedDirection === 'up') {
                    if (floorDiff !== 0 && (uType === 'exit' || vType === 'exit')) continue;
                } else if (allowedDirection === 'down') {
                    if (floorDiff !== 0 && (uType === 'entrance' || vType === 'entrance')) continue;
                }

                // ────────────────────────────────────────────────────────────

                const tentativeG = gScore[current] + cost;

                if (tentativeG < gScore[neighbor]) {
                    cameFrom[neighbor] = current;
                    gScore[neighbor] = tentativeG;
                    fScore[neighbor] = tentativeG + heuristic(neighbor, endName, nodes);
                    openSet.add(neighbor);
                }
            }
        }

        if (gScore[endName] === INFINITY) {
            return { error: 'No path found' };
        }

        // ─── RECONSTRUCT PATH ─────────────────────────────────────────────────
        const path = [];
        let current = endName;
        while (current !== undefined) {
            path.unshift(current);
            current = cameFrom[current];
        }

        // ─── BUILD COORDS + SEGMENTS ──────────────────────────────────────────
        const fullCoords = [];
        const segments = [];
        let segFloor = null;
        let segCoords = [];

        path.forEach(name => {
            const node = nodes[name];
            fullCoords.push([node.y, node.x, node.floor]);

            if (segFloor === null) {
                segFloor = node.floor;
                segCoords = [[node.y, node.x]];
                return;
            }

            if (node.floor !== segFloor) {
                if (segCoords.length >= 2) {
                    segments.push({ floor: segFloor, coords: segCoords });
                }
                segFloor = node.floor;
                segCoords = [[node.y, node.x]];
            } else {
                segCoords.push([node.y, node.x]);
            }
        });

        if (segCoords.length >= 2) {
            segments.push({ floor: segFloor, coords: segCoords });
        }

        return {
            path: fullCoords,
            segments,
            destination: endName
        };
    }

    return { loadGraphFromPage, findPath };

})();