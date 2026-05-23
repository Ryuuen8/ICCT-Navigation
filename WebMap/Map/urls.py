from . import views
from django.urls import path

urlpatterns = [
    path('', views.index, name='index'),
    path('testmap/', views.testmap, name='testmap'),
    path('pathfind/', views.pathfind, name="pathfind")
]
