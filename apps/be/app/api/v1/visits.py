from fastapi import APIRouter, HTTPException, status, Depends, Request, Query, Response
from typing import List, Optional
import hashlib
import json
import logging
import time
from app.models.visit import (
    CafeViewCreate,
    CafeViewResponse,
    CafeVisitCreate,
    CafeVisitUpdate,
    CafeVisitResponse,
    TrendingCafeResponse,
    CafeStatsResponse,
    CafeLogPublicResponse,
    CafeLogsResponse,
    validate_merged_log,
)
from app.services import badges as badges_service
from app.services import traits as traits_service
from app.services.coffee_logs import LOG_COLUMNS, public_logs, with_bean
from app.api.deps import get_current_user, require_admin_role
from app.models.error import ErrorCode, ErrorDetail, create_error_response
from app.database.supabase import get_supabase_client
from supabase import Client
from datetime import datetime, timezone
from decimal import Decimal

logger = logging.getLogger(__name__)


def _as_tag_list(value) -> list | None:
    """
    Atmosphere tags come back as a list, or as a JSON string from older rows.

    Returning `[]` for anything unparseable rather than raising: a malformed tag
    field is not a reason to fail the whole log listing.
    """
    if value is None or isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            return []
    return []


def _visit_payload(supabase: Client, visit: dict) -> dict:
    """
    A stored visit row, ready for `CafeVisitResponse`.

    The insert and update calls already return every column of the row, so the bean
    is the only thing missing — and only when the log actually points at one. Looking
    it up conditionally keeps the common case (a log with no bean) at zero extra
    round trips.
    """
    payload = {
        **visit,
        "photo_urls": visit.get("photo_urls") or [],
        "bean": None,
    }

    bean_id = visit.get("bean_id")
    if not bean_id:
        return payload

    try:
        bean = supabase.table("beans").select(
            "id, name, roasters(name)"
        ).eq("id", bean_id).single().execute().data
        if bean:
            payload["bean"] = with_bean({"beans": bean})["bean"]
    except Exception:
        # A missing bean must not fail the log the reader just saved.
        logger.warning("Could not load bean %s for visit response", bean_id, exc_info=True)

    return payload


# ---------------------------------------------------------------------------
# In-memory TTL cache for trending cafes
# ---------------------------------------------------------------------------
_trending_cache: dict[tuple, tuple[list, float]] = {}
_TRENDING_CACHE_TTL = 300  # 5 minutes


def _trending_cache_key(lat, lng, radius, limit, offset, sort_by):
    """Quantize lat/lng to ~1.1 km grid so nearby requests share cache."""
    lat_q = round(lat, 2) if lat is not None else None
    lng_q = round(lng, 2) if lng is not None else None
    return (lat_q, lng_q, radius, limit, offset, sort_by)


def _get_trending_cached(key):
    """Return cached data if still fresh, else None."""
    entry = _trending_cache.get(key)
    if entry is None:
        return None
    data, cached_at = entry
    if time.monotonic() - cached_at > _TRENDING_CACHE_TTL:
        _trending_cache.pop(key, None)
        return None
    return data


#: Metric each sort_by value ranks on. "distance" is handled separately in Python.
_TRENDING_SORT_COLUMNS = {
    "trending": "trending_score",
    "popular": "visit_count_14d",
}


def _order_deterministically(query, primary_column: str):
    """Order by the ranking metric, then by stable tiebreaks.

    Most cafes are OSM-seeded with no activity, so their ranking metric ties at 0.
    Without explicit tiebreaks Postgres returns tied rows in arbitrary physical
    order that changes between requests, which makes the list look shuffled and
    breaks offset pagination (rows repeat or vanish across pages).
    """
    return (
        query.order(primary_column, desc=True)
        .order("admin_verified", desc=True)
        .order("verification_count", desc=True)
        .order("created_at", desc=True)
        .order("id")
    )


