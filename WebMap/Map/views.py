from django.shortcuts import render, redirect
from django.contrib import messages
from django.http import JsonResponse
from .models import Location, Connection, Announcement, HazardReport
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q
from .forms import ReportForm
import json
import networkx as nx
import math
from rest_framework import viewsets
from .serializers import LocationSerializer, ConnectionSerializer, AnnouncementSerializer, HazardReportSerializer
from django.contrib.auth.decorators import login_required, user_passes_test
from rest_framework.permissions import IsAdminUser
from django.core.cache import cache
from django_ratelimit.decorators import ratelimit   

# ─── CACHE TTLs ───────────────────────────────────────────────────────────────
CACHE_TTL = {
    'locations':       3600 * 24,
    'connections':     3600 * 24,
    'emergency_paths': 3600 * 6,
    'announcements':   3600 * 1,
    'floormap':        3600 * 24,
    'pathfind_graph':  3600 * 24,
}

# ─── CACHE KEYS ───────────────────────────────────────────────────────────────
LOCATION_CACHE_KEYS = [
    'locations_data',
    'floormap_locations',
    'pathfind_graph',
]

CONNECTION_CACHE_KEYS = [
    'connections_data',
    'emergency_paths_data',
    'pathfind_graph',
]


def staff_check(user):
    return user.is_staff


def clear_map_cache():
    keys = list(set(LOCATION_CACHE_KEYS + CONNECTION_CACHE_KEYS))
    cache.delete_many(keys)


def clear_location_cache():
    cache.delete_many(LOCATION_CACHE_KEYS)


def clear_connection_cache():
    cache.delete_many(CONNECTION_CACHE_KEYS)


# ─── PATHFIND GRAPH CACHE ─────────────────────────────────────────────────────
def get_pathfind_graph():
    graph_data = cache.get('pathfind_graph')
    if graph_data is not None:
        return graph_data

    locations = list(Location.objects.all())
    connections = list(
        Connection.objects.select_related('from_location', 'to_location')
    )

    stair_x = [
        loc.x_coordinate for loc in locations
        if 'stair' in loc.room_name.lower()
    ]
    stair_threshold = (min(stair_x) + max(stair_x)) / 2 if stair_x else 0

    emergency_rooms = [
        loc.room_name for loc in locations
        if 'emergency node' in loc.room_name.lower()
    ]

    bridge_rooms = [
        loc.room_name for loc in locations
        if 'bridge node' in loc.room_name.lower()
    ]

    nodes = {}
    for loc in locations:
        stair_type = loc.stair_type
        if stair_type is None and 'stair' in loc.room_name.lower():
            stair_type = (
                Location.STAIR_TYPE_ENTRANCE
                if loc.x_coordinate > stair_threshold
                else Location.STAIR_TYPE_EXIT
            )
        nodes[loc.room_name] = {
            'pos': (loc.x_coordinate, loc.y_coordinate, loc.floor_location),
            'stair_type': stair_type
        }

    edges = [
        {
            'from': conn.from_location.room_name,
            'to': conn.to_location.room_name,
            'cost': conn.cost,
            'from_floor': conn.from_location.floor_location,
            'to_floor': conn.to_location.floor_location,
            'is_emergency': conn.is_emergency,
            'floor_diff': conn.to_location.floor_location - conn.from_location.floor_location,
        }
        for conn in connections
    ]

    graph_data = {
        'nodes': nodes,
        'edges': edges,
        'emergency_rooms': emergency_rooms,
        'bridge_rooms': bridge_rooms,
    }

    cache.set('pathfind_graph', graph_data, CACHE_TTL['pathfind_graph'])
    return graph_data


# ─── VIEWSETS ─────────────────────────────────────────────────────────────────
class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    permission_classes = [IsAdminUser]

    def perform_create(self, serializer):
        serializer.save()
        clear_location_cache()

    def perform_update(self, serializer):
        serializer.save()
        clear_location_cache()

    def perform_destroy(self, instance):
        instance.delete()
        clear_location_cache()


