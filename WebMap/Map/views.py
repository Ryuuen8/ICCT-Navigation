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
# Create your views here.

class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer

class ConnectionViewSet(viewsets.ModelViewSet):
    queryset = Connection.objects.select_related('from_location', 'to_location').all()
    serializer_class = ConnectionSerializer

class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.select_related('from_location', 'to_location').all()
    serializer_class = AnnouncementSerializer
    
class HazardReportViewSet(viewsets.ModelViewSet):
    queryset = HazardReport.objects.all()
    serializer_class = HazardReportSerializer

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
    paginator = Paginator(locations, 30)
    
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)
    context = {'room_name':  locations}
        
    return render(request,'floor-maps.html', {"page_obj": page_obj  })

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
    """Handle POST requests to compute a path between two rooms.

    Expects JSON `{ "start": <room>, "end": <room> }` and returns
    a JSON object with `path` (flat [y,x,floor] coords) and `segments`
    (grouped by floor) for client rendering.
    """
    if request.method != "POST":
        return JsonResponse({
            "error": "POST request required"
        }, status=400)

    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body"}, status=400)

    start = data.get("start")
    end = data.get("end")

    if not start or not end:
        return JsonResponse({"error": "Missing start or end room"}, status=400)

    G = nx.DiGraph()

    locations = list(Location.objects.all())
    stair_x = [loc.x_coordinate for loc in locations if "stair" in loc.room_name.lower()]
    stair_threshold = (min(stair_x) + max(stair_x)) / 2 if stair_x else 0

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

    for conn in Connection.objects.all():
        from_floor = conn.from_location.floor_location
        to_floor = conn.to_location.floor_location

        # Add both directions; stair transitions are filtered later
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
    if start_floor < end_floor:
        allowed_direction = "up"
    elif start_floor > end_floor:
        allowed_direction = "down"
    else:
        allowed_direction = None

    blocked_rooms = {"Library"}

    H = nx.DiGraph()
    H.add_nodes_from(G.nodes(data=True))
    for u, v, data in G.edges(data=True):
        if u in blocked_rooms and u not in {start, end}:
            continue
        if v in blocked_rooms and v not in {start, end}:
            continue

        floor_diff = data.get("floor_diff", 0)
        u_type = G.nodes[u].get("stair_type")
        v_type = G.nodes[v].get("stair_type")

        if allowed_direction == "up":
            if floor_diff != 0 and (u_type == "exit" or v_type == "exit"):
                continue
        elif allowed_direction == "down":
            if floor_diff != 0 and (u_type == "entrance" or v_type == "entrance"):
                continue

        if floor_diff == 0 or allowed_direction is None:
            H.add_edge(u, v, **data)
        elif allowed_direction == "up" and floor_diff > 0:
            H.add_edge(u, v, **data)
        elif allowed_direction == "down" and floor_diff < 0:
            H.add_edge(u, v, **data)

    def heuristic(a, b):
        ax, ay, af = H.nodes[a]["pos"]
        bx, by, bf = H.nodes[b]["pos"]

        return math.hypot(ax - bx, ay - by)

    path = nx.astar_path(
        H,
        start,
        end,
        heuristic=heuristic,
        weight="weight"
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
        "segments": segments
    })

def index(request):
    """Render the main index used by the map UI.

    This view collects `Location` objects and embeds their coordinates
    into the template so the frontend can render room polygons and
    build a client-side graph view.
    """
    locations  = Location.objects.all()
    data = [
        {
            "floor": loc.floor_location,
            "room_name": loc.room_name,
            "coordinates": loc.coordinates,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    G = nx.Graph()
    for loc in locations:
        G.add_node(loc.room_name, pos=(loc.floor_location,loc.x_coordinate, loc.y_coordinate, loc.coordinates))
    for conn in Connection.objects.all():
        G.add_edge(            
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost)
    print(list(G.edges()))
    return render(request, "index.html", {
        "locations": data,
    })

def staff_check(user):
    return user.is_staff
    
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
    """Save room polygons from the map editor.

    Expects POST JSON with `rooms` array; creates `Location` rows.
    """

    if request.method == "POST":

        data = json.loads(request.body)

        for room in data["rooms"]:
            Location.objects.create(
                room_name=room["room_name"],
                x_coordinate=room["center_x"],
                y_coordinate=room["center_y"],
                coordinates=room["polygon"]
            )

        return JsonResponse({"status": "saved"})

#Testing for pathfinding using foliumfrom django.shortcuts import render, redirect
