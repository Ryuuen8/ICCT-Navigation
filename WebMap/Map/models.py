from django.db import models
from django.forms import ModelForm
# Create your models here.
class Location(models.Model):
    STAIR_TYPE_ENTRANCE = "entrance"
    STAIR_TYPE_EXIT = "exit"
    STAIR_TYPE_CHOICES = [
        (STAIR_TYPE_ENTRANCE, "Entrance"),
        (STAIR_TYPE_EXIT, "Exit"),
    ]

    floor_location = models.IntegerField(default=1)
    room_name = models.TextField(max_length=20)
    stair_type = models.CharField(
        max_length=10,
        choices=STAIR_TYPE_CHOICES,
        blank=True,
        null=True,
        help_text="Optional explicit stair direction for stair nodes.",
    )
    coordinates = models.JSONField(default=list)
    y_coordinate = models.FloatField()
    x_coordinate = models.FloatField()
    

    def __str__(self):
        return self.room_name
    
class Connection(models.Model):
    from_location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="from_conn")
    to_location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="to_conn")
    cost = models.FloatField()
    
    def __str__(self):
        return f"{self.from_location.room_name} → {self.to_location.room_name}"    

class Announcement(models.Model):
    title = models.CharField(max_length=20)
    description = models.TextField(max_length=200)
    from_location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="from_destination", null=True, blank=True)
    to_location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name="destination")
    date_pub = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.title
    
class HazardReport(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(max_length=500)
    image  = models.ImageField(upload_to='user-reports/%Y/%m/%d/', null=True, blank=True)
    uploade_date = models.DateTimeField(auto_now_add=True)
    
    
    def __str__(self):
        return self.title