class ConnectionViewSet(viewsets.ModelViewSet):
    queryset = Connection.objects.select_related('from_location', 'to_location').all()
    serializer_class = ConnectionSerializer
    permission_classes = [IsAdminUser]

    def perform_create(self, serializer):
        serializer.save()
        clear_connection_cache()

    def perform_update(self, serializer):
        serializer.save()
        clear_connection_cache()

    def perform_destroy(self, instance):
        instance.delete()
        clear_connection_cache()


class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.select_related('from_location', 'to_location').all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminUser]


class HazardReportViewSet(viewsets.ModelViewSet):
    queryset = HazardReport.objects.all()
    serializer_class = HazardReportSerializer
    permission_classes = [IsAdminUser]


# ─── VIEWS ────────────────────────────────────────────────────────────────────
def announcement(request):
    if request.method == "POST":
        form = ReportForm(request.POST, request.FILES)
        if form.is_valid():
            form.save()
            messages.success(request, "Form Submitted")
            return redirect('main')
    else:
        form = ReportForm()

    items = Announcement.objects.select_related('to_location', 'from_location').all()
    context = {'items': items, 'form': form, 'items_count': items.count()}
    return render(request, 'main.html', context)


def floormap(request):
    locations = cache.get('floormap_locations')

    if locations is None:
        locations = list(
            Location.objects.exclude(
                Q(room_name__contains="H1") |
                Q(room_name__startswith="Stair") |
                Q(room_name__contains="H2") |
                Q(room_name__contains="H3") |
                Q(room_name__contains="H4") |
                Q(room_name__contains="H5") |
                Q(room_name__contains="HEX") |
                Q(room_name__contains="STAIR") |
                Q(room_name__contains="EMERGENCY NODE") |
                Q(room_name__contains="NULL")
            )
        )
        cache.set('floormap_locations', locations, CACHE_TTL['floormap'])

    return render(request, 'floor-maps.html', {"locations": locations})


def emergency(request):
    return render(request, 'emergencty.html')


def search(request):
    query = request.GET.get('term', '')
    products = Location.objects.filter(name__icontains=query)[:10]
    results = [product.name for product in products]
    return JsonResponse(results, safe=False)


def locate(request):
    x = request.GET.get('x')
    y = request.GET.get('y')
    floor = request.GET.get('floor')
    name = request.GET.get('name')

    if not all([x, y, floor]):
        return JsonResponse({"error": "Missing coordinates"}, status=400)

    try:
        x = float(x)
        y = float(y)
        floor = int(floor)
    except ValueError:
        return JsonResponse({"error": "Invalid coordinate format"}, status=400)

    from django.urls import reverse
    base_url = reverse('mainmap')
    query_string = f"?x={x}&y={y}&floor={floor}"
    if name:
        query_string += f"&name={name}"

    return redirect(f"{base_url}{query_string}")

