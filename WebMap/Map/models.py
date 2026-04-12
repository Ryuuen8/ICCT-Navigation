from django.db import models

# Create your models here.
class FirstFloor(models.Model):
    room_name = models.TextField(max_length=20)
    y_coordinate = models.IntegerField(default=10, editable=False)
    x_coordinate = models.IntegerField(default=0, unique=True)
    
    class Meta:
        pass