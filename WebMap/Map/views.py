from django.shortcuts import render
from django.templatetags.static import static
from django.http import JsonResponse
from folium.plugins import MousePosition, AntPath, Search
from .models import Location, Connection 
import folium
import json
import networkx as nx
# Create your views here.



def testresponse(Request):
    pass

#Pathfinding for the map using networtx for the a* algo
def index(request):
    locations  = Location.objects.all()
    data = [
        {
            "room_name": loc.room_name,
            "x_coordinate": loc.x_coordinate,
            "y_coordinate": loc.y_coordinate,
        }
        for loc in locations
    ]
    
    G = nx.Graph()
    for loc in locations:
        G.add_node(loc.room_name, pos=(loc.x_coordinate, loc.y_coordinate))
    for conn in Connection.objects.all():
        G.add_edge(            
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost)
    print(list(G.edges()))
    def heuristic(a, b):
        ax, ay = G.nodes[a]["pos"]
        bx, by = G.nodes[b]["pos"]

        return ((ax - bx)**2 + (ay - by)**2) ** 0.5
    
    data = json.loads(request.body)
    start = data("start")
    end = data("end")

    path = nx.astar_path(G, start, end, heuristic=heuristic,weight="weight")
    full_coords = []

    for node in path:
        x, y = G.nodes[node]["pos"]
        full_coords.append([y, x])

    return render(request, "index.html", {
        "locations": data,
          "path": full_coords
    })

#Testing for pathfinding using folium
def testmap(self):
    
    m = folium.Map([0,0], zoom_start=2, tiles=None)
    image_filepath = self.build_absolute_uri(static('hallways.svg'))
    
    img = folium.raster_layers.ImageOverlay(
        name = "2nd Floor",
        image = image_filepath, 
        bounds = [[-50, -45], [50, 45]],
        opacity = 0.6,
        interactive = True,
        cross_origin = False,
        zindex = 1,
    )
    
    G = nx.Graph()

    locations = Location.objects.all()


    for loc in locations:
        folium.Marker(
            location=[loc.y_coordinate, loc.x_coordinate],
            tooltip=loc.room_name
        ).add_to(m)
        
        G.add_node(loc.room_name, pos=(loc.x_coordinate, loc.y_coordinate))
    
    for conn in Connection.objects.all():
        G.add_edge(
            conn.from_location.room_name,
            conn.to_location.room_name,
            weight=conn.cost
        )
        
    def heuristic(a, b):
        ax, ay = G.nodes[a]["pos"]
        bx, by = G.nodes[b]["pos"]

        return ((ax - bx)**2 + (ay - by)**2) ** 0.5
    
    path = nx.astar_path(G, 'Test', 'Test1', heuristic=heuristic,weight="weight")
    coords = []

    for i in range(len(path) - 1):
        a = path[i]
        b = path[i + 1]

        ax, ay = G.nodes[a]["pos"]
        bx, by = G.nodes[b]["pos"]

        coords.append([(ay, ax), (by, bx)])

    for segment in coords:
        AntPath(
            locations=segment,
            color="blue",
            weight=5,
            delay=800
        ).add_to(m)

    
    folium.Popup("Image").add_to(img)
    img.add_to(m)
    folium.LayerControl().add_to(m)
    MousePosition().add_to(m)
    AntPath(locations=coords, reverse="False", dash_array=[20,30]).add_to(m) 
    
    testmap_html = m._repr_html_()

    m.fit_bounds(m.get_bounds())
    return render(self, 'testmap.html', {'testmap':  testmap_html})