@ratelimit(key='ip', rate='60/m', block=True)
def pathfind(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST request required"}, status=400)

    try:
        request_data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    start = request_data.get("start")
    end = request_data.get("end")
    is_emergency = bool(request_data.get("emergency", False))

    if not start or not end:
        return JsonResponse({"error": "Missing start or end room"}, status=400)

    # ✅ use cached graph — avoids DB query on every pathfind request
    graph_data = get_pathfind_graph()

    G = nx.DiGraph()
    emergency_rooms = set(graph_data['emergency_rooms'])

    for name, data in graph_data['nodes'].items():
        G.add_node(name, pos=data['pos'], stair_type=data['stair_type'])

    for edge in graph_data['edges']:
        if edge['is_emergency'] and not is_emergency:
            continue
        G.add_edge(
            edge['from'], edge['to'],
            weight=edge['cost'],
            floor_diff=edge['floor_diff']
        )
        G.add_edge(
            edge['to'], edge['from'],
            weight=edge['cost'],
            floor_diff=-edge['floor_diff']
        )

    if start not in G:
        return JsonResponse({"error": f"Start room '{start}' not found"}, status=400)

    if end not in G:
        return JsonResponse({"error": f"Destination room '{end}' not found"}, status=400)

    start_floor = G.nodes[start]["pos"][2]
    end_floor = G.nodes[end]["pos"][2]
    same_floor = start_floor == end_floor

    allowed_direction = None
    if not same_floor:
        allowed_direction = "up" if start_floor < end_floor else "down"

    blocked_rooms = {"Library"}
    allowed_endpoints = {start, end}

    H = nx.DiGraph()
    H.add_nodes_from(G.nodes(data=True))

    for u, v, edge_data in G.edges(data=True):
        floor_diff = edge_data.get("floor_diff", 0)

        if same_floor and floor_diff != 0:
            continue

        if u in blocked_rooms and u not in allowed_endpoints:
            continue
        if v in blocked_rooms and v not in allowed_endpoints:
            continue

        if not is_emergency:
            if u in emergency_rooms and u not in allowed_endpoints:
                continue
            if v in emergency_rooms and v not in allowed_endpoints:
                continue

        u_type = G.nodes[u].get("stair_type")
        v_type = G.nodes[v].get("stair_type")

        if allowed_direction == "up":
            if floor_diff != 0 and (
                u_type == Location.STAIR_TYPE_EXIT or
                v_type == Location.STAIR_TYPE_EXIT
            ):
                continue
        elif allowed_direction == "down":
            if floor_diff != 0 and (
                u_type == Location.STAIR_TYPE_ENTRANCE or
                v_type == Location.STAIR_TYPE_ENTRANCE
            ):
                continue

        H.add_edge(u, v, **edge_data)

    def heuristic(a, b):
        ax, ay, af = H.nodes[a]["pos"]
        bx, by, bf = H.nodes[b]["pos"]
        return math.hypot(ax - bx, ay - by) + abs(af - bf) * 100

    try:
        path = nx.astar_path(H, start, end, heuristic=heuristic, weight="weight")
    except nx.NodeNotFound as e:
        return JsonResponse({"error": str(e)}, status=400)
    except nx.NetworkXNoPath:
        return JsonResponse({"error": "No path found"}, status=404)

    full_coords = []
    segments = []
    current_floor = None
    current_segment = []

    for node in path:
        x, y, floor = G.nodes[node]["pos"]
        full_coords.append([y, x, floor])

        if current_floor is None:
            current_floor = floor
            current_segment = [[y, x]]
            continue

        if floor != current_floor:
            if len(current_segment) >= 2:
                segments.append({"floor": current_floor, "coords": current_segment})
            current_floor = floor
            current_segment = [[y, x]]
        else:
            current_segment.append([y, x])

    if len(current_segment) >= 2:
        segments.append({"floor": current_floor, "coords": current_segment})

    return JsonResponse({
        "path": full_coords,
        "segments": segments,
        "destination": end
    })


def index(request):
    locations = cache.get("locations_data")
    connections = cache.get("connections_data")

    if locations is None:
        locations = [
            {
                "floor": loc.floor_location,
                "floor_location": loc.floor_location,
                "room_name": loc.room_name,
                "coordinates": loc.coordinates,
                "x_coordinate": loc.x_coordinate,
                "y_coordinate": loc.y_coordinate,
                "stair_type": loc.stair_type,
            }
            for loc in Location.objects.exclude(
                # ✅ exclude non-clickable nodes from frontend payload
                Q(room_name__contains="EMERGENCY NODE") |
                Q(room_name__contains="NULL") |
                Q(room_name__contains="BRIDGE NODE")
            )
        ]
        cache.set("locations_data", locations, CACHE_TTL['locations'])

    if connections is None:
        connections = [
            {
                "from": conn.from_location.room_name,
                "to": conn.to_location.room_name,
                "cost": conn.cost,
                "from_floor": conn.from_location.floor_location,
                "to_floor": conn.to_location.floor_location,
                "is_emergency": conn.is_emergency,
            }
            for conn in Connection.objects.select_related(
                "from_location", "to_location"
            )
        ]
        cache.set("connections_data", connections, CACHE_TTL['connections'])

    return render(request, "index.html", {
        "locations": locations,
        "connections": connections,
        "path": [],
    })


def offline_map(request):
    locations = [
        {
            "floor": loc.floor_location,
            "floor_location": loc.floor_location,
            "room_name": loc.room_name,
            "coordinates": loc.coordinates,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
            "stair_type": loc.stair_type,
        }
        for loc in Location.objects.all()
    ]
    connections_data = [
        {
            "from": conn.from_location.room_name,
            "to": conn.to_location.room_name,
            "cost": conn.cost,
            "from_floor": conn.from_location.floor_location,
            "to_floor": conn.to_location.floor_location,
            "is_emergency": conn.is_emergency,
        }
        for conn in Connection.objects.select_related(
            "from_location", "to_location"
        ).all()
    ]

    return render(request, "offline-map.html", {
        "locations": locations,
        "connections": connections_data,
        "path": [],
    })


def offline(request):
    return render(request, 'offline.html')


@login_required(login_url="admin:login")
@user_passes_test(staff_check)
def admin_dashboard(request):
    locations = Location.objects.only(
        'room_name', 'floor_location', 'x_coordinate', 'y_coordinate'
    )
    data = [
        {
            "floor": loc.floor_location,
            "room_name": loc.room_name,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    return render(request, 'admin/admin-dashboard.html', {"locations": data})


@login_required(login_url="admin:login")
@user_passes_test(staff_check)
def admin_management(request):
    locations = Location.objects.only(
        'room_name', 'floor_location', 'x_coordinate', 'y_coordinate'
    )
    data = [
        {
            "floor": loc.floor_location,
            "room_name": loc.room_name,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    return render(request, 'admin/admin-management.html', {"locations": data})


@csrf_exempt
@login_required
@user_passes_test(staff_check)
def save_room(request):
    if request.method != "POST":
        return JsonResponse({"error": "invalid method"}, status=400)

    try:
        data = json.loads(request.body.decode("utf-8"))
        rooms = data.get("rooms", [])

        if not rooms:
            return JsonResponse({"error": "No rooms provided"}, status=400)

        created = 0
        for room in rooms:
            room_name = room.get("room_name")
            floor = room.get("floor")
            x = room.get("center_x")
            y = room.get("center_y")
            polygon = room.get("polygon")

            if None in [room_name, floor, x, y, polygon]:
                continue

            Location.objects.create(
                room_name=room_name,
                floor_location=floor,
                x_coordinate=x,
                y_coordinate=y,
                coordinates=polygon
            )
            created += 1

        clear_location_cache()
        return JsonResponse({"status": "saved", "created": created})

    except Exception as e:
        return JsonResponse({"error": "server crash", "detail": str(e)}, status=500)


@csrf_exempt
def save_connection(request):
    if request.method != "POST":
        return JsonResponse({"error": "invalid method"}, status=400)

    try:
        data = json.loads(request.body.decode("utf-8"))

        from_room = data.get("from_room")
        to_room = data.get("to_room")
        from_x = data.get("from_x")
        from_y = data.get("from_y")
        to_x = data.get("to_x")
        to_y = data.get("to_y")

        if not from_room or not to_room:
            return JsonResponse({"error": "Missing room names"}, status=400)

        try:
            from_obj = Location.objects.get(room_name=from_room)
            to_obj = Location.objects.get(room_name=to_room)
        except Location.DoesNotExist:
            return JsonResponse({"error": "Room not found"}, status=404)

        cost = data.get("cost")
        if cost is None:
            try:
                cost = ((to_x - from_x) ** 2 + (to_y - from_y) ** 2) ** 0.5
            except Exception:
                cost = 1.0

        conn = Connection.objects.create(
            from_location=from_obj,
            to_location=to_obj,
            cost=float(cost)
        )

        clear_connection_cache()
        return JsonResponse({"status": "saved", "connection_id": conn.id})

    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


def emergency_paths(request):
    data = cache.get('emergency_paths_data')

    if data is None:
        connections = Connection.objects.filter(
            is_emergency=True
        ).select_related('from_location', 'to_location')

        data = [
            {
                "from": [
                    conn.from_location.y_coordinate,
                    conn.from_location.x_coordinate,
                    conn.from_location.floor_location
                ],
                "to": [
                    conn.to_location.y_coordinate,
                    conn.to_location.x_coordinate,
                    conn.to_location.floor_location
                ],
            }
            for conn in connections
        ]
        cache.set('emergency_paths_data', data, CACHE_TTL['emergency_paths'])

    return JsonResponse(data, safe=False)