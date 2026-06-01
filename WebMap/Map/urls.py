from . import views
from django.urls import path

urlpatterns = [
    path('', views.testmap, name='main'),
    path('map/', views.index, name='mainmap'),
    path('pathfind/', views.pathfind, name="pathfind"),
    path('emergency/', views.emergency, name="emergency"),
    path('locate/', views.locate, name="locate"),
    path('admin-dashboard', views.admin_dashboard, name="adminds"),
    path('save-room/', views.save_room, name="save-room"),
    path('floormap/', views.floormap, name="floormap"),
]