def _bounding_box(lat: float, lng: float, radius: int):
    """Return (lat_min, lat_max, lng_min, lng_max) covering radius metres."""
    import math

    lat_offset = radius / 111000
    lng_offset = (
        radius / (111000 * math.cos(math.radians(abs(lat)))) if lat != 0 else radius / 111000
    )
    return lat - lat_offset, lat + lat_offset, lng - lng_offset, lng + lng_offset


def _within_bounding_box(query, lat: float, lng: float, radius: int):
    """Restrict a cafes query to the bounding box around lat/lng."""
    lat_min, lat_max, lng_min, lng_max = _bounding_box(lat, lng, radius)
    return (
        query.gte("latitude", lat_min)
        .lte("latitude", lat_max)
        .gte("longitude", lng_min)
        .lte("longitude", lng_max)
    )


def _set_trending_cache(key, data):
    """Store result in cache. Evict stale entries when cache grows large."""
    now = time.monotonic()
    if len(_trending_cache) > 200:
        stale_keys = [k for k, (_, t) in _trending_cache.items() if now - t > _TRENDING_CACHE_TTL]
        for k in stale_keys:
            _trending_cache.pop(k, None)
    _trending_cache[key] = (data, now)

router = APIRouter()

@router.post("/cafes/{cafe_id}/view", status_code=status.HTTP_201_CREATED)
async def record_cafe_view(
    cafe_id: str,
    request: Request,
    user_id: Optional[str] = None
):
    """
    Record a cafe view (when user clicks on cafe marker or views details).
    
    - Anonymous users supported
    - Tracks IP and user agent for spam prevention
    - Rate limited per cafe by IP; views without a client IP are skipped
      (user_id is an unauthenticated query param, so it cannot be a throttle key)
    """
    try:
        import re
        # Validate cafe_id format (UUID)
        uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
        if not uuid_pattern.match(cafe_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid cafe ID format"
            )
        
        supabase = get_supabase_client()
        
        # Verify cafe exists
        cafe_check = supabase.table("cafes").select("id").eq("id", cafe_id).limit(1).execute()
        if not cafe_check.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        raw_ip = request.client.host if request.client else None
        if not raw_ip:
            # The IP is the only throttle key we cannot be handed by the caller,
            # so without it the view is unattributable — drop it rather than
            # count a throttle-free row. 204 rather than the route's 201:
            # nothing was created. Logged because a steady rate here means real
            # views are being dropped, most likely from a proxy that hides the
            # client address.
            logger.warning("Cafe view dropped, no client ip: cafe=%s", cafe_id)
            return Response(status_code=status.HTTP_204_NO_CONTENT)

        ip_address = hashlib.sha256(raw_ip.encode()).hexdigest()

        # Rate limiting: max 10 views per minute per cafe from the same source
        from datetime import timedelta
        one_minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        recent_views = supabase.table("cafe_views").select("id", count="exact").eq(
            "cafe_id", cafe_id
        ).eq(
            "ip_address", ip_address
        ).gte(
            "viewed_at", one_minute_ago
        ).execute()

        if recent_views.count and recent_views.count >= 10:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later."
            )

        view_data = {
            "cafe_id": cafe_id,
            "user_id": user_id,
            "ip_address": ip_address,
            "user_agent": request.headers.get("user-agent"),
            "viewed_at": datetime.now(timezone.utc).isoformat()
        }
        
        result = supabase.table("cafe_views").insert(view_data).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to record cafe view"
            )
        
        return {
            "message": "View recorded successfully",
            "cafe_id": cafe_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error recording cafe view")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.post("/cafes/{cafe_id}/visit", response_model=CafeVisitResponse, status_code=status.HTTP_201_CREATED)
async def record_cafe_visit(
    cafe_id: str,
    visit_data: CafeVisitCreate,
    current_user = Depends(get_current_user)
):
    """
    Record a cafe visit (physical presence).
    
    - Requires authentication
    - Can be auto-detected or manual check-in
    - Validates distance if coordinates provided
    """
    try:
        supabase = get_supabase_client()
        
        # Get cafe location for distance validation
        cafe_result = supabase.table("cafes").select("latitude, longitude").eq("id", cafe_id).single().execute()
        
        if not cafe_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=create_error_response(
                    error_code=ErrorCode.CAFE_NOT_FOUND,
                    message="Cafe not found",
                    details=[ErrorDetail(
                        field="cafe_id",
                        message=f"Cafe with ID {cafe_id} does not exist",
                        value=cafe_id
                    )]
                )
            )
        
        cafe_lat = float(cafe_result.data["latitude"])
        cafe_lng = float(cafe_result.data["longitude"])
        
        # Calculate distance if check-in coordinates provided
        distance_meters = None
        if visit_data.check_in_lat and visit_data.check_in_lng:
            from math import radians, cos, sin, asin, sqrt
            
            check_in_lat = float(visit_data.check_in_lat)
            check_in_lng = float(visit_data.check_in_lng)
            
            # Haversine formula
            lon1, lat1, lon2, lat2 = map(radians, [cafe_lng, cafe_lat, check_in_lng, check_in_lat])
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
            c = 2 * asin(sqrt(a))
            distance_meters = int(c * 6371000)  # Radius of earth in meters
            
            # Validate distance (should be within 50 meters)
            if distance_meters > 50:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=create_error_response(
                        error_code=ErrorCode.DISTANCE_TOO_FAR,
                        message=f"Check-in location too far from cafe",
                        details=[ErrorDetail(
                            field="distance",
                            message=f"Distance is {distance_meters}m, must be within 50m",
                            value=distance_meters
                        )]
                    )
                )
        
        # Create visit record
        visit_record = {
            "cafe_id": cafe_id,
            "user_id": current_user.id,
            "visited_at": datetime.now(timezone.utc).isoformat(),
            "check_in_lat": str(visit_data.check_in_lat) if visit_data.check_in_lat else None,
            "check_in_lng": str(visit_data.check_in_lng) if visit_data.check_in_lng else None,
            "distance_meters": distance_meters or visit_data.distance_meters,
            "duration_minutes": visit_data.duration_minutes,
            "auto_detected": visit_data.auto_detected,
            "confirmed": visit_data.confirmed,
            "has_review": visit_data.rating is not None,
            "has_photos": visit_data.photo_urls is not None and len(visit_data.photo_urls) > 0,
            "rating": visit_data.rating,
            "comment": visit_data.comment,
            "photo_urls": visit_data.photo_urls if visit_data.photo_urls else [],
            "is_public": visit_data.is_public,
            "anonymous": visit_data.anonymous,
            "coffee_type": visit_data.coffee_type,
            "dessert": visit_data.dessert,
            "price": str(visit_data.price) if visit_data.price is not None else None,
            "price_currency": visit_data.price_currency,
            "atmosphere_rating": visit_data.atmosphere_rating,
            "atmosphere_tags": visit_data.atmosphere_tags,
            "acidity_rating": visit_data.acidity_rating,
            "body_rating": visit_data.body_rating,
            "sweetness_rating": visit_data.sweetness_rating,
            "bitterness_rating": visit_data.bitterness_rating,
            "aftertaste_rating": visit_data.aftertaste_rating,
            "aroma_rating": visit_data.aroma_rating,
            "overall_taste_rating": visit_data.overall_taste_rating,
            "mode": visit_data.mode,
            "bean_id": visit_data.bean_id,
            "bean_name_raw": visit_data.bean_name_raw,
            "want_again": visit_data.want_again,
        }
        
        result = supabase.table("cafe_visits").insert(visit_record).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to record cafe visit"
            )
        
        visit = result.data[0]
        
        # Auto drop bean when logging a visit (log = proof of visit, no location check needed)
        try:
            from datetime import timedelta
            
            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            
            # Not `.single()`: PostgREST raises PGRST116 when a row does not exist yet,
            # which is exactly the case this branch is here to handle. The `except`
            # below swallowed it, so nobody's FIRST log at a cafe ever dropped a bean --
            # and the form promises one. It also meant `cafe_beans.growth_level` never
            # started counting, which is what the `regular_*` badges read.
            existing_result = supabase.table("cafe_beans").select("*").eq(
                "cafe_id", cafe_id
            ).eq(
                "user_id", current_user.id
            ).limit(1).execute()
            existing_bean = existing_result.data[0] if existing_result.data else None

            if existing_bean:
                # Check if already dropped today
                last_dropped = existing_bean.get("last_dropped_at")
                already_today = False
                
                if last_dropped:
                    from dateutil import parser as date_parser
                    last_dropped_dt = date_parser.parse(last_dropped)
                    already_today = last_dropped_dt >= today_start
                
                if not already_today:
                    # Update existing bean
                    new_count = existing_bean.get("drop_count", 0) + 1
                    from app.api.v1.cafes import calculate_growth_level
                    new_level = calculate_growth_level(new_count)
                    supabase.table("cafe_beans").update({
                        "drop_count": new_count,
                        "growth_level": new_level,
                        "last_dropped_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", existing_bean["id"]).execute()
            else:
                # Create new bean entry
                supabase.table("cafe_beans").insert({
                    "cafe_id": cafe_id,
                    "user_id": current_user.id,
                    "drop_count": 1,
                    "growth_level": 1,
                    "first_dropped_at": datetime.now(timezone.utc).isoformat(),
                    "last_dropped_at": datetime.now(timezone.utc).isoformat()
                }).execute()
        except Exception:
            # Log but don't fail the main visit creation
            logger.warning("Auto drop bean failed (non-critical)", exc_info=True)

        # Somebody who just bought a bag here is evidence the cafe sells them -- but
        # only if they were here. A log can be written from anywhere, days later, in any
        # mode, so the answer alone proves nothing: without it, one `mode: "drink"`
        # request carrying `sells_beans: false` flipped a map filter for everyone.
        #
        # `distance_meters` is the one computed above from the cafe's own coordinates,
        # never the number the client sent, and it exists only when a check-in passed
        # the 50m gate. That plus the purchase form asking the question is the same
        # standing-in-the-shop evidence registration has; anything less waits for review
        # like a claim typed on the cafe page.
        if visit_data.sells_beans is not None:
            stood_in_the_shop = visit_data.mode == "purchase" and distance_meters is not None
            traits_service.record_observations_quietly(
                supabase, cafe_id, {"sells_beans": visit_data.sells_beans}, current_user.id,
                status=traits_service.APPROVED if stood_in_the_shop else traits_service.PENDING,
            )

        # After the drop, not before: the drop is what a `regular_*` badge counts.
        badges_service.award_badges_quietly(supabase, current_user.id)

        # Hand the stored row to the response model rather than copying it field by
        # field. The model prunes what it does not declare, so a new column is one
        # edit here instead of four dicts that drift apart.
        return CafeVisitResponse(**_visit_payload(supabase, visit))

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error recording cafe visit")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.patch("/visits/{visit_id}", response_model=CafeVisitResponse)
async def update_visit(
    visit_id: str,
    update_data: CafeVisitUpdate,
    current_user = Depends(get_current_user)
):
    """
    Confirm or update an auto-detected visit.
    
    - Used to confirm visits detected by location tracking
    - Can update duration and confirmation status
    """
    try:
        supabase = get_supabase_client()
        
        # Verify visit belongs to user
        visit_check = supabase.table("cafe_visits").select(
            "user_id, mode, rating"
        ).eq("id", visit_id).single().execute()
        
        if not visit_check.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=create_error_response(
                    error_code=ErrorCode.VISIT_NOT_FOUND,
                    message="Visit not found",
                    details=[ErrorDetail(
                        field="visit_id",
                        message=f"Visit with ID {visit_id} does not exist",
                        value=visit_id
                    )]
                )
            )
        
        if visit_check.data["user_id"] != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=create_error_response(
                    error_code=ErrorCode.NOT_RESOURCE_OWNER,
                    message="Not authorized to update this visit",
                    details=[ErrorDetail(
                        field="user_id",
                        message="You do not own this visit",
                        value=current_user.id
                    )]
                )
            )
        
        # `exclude_unset` is what makes `bean_id: null` mean "unlink this bean" while
        # leaving the field out means "keep whatever is there". The chain of
        # `if field is not None` this replaces could not tell those apart, so a bean
        # could be attached but never removed.
        update_payload = update_data.model_dump(exclude_unset=True)

        if "price" in update_payload and update_payload["price"] is not None:
            update_payload["price"] = str(update_payload["price"])

        # These two are derived, not sent: a log has a review when it has a rating,
        # and photos when the list is non-empty.
        if "rating" in update_payload:
            update_payload["has_review"] = update_payload["rating"] is not None
        if "photo_urls" in update_payload:
            update_payload["has_photos"] = bool(update_payload["photo_urls"])

        # Validate the MERGED state, not the patch. A patch that only sets
        # `mode: "drink"` is valid or not depending entirely on the rating already on
        # the stored row, which the request body cannot see.
        stored = visit_check.data
        try:
            validate_merged_log(
                update_payload.get("mode", stored.get("mode", "drink")),
                update_payload["rating"] if "rating" in update_payload else stored.get("rating"),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=create_error_response(
                    error_code=ErrorCode.INVALID_INPUT,
                    message=str(exc),
                    details=[ErrorDetail(field="rating", message=str(exc), value=None)],
                )
            )

        if not update_payload:
            update_payload = {"updated_at": datetime.now(timezone.utc).isoformat()}

        result = supabase.table("cafe_visits").update(update_payload).eq("id", visit_id).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update visit"
            )
        
        visit = result.data[0]
        
        return CafeVisitResponse(**_visit_payload(supabase, visit))
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error updating visit")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/cafes/trending", response_model=List[TrendingCafeResponse])
async def get_trending_cafes(
    limit: int = Query(default=20, ge=1, le=100, description="Page size"),
    offset: int = Query(default=0, ge=0, description="Number of cafes to skip"),
    sort_by: str = Query(
        default="trending",
        pattern="^(trending|distance|popular)$",
        description="trending = score, popular = 14-day visits, distance = nearest first (needs lat/lng)"
    ),
    lat: Optional[float] = Query(None, ge=-90, le=90, description="User latitude for location-based filtering"),
    lng: Optional[float] = Query(None, ge=-180, le=180, description="User longitude for location-based filtering"),
    radius: int = Query(default=50000, ge=1000, le=500000, description="Search radius in meters (default 50km for city-level)")
):
    """
    Get cafes ranked for the explore map, paginated.

    - `sort_by=trending`: trending score (views, visits, reviews, rating over 14 days)
    - `sort_by=popular`: 14-day visit count
    - `sort_by=distance`: nearest first; requires lat/lng, falls back to trending without them
    - Optional location filtering: when lat/lng provided, results are limited to the radius
    - Ties are broken deterministically so repeated calls and `offset` paging are stable
    - Results are cached in-memory for 5 minutes (quantized by ~1.1 km grid)
    """
    has_location = lat is not None and lng is not None

    # Distance ordering is meaningless without coordinates
    if sort_by == "distance" and not has_location:
        sort_by = "trending"

    # Check cache first
    cache_key = _trending_cache_key(lat, lng, radius, limit, offset, sort_by)
    cached = _get_trending_cached(cache_key)
    if cached is not None:
        return cached

    try:
        supabase = get_supabase_client()

        if sort_by == "distance":
            # ponytail: fetches the whole bounding box and sorts in Python because
            # Postgres cannot order by a computed distance without PostGIS here.
            # Fine at ~1.2k cafes; move to PostGIS/earth_distance if the table grows.
            from app.api.v1.cafes import calculate_earth_distance

            box_result = _within_bounding_box(
                supabase.table("cafes").select("*"), lat, lng, radius
            ).execute()

            nearby = []
            for cafe in box_result.data or []:
                distance = calculate_earth_distance(
                    lat, lng,
                    float(cafe.get("latitude", 0)),
                    float(cafe.get("longitude", 0))
                )
                if distance <= radius:
                    cafe["_distance"] = distance
                    nearby.append(cafe)

            # Secondary key keeps cafes at identical coordinates in a stable order
            nearby.sort(key=lambda c: (c["_distance"], str(c.get("id"))))
            rows = nearby[offset:offset + limit]
        else:
            query = supabase.table("cafes").select("*")
            if has_location:
                query = _within_bounding_box(query, lat, lng, radius)

            result = _order_deterministically(
                query, _TRENDING_SORT_COLUMNS[sort_by]
            ).range(offset, offset + limit - 1).execute()
            rows = result.data or []

        if not rows:
            _set_trending_cache(cache_key, [])
            return []

        # Get cafe IDs that don't have main_image set
        cafe_ids_needing_image = [
            cafe.get("id") for cafe in rows
            if not cafe.get("main_image")
        ]

        # Batch fetch first photo from logs for cafes without main_image
        cafe_images = {}
        if cafe_ids_needing_image:
            try:
                logs_with_photos = supabase.table("cafe_visits").select(
                    "cafe_id, photo_urls"
                ).in_("cafe_id", cafe_ids_needing_image).eq(
                    "is_public", True
                ).not_.is_("photo_urls", "null").order(
                    "visited_at", desc=True
                ).limit(len(cafe_ids_needing_image)).execute()

                if logs_with_photos.data:
                    for log in logs_with_photos.data:
                        cafe_id = log.get("cafe_id")
                        photo_urls = log.get("photo_urls", [])
                        if cafe_id not in cafe_images and photo_urls:
                            cafe_images[cafe_id] = photo_urls[0]
            except Exception:
                logger.warning("Error fetching log images for trending", exc_info=True)

        # Format response with default values for missing fields
        formatted_cafes = []
        for cafe in rows:
            main_image = cafe.get("main_image") or cafe_images.get(cafe.get("id"))

            formatted_cafes.append({
                "id": cafe.get("id"),
                "slug": cafe.get("slug"),
                "name": cafe.get("name"),
                "address": cafe.get("address"),
                "latitude": cafe.get("latitude"),
                "longitude": cafe.get("longitude"),
                "view_count_14d": cafe.get("view_count_14d", 0),
                "visit_count_14d": cafe.get("visit_count_14d", 0),
                "trending_score": cafe.get("trending_score", 0.0),
                # Global rank from the DB, so the badge means "top N overall",
                # not "top of whichever page you happen to be looking at"
                "trending_rank": cafe.get("trending_rank"),
                "image": cafe.get("image"),
                "main_image": main_image,
                # Lets the explore grid answer "open now" without a second request
                "business_hours": cafe.get("business_hours"),
                "timezone": cafe.get("timezone"),
            })

        _set_trending_cache(cache_key, formatted_cafes)
        return formatted_cafes

    except Exception as e:
        logger.exception("Error getting trending cafes")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/cafes/{cafe_id}/stats", response_model=CafeStatsResponse)
