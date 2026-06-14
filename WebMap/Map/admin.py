from django.contrib import admin
from .models import Announcement, Connection, Location, HazardReport

@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = (
        "room_name",
        "floor_location",
        "stair_type",
        "x_coordinate",
        "y_coordinate",
    )
    list_filter = ("floor_location", "stair_type")
    search_fields = ("room_name",)
    ordering = ("floor_location", "room_name")
    fieldsets = (
        (
            "Room information",
            {"fields": ("room_name", "floor_location", "stair_type")},
        ),
        (
            "Map placement",
            {"fields": ("x_coordinate", "y_coordinate", "coordinates")},
        ),
    )


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ("from_location", "to_location", "cost")
    search_fields = ("from_location__room_name", "to_location__room_name")
    autocomplete_fields = ("from_location", "to_location")


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("title", "from_location", "to_location", "date_pub")
    list_filter = ("date_pub",)
    search_fields = (
        "title",
        "description",
        "from_location__room_name",
        "to_location__room_name",
    )

@admin.register(HazardReport)
class HazardAdmin(admin.ModelAdmin):
    list_display = ("title", "description", "image")