# management/commands/rescale_floor1.py
from django.core.management.base import BaseCommand
from Map.models import Location

OLD_W, OLD_H = 934, 817
NEW_W, NEW_H = 989, 810

SCALE_X = NEW_W / OLD_W  # 1.0589
SCALE_Y = NEW_H / OLD_H  # 0.9914

class Command(BaseCommand):
    help = 'Rescale floor 1 polygon coordinates to new SVG dimensions'

    def handle(self, *args, **kwargs):
        locations = Location.objects.filter(floor_location=1)
        updated = 0

        for loc in locations:
            # rescale center point
            loc.x_coordinate = loc.x_coordinate * SCALE_X
            loc.y_coordinate = loc.y_coordinate * SCALE_Y

            # rescale polygon coordinates [[y, x], [y, x], ...]
            if loc.coordinates:
                loc.coordinates = [
                    [point[0] * SCALE_Y, point[1] * SCALE_X]
                    for point in loc.coordinates
                ]

            loc.save()
            updated += 1
            self.stdout.write(f"Updated: {loc.room_name}")

        self.stdout.write(self.style.SUCCESS(f"Done — {updated} locations updated"))