
/**
 * Client-side pathfinding — mirrors server logic in Map/views.py pathfind().
 */
(function (global) {
    const STAIR_ENTRANCE = "entrance";
    const STAIR_EXIT = "exit";
    const BLOCKED_ROOMS = new Set(["Library"]);

    class MinHeap {
        constructor(compare) {
            this.items = [];
            this.compare = compare;
        }

        push(value) {
            this.items.push(value);
            this._bubbleUp(this.items.length - 1);
        }

        pop() {
            if (this.items.length === 1) {
                return this.items.pop();
            }

            const top = this.items[0];
            this.items[0] = this.items.pop();
            this._sinkDown(0);
            return top;
        }

        isEmpty() {
            return this.items.length === 0;
        }

        _bubbleUp(index) {
            while (index > 0) {
                const parent = Math.floor((index - 1) / 2);
                if (this.compare(this.items[index], this.items[parent]) >= 0) {
                    break;
                }
                [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
                index = parent;
            }
        }

        _sinkDown(index) {
            const length = this.items.length;

            while (true) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;

                if (left < length && this.compare(this.items[left], this.items[smallest]) < 0) {
                    smallest = left;
                }
                if (right < length && this.compare(this.items[right], this.items[smallest]) < 0) {
                    smallest = right;
                }
                if (smallest === index) {
                    break;
                }

                [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
                index = smallest;
            }
        }
    }

    function getFloor(loc) {
        return loc.floor_location ?? loc.floor;
    }

    function inferStairType(loc, stairThreshold) {
        if (loc.stair_type) {
            return loc.stair_type;
        }

        if (!loc.room_name.toLowerCase().includes("stair")) {
            return null;
        }

        return loc.x_coordinate > stairThreshold ? STAIR_ENTRANCE : STAIR_EXIT;
    }

    function buildNodes(locations) {
        const stairX = locations
            .filter((loc) => loc.room_name.toLowerCase().includes("stair"))
            .map((loc) => loc.x_coordinate);
        const stairThreshold = stairX.length
            ? (Math.min(...stairX) + Math.max(...stairX)) / 2
            : 0;

        const nodes = new Map();

        for (const loc of locations) {
            nodes.set(loc.room_name, {
                pos: [loc.x_coordinate, loc.y_coordinate, getFloor(loc)],
                stair_type: inferStairType(loc, stairThreshold),
            });
        }

        return nodes;
    }

    function buildEdges(connections) {
        const edges = [];

        for (const conn of connections) {
            const from = conn.from ?? conn.from_room ?? conn.from_location_name;
            const to = conn.to ?? conn.to_room ?? conn.to_location_name;
            const fromFloor = conn.from_floor ?? conn.from_location?.floor_location;
            const toFloor = conn.to_floor ?? conn.to_location?.floor_location;

            edges.push({
                from,
                to,
                weight: conn.cost,
                floor_diff: toFloor - fromFloor,
            });
            edges.push({
                from: to,
                to: from,
                weight: conn.cost,
                floor_diff: fromFloor - toFloor,
            });
        }

        return edges;
    }

    function buildFilteredAdjacency(nodes, edges, start, end, allowedDirection) {
        const adjacency = new Map();

        for (const edge of edges) {
            const { from, to, weight, floor_diff: floorDiff } = edge;

            if (!nodes.has(from) || !nodes.has(to)) {
                continue;
            }

            if (BLOCKED_ROOMS.has(from) && from !== start && from !== end) {
                continue;
            }
            if (BLOCKED_ROOMS.has(to) && to !== start && to !== end) {
                continue;
            }

            const uType = nodes.get(from).stair_type;
            const vType = nodes.get(to).stair_type;

            if (allowedDirection === "up") {
                if (floorDiff !== 0 && (uType === STAIR_EXIT || vType === STAIR_EXIT)) {
                    continue;
                }
            } else if (allowedDirection === "down") {
                if (floorDiff !== 0 && (uType === STAIR_ENTRANCE || vType === STAIR_ENTRANCE)) {
                    continue;
                }
            }

            let allowed = false;
            if (floorDiff === 0 || allowedDirection === null) {
                allowed = true;
            } else if (allowedDirection === "up" && floorDiff > 0) {
                allowed = true;
            } else if (allowedDirection === "down" && floorDiff < 0) {
                allowed = true;
            }

            if (!allowed) {
                continue;
            }

            if (!adjacency.has(from)) {
                adjacency.set(from, []);
            }
            adjacency.get(from).push({ to, weight });
        }

        return adjacency;
    }

    function heuristic(nodes, a, b) {
        const [ax, ay] = nodes.get(a).pos;
        const [bx, by] = nodes.get(b).pos;
        return Math.hypot(ax - bx, ay - by);
    }

    function astar(nodes, adjacency, start, end) {
        const open = new MinHeap((a, b) => a.f - b.f);
        const gScore = new Map([[start, 0]]);
        const cameFrom = new Map();
        const closed = new Set();

        open.push({ node: start, f: heuristic(nodes, start, end) });

        while (!open.isEmpty()) {
            const current = open.pop().node;

            if (current === end) {
                const path = [end];
                while (cameFrom.has(path[path.length - 1])) {
                    path.push(cameFrom.get(path[path.length - 1]));
                }
                return path.reverse();
            }

            if (closed.has(current)) {
                continue;
            }
            closed.add(current);

            for (const edge of adjacency.get(current) || []) {
                const tentative = gScore.get(current) + edge.weight;

                if (tentative >= (gScore.get(edge.to) ?? Infinity)) {
                    continue;
                }

                cameFrom.set(edge.to, current);
                gScore.set(edge.to, tentative);
                open.push({
                    node: edge.to,
                    f: tentative + heuristic(nodes, edge.to, end),
                });
            }
        }

        return null;
    }

    function buildSegments(path, nodes) {
        const fullCoords = [];
        const segments = [];
        let currentFloor = null;
        let currentSegment = [];

        for (const node of path) {
            const [x, y, floor] = nodes.get(node).pos;
            fullCoords.push([y, x, floor]);

            if (currentFloor === null) {
                currentFloor = floor;
                currentSegment = [[y, x]];
                continue;
            }

            if (floor !== currentFloor) {
                if (currentSegment.length >= 2) {
                    segments.push({ floor: currentFloor, coords: currentSegment });
                }
                currentFloor = floor;
                currentSegment = [[y, x]];
            } else {
                currentSegment.push([y, x]);
            }
        }

        if (currentSegment.length >= 2) {
            segments.push({ floor: currentFloor, coords: currentSegment });
        }

        return { path: fullCoords, segments };
    }

    function findPath(locations, connections, start, end) {
        if (!start || !end) {
            return { error: "Missing start or end room" };
        }

        const nodes = buildNodes(locations);
        const edges = buildEdges(connections);

        if (!nodes.has(start) || !nodes.has(end)) {
            return { error: "Unknown start or end room" };
        }

        const startFloor = nodes.get(start).pos[2];
        const endFloor = nodes.get(end).pos[2];
        let allowedDirection = null;

        if (startFloor < endFloor) {
            allowedDirection = "up";
        } else if (startFloor > endFloor) {
            allowedDirection = "down";
        }

        const adjacency = buildFilteredAdjacency(nodes, edges, start, end, allowedDirection);
        const path = astar(nodes, adjacency, start, end);

        if (!path) {
            return { error: "No path found" };
        }

        return buildSegments(path, nodes);
    }

    function loadGraphFromPage() {
        const locationsElem = document.getElementById("locations-data");
        const connectionsElem = document.getElementById("connections-data");

        if (!locationsElem || !connectionsElem) {
            return null;
        }

        return {
            locations: JSON.parse(locationsElem.textContent),
            connections: JSON.parse(connectionsElem.textContent),
        };
    }

    global.OfflinePathfinder = {
        findPath,
        loadGraphFromPage,
    };
})(window);