from rest_framework import serializers
from .models import Location, Connection, Announcement, HazardReport

class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = '__all__'

class ConnectionSerializer(serializers.ModelSerializer):
    from_location_name = serializers.CharField(source='from_location.room_name', read_only=True)
    to_location_name = serializers.CharField(source='to_location.room_name', read_only=True)
    class Meta:
        model = Connection
        fields = '__all__'

class AnnouncementSerializer(serializers.ModelSerializer):
    from_location_name = serializers.CharField(source='from_location.room_name', read_only=True)
    to_location_name = serializers.CharField(source='to_location.room_name', read_only=True)
    class Meta:
        model = Announcement
        fields = '__all__'

class HazardReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = HazardReport
        fields = '__all__'