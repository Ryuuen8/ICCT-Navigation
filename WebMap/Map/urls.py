from . import views
from django.urls import path, include
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'locations', views.LocationViewSet)
router.register(r'connections', views.ConnectionViewSet)
router.register(r'announcements', views.AnnouncementViewSet)
router.register(r'hazards', views.HazardReportViewSet)

urlpatterns = [
    path('', views.announcement, name='main'),
    path('', include('pwa.urls')),  
    path('map/', views.index, name='mainmap'),
    path('emergency/', views.emergency, name="emergency"),
    path('admin-dashboard/', views.admin_dashboard, name="adminds"),
    path('admin-editor/', views.admin_management, name="map-editor"),
    path('floormap/', views.floormap, name="floormap"),
    path('offline/', views.offline, name="offline"),
    path('offline-map/', views.offline_map, name="offline_map"),
    path('map/emergency-paths/', views.emergency_paths, name="emergency-paths"),
    path('locate/', views.locate, name="locate"),
    path('submit-report/', views.announcement, name="report"),
    path('search/', views.search, name="search"),
    path('save-room/', views.save_room, name="save-room"),
    path('save-connection/', views.save_connection, name='save-nodes'),
    path('pathfind/', views.pathfind, name="pathfind"),
    path('api/', include(router.urls)),

]
