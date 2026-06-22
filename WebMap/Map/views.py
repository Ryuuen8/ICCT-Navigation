from django.shortcuts import render, redirect
from django.contrib import messages
from django.http import JsonResponse
from django.core.paginator import Paginator
from .models import Location, Connection, Announcement, HazardReport
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.db.models import Q
from .forms import ReportForm
import json
import networkx as nx
import math
from rest_framework import viewsets
from .serializers import LocationSerializer, ConnectionSerializer, AnnouncementSerializer, HazardReportSerializer
from django.contrib.auth.decorators import login_required, user_passes_test
from rest_framework.permissions import IsAdminUser
# Create your views here.


def staff_check(user):
    return user.is_staff

class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    permission_classes = [IsAdminUser]
    
class ConnectionViewSet(viewsets.ModelViewSet):
    queryset = Connection.objects.select_related('from_location', 'to_location').all()
    serializer_class = ConnectionSerializer
    permission_classes = [IsAdminUser]
    
class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.select_related('from_location', 'to_location').all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminUser]

class HazardReportViewSet(viewsets.ModelViewSet):
    queryset = HazardReport.objects.all()
    serializer_class = HazardReportSerializer
    permission_classes = [IsAdminUser]

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
    context = {'items': items, 'form':form, 'items_count': items.count()}
    
    return render(request, 'main.html', context)

def floormap(request):
    locations = Location.objects.exclude(Q(room_name__startswith="Point") | Q(room_name__startswith="Stair"))
    return render(request,'floor-maps.html', {"locations":locations})

def emergency(request):
    return render(request, 'emergencty.html')

def search(request):
    query = request.GET.get('term', '')     
    products = Location.objects.filter(name__icontains=query)[:10]
    results = [product.name for product in products]
    return JsonResponse(results, safe=False)
    
def locate(request):
    """Handle QR code scans with coordinates.

    Expects URL params: x, y, floor, name
    Redirects to the map page so both in-app and external scans work.
    """
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

    query_string = f"?x={x}&y={y}&floor={floor}"
    if name:
        query_string += f"&name={name}"

    return redirect(f"/map/{query_string}")

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

    G = nx.DiGraph()

    locations = list(Location.objects.all())

    stair_x = [loc.x_coordinate for loc in locations if "stair" in loc.room_name.lower()]
    stair_threshold = (min(stair_x) + max(stair_x)) / 2 if stair_x else 0

    emergency_rooms = {
        loc.room_name for loc in locations
        if "emergency node" in loc.room_name.lower()
    }

    # Build nodes
    for loc in locations:
        stair_type = loc.stair_type
        if stair_type is None and "stair" in loc.room_name.lower():
            stair_type = (
                Location.STAIR_TYPE_ENTRANCE
                if loc.x_coordinate > stair_threshold
                else Location.STAIR_TYPE_EXIT
            )

        G.add_node(
            loc.room_name,
            pos=(loc.x_coordinate, loc.y_coordinate, loc.floor_location),
            stair_type=stair_type,
        )

    # Build edges
    for conn in Connection.objects.all():
        from_floor = conn.from_location.floor_location
        to_floor = conn.to_location.floor_location

        G.add_edge(
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost,
            floor_diff=to_floor - from_floor,
        )
        G.add_edge(
            conn.to_location.room_name,
            conn.from_location.room_name,
            weight=conn.cost,
            floor_diff=from_floor - to_floor,
        )

    if start not in G or end not in G:
        return JsonResponse({"error": "Unknown start or end room"}, status=400)

    start_floor = G.nodes[start]["pos"][2]
    end_floor = G.nodes[end]["pos"][2]

    same_floor = (start_floor == end_floor)

    # direction rule
    if same_floor:
        allowed_direction = None
    else:
        allowed_direction = (
            "up" if start_floor < end_floor else "down"
        )

    blocked_rooms = {"Library"}
    allowed_endpoints = {start, end}

    H = nx.DiGraph()
    H.add_nodes_from(G.nodes(data=True))

    for u, v, edge_data in G.edges(data=True):

        floor_diff = edge_data.get("floor_diff", 0)

        # ❌ BLOCK STAIRS if same floor navigation
        if same_floor and floor_diff != 0:
            continue

        # blocked rooms
        if u in blocked_rooms and u not in allowed_endpoints:
            continue
        if v in blocked_rooms and v not in allowed_endpoints:
            continue

        # emergency filtering
        if not is_emergency:
            if u in emergency_rooms and u not in allowed_endpoints:
                continue
            if v in emergency_rooms and v not in allowed_endpoints:
                continue

        u_type = G.nodes[u].get("stair_type")
        v_type = G.nodes[v].get("stair_type")

        if allowed_direction == "up":
            if floor_diff != 0 and (u_type == "exit" or v_type == "exit"):
                continue
        elif allowed_direction == "down":
            if floor_diff != 0 and (u_type == "entrance" or v_type == "entrance"):
                continue

        H.add_edge(u, v, **edge_data)

    def heuristic(a, b):
        ax, ay, af = H.nodes[a]["pos"]
        bx, by, bf = H.nodes[b]["pos"]
        return math.hypot(ax - bx, ay - by)

    try:
        path = nx.astar_path(H, start, end, heuristic=heuristic, weight="weight")
    except nx.NetworkXNoPath:
        return JsonResponse(
            {"error": "No path found between these rooms"},
            status=404
        )

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
                segments.append({
                    "floor": current_floor,
                    "coords": current_segment
                })
            current_floor = floor
            current_segment = [[y, x]]
        else:
            current_segment.append([y, x])

    if len(current_segment) >= 2:
        segments.append({
            "floor": current_floor,
            "coords": current_segment
        })

    return JsonResponse({
        "path": full_coords,
        "segments": segments,
        "destination": end
    })
    
    
