//simple map
var map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -2
});

var bounds = [
    [0, 0],
    [1000, 1000]
];

//Custom map using svg
map.fitBounds(bounds);
L.imageOverlay(
  '/static/hallways.svg',
    bounds
).addTo(map);

var videoUrl = "C:/Users/sabri/Downloads/evernight-everknight.gif"
L.videoOverlay(videoUrl, bounds).addTo(map);



//Positioning coordinates location to bottom left
var coordControl = L.control({
    position: 'bottomleft'
});

coordControl.onAdd = function (map) {
    this._div = L.DomUtil.create('div', 'coords-display');
    this._div.style.background = 'white';
    this._div.style.padding = '5px';
    return this._div;
};

coordControl.addTo(map);

var locations = JSON.parse(document.getElementById("locations-data").textContent);

locations.forEach(function(loc){
    L.marker([loc.y_coordinate, loc.x_coordinate]).addTo(map).bindPopup(loc.room_name)
})

map.on('mousemove', function (e) {
    coordControl._div.innerHTML = "Lat: " + e.latlng.lat.toFixed(4) + " | Lng: " + e.latlng.lng.toFixed(4);
});

//Pathfinding visualization

var path = JSON.parse(document.getElementById("path-data").textContent);

console.log("PATH:", path);

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

console.log("PATH:", path);
console.log("PATH LENGTH:", path.length);

//mouse click event listener
let selected = []

map.on('click', function(){
    selected.push(roomName)
});

fetch("/index/",{
    method: "POST",
    headers: {
        "Content-type": "application/json"
    },
    body : JSON.stringify({
        start: "test1",
        end: "test2"
    })
})