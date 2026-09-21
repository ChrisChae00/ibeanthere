"""
Which surface a trait claim came through decides whether it counts yet.

The same sentence -- "this place sells beans" -- carries different evidence depending
on where it was said:

- Registering a cafe means passing a 100m check while standing in it.
- Logging a bean purchase from inside the cafe means the same check, plus having just
  bought the bag.
- Logging one from home, or pressing a button on a cafe page, means neither; the person
  may never have been there.

So a claim counts at once only when the server measured where it was made, and every
other claim waits. These tests pin that split, and pin the thing that makes the split
worth having: a pending row must never reach a count, a flag, or a map filter.
"""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services import traits

from test_visit_privacy import FakeSupabase, FakeUser, _row, make_client
from app.api.deps import get_current_user
from app.main import app

CAFE = "cafe-1"
SOMEONE = "user-1"
SOMEONE_ELSE = "user-2"


def _obs(**overrides):
    row = {
        "trait": "sells_beans",
        "value": True,
        "source": "user",
        "user_id": SOMEONE,
        "observed_at": "2026-09-01",
        "created_at": "2026-09-01T10:00:00+00:00",
        "status": traits.APPROVED,
    }
    row.update(overrides)
    return row


def _of(summaries, trait="sells_beans"):
    return next(s for s in summaries if s["trait"] == trait)


class PendingIsNotTheRecordTests(unittest.TestCase):
    def test_a_pending_row_is_not_counted(self):
        summary = _of(traits.summarise([_obs(status=traits.PENDING)]))
        self.assertEqual((summary["yes"], summary["no"]), (0, 0))
        self.assertIsNone(summary["latest_value"])

    def test_a_pending_row_does_not_raise_a_map_flag(self):
        """The filter promises places that ARE something. A request is not an answer."""
        self.assertFalse(traits.flags([_obs(status=traits.PENDING)])["sells_beans"])

    def test_a_pending_no_cannot_overturn_an_approved_yes(self):
        # The whole point: one unreviewed "no" must not drop a cafe out of a filter.
        rows = [
            _obs(value=True, observed_at="2026-09-01"),
            _obs(value=False, user_id=SOMEONE_ELSE, observed_at="2026-09-08",
                 status=traits.PENDING),
        ]
        summary = _of(traits.summarise(rows))
        self.assertEqual((summary["yes"], summary["no"]), (1, 0))
        self.assertIs(summary["latest_value"], True)

    def test_my_own_pending_claim_is_not_reported_back_as_mine(self):
        """`mine` says what the record holds for you, not what you have asked for."""
        summary = _of(traits.summarise([_obs(status=traits.PENDING)], viewer_id=SOMEONE))
        self.assertIsNone(summary["mine"])

    def test_a_row_with_no_status_still_counts(self):
        """Rows written before the column existed are the record, not suggestions."""
        row = _obs()
        del row["status"]
        self.assertEqual(_of(traits.summarise([row]))["yes"], 1)


class WritePathTests(unittest.TestCase):
    def test_evidence_backed_writes_are_approved(self):
        supabase = FakeSupabase({"cafe_trait_observations": []})
        traits.record_observation(supabase, CAFE, "sells_beans", True, SOMEONE)
        self.assertEqual(supabase.queries[0].payload["status"], traits.APPROVED)
        self.assertEqual(supabase.queries[0].payload["source"], "user")

    def test_the_cafe_page_writes_pending(self):
        supabase = FakeSupabase({"cafe_trait_observations": []})
        traits.record_observation(
            supabase, CAFE, "sells_beans", True, SOMEONE, status=traits.PENDING
        )
        self.assertEqual(supabase.queries[0].payload["status"], traits.PENDING)

    def test_observed_at_defaults_to_today_not_to_null(self):
        supabase = FakeSupabase({"cafe_trait_observations": []})
        traits.record_observation(supabase, CAFE, "sells_beans", True, SOMEONE)
        self.assertEqual(supabase.queries[0].payload["observed_at"], date.today().isoformat())

    def test_an_unknown_trait_is_dropped_rather_than_written(self):
        supabase = FakeSupabase({"cafe_trait_observations": []})
        traits.record_observations_quietly(
            supabase, CAFE, {"sells_beans": True, "wifi": True}, SOMEONE
        )
        written = [q.payload["trait"] for q in supabase.queries if q.op == "insert"]
        self.assertEqual(written, ["sells_beans"])

    def test_a_failed_trait_never_reaches_the_caller(self):
        """Registration and the log have already succeeded by the time this runs."""
        class Exploding(FakeSupabase):
            def table(self, name):
                raise RuntimeError("boom")

        traits.record_observations_quietly(
            Exploding({}), CAFE, {"sells_beans": True}, SOMEONE
        )  # must not raise


