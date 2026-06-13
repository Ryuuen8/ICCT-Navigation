from django.contrib import admin
from .models import Location, Connection, Announcement


class LocationAdmin(admin.ModelAdmin):
    list_display = ('room_name', 'floor_location', 'stair_type')
    list_filter = ('floor_location', 'stair_type')


admin.site.register(Location, LocationAdmin)
admin.site.register(Connection)
admin.site.register(Announcement)