async def get_cafe_stats(cafe_id: str):
    """
    Get detailed statistics for a specific cafe.
    
    - View and visit counts (total and 14-day)
    - Trending score and rank
    """
    try:
        supabase = get_supabase_client()
        
        result = supabase.table("cafes").select(
            "id, view_count_total, view_count_14d, visit_count_total, "
            "visit_count_14d, trending_score, trending_rank, trending_updated_at"
        ).eq("id", cafe_id).single().execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        return {
            "cafe_id": cafe_id,
            **result.data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error getting cafe stats")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/cafes/{cafe_id}/visits", response_model=List[CafeVisitResponse])
async def get_cafe_visits(
    cafe_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user = Depends(get_current_user)
):
    """
    Get visits for a specific cafe.
    
    - Requires authentication
    - Returns only the current user's own visits for privacy protection
    - For public logs, use GET /cafes/{cafe_id}/logs instead
    - Ordered by visited_at (most recent first)
    """
    try:
        supabase = get_supabase_client()
        
        # Security: Only return the current user's own visits to protect privacy
        # Other users' visits are private data that should not be exposed
        result = supabase.table("cafe_visits").select("*").eq(
            "cafe_id", cafe_id
        ).eq(
            "user_id", current_user.id  # Filter by current user only
        ).order(
            "visited_at", desc=True
        ).range(offset, offset + limit - 1).execute()
        
        if not result.data:
            return []
        
        return result.data
        
    except Exception as e:
        logger.exception("Error getting cafe visits")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/cafes/{cafe_id}/visits/check-duplicate")