class LogPathEvidenceTests(unittest.TestCase):
    """
    What a coffee log's `sells_beans` answer is worth.

    A log can be written from anywhere, in either mode, days after the fact -- the form
    is not a check-in. So the answer counts at once only when the request also carried a
    location the server measured against the cafe. Anything else is a claim like any
    other and waits for review.

    The bug this pins: `mode: "drink"`, no coordinates, `sells_beans: false` used to
    write an approved observation, which is the newest user observation, which is the
    state -- one request from any account dropped a cafe out of the map's bean filter.
    """

    CAFE_ROW = {"id": CAFE, "latitude": "37.6190", "longitude": "127.0590"}

    # A shop-front metre or two away: inside the 50m gate the endpoint enforces.
    INSIDE = {"check_in_lat": 37.61901, "check_in_lng": 127.05901}

    def _post(self, body):
        client, supabase = make_client(self, {
            "cafes": [self.CAFE_ROW],
            "cafe_visits": [_row()],
            "cafe_beans": [],
            "cafe_trait_observations": [],
        })
        response = client.post(f"/api/v1/cafes/{CAFE}/visit", json={"cafe_id": CAFE, **body})
        written = [
            q.payload for q in supabase.queries_on("cafe_trait_observations") if q.op == "insert"
        ]
        return response, written

    def test_a_drink_log_cannot_approve_a_trait(self):
        response, written = self._post(
            {"mode": "drink", "rating": 4, "is_public": False, "sells_beans": False}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual([w["status"] for w in written], [traits.PENDING])

    def test_a_purchase_log_with_no_location_waits(self):
        """Saying "I bought a bag here" is not evidence of having been here."""
        _, written = self._post({"mode": "purchase", "sells_beans": True})
        self.assertEqual([w["status"] for w in written], [traits.PENDING])

    def test_a_client_claimed_distance_is_not_evidence(self):
        """`distance_meters` in the body is whatever the caller typed."""
        _, written = self._post(
            {"mode": "purchase", "sells_beans": True, "distance_meters": 3}
        )
        self.assertEqual([w["status"] for w in written], [traits.PENDING])

    def test_a_purchase_checked_in_at_the_cafe_counts_at_once(self):
        response, written = self._post(
            {"mode": "purchase", "sells_beans": True, **self.INSIDE}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual([w["status"] for w in written], [traits.APPROVED])

    def test_a_check_in_too_far_away_takes_the_whole_log_down(self):
        """Not a trait question: the endpoint already refuses the visit outright."""
        response, written = self._post(
            {"mode": "purchase", "sells_beans": True,
             "check_in_lat": 37.5665, "check_in_lng": 126.9780}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(written, [])

    def test_no_answer_writes_no_observation(self):
        _, written = self._post({"mode": "drink", "rating": 4})
        self.assertEqual(written, [])


class MapFlagQueryTests(unittest.TestCase):
    def test_the_map_asks_the_database_for_approved_rows_only(self):
        supabase = FakeSupabase({"cafe_trait_observations": []})
        traits.load_flags(supabase, [CAFE])
        self.assertIn(("eq", "status", traits.APPROVED), supabase.queries[0].filters)


class AdminAnswersTests(unittest.TestCase):
    """
    The admin cafe card answers the trait questions itself.

    Everyone else's press is a suggestion that waits for an admin to read it. When the
    admin is the one pressing, waiting means the same person reads their own sentence
    and presses approve, so their answer is written approved. `evidence` is the
    admin-only reason behind it and only an admin's request may carry one -- a stranger
    cannot post text into a column no reader-facing endpoint returns.
    """

    def _press(self, role, body):
        client, supabase = make_client(self, {
            "cafes": [{"id": CAFE}],
            "cafe_trait_observations": [],
        })
        user = FakeUser(SOMEONE)
        user.role = role
        app.dependency_overrides[get_current_user] = lambda: user

        response = client.post(f"/api/v1/cafes/{CAFE}/traits/sells_beans", json=body)
        written = [
            q.payload for q in supabase.queries_on("cafe_trait_observations") if q.op == "insert"
        ]
        return response, written

    def test_an_admin_answer_counts_at_once(self):
        response, written = self._press("admin", {"value": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([w["status"] for w in written], [traits.APPROVED])

    def test_everyone_else_still_waits(self):
        _, written = self._press("user", {"value": True})
        self.assertEqual([w["status"] for w in written], [traits.PENDING])

    def test_an_admin_reason_is_stored(self):
        _, written = self._press("admin", {"value": True, "evidence": "  Sells  Pilot bags  "})
        self.assertEqual(written[0]["evidence"], "Sells Pilot bags")

    def test_a_reason_survives_a_no(self):
        """Why a cafe does NOT do something is exactly what the next approver needs."""
        _, written = self._press(
            "admin", {"value": False, "evidence": "Menu lists espresso only"}
        )
        self.assertEqual(written[0]["evidence"], "Menu lists espresso only")

    def test_a_stranger_cannot_write_into_the_admin_column(self):
        _, written = self._press("user", {"value": True, "evidence": "trust me"})
        self.assertIsNone(written[0]["evidence"])

    def test_a_long_reason_is_cut_to_what_the_column_takes(self):
        _, written = self._press("admin", {"value": True, "evidence": "x" * 500})
        self.assertEqual(len(written[0]["evidence"]), traits.EVIDENCE_MAX_LENGTH)


if __name__ == "__main__":
    unittest.main()
