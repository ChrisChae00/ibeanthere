"""
What registration turns away, now that a franchise is not on that list.

The line is no longer "how many outlets does this brand have" but "is this a cafe
that serves coffee" -- a franchise location can name its roaster and grind for
filter, and the shop with one address can pour from a bag nobody can name. So the
brand verdict is still recorded, and no longer decides.

The two claims:

1. A franchise name registers. It is classified, stored, and let through.
2. A bubble tea shop still does not.

No database and no map service: both are faked. The registration reaches the
duplicate check and lands on the existing-cafe branch, which is enough -- the
franchise verdict is read before that point, so arriving there at all is the
proof that it no longer rejects.
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.api.v1 import cafes as cafes_api
from app.services import franchise_service

from test_visit_privacy import OWNER, make_client

# Standing inside the cafe being registered, so the 100m gate passes.
HERE = {"lat": 43.4643, "lng": -80.5204}

OSM_CAFE = {
    "road": "King Street West",
    "display_name": "King Street West, Kitchener, Ontario",
    "extratags": {"amenity": "cafe", "cuisine": "coffee_shop"},
}
OSM_BUBBLE_TEA = {
    "road": "King Street West",
    "display_name": "King Street West, Kitchener, Ontario",
    "extratags": {"amenity": "cafe", "cuisine": "bubble_tea"},
}

EXISTING = {
    "id": "cafe-1",
    "name": "Some Cafe",
    "navigator_id": "user-navigator",
    "status": "pending",
}


def _body(name):
    return {
        "name": name,
        "latitude": HERE["lat"],
        "longitude": HERE["lng"],
        "address": "1 King Street West",
        "user_location": HERE,
        "serves_coffee": True,
        "images": ["https://example.com/cafe.jpg"],
    }


class RegistrationPolicyTests(unittest.TestCase):
    def _register(self, name, osm, verdict):
        """Run one registration against fakes, and hand back the response."""
        client, supabase = make_client(
            self,
            {
                # No bean of this user at the cafe yet, so the check-in is allowed
                # to proceed rather than answering 409.
                "cafe_beans": [],
                "cafes": [EXISTING],
            },
            user_id=OWNER,
        )

        osm_service = mock.Mock()
        osm_service.reverse_geocode = mock.AsyncMock(return_value=osm)

        with mock.patch.object(cafes_api, "get_osm_service", return_value=osm_service), \
             mock.patch.object(cafes_api, "check_nearby_cafes", return_value=EXISTING), \
             mock.patch.object(
                 cafes_api.franchise_service, "classify",
                 mock.AsyncMock(return_value=verdict),
             ):
            return client.post("/api/v1/cafes/register", json=_body(name))

    def test_franchise_name_is_accepted(self):
        verdict = franchise_service.Verdict(
            status=franchise_service.FRANCHISE,
            brand_key="starbucks",
            display_name="Starbucks",
            outlet_count=30000,
        )
        response = self._register("Starbucks", OSM_CAFE, verdict)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("franchise", response.text.lower())

    def test_bubble_tea_is_still_refused(self):
        verdict = franchise_service.Verdict(
            status=franchise_service.LOCAL,
            brand_key="chatime",
            display_name="Chatime",
            outlet_count=1,
        )
        response = self._register("Chatime", OSM_BUBBLE_TEA, verdict)

        self.assertEqual(response.status_code, 400)
        self.assertIn("bubble tea", response.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