async def check_duplicate_visit(
    cafe_id: str,
    current_user = Depends(get_current_user)
):
    """
    Check if user has already checked in to this cafe today.
    
    - Requires authentication
    - Returns duplicate status and visit info if exists
    - Used by frontend to prevent duplicate check-ins
    """
    try:
        supabase = get_supabase_client()
        user_id = current_user.id
        
        from datetime import datetime, timezone, timedelta
        
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        
        result = supabase.table("cafe_visits").select("*").eq(
            "cafe_id", cafe_id
        ).eq(
            "user_id", user_id
        ).gte(
            "visited_at", today_start.isoformat()
        ).execute()
        
        if result.data and len(result.data) > 0:
            return {
                "is_duplicate": True,
                "visit": result.data[0],
                "message": "You have already checked in to this cafe today"
            }
        else:
            return {
                "is_duplicate": False,
                "visit": None,
                "message": "No duplicate visit found"
            }
        
    except Exception as e:
        logger.exception("Error checking duplicate visit")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.post("/admin/update-trending-scores")
async def update_trending_scores(
    current_user = Depends(require_admin_role)
):
    """
    Manually trigger trending score recalculation for all cafes.
    
    - Admin only - requires authentication with admin role
    - Should be run via cron job hourly
    """
    try:
        supabase = get_supabase_client()
        
        result = supabase.rpc("update_all_trending_scores").execute()
        
        updated_count = result.data if result.data else 0
        
        return {
            "message": "Trending scores updated successfully",
            "updated_count": updated_count
        }
        
    except Exception as e:
        logger.exception("Error updating trending scores")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