def index(request):
    """Render the main index used by the map UI.

    This view collects `Location` objects and embeds their coordinates
    into the template so the frontend can render room polygons and
    build a client-side graph view.
    """
    locations = Location.objects.all()
    data = [
        {
            "floor": loc.floor_location,
            "floor_location": loc.floor_location,
            "room_name": loc.room_name,
            "coordinates": loc.coordinates,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
            "stair_type": loc.stair_type,
        }
        for loc in locations
    ]
    connections_data = [
        {
            "from": conn.from_location.room_name,
            "to": conn.to_location.room_name,
            "cost": conn.cost,
            "from_floor": conn.from_location.floor_location,
            "to_floor": conn.to_location.floor_location,
        }
        for conn in Connection.objects.select_related(
            "from_location", "to_location"
        ).all()
    ]

    return render(request, "index.html", {
        "locations": data,
        "connections": connections_data,
        "path": [],
    })

def offline_map(request):
    locations = Location.objects.all()
    data = [
        {
            "floor": loc.floor_location,
            "floor_location": loc.floor_location,
            "room_name": loc.room_name,
            "coordinates": loc.coordinates,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
            "stair_type": loc.stair_type,
        }
        for loc in locations
    ]
    connections_data = [
        {
            "from": conn.from_location.room_name,
            "to": conn.to_location.room_name,
            "cost": conn.cost,
            "from_floor": conn.from_location.floor_location,
            "to_floor": conn.to_location.floor_location,
        }
        for conn in Connection.objects.select_related(
            "from_location", "to_location"
        ).all()
    ]

    return render(request, "offline-map.html", {
        "locations": data,
        "connections": connections_data,
        "path": [],
    })
    
def offline(request):
    return render(request, 'offline.html')

@login_required(login_url="admin:login")
@user_passes_test(staff_check)
def admin_dashboard(request):
    locations  = Location.objects.all()
    data = [
        {
            "floor": loc.floor_location,
            "room_name": loc.room_name,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    G = nx.Graph()
    for loc in locations:
        G.add_node(loc.room_name, pos=(loc.floor_location,loc.x_coordinate, loc.y_coordinate))
    for conn in Connection.objects.all():
        G.add_edge(            
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost)
    return render(request, 'admin/admin-dashboard.html',{"locations": data})

@login_required(login_url="admin:login")
@user_passes_test(staff_check)
def admin_management(request):
    locations  = Location.objects.all()
    data = [
        {
            "floor": loc.floor_location,
            "room_name": loc.room_name,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    G = nx.Graph()
    for loc in locations:
        G.add_node(loc.room_name, pos=(loc.floor_location,loc.x_coordinate, loc.y_coordinate))
    for conn in Connection.objects.all():
        G.add_edge(            
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost)
    return render(request, 'admin/admin-management.html',{"locations": data})


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

            # safety check (THIS PREVENTS 500s)
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

        return JsonResponse({
            "status": "saved",
            "created": created
        })

    except Exception as e:
        return JsonResponse({
            "error": "server crash",
            "detail": str(e)
        }, status=500)    
@csrf_exempt  # remove if you're already handling CSRF properly
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

        # -----------------------------
        # BASIC VALIDATION
        # -----------------------------
        if not from_room or not to_room:
            return JsonResponse({"error": "Missing room names"}, status=400)

        # -----------------------------
        # FIND OBJECTS
        # -----------------------------
        try:
            from_obj = Location.objects.get(room_name=from_room)
            to_obj = Location.objects.get(room_name=to_room)
        except Location.DoesNotExist:
            return JsonResponse({"error": "Room not found"}, status=404)

        # -----------------------------
        # OPTIONAL: compute cost if not provided
        # -----------------------------
        cost = data.get("cost")

        if cost is None:
            # fallback: simple euclidean distance
            try:
                cost = ((to_x - from_x) ** 2 + (to_y - from_y) ** 2) ** 0.5
            except Exception:
                cost = 1.0

        # -----------------------------
        # CREATE CONNECTION
        # -----------------------------
        conn = Connection.objects.create(
            from_location=from_obj,
            to_location=to_obj,
            cost=float(cost)
        )

        return JsonResponse({
            "status": "saved",
            "connection_id": conn.id
        })

    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)    
#Testing for pathfinding using foliumfrom django.shortcuts import render, redirect
