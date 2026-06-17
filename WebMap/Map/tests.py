import json
from django.test import TestCase, Client
from .models import Location, Announcement


class LocationAPITest(TestCase):
    def setUp(self):
        self.client = Client()
        self.location = Location.objects.create(
            room_name='R401',
            floor_location=4,
            x_coordinate=100.0,
            y_coordinate=200.0
        )

    # ─── GET TEST ─────────────────────────────
    def test_get_locations(self):
        response = self.client.get('/api/locations/')

        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

    # ─── CREATE TEST ──────────────────────────
    def test_create_location(self):
        payload = {
            'room_name': 'R402',
            'floor_location': 4,
            'x_coordinate': 150.0,
            'y_coordinate': 250.0,
        }

        response = self.client.post(
            '/api/locations/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        self.assertEqual(response.status_code, 201)

        data = response.json()
        self.assertEqual(data['room_name'], 'R402')
        self.assertEqual(data['floor_location'], 4)
        self.assertIn('id', data)

        # confirm DB was updated
        self.assertTrue(Location.objects.filter(room_name='R402').exists())

    # ─── PATHFIND TEST ────────────────────────
    def test_pathfind(self):
        payload = {
            'start': 'R401',
            'end': 'Library'
        }

        response = self.client.post(
            '/pathfind/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        # accept either success or controlled failure
        self.assertIn(response.status_code, [200, 400])

        # if success, validate structure
        if response.status_code == 200:
            data = response.json()
            self.assertIn('path', data)

class AnnouncementAPItest(TestCase):
    def setUp(self):
        self.client = Client()

        # Create locations (required for ForeignKey fields)
        self.loc1 = Location.objects.create(
            room_name="B2-31",
            floor_location=2,
            x_coordinate=100,
            y_coordinate=100
        )

        self.loc2 = Location.objects.create(
            room_name="B2-55",
            floor_location=2,
            x_coordinate=200,
            y_coordinate=200
        )

        # Create initial announcement
        self.ann = Announcement.objects.create(
            title="Test",
            description="Test Test",
            from_location=self.loc1,
            to_location=self.loc2
        )

    # ─── GET TEST ─────────────────────────────
    def test_get_announcements(self):
        response = self.client.get('/api/announcements/')

        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

        self.assertEqual(data[0]["title"], "Test")

    # ─── CREATE TEST ──────────────────────────
    def test_create_announcement(self):
        payload = {
            "title": "New Announcement",
            "description": "System update",
            "from_location": self.loc1.id,
            "to_location": self.loc2.id
        }

        response = self.client.post(
            '/api/announcements/',
            data=json.dumps(payload),
            content_type='application/json'
        )

        self.assertEqual(response.status_code, 201)

        data = response.json()
        self.assertEqual(data["title"], "New Announcement")
        self.assertIn("id", data)

        # verify it was saved in DB
        self.assertTrue(
            Announcement.objects.filter(title="New Announcement").exists()
        )