# `POST /admin/backfill-cafe-images` was here. It copied the newest public log photo
# into `cafes.main_image` so the trending list would not have to look one up at read
# time -- and stored no link back to the log it came from. When the author made that
# log private, or deleted it, the copy stayed on the cafe and kept being served: a
# photo withdrawn from the app that the app still showed (SEC-10).
#
# Deleted rather than given a provenance column, because the read-time lookup it was
# avoiding already exists in `cafes.py` (both the trending list and the cafe detail
# fall back to log photos) and that one re-reads `is_public` on every request, so a
# withdrawal takes effect at once. `cafes.main_image` is now only ever written by an
# act that means it: registration, an admin edit, or a reviewed seed row.

@router.get("/cafes/{cafe_id}/logs", response_model=CafeLogsResponse)
async def get_cafe_logs(
    cafe_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get public coffee logs for a cafe.
    
    - No authentication required
    - Returns only public logs with ratings
    - Paginated results
    - Anonymous users show as "Anonymous" if anonymous flag is set
    """
    try:
        offset = (page - 1) * page_size
        
        # A rated cup or a recorded purchase -- see `public_logs`. The same filter has
        # to reach the count below, or the pager promises rows the list cannot show.
        result = public_logs(
            supabase.table("cafe_visits").select(LOG_COLUMNS).eq("cafe_id", cafe_id)
        ).order("visited_at", desc=True).range(offset, offset + page_size - 1).execute()
        
        if not result.data:
            return CafeLogsResponse(
                logs=[],
                total_count=0,
                page=page,
                page_size=page_size,
                has_more=False
            )
        
        # Get total count
        count_result = public_logs(
            supabase.table("cafe_visits").select("id", count="exact").eq("cafe_id", cafe_id)
        ).execute()
        
        total_count = count_result.count if count_result.count else 0
        
        # Format logs with author display names
        logs = []
        for log in result.data:
            author_display_name = None
            author_username = None
            author_avatar_url = None
            if not log.get("anonymous"):
                # Get user info from users table
                try:
                    user_result = supabase.table("users").select("username, display_name, avatar_url").eq("id", log["user_id"]).single().execute()
                    if user_result.data:
                        author_display_name = user_result.data.get("display_name") or user_result.data.get("username") or "User"
                        author_username = user_result.data.get("username")
                        author_avatar_url = user_result.data.get("avatar_url")
                except Exception:
                    author_display_name = "User"
            else:
                author_display_name = "Anonymous"
            
            logs.append(CafeLogPublicResponse(**with_bean({
                **log,
                "photo_urls": log.get("photo_urls") or [],
                "atmosphere_tags": _as_tag_list(log.get("atmosphere_tags")),
                "author_display_name": author_display_name,
                "author_username": author_username,
                "author_avatar_url": author_avatar_url,
            })))
        
        return CafeLogsResponse(
            logs=logs,
            total_count=total_count,
            page=page,
            page_size=page_size,
            has_more=offset + page_size < total_count
        )
        
    except Exception as e:
        logger.exception("Error getting cafe logs")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/users/me/logs", response_model=List[CafeVisitResponse])
async def get_my_logs(
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get all logs for the current user (public and private).
    
    - Requires authentication
    - Returns all logs regardless of is_public flag
    - Ordered by visited_at (most recent first)
    """
    try:
        # No rating filter here. These are the reader's own logs, and a bag they
        # bought but have not brewed yet has no rating to filter on -- requiring one
        # made their own purchases invisible to them.
        result = supabase.table("cafe_visits").select(
            "*, beans(id, name, roasters(name))"
        ).eq("user_id", current_user.id).order("visited_at", desc=True).execute()
        
        if not result.data:
            return []
        
        return [
            CafeVisitResponse(**with_bean({
                **visit,
                "photo_urls": visit.get("photo_urls") or [],
                "atmosphere_tags": _as_tag_list(visit.get("atmosphere_tags")),
            }))
            for visit in result.data
        ]
        
    except Exception as e:
        logger.exception("Error getting my logs")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.delete("/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_visit(
    visit_id: str,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Delete a visit/log.
    
    - Requires authentication
    - Only owner or admin can delete
    """
    try:
        # Check if visit exists and get owner
        visit_check = supabase.table("cafe_visits").select(
            "user_id, mode, rating"
        ).eq("id", visit_id).single().execute()
        
        if not visit_check.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Visit not found"
            )
        
        # Check if user is owner or admin
        is_owner = visit_check.data["user_id"] == current_user.id
        is_admin = getattr(current_user, "role", None) == "admin"
        
        if not is_owner and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to delete this visit"
            )
        
        # Delete visit
        supabase.table("cafe_visits").delete().eq("id", visit_id).execute()
        
        return None
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error deleting visit")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

