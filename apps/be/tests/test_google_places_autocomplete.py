import asyncio
import os
from unittest import TestCase
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")

from pydantic import ValidationError

from app.models.cafe import GooglePlacesDetailsRequest
from app.services import google_places_service
from app.services.google_places_service import GooglePlacesService


def fake_client(status_code, payload):
    response = MagicMock(status_code=status_code, text="")
    response.json.return_value = payload
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


class AutocompleteTests(TestCase):
    def test_suggestions_are_flattened_and_session_token_is_sent(self):
        client = fake_client(200, {"suggestions": [
            {"placePrediction": {
                "placeId": "ChIJabc123456",
                "structuredFormat": {
                    "mainText": {"text": "Fritz Coffee"},
                    "secondaryText": {"text": "Mapo-gu, Seoul"},
                },
            }},
            {"queryPrediction": {"text": {"text": "fritz"}}},
        ]})
        with patch.object(google_places_service.httpx, "AsyncClient", return_value=client):
            result = asyncio.run(GooglePlacesService("key").autocomplete("fritz", "tok-12345678", 37.5, 127.0))

        self.assertEqual(result, [{"place_id": "ChIJabc123456", "name": "Fritz Coffee", "secondary": "Mapo-gu, Seoul"}])
        body = client.post.await_args.kwargs["json"]
        self.assertEqual(body["sessionToken"], "tok-12345678")
        self.assertIn("locationBias", body)

    def test_nearest_first_and_capped_at_five(self):
        far_to_near = [
            {"placePrediction": {
                "placeId": f"ChIJplace{i:04d}",
                "distanceMeters": 1000 * (7 - i),
                "structuredFormat": {"mainText": {"text": f"Cafe {i}"}},
            }}
            for i in range(7)
        ]
        client = fake_client(200, {"suggestions": far_to_near})
        with patch.object(google_places_service.httpx, "AsyncClient", return_value=client):
            result = asyncio.run(GooglePlacesService("key").autocomplete("cafe", "tok-12345678", 37.5, 127.0))

        self.assertEqual([s["name"] for s in result], ["Cafe 6", "Cafe 5", "Cafe 4", "Cafe 3", "Cafe 2"])
        self.assertNotIn("distance", result[0])
        self.assertIn("origin", client.post.await_args.kwargs["json"])

    def test_google_failure_is_none_not_empty(self):
        client = fake_client(403, {})
        with patch.object(google_places_service.httpx, "AsyncClient", return_value=client):
            result = asyncio.run(GooglePlacesService("key").autocomplete("fritz", "tok-12345678"))
        self.assertIsNone(result)

    def test_details_carries_session_token_and_field_mask(self):
        client = fake_client(200, {"id": "ChIJabc123456", "location": {"latitude": 1.0, "longitude": 2.0}})
        with patch.object(google_places_service.httpx, "AsyncClient", return_value=client):
            result = asyncio.run(GooglePlacesService("key")._get_place_details(
                "ChIJabc123456", session_token="tok-12345678", field_mask="id,location"
            ))

        kwargs = client.get.await_args.kwargs
        self.assertEqual(kwargs["params"], {"sessionToken": "tok-12345678"})
        self.assertEqual(kwargs["headers"]["X-Goog-FieldMask"], "id,location")
        self.assertEqual((result["latitude"], result["longitude"]), (1.0, 2.0))

    def test_place_id_cannot_carry_a_path(self):
        with self.assertRaises(ValidationError):
            GooglePlacesDetailsRequest(place_id="../../places:searchText")
