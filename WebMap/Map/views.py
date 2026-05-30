from django.shortcuts import render
from django.templatetags.static import static
from django.http import JsonResponse
from folium.plugins import MousePosition, AntPath, Search
from .models import Location, Connection
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.db.models import Q
import json
import networkx as nx
import math
# Create your views here.
def floormap(request):
    locations = Location.objects.filter(room_name__startswith="R")
    context = {'room_name':  locations}
        
    return render(request,'floor-maps.html', context)

def testmap(request):
    return render(request, 'main.html')

def emergency(request):
    return render(request, 'emergencty.html')

def pathfind(request):
    if request.method != "POST":
        return JsonResponse({
            "error": "POST request required"
        }, status=400)

    data = json.loads(request.body)

    start = data["start"]
    end = data["end"]
    G = nx.Graph()

    locations = Location.objects.all()

    for loc in locations:
        G.add_node(
            loc.room_name,
            pos=(loc.x_coordinate, loc.y_coordinate,loc.floor_location)
        )

    for conn in Connection.objects.all():
        G.add_edge(
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost
        )

    def heuristic(a, b):
        ax, ay, af = G.nodes[a]["pos"]
        bx, by, bf = G.nodes[b]["pos"]

        return math.hypot(ax - bx, ay - by)

    path = nx.astar_path(
        G,
        start,
        end,
        heuristic=heuristic,
        weight="weight"
    )

    full_coords = []

    for node in path:
        x, y, floor = G.nodes[node]["pos"]
        full_coords.append([y, x, floor])

    return JsonResponse({
        "path": full_coords
    })

#Pathfinding for the map using networtx for the a* algo
@ensure_csrf_cookie
def index(request):
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


@csrf_exempt
def save_room(request):
    
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

#Testing for pathfinding using folium
