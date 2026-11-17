import os
from unittest import TestCase

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")

from app.api.v1.cafes import admin_owned_photos


class AdminOwnedPhotosTests(TestCase):
    def test_keeps_only_photos_no_other_log_holds(self):
        visits = [
            {"id": "user-log", "photo_urls": ["a.jpg", "b.jpg"]},
            {"id": "admin-log", "photo_urls": ["a.jpg", "c.jpg"]},
        ]
        self.assertEqual(
            admin_owned_photos(["a.jpg", "b.jpg", "c.jpg", "new.jpg"], visits, "admin-log"),
            ["c.jpg", "new.jpg"],
        )

    def test_first_admin_edit_has_no_admin_log(self):
        visits = [{"id": "user-log", "photo_urls": ["a.jpg"]}, {"id": "empty", "photo_urls": None}]
        self.assertEqual(admin_owned_photos(["a.jpg", "new.jpg"], visits, None), ["new.jpg"])
