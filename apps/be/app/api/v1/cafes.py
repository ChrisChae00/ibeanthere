"""
Cafe API endpoints for UGC verification system.

- Search cafes by location (PostGIS earth_distance)
- Register new cafe (with location verification)
- Get cafe details (with Founding Crew info)
"""

from fastapi import APIRouter, Query, HTTPException, status, Depends, Body, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal
import re
import math
import time
from app.models.cafe import (
    CafeSearchParams,
    CafeSearchResponse,
    CafeResponse,
    CafeRegistrationRequest,
    GooglePlacesLookupRequest,
    GooglePlacesLookupResponse,
    TraitSummary,
    TraitObservationCreate,
    CafeBeanEntry,
    CafeBeansResponse,
)
from app.services import traits as traits_service
from app.services.coffee_logs import public_logs
from app.services.osm_service import OSMService, format_address
from app.services import badges as badges_service
from app.services import franchise_service, venue_category
from app.database.supabase import get_supabase_client
from app.api.deps import get_current_user, get_optional_user, require_admin_role
from app.core.permissions import Permission, UserRole, require_permission
from app.core.fraud_detection import check_location_consistency
from app.core.rate_limit import limiter
from app.config import settings
from app.services.google_places_service import GooglePlacesService
from app.utils.timezone import get_timezone_from_coords
from supabase import Client
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import httpx
from dateutil import parser as date_parser
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

PHOTO_SKU = "place_photo"


def _google_billing_month(now: Optional[datetime] = None) -> str:
    pacific = (now or datetime.now(timezone.utc)).astimezone(
        ZoneInfo("America/Los_Angeles")
    )
    return pacific.strftime("%Y-%m-01")


def _reserve_photo_slot(supabase: Client) -> int:
    result = supabase.rpc(
        "reserve_google_api_slot",
        {
            "p_sku": PHOTO_SKU,
            "p_billing_month": _google_billing_month(),
            "p_cap": settings.google_place_photo_monthly_cap,
        },
    ).execute()
    count = int(result.data or 0)
    if count in (720, 810, 900):
        logger.warning(
            "google_place_photo_usage_threshold",
            extra={"sku": PHOTO_SKU, "reserved_count": count},
        )
    return count


@router.get("/{cafe_id}/google-photo")
@limiter.limit("12/minute")
async def get_google_photo(cafe_id: str, request: Request):
    """Return a fresh Google photo URI for explore cards only."""
    no_store = {"Cache-Control": "no-store"}
    if not settings.google_place_photo_enabled or not settings.google_places_api_key:
        return Response(status_code=status.HTTP_204_NO_CONTENT, headers=no_store)

    try:
        supabase = get_supabase_client()
        cafe_result = supabase.table("cafes").select("*").eq("id", cafe_id).limit(1).execute()
        cafe = (cafe_result.data or [None])[0]
        if not cafe:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"detail": "Cafe not found"},
                headers=no_store,
            )
        if cafe.get("main_image") or cafe.get("image"):
            return Response(status_code=status.HTTP_204_NO_CONTENT, headers=no_store)

        visit_result = supabase.table("cafe_visits").select("photo_urls").eq(
            "cafe_id", cafe_id
        ).eq("is_public", True).not_.is_("photo_urls", "null").order(
            "visited_at", desc=True
        ).execute()
        if any((row.get("photo_urls") or []) for row in (visit_result.data or [])):
            return Response(status_code=status.HTTP_204_NO_CONTENT, headers=no_store)

        place_id = cafe.get("google_place_id")
        if not place_id:
            return Response(status_code=status.HTTP_204_NO_CONTENT, headers=no_store)

        service = GooglePlacesService(settings.google_places_api_key)
        photo = await service.get_first_photo(place_id)
        if not photo or not photo.get("googleMapsUri"):
            return Response(status_code=status.HTTP_204_NO_CONTENT, headers=no_store)

        if _reserve_photo_slot(supabase) == 0:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "PHOTO_MONTHLY_CAP_REACHED"},
                headers=no_store,
            )

        image_url = await service.get_photo_uri(photo["name"])
        attributions = [
            {
                "display_name": item.get("displayName"),
                "uri": item.get("uri"),
                "photo_uri": item.get("photoUri"),
            }
            for item in (photo.get("authorAttributions") or [])
        ]
        return JSONResponse(
            content={
                "image_url": image_url,
                "source_url": photo["googleMapsUri"],
                "provider": "Google Maps",
                "author_attributions": attributions,
            },
            headers=no_store,
        )
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        logger.warning("Google Place Photo request failed", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "GOOGLE_PLACE_PHOTO_FAILED"},
            headers=no_store,
        )
    except Exception:
        logger.exception("Google Place Photo endpoint failed")
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content={"detail": "GOOGLE_PLACE_PHOTO_FAILED"},
            headers=no_store,
        )

def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = re.sub(r'-{2,}', '-', slug).strip('-')
    return slug or 'cafe'


def generate_unique_slug(name: str, supabase: Client, exclude_id: Optional[str] = None) -> str:
    base_slug = slugify(name)
    slug_candidate = base_slug
    counter = 1

    while True:
        existing = supabase.table("cafes").select("id").eq("slug", slug_candidate).limit(1).execute()
        rows = existing.data or []

        if not rows:
            return slug_candidate

        existing_id = rows[0].get("id")
        if exclude_id and existing_id == exclude_id:
            return slug_candidate

        slug_candidate = f"{base_slug}-{counter}"
        counter += 1


# Initialize services
_osm_service = None

def get_osm_service() -> OSMService:
    global _osm_service
    if _osm_service is None:
        _osm_service = OSMService()
    return _osm_service

def get_country_code_from_name(country_name: str) -> Optional[str]:
    """
    Convert country name to ISO 3166-1 alpha-2 country code.
    
    Args:
        country_name: Country name from OSM
        
    Returns:
        ISO 3166-1 alpha-2 country code or None
    """
    country_map = {
        'Canada': 'ca',
        'United States': 'us',
        'United States of America': 'us',
        'United Kingdom': 'gb',
        'Australia': 'au',
        'Germany': 'de',
        'France': 'fr',
        'South Korea': 'kr',
        'Korea, Republic of': 'kr',
        'Japan': 'jp',
        'China': 'cn',
        'India': 'in',
        'Brazil': 'br',
        'Mexico': 'mx',
        'Spain': 'es',
        'Italy': 'it',
        'Netherlands': 'nl',
        'Belgium': 'be',
        'Switzerland': 'ch',
        'Austria': 'at',
        'Sweden': 'se',
        'Norway': 'no',
        'Denmark': 'dk',
        'Finland': 'fi',
        'Poland': 'pl',
        'Portugal': 'pt',
        'Greece': 'gr',
        'Ireland': 'ie',
        'New Zealand': 'nz',
        'Singapore': 'sg',
        'Malaysia': 'my',
        'Thailand': 'th',
        'Indonesia': 'id',
        'Philippines': 'ph',
        'Vietnam': 'vn',
        'Taiwan': 'tw',
        'Hong Kong': 'hk'
    }
    
    return country_map.get(country_name)

def detect_country_from_postcode(postcode: str) -> Optional[str]:
    """
    Detect country code from postcode format.
    
    Args:
        postcode: Postcode string
        
    Returns:
        ISO 3166-1 alpha-2 country code or None
    """
    import re
    
    # Remove spaces and convert to uppercase
    clean_postcode = postcode.replace(' ', '').upper()
    
    # Canadian postcode: A1A 1A1 format (e.g., N2H 4B4)
    if re.match(r'^[A-Z]\d[A-Z]\d[A-Z]\d$', clean_postcode):
        return 'ca'
    
    # US ZIP code: 5 digits or 5+4 format (e.g., 12345 or 12345-6789)
    if re.match(r'^\d{5}(-\d{4})?$', postcode):
        return 'us'
    
    # UK postcode: Various formats (e.g., SW1A 1AA, M1 1AA)
    if re.match(r'^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$', postcode.upper()):
        return 'gb'
    
    # Australian postcode: 4 digits (e.g., 2000)
    if re.match(r'^\d{4}$', postcode):
        return 'au'
    
    # German postcode: 5 digits (e.g., 10115)
    if re.match(r'^\d{5}$', postcode):
        return 'de'
    
    # French postcode: 5 digits (e.g., 75001)
    if re.match(r'^\d{5}$', postcode):
        # Could be France or Germany, but France is more common
        # This is a heuristic - may need refinement
        pass
    
    return None

# Distance + duplicate detection live in one place, shared with the seed and
# cleanup scripts. calculate_earth_distance is re-exported here because
# app/api/v1/visits.py imports it from this module.
from app.services.cafe_dedupe import calculate_earth_distance, check_nearby_cafes  # noqa: F401

# How far the place Google returns for a submitted URL may sit from the coordinates
# being registered. Same 100 m the registrant themselves has to stand within.
GOOGLE_PLACE_MAX_DRIFT_METERS = 100

_STATUS_PRIORITY = {"verified": 0, "pending": 1, "disputed": 2}

def _is_better_cafe(candidate: dict, existing: dict) -> bool:
    c_status = _STATUS_PRIORITY.get(candidate.get("status", ""), 99)
    e_status = _STATUS_PRIORITY.get(existing.get("status", ""), 99)
    if c_status != e_status:
        return c_status < e_status
    c_vc = int(candidate.get("verification_count", 0) or 0)
    e_vc = int(existing.get("verification_count", 0) or 0)
    if c_vc != e_vc:
        return c_vc > e_vc
    return (candidate.get("created_at", "") or "") > (existing.get("created_at", "") or "")

@router.get("/search", response_model=CafeSearchResponse)
async def search_cafes(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude"),
    radius: int = Query(default=2000, ge=100, le=150000, description="Search radius in meters"),
    status_filter: Optional[str] = Query(None, description="Filter by status: 'pending' | 'verified'"),
    sort_by: str = Query(default="distance", description="Sort by: distance | trending | rating | newest"),
    min_rating: Optional[float] = Query(None, ge=0, le=5, description="Minimum rating filter")
):
    """
    Search for cafes near a location using PostGIS.
    
    - Uses earth_distance() for accurate distance calculation
    - Returns cafes within radius
    - Optional status filter
    - Sort by distance, trending score, rating, or creation date
    - Optional minimum rating filter
    """
    try:
        supabase = get_supabase_client()
        
        # Calculate bounding box for optimization
        # 1 degree latitude = ~111km everywhere
        lat_offset = radius / 111000
        
        # 1 degree longitude = ~111km * cos(latitude)
        # At latitude 43°, 1 degree longitude ≈ 81km
        lng_offset = radius / (111000 * math.cos(math.radians(abs(lat)))) if lat != 0 else radius / 111000
        
        lat_min = lat - lat_offset
        lat_max = lat + lat_offset
        lng_min = lng - lng_offset
        lng_max = lng + lng_offset
        
        # Query with bounding box (optimization)
        query = supabase.table("cafes").select("*").gte(
            "latitude", lat_min
        ).lte(
            "latitude", lat_max
        ).gte(
            "longitude", lng_min
        ).lte(
            "longitude", lng_max
        )
        
        if status_filter:
            query = query.eq("status", status_filter)
        
        result = query.execute()
        
        if not result.data:
            return CafeSearchResponse(cafes=[], total_count=0)
        
        # Filter by exact distance and calculate distances
        valid_cafes = []
        for cafe in result.data:
            distance = calculate_earth_distance(
                lat, lng,
                float(cafe.get("latitude", 0)),
                float(cafe.get("longitude", 0))
            )
            if distance <= radius:
                # Filter by minimum rating if specified
                cafe_rating = cafe.get("google_rating") or cafe.get("average_rating") or 0
                if min_rating is not None and float(cafe_rating) < min_rating:
                    continue
                
                # Store distance for sorting
                cafe["_distance"] = distance
                valid_cafes.append(cafe)
        
        # Deduplicate cafes at identical coordinates - keep the better record
        seen_coords: dict[tuple[str, str], dict] = {}
        deduped_cafes: list[dict] = []
        for cafe in valid_cafes:
            coord_key = (str(cafe.get("latitude")), str(cafe.get("longitude")))
            if coord_key in seen_coords:
                existing = seen_coords[coord_key]
                if _is_better_cafe(cafe, existing):
                    deduped_cafes[deduped_cafes.index(existing)] = cafe
                    seen_coords[coord_key] = cafe
            else:
                seen_coords[coord_key] = cafe
                deduped_cafes.append(cafe)
        valid_cafes = deduped_cafes

        # Sort cafes based on sort_by parameter
        if sort_by == "distance":
            valid_cafes.sort(key=lambda c: c.get("_distance", float("inf")))
        elif sort_by == "trending":
            valid_cafes.sort(key=lambda c: float(c.get("trending_score", 0) or 0), reverse=True)
        elif sort_by == "rating":
            valid_cafes.sort(key=lambda c: float(c.get("google_rating", 0) or c.get("average_rating", 0) or 0), reverse=True)
        elif sort_by == "newest":
            valid_cafes.sort(key=lambda c: c.get("created_at", ""), reverse=True)
        
        # Get cafe IDs that don't have main_image set
        cafe_ids_needing_image = [
            cafe.get("id") for cafe in valid_cafes 
            if not cafe.get("main_image")
        ]
        
        # Batch fetch first photo from logs for cafes without main_image
        cafe_images = {}
        if cafe_ids_needing_image:
            try:
                # Get the oldest log with photo for each cafe
                logs_with_photos = supabase.table("cafe_visits").select(
                    "cafe_id, photo_urls"
                ).in_("cafe_id", cafe_ids_needing_image).eq(
                    "is_public", True
                ).not_.is_("photo_urls", "null").order(
                    "visited_at", desc=False
                ).execute()
                
                if logs_with_photos.data:
                    for log in logs_with_photos.data:
                        cafe_id = log.get("cafe_id")
                        photo_urls = log.get("photo_urls", [])
                        # Only take the first image for each cafe
                        if cafe_id not in cafe_images and photo_urls:
                            cafe_images[cafe_id] = photo_urls[0]
            except Exception:
                logger.warning("Error fetching log images", exc_info=True)
        
        # Format response
        formatted_cafes = []
        for cafe in valid_cafes:
            # Use DB main_image or fallback to log image
            main_image = cafe.get("main_image") or cafe_images.get(cafe.get("id"))
            
            formatted_cafes.append({
                "id": cafe.get("id", ""),
                "name": cafe.get("name", ""),
                "slug": cafe.get("slug"),
                "address": cafe.get("address"),
                "latitude": Decimal(str(cafe.get("latitude", 0))),
                "longitude": Decimal(str(cafe.get("longitude", 0))),
                "phone": cafe.get("phone"),
                "website": cafe.get("website"),
                "description": cafe.get("description"),
                "source_type": cafe.get("source_type"),
                "source_url": cafe.get("source_url"),
                "business_hours": cafe.get("business_hours"),
                "status": cafe.get("status", "pending"),
                "verification_count": cafe.get("verification_count", 1),
                "verified_at": cafe.get("verified_at"),
                "admin_verified": cafe.get("admin_verified", False),
                "navigator_id": cafe.get("navigator_id"),
                    "created_at": cafe.get("created_at", datetime.now(timezone.utc)),
                "updated_at": cafe.get("updated_at"),
                "main_image": main_image
            })

        _attach_trait_flags(supabase, formatted_cafes)

        return CafeSearchResponse(
            cafes=formatted_cafes,
            total_count=len(formatted_cafes)
        )
        
    except Exception as e:
        logger.exception("Error in search_cafes")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/search/text", response_model=CafeSearchResponse)
async def search_cafes_by_text(
    q: str = Query(..., min_length=2, max_length=100, description="Name or address fragment"),
    limit: int = Query(default=20, ge=1, le=50, description="Maximum results")
):
    """
    Find cafes by name or address, anywhere.

    The map's own search is bounded by whatever area has been loaded; this one is not,
    so a reader can look up a cafe they have not navigated to yet. Ordered by name so
    repeated queries return a stable list.
    """
    try:
        supabase = get_supabase_client()

        # `%`, `,` and parentheses would otherwise be read as PostgREST pattern,
        # argument and grouping syntax rather than as characters the reader typed.
        term = q.strip().replace("%", "").translate(str.maketrans(",()", "   "))
        if len(term) < 2:
            return CafeSearchResponse(cafes=[], total_count=0)

        result = supabase.table("cafes").select("*").or_(
            f"name.ilike.%{term}%,address.ilike.%{term}%"
        ).order("name").limit(limit).execute()

        formatted_cafes = [
            {
                "id": cafe.get("id", ""),
                "name": cafe.get("name", ""),
                "slug": cafe.get("slug"),
                "address": cafe.get("address"),
                "latitude": Decimal(str(cafe.get("latitude", 0))),
                "longitude": Decimal(str(cafe.get("longitude", 0))),
                "phone": cafe.get("phone"),
                "website": cafe.get("website"),
                "description": cafe.get("description"),
                "source_type": cafe.get("source_type"),
                "source_url": cafe.get("source_url"),
                "business_hours": cafe.get("business_hours"),
                "status": cafe.get("status", "pending"),
                "verification_count": cafe.get("verification_count", 1),
                "verified_at": cafe.get("verified_at"),
                "admin_verified": cafe.get("admin_verified", False),
                "navigator_id": cafe.get("navigator_id"),
                    "created_at": cafe.get("created_at", datetime.now(timezone.utc)),
                "updated_at": cafe.get("updated_at"),
                "main_image": cafe.get("main_image"),
            }
            for cafe in (result.data or [])
        ]

        _attach_trait_flags(supabase, formatted_cafes)

        return CafeSearchResponse(cafes=formatted_cafes, total_count=len(formatted_cafes))

    except Exception:
        logger.exception("Error in search_cafes_by_text")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.get("/pending", response_model=CafeSearchResponse)
async def get_pending_cafes_public(
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get all pending cafes (Public endpoint).
    
    Returns:
        List of pending cafes ordered by creation date
    """
    try:
        logger.info("======== FETCHING PENDING CAFES ========")
        result = supabase.table("cafes").select("*").eq("status", "pending").execute()
        logger.info(f"Query result count: {len(result.data) if result.data else 0}")
        
        if not result.data:
            logger.info("No pending cafes found")
            return CafeSearchResponse(cafes=[], total_count=0)
        
        logger.info(f"Found {len(result.data)} pending cafes")
        logger.info(f"First cafe raw data: {result.data[0] if result.data else 'None'}")
        
        # Sort by created_at descending (most recent first)
        # Handle None values by using a default date
        sorted_data = sorted(
            result.data, 
            key=lambda x: x.get("created_at") or "1970-01-01T00:00:00Z", 
            reverse=True
        )
        
        cafes = []
        for i, cafe in enumerate(sorted_data):
            try:
                logger.info(f"Processing cafe {i+1}/{len(sorted_data)}: {cafe.get('name')}")
                
                # Parse datetime fields
                created_at_str = cafe.get("created_at")
                logger.info(f"  created_at_str: {created_at_str}, type: {type(created_at_str)}")
                created_at = date_parser.parse(created_at_str) if created_at_str else datetime.now(timezone.utc)
                
                updated_at_str = cafe.get("updated_at")
                updated_at = date_parser.parse(updated_at_str) if updated_at_str else None
                
                verified_at_str = cafe.get("verified_at")
                verified_at = date_parser.parse(verified_at_str) if verified_at_str else None
                
                logger.info(f"  Creating CafeResponse object...")
                logger.info(f"  latitude: {cafe.get('latitude')}, type: {type(cafe.get('latitude'))}")
                logger.info(f"  longitude: {cafe.get('longitude')}, type: {type(cafe.get('longitude'))}")
                
                cafe_response = CafeResponse(
                    id=str(cafe.get("id")),
                    name=cafe.get("name"),
                    slug=cafe.get("slug"),
                    address=cafe.get("address"),
                    latitude=Decimal(str(cafe.get("latitude"))),
                    longitude=Decimal(str(cafe.get("longitude"))),
                    phone=cafe.get("phone"),
                    website=cafe.get("website"),
                    description=cafe.get("description"),
                    source_type=cafe.get("source_type"),
                    source_url=cafe.get("source_url"),
                    business_hours=cafe.get("business_hours"),
                    status=cafe.get("status", "pending"),
                    verification_count=cafe.get("verification_count", 1),
                    verified_at=verified_at,
                    admin_verified=cafe.get("admin_verified", False),
                    navigator_id=str(cafe.get("navigator_id")) if cafe.get("navigator_id") else None,
                    created_at=created_at,
                    updated_at=updated_at
                )
                cafes.append(cafe_response)
                logger.info("  Successfully processed cafe: %s", cafe.get('name'))
            except Exception:
                logger.exception("Error processing cafe %s", cafe.get('name'))
                raise

        logger.info("Returning %d cafes", len(cafes))
        return CafeSearchResponse(cafes=cafes, total_count=len(cafes))

    except Exception as e:
        logger.exception("Error getting pending cafes")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

# ---------------------------------------------------------------------------
# Public aggregate stats.
#
# Declared before `/{cafe_identifier}` on purpose: a path parameter registered
# first would swallow `/stats` as a cafe slug.
#
# Everything here is a count. No ids, no coordinates, no names, no user data --
# nothing that is not already derivable from the public `/search` and
# `/pending` endpoints. The series is bucketed by ISO week so a single cafe's
# registration time cannot be read back out of it.
# ---------------------------------------------------------------------------

# One process-wide entry, so a scraped landing page costs the database at most
# twelve reads an hour no matter how much traffic hits it. The global 60/minute
# SlowAPI limit in main.py is the second layer.
_STATS_TTL_SECONDS = 300
_stats_cache: dict = {"expires_at": 0.0, "payload": None}


def _weekly_cumulative(created_at_values: List[str], weeks: int = 26) -> List[dict]:
    """Cumulative cafe count at the end of each of the last `weeks` ISO weeks."""
    timestamps = []
    for raw in created_at_values:
        if not raw:
            continue
        try:
            parsed = date_parser.parse(raw)
        except (ValueError, TypeError, OverflowError):
            continue
        # A naive timestamp compares as smaller than every aware one and would
        # silently land in the first bucket.
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        timestamps.append(parsed)

    if not timestamps:
        return []

    timestamps.sort()
    now = datetime.now(timezone.utc)
    # Monday 00:00 UTC of the current week.
    week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    series = []
    index = 0
    total = 0
    for offset in range(weeks - 1, -1, -1):
        bucket_start = week_start - timedelta(weeks=offset)
        # Everything registered before this bucket closes is in its total, so
        # the line only ever climbs -- it is a running total, not a per-week bar.
        bucket_end = bucket_start + timedelta(weeks=1)
        while index < len(timestamps) and timestamps[index] < bucket_end:
            index += 1
            total += 1
        series.append({"week": bucket_start.date().isoformat(), "cumulative": total})

    return series


@router.get("/stats")
async def get_cafe_stats(supabase: Client = Depends(get_supabase_client)):
    """
    Aggregate, unauthenticated counts for the landing page.

    Returns totals plus a 26-week cumulative registration series.
    """
    now = time.monotonic()
    if _stats_cache["payload"] is not None and now < _stats_cache["expires_at"]:
        return _stats_cache["payload"]

    try:
        cafes = supabase.table("cafes").select("created_at, status").execute().data or []
        drops = supabase.table("cafe_bean_drops").select("id", count="exact").limit(1).execute()

        payload = {
            "total_cafes": len(cafes),
            "verified_cafes": sum(1 for c in cafes if c.get("status") == "verified"),
            "beans_dropped": drops.count or 0,
            "series": _weekly_cumulative([c.get("created_at") for c in cafes]),
        }

        _stats_cache["payload"] = payload
        _stats_cache["expires_at"] = now + _STATS_TTL_SECONDS
        return payload
    except Exception:
        logger.exception("Error building cafe stats")
        # A stale payload beats an error banner on the landing page.
        if _stats_cache["payload"] is not None:
            return _stats_cache["payload"]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

def _attach_trait_flags(supabase, cafes: list) -> None:
    """
    Add `trait_flags` to a page of cafe dicts, in place.

    This is what the map and list filter chips read, so it travels with the search
    results rather than needing a second request per pin.
    """
    if not cafes:
        return
    flags_by_cafe = traits_service.load_flags(supabase, [c["id"] for c in cafes if c.get("id")])
    for cafe in cafes:
        cafe["trait_flags"] = flags_by_cafe.get(cafe.get("id"), {})


# ---------------------------------------------------------------------------
# Coffee traits and beans
#
# Both are registered before the `/{cafe_identifier}` catch-all below.
#
# Neither is cached, and neither is folded into the cafe detail payload, which is
# served with `revalidate: 120`. A reader who switches a log to private and then
# sees the bean still listed for two minutes has been told their privacy setting
# does not work -- and they would be right to think so.
# ---------------------------------------------------------------------------

@router.get("/{cafe_id}/traits", response_model=List[TraitSummary])
async def get_cafe_traits(
    cafe_id: str,
    current_user = Depends(get_optional_user),
    supabase = Depends(get_supabase_client)
):
    """
    What people report about this cafe's coffee, and -- if signed in -- what you did.

    One query, aggregated in Python. `mine` is derived from the same rows as the
    counts, so the button state can never disagree with the number beside it.
    """
    try:
        result = supabase.table("cafe_trait_observations").select(
            traits_service.OBSERVATION_COLUMNS
        ).eq("cafe_id", cafe_id).eq("status", traits_service.APPROVED).execute()

        viewer_id = current_user.id if current_user else None
        return [
            TraitSummary(**summary)
            for summary in traits_service.summarise(result.data or [], viewer_id)
        ]
    except Exception:
        logger.exception("Error loading cafe traits")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.post("/{cafe_id}/traits/{trait}")
async def observe_cafe_trait(
    cafe_id: str,
    trait: str,
    payload: TraitObservationCreate,
    current_user = Depends(get_current_user),
    supabase = Depends(get_supabase_client)
):
    """
    Suggest a change to what this cafe's page says. Yes or no, both are observations.

    This is the one surface with no evidence behind the claim: the person pressing the
    button may never have set foot in the place. So it is written `pending` and counts
    for nothing until an admin approves it. The two surfaces that do carry evidence --
    registering a cafe from inside it, logging a bean purchase -- write approved rows
    directly and are not routed through here.

    An admin is the exception, because an admin is who the pending queue is waiting for:
    the same person would read their own suggestion and press approve. Their answer is
    written approved, and only their request may carry `evidence`, which is admin-only
    text. Both are decided from the caller's role here, never from the request body.

    Insert-only: the history is the point. Saying "no" today does not erase the "yes"
    from six months ago, it supersedes it -- and the old row is what lets anyone see
    that the place changed rather than that someone was wrong.
    """
    if not traits_service.is_valid_trait(trait):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown trait '{trait}'"
        )

    try:
        observed_at = None
        if payload.observed_at:
            try:
                observed_at = date.fromisoformat(payload.observed_at)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="observed_at must be a date in YYYY-MM-DD form"
                )

        try:
            traits_service.check_observed_at(observed_at)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        # `status` is set from which endpoint this is and who is calling it, never from
        # the request body. Same for `evidence`: a non-admin's is dropped, not refused.
        is_admin = getattr(current_user, "role", None) == UserRole.ADMIN
        traits_service.record_observation(
            supabase,
            cafe_id=cafe_id,
            trait=trait,
            value=payload.value,
            user_id=current_user.id,
            observed_at=observed_at,
            status=traits_service.APPROVED if is_admin else traits_service.PENDING,
            note=payload.note,
            evidence=payload.evidence if is_admin else None,
        )

        # The summary is re-read after the insert, so an admin sees their own answer
        # immediately and everyone else sees the numbers unchanged -- a suggestion does
        # not move them. The `submitted` flag is what the page uses to say "thanks,
        # someone will look at this".
        return {
            "submitted": True,
            "traits": await get_cafe_traits(cafe_id, current_user, supabase),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error recording trait observation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.delete("/{cafe_id}/traits/{trait}", response_model=List[TraitSummary])
async def clear_cafe_trait(
    cafe_id: str,
    trait: str,
    current_user = Depends(get_current_user),
    supabase = Depends(get_supabase_client)
):
    """
    Withdraw your own observations of this trait, approved or still waiting.

    The `user_id` filter is on the query, not left to row-level security: the backend
    holds the service key, which bypasses RLS entirely. Without this line, this
    endpoint would delete everyone's.
    """
    if not traits_service.is_valid_trait(trait):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown trait '{trait}'"
        )

    try:
        supabase.table("cafe_trait_observations").delete().eq(
            "cafe_id", cafe_id
        ).eq("trait", trait).eq("user_id", current_user.id).execute()

        return await get_cafe_traits(cafe_id, current_user, supabase)
    except Exception:
        logger.exception("Error clearing trait observation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.get("/traits/suggestions")
async def list_trait_suggestions(
    current_user = Depends(require_admin_role),
    supabase = Depends(get_supabase_client)
):
    """
    Everything waiting for review, oldest first.

    Two kinds of claim land here now. One is a reader pressing a button on a cafe page.
    The other is a seeded row: a cafe imported from the review CSV, whose answers were
    researched rather than witnessed, so they wait here with their `evidence` instead of
    counting on arrival. Both are the same shape -- an unwitnessed claim -- which is why
    they share a queue rather than getting a second one.

    Registered above the `/{cafe_identifier}` catch-all, like `/trending`: a literal
    path segment that comes after a wildcard route is never reached.
    """
    try:
        result = supabase.table("cafe_trait_observations").select(
            "id, cafe_id, trait, value, observed_at, created_at, user_id, note, source, evidence"
        ).eq("status", traits_service.PENDING).order("created_at", desc=False).limit(300).execute()

        rows = result.data or []
        if not rows:
            return {"suggestions": []}

        # Two lookups for the page rather than two per row.
        cafe_ids = list({r["cafe_id"] for r in rows})
        user_ids = list({r["user_id"] for r in rows if r.get("user_id")})

        # Enough to check the claim without leaving the page: the seed review answers
        # "does this place sell beans" from a website, and an approver needs the same
        # website. `status` and `source_type` say whether the cafe itself is still
        # waiting, which is a different decision from the trait and has its own buttons.
        cafes = supabase.table("cafes").select(
            "id, name, slug, address, website, status, source_type, latitude, longitude"
        ).in_("id", cafe_ids).execute()
        cafe_by_id = {c["id"]: c for c in (cafes.data or [])}

        users_by_id = {}
        if user_ids:
            users = supabase.table("users").select("id, username").in_("id", user_ids).execute()
            users_by_id = {u["id"]: u for u in (users.data or [])}

        return {
            "suggestions": [
                {
                    "id": row["id"],
                    "cafe_id": row["cafe_id"],
                    "cafe_name": cafe_by_id.get(row["cafe_id"], {}).get("name"),
                    "cafe_slug": cafe_by_id.get(row["cafe_id"], {}).get("slug"),
                    "cafe_address": cafe_by_id.get(row["cafe_id"], {}).get("address"),
                    "cafe_website": cafe_by_id.get(row["cafe_id"], {}).get("website"),
                    "cafe_status": cafe_by_id.get(row["cafe_id"], {}).get("status"),
                    "cafe_source_type": cafe_by_id.get(row["cafe_id"], {}).get("source_type"),
                    "cafe_latitude": cafe_by_id.get(row["cafe_id"], {}).get("latitude"),
                    "cafe_longitude": cafe_by_id.get(row["cafe_id"], {}).get("longitude"),
                    "trait": row["trait"],
                    "value": row["value"],
                    "observed_at": row.get("observed_at"),
                    "created_at": row.get("created_at"),
                    # Free text an admin is being asked to publish: it is the reason
                    # this queue exists, so it has to be visible before approving.
                    "note": row.get("note"),
                    # Where the claim came from, and what it was based on. A seeded row
                    # has no author to vouch for it, so the working -- which website,
                    # which sentence -- is the only thing an approver can check.
                    # Never leaves this endpoint; the cafe page shows `note` alone.
                    "source": row.get("source"),
                    "evidence": row.get("evidence"),
                    # An admin deciding whether to trust a claim needs to know who made
                    # it. This endpoint is admin-only; nothing here reaches a reader.
                    "username": users_by_id.get(row.get("user_id"), {}).get("username"),
                }
                for row in rows
            ]
        }
    except Exception:
        logger.exception("Error listing trait suggestions")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.post("/traits/suggestions/{suggestion_id}/approve")
async def approve_trait_suggestion(
    suggestion_id: str,
    current_user = Depends(require_admin_role),
    supabase = Depends(get_supabase_client)
):
    """
    Accept a suggestion: the row it already is becomes the record.

    An UPDATE rather than a copy into another table, so the observer and the day they
    say they saw it survive approval. Those two fields are what make it an observation
    rather than a vote, and every copy is a chance to lose them.
    """
    try:
        result = supabase.table("cafe_trait_observations").update({
            "status": traits_service.APPROVED
        }).eq("id", suggestion_id).eq("status", traits_service.PENDING).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Suggestion not found or already reviewed"
            )
        return {"approved": True, "id": suggestion_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error approving trait suggestion")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.delete("/traits/suggestions/{suggestion_id}")
async def reject_trait_suggestion(
    suggestion_id: str,
    current_user = Depends(require_admin_role),
    supabase = Depends(get_supabase_client)
):
    """Turn a suggestion down. It never counted, so there is nothing to undo."""
    try:
        supabase.table("cafe_trait_observations").delete().eq(
            "id", suggestion_id
        ).eq("status", traits_service.PENDING).execute()
        return {"rejected": True, "id": suggestion_id}
    except Exception:
        logger.exception("Error rejecting trait suggestion")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


# `/user/beans` sits above `/{cafe_id}/beans`, and the order is the whole point:
# FastAPI matches in registration order, so with the parameterised route first a
# request for `/cafes/user/beans` is served as "the cafe whose id is `user`" and dies
# as a 500 that explains nothing. The My Beans page never loaded a single bean because
# of it. Same hazard the `/{cafe_identifier}` catch-all is commented for -- a literal
# segment must be registered before the pattern that would swallow it.
@router.get("/user/beans")
async def get_user_beans(
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """
    Get all beans for current user (for My Beans page / heatmap).
    Includes cafe info and growth status.
    """
    try:
        # Get user's beans with cafe info
        beans_result = supabase.table("cafe_beans").select(
            "*, cafes(id, name, slug, address, latitude, longitude)"
        ).eq(
            "user_id", current_user.id
        ).order(
            "last_dropped_at", desc=True
        ).range(offset, offset + limit - 1).execute()
        
        beans = []
        for bean in (beans_result.data or []):
            cafe = bean.get("cafes", {})
            growth_level = bean.get("growth_level", 1)
            
            beans.append({
                "id": bean.get("id"),
                "cafe_id": bean.get("cafe_id"),
                "cafe_name": cafe.get("name"),
                "cafe_slug": cafe.get("slug"),
                "cafe_address": cafe.get("address"),
                "latitude": cafe.get("latitude"),
                "longitude": cafe.get("longitude"),
                "drop_count": bean.get("drop_count"),
                "growth_level": growth_level,
                "growth_level_name": GROWTH_LEVEL_NAMES.get(growth_level, "Unknown"),
                "first_dropped_at": bean.get("first_dropped_at"),
                "last_dropped_at": bean.get("last_dropped_at")
            })
        
        return {
            "beans": beans,
            "total_count": len(beans),
            "offset": offset,
            "limit": limit
        }
        
    except Exception as e:
        logger.exception("Error getting user beans")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.get("/{cafe_id}/beans", response_model=CafeBeansResponse)
async def get_cafe_beans(
    cafe_id: str,
    supabase = Depends(get_supabase_client)
):
    """
    The beans people had here and the beans people bought here.

    Derived from public logs, not from a table of its own. That is the whole privacy
    design: a private or anonymous log contributes nothing a reader can trace back,
    and switching a log to private removes it here with no retraction step, because
    there is nothing to retract.

    `last_seen_at` is `visited_at` -- the day it was seen, not the day it was typed up.
    No author information leaves this endpoint, for anonymous and named logs alike.
    """
    try:
        result = public_logs(
            supabase.table("cafe_visits").select(
                "mode, visited_at, bean_id, beans(id, name, origin, roast_level, roasters(name))"
            ).eq("cafe_id", cafe_id).not_.is_("bean_id", "null")
        ).order("visited_at", desc=True).limit(200).execute()

        grouped = {"drink": {}, "purchase": {}}
        for row in result.data or []:
            bean = row.get("beans")
            if isinstance(bean, list):
                bean = bean[0] if bean else None
            if not bean:
                continue

            bucket = grouped.get(row.get("mode") or "drink")
            if bucket is None:
                continue

            roaster = bean.get("roasters")
            if isinstance(roaster, list):
                roaster = roaster[0] if roaster else None

            entry = bucket.get(bean["id"])
            if entry:
                entry["count"] += 1
                continue

            # Rows arrive newest first, so the first one seen for a bean is the
            # most recent -- no comparison needed.
            bucket[bean["id"]] = {
                "bean_id": bean["id"],
                "name": bean.get("name"),
                "roaster_name": roaster.get("name") if roaster else None,
                "origin": bean.get("origin"),
                "roast_level": bean.get("roast_level"),
                "last_seen_at": row["visited_at"],
                "count": 1,
            }

        return CafeBeansResponse(
            drink=[CafeBeanEntry(**e) for e in grouped["drink"].values()],
            purchase=[CafeBeanEntry(**e) for e in grouped["purchase"].values()],
        )
    except Exception:
        logger.exception("Error loading cafe beans")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


@router.get("/{cafe_identifier}", response_model=CafeResponse)
async def get_cafe_details(cafe_identifier: str):
    """
    Get detailed information about a specific cafe.
    
    - Can be accessed by ID (UUID) or slug (e.g., 'midnight-run-cafe')
    - Includes verification status
    - Includes Founding Crew info
    - Includes average rating and log count (computed from public logs)
    """
    try:
        supabase = get_supabase_client()
        
        slug_query = supabase.table("cafes").select("*").eq("slug", cafe_identifier).limit(1).execute()
        slug_rows = slug_query.data or []

        if slug_rows:
            cafe = slug_rows[0]
        else:
            id_query = supabase.table("cafes").select("*").eq("id", cafe_identifier).limit(1).execute()
            id_rows = id_query.data or []
            if not id_rows:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Cafe not found"
                )
            cafe = id_rows[0]
        
        cafe_id = cafe.get("id")
        
        if not cafe.get("slug") and cafe.get("name"):
            new_slug = generate_unique_slug(cafe.get("name", "cafe"), supabase, cafe_id)
            supabase.table("cafes").update({"slug": new_slug}).eq("id", cafe_id).execute()
            cafe["slug"] = new_slug
        
        # Parse datetime fields
        created_at_str = cafe.get("created_at")
        created_at = date_parser.parse(created_at_str) if created_at_str else datetime.now(timezone.utc)
        
        updated_at_str = cafe.get("updated_at")
        updated_at = date_parser.parse(updated_at_str) if updated_at_str else None
        
        verified_at_str = cafe.get("verified_at")
        verified_at = date_parser.parse(verified_at_str) if verified_at_str else None
        
        # Same definition of "public" the log list and its count use -- see
        # `services/coffee_logs.public_logs`. A purchase with no rating is a log; it
        # counts here, and `average_rating` below simply skips the missing number.
        all_logs_result = public_logs(
            supabase.table("cafe_visits").select(
                "id, rating, mode, visited_at, user_id, anonymous, comment, photo_urls, coffee_type"
            ).eq("cafe_id", cafe_id)
        ).order("visited_at", desc=True).execute()
        
        average_rating = None
        log_count = 0
        recent_logs = []
        
        if all_logs_result.data:
            # Calculate average rating from all logs
            ratings = [log["rating"] for log in all_logs_result.data if log.get("rating")]
            if ratings:
                average_rating = sum(ratings) / len(ratings)
            
            log_count = len(all_logs_result.data)
            
            # Get recent logs (first 3)
            recent_logs_data = all_logs_result.data[:3]
            
            # Format recent logs
            for log in recent_logs_data:
                author_display_name = None
                author_username = None
                author_avatar_url = None
                
                if not log.get("anonymous"):
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
                
                recent_logs.append({
                    "id": log.get("id"),
                    "cafe_id": cafe_id,
                    "user_id": log.get("user_id"),
                    "visited_at": log.get("visited_at"),
                    "rating": log.get("rating"),
                    "comment": log.get("comment"),
                    "photo_urls": log.get("photo_urls", []),
                    "coffee_type": log.get("coffee_type"),
                    "mode": log.get("mode", "drink"),
                    "is_public": True,
                    "anonymous": log.get("anonymous", False),
                    "author_display_name": author_display_name,
                    "author_username": author_username,
                    "author_avatar_url": author_avatar_url
                })
        
        # Get total beans dropped at this cafe
        total_beans_dropped = 0
        try:
            beans_result = supabase.table("cafe_beans").select("drop_count").eq("cafe_id", cafe_id).execute()
            if beans_result.data:
                total_beans_dropped = sum(bean.get("drop_count", 0) for bean in beans_result.data)
        except Exception:
            pass  # Silently handle if table doesn't exist or query fails
        
        # Collect all images from logs (sorted by oldest first for main_image selection)
        all_images = []
        main_image = cafe.get("main_image")  # First priority: Navigator's image set during registration
        
        # If main_image exists, add it to the list first
        if main_image:
            all_images.append(main_image)
        
        try:
            # Get all logs with photos, ordered by oldest first (for main_image selection)
            logs_with_photos = supabase.table("cafe_visits").select(
                "photo_urls, visited_at"
            ).eq("cafe_id", cafe_id).eq("is_public", True).not_.is_("photo_urls", "null").order(
                "visited_at", desc=False  # Oldest first
            ).execute()
            
            if logs_with_photos.data:
                for log in logs_with_photos.data:
                    photo_urls = log.get("photo_urls", [])
                    if photo_urls:
                        # Add images if they are not already in the list (avoid duplicates with main_image)
                        for url in photo_urls:
                            if url and isinstance(url, str) and url.strip() and url not in all_images:
                                all_images.append(url)
                
                # If no main_image from registration (and none set above), use first image from oldest log
                if not main_image and all_images:
                    main_image = all_images[0]
        except Exception:
            logger.warning("Error collecting images", exc_info=True)
        
        response = {
            "id": cafe.get("id", ""),
            "name": cafe.get("name", ""),
            "slug": cafe.get("slug"),
            "address": cafe.get("address"),
            "latitude": Decimal(str(cafe.get("latitude", 0))),
            "longitude": Decimal(str(cafe.get("longitude", 0))),
            "phone": cafe.get("phone"),
            "website": cafe.get("website"),
            "description": cafe.get("description"),
            "source_type": cafe.get("source_type"),
            "source_url": cafe.get("source_url"),
            "business_hours": cafe.get("business_hours"),
            "status": cafe.get("status", "pending"),
            "verification_count": cafe.get("verification_count", 1),
            "verified_at": verified_at,
            "admin_verified": cafe.get("admin_verified", False),
            "navigator_id": cafe.get("navigator_id"),
            "created_at": created_at,
            "updated_at": updated_at,
            "average_rating": float(average_rating) if average_rating else None,
            "log_count": log_count,
            "recent_logs": recent_logs,
            "total_beans_dropped": total_beans_dropped,
            "main_image": main_image,
            "images": all_images if all_images else None
        }
        
        # Populate Founding Crew details
        founding_crew = {}
        
        # 1. Navigator
        if cafe.get("navigator_id"):
            try:
                nav_user = supabase.table("users").select("user_id:id, username, display_name, avatar_url").eq("id", cafe["navigator_id"]).single().execute()
                if nav_user.data:
                    founding_crew["navigator"] = nav_user.data
            except Exception:
                pass
                
        # There is no second half. Vanguard ranked the second and third person through
        # a door against the first, which is a race nobody entered -- what a cafe's page
        # says about people is now who put it on the map, and nothing about the order
        # everyone else arrived in.
        if founding_crew:
            response["founding_crew"] = founding_crew
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error getting cafe details")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

def _is_duplicate_key_error(error: Exception) -> bool:
    """Whether a Supabase write failed on a unique index (PostgreSQL 23505)."""
    code = getattr(error, "code", None)
    if code is None and isinstance(getattr(error, "args", None), tuple) and error.args:
        first = error.args[0]
        code = first.get("code") if isinstance(first, dict) else None
    return code == "23505" or "duplicate key value" in str(error)


@router.post("/register")
async def register_cafe(
    request: CafeRegistrationRequest = Body(...),
    current_user = Depends(require_permission(Permission.CREATE_CAFE)),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Register a new cafe (UGC).
    
    - Location verification (100m distance check)
    - Duplicate detection (25m threshold)
    - Founding Crew recording
    - OSM reverse geocoding for address
    """
    try:
        # 1. Location verification (100m limit)
        max_distance = 100
        
        user_lat = request.user_location.get("lat")
        user_lng = request.user_location.get("lng")

        if user_lat is None or user_lng is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Valid user location (lat/lng) is required to register a cafe"
            )

        distance = calculate_earth_distance(
            user_lat, user_lng,
            float(request.latitude),
            float(request.longitude)
        )

        if distance > max_distance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"You must be within {max_distance}m of the cafe to register. Current distance: {distance:.0f}m"
            )
        
        # 2. OSM Cross Check - verify location exists
        osm_service = get_osm_service()
        osm_data = await osm_service.reverse_geocode(
            float(request.latitude),
            float(request.longitude)
        )
        
        # A silent map service is not a verdict about the place. Reading None as
        # "does not exist" told people standing inside a real cafe that their cafe was
        # not on the map, and the brand classification and coffee-only check below both
        # read this same payload — so an outage has to stop the registration, not pass it.
        if osm_data is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The map service is not responding right now. Please try again in a moment."
            )

        if not osm_data.get('road'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid location: This location does not exist on the map"
            )
        
        # Auto-complete address from OSM if not provided
        if not request.address:
            request.address = osm_data.get('display_name', '')

        # 3. Brand classification. A franchise is no longer turned away: whether a place
        # is worth listing is decided by the coffee it can name, not by how many outlets
        # its brand has, and one franchise location can roast on site while the one down
        # the road pours from a bag nobody can name. The verdict is stored and shown, not
        # enforced.
        verdict = await franchise_service.classify(
            request.name,
            osm_data.get('extratags'),
            supabase
        )

        # 4. Coffee-only rule - bubble tea, tea houses and juice bars are out
        extratags = osm_data.get('extratags')
        category = venue_category.classify_venue(extratags)

        if category == venue_category.EXCLUDED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Bubble tea shops, tea houses and juice bars cannot be registered. "
                    "ibeanthere only lists cafes that serve coffee."
                )
            )

        if category == venue_category.UNKNOWN and not request.serves_coffee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Map data for this location does not say whether coffee is served. "
                    "Please confirm this is a cafe that serves coffee."
                )
            )

        category_source = 'osm' if category == venue_category.COFFEE else 'self_declared'
        venue_traits = venue_category.derive_traits(extratags)

        # 5. Check for duplicates (25m threshold). A failure here must not be read as
        # "no duplicate nearby" — that would let an outage create the very rows this
        # check exists to prevent.
        try:
            existing_cafe = check_nearby_cafes(
                float(request.latitude),
                float(request.longitude),
                threshold_meters=25,
                supabase=supabase
            )
        except Exception:
            logger.exception("Duplicate check failed during registration (%s, %s)",
                             request.latitude, request.longitude)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not check whether this cafe is already listed. Please try again in a moment."
            )
        
        if existing_cafe:
            # Existing cafe found - add bean drop as founding contribution
            cafe_id = existing_cafe.get("id")

            # Check if user already has a bean at this cafe
            existing_bean_result = supabase.table("cafe_beans").select("id").eq(
                "cafe_id", cafe_id
            ).eq(
                "user_id", current_user.id
            ).execute()

            if existing_bean_result.data and len(existing_bean_result.data) > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="You have already checked in to this cafe"
                )

            # Create bean record for this user as a founding contribution
            now_iso = datetime.now(timezone.utc).isoformat()
            new_bean = supabase.table("cafe_beans").insert({
                "cafe_id": cafe_id,
                "user_id": current_user.id,
                "drop_count": 1,
                "growth_level": 1,
                "last_latitude": float(request.latitude),
                "last_longitude": float(request.longitude),
                "first_dropped_at": now_iso,
                "last_dropped_at": now_iso
            }).execute()

            if new_bean.data:
                supabase.table("cafe_bean_drops").insert({
                    "bean_id": new_bean.data[0]["id"],
                    "user_id": current_user.id,
                    "cafe_id": cafe_id,
                    "latitude": float(request.latitude),
                    "longitude": float(request.longitude),
                    "dropped_at": now_iso
                }).execute()

            # Count unique users who have beans at this cafe
            unique_users_result = supabase.table("cafe_beans").select("user_id").eq("cafe_id", cafe_id).execute()
            unique_user_ids = list(set([b["user_id"] for b in unique_users_result.data])) if unique_users_result.data else []
            unique_user_count = len(unique_user_ids)

            update_data = {"verification_count": unique_user_count}
            triggered_verification = False

            # App-seeded cafes (e.g. OSM import) have no navigator yet — the
            # first real bean drop claims it.
            navigator_id = existing_cafe.get("navigator_id")
            if not navigator_id:
                navigator_id = current_user.id
                update_data["navigator_id"] = navigator_id

            if unique_user_count >= 3 and not existing_cafe.get("blacklist_history_id"):
                # Three separate people is still what verifies a cafe. Only the roles
                # handed out for being second and third are gone.
                update_data["status"] = "verified"
                update_data["verified_at"] = now_iso
                triggered_verification = True
                logger.info("Cafe %s auto-verified by 3 unique bean droppers (register flow)", cafe_id)

            supabase.table("cafes").update(update_data).eq("id", cafe_id).execute()

            # Fetch updated cafe
            result = supabase.table("cafes").select("*").eq("id", cafe_id).single().execute()

            # A check-in at an existing cafe is the same evidence as registering one:
            # the 100m gate above was passed either way.
            traits_service.record_observations_quietly(
                supabase, cafe_id, request.traits, current_user.id
            )
            badges_service.award_badges_quietly(supabase, current_user.id)

            return {
                "message": "Check-in recorded",
                "cafe": result.data,
                "check_in": {"cafe_id": cafe_id, "user_id": current_user.id},
                "triggered_verification": triggered_verification
            }
        
        else:
            # New cafe - create it
            normalized_name = request.name.lower().strip()
            normalized_address = request.address.lower().strip() if request.address else ""
            slug = generate_unique_slug(request.name, supabase)
            
            # Handle images - get main image from uploaded images
            main_image = None
            if request.images and len(request.images) > 0:
                main_index = request.main_image_index if request.main_image_index is not None else 0
                # Ensure index is within bounds
                if main_index >= len(request.images):
                    main_index = 0
                main_image = request.images[main_index]
                logger.info(f"Main image selected at index {main_index}, storing for later use")
            
            # Google's own id for this place, so the same shop cannot be registered
            # twice through a second URL, plus the canonical URL Google gives back.
            #
            # Both are taken from a server-side lookup and both are discarded unless
            # the place Google returns sits at the coordinates being registered. The
            # submitted URL is client input: without that check, a user standing in
            # cafe A could paste cafe B's URL and permanently claim B's identity,
            # which would then block B's own registration on the UNIQUE index.
            google_place_id = None
            source_url = None
            if request.source_type == 'google_url' and request.source_url:
                from app.config import settings
                if not settings.google_places_api_key:
                    logger.error(
                        "Google Places API key is not configured — registering %r "
                        "without a place id, so duplicate detection for this cafe "
                        "falls back to proximity alone", request.name
                    )
                else:
                    lookup = None
                    try:
                        from app.services.google_places_service import GooglePlacesService
                        lookup = await GooglePlacesService(
                            api_key=settings.google_places_api_key
                        ).lookup_from_url(request.source_url)
                    except Exception:
                        logger.exception("Google Places lookup raised for %s",
                                         request.source_url)
                    if not lookup:
                        logger.error("Google Places lookup found nothing for %s — "
                                     "registering without a place id",
                                     request.source_url)
                    else:
                        drift = None
                        if lookup.get("latitude") is not None and lookup.get("longitude") is not None:
                            drift = calculate_earth_distance(
                                float(request.latitude), float(request.longitude),
                                float(lookup["latitude"]), float(lookup["longitude"]),
                            )
                        if drift is not None and drift <= GOOGLE_PLACE_MAX_DRIFT_METERS:
                            google_place_id = lookup.get("place_id")
                            source_url = lookup.get("google_maps_url") or request.source_url
                        else:
                            logger.error(
                                "Google Places lookup for %r resolved %s from the "
                                "registration point; storing neither its place id "
                                "nor its URL",
                                request.name,
                                f"{drift:.0f}m" if drift is not None else "nowhere",
                            )

            cafe_data = {
                "name": request.name,
                "address": request.address,
                "latitude": float(request.latitude),
                "longitude": float(request.longitude),
                "phone": request.phone,
                "website": request.website,
                "description": request.description,
                "business_hours": request.business_hours,
                "timezone": get_timezone_from_coords(float(request.latitude), float(request.longitude)),
                "status": "pending",
                "verification_count": 1,
                "navigator_id": current_user.id,
                "source_type": request.source_type,
                "source_url": source_url,
                "normalized_name": normalized_name,
                "normalized_address": normalized_address,
                "slug": slug,
                "main_image": main_image,
                "brand_key": verdict.brand_key,
                "brand_status": verdict.status,
                "serves_coffee": True,
                "category_source": category_source,
                "venue_traits": venue_traits,
                "osm_tags": extratags,
                "google_place_id": google_place_id,
                # osm_id is intentionally absent: the only osm_id this path could
                # supply comes from Nominatim's reverse geocode, which snaps to the
                # building or the road, so two cafes in one building would claim the
                # same one and collide on cafes_osm_id_uidx.
            }
            
            # Insert cafe. The identity columns are UNIQUE, and the 25 m check above
            # cannot see a duplicate registered from the far side of the same shop,
            # so a collision here means the cafe is already listed — say so instead
            # of asking the user to retry something that can never succeed.
            try:
                result = supabase.table("cafes").insert(cafe_data).execute()
            except Exception as insert_error:
                if _is_duplicate_key_error(insert_error):
                    logger.info("Registration blocked by a cafe identity unique index: %s",
                                insert_error)
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This cafe is already listed on ibeanthere. Open it from the map to drop a bean."
                    )
                raise

            if not result.data or len(result.data) == 0:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create cafe"
                )
            
            new_cafe = result.data[0]
            cafe_id = new_cafe.get("id")
            
            # Auto-create first Drop Bean for Navigator (founding member)
            first_bean = supabase.table("cafe_beans").insert({
                "cafe_id": cafe_id,
                "user_id": current_user.id,
                "drop_count": 1,
                "growth_level": 1,
                "last_latitude": float(request.latitude),
                "last_longitude": float(request.longitude),
                "first_dropped_at": datetime.now(timezone.utc).isoformat(),
                "last_dropped_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            
            if first_bean.data:
                # Record the drop event
                supabase.table("cafe_bean_drops").insert({
                    "bean_id": first_bean.data[0]["id"],
                    "user_id": current_user.id,
                    "cafe_id": cafe_id,
                    "latitude": float(request.latitude),
                    "longitude": float(request.longitude),
                    "dropped_at": datetime.now(timezone.utc).isoformat()
                }).execute()
            
            # Save uploaded photos to cafe_visits for gallery display
            if request.images and len(request.images) > 0:
                try:
                    visit_data = {
                        "cafe_id": cafe_id,
                        "user_id": current_user.id,
                        "visited_at": datetime.now(timezone.utc).isoformat(),
                        "photo_urls": request.images,
                        "is_public": True,
                        "anonymous": False,
                        "comment": "Founding Crew - Cafe Registration",
                        "has_photos": True
                    }
                    supabase.table("cafe_visits").insert(visit_data).execute()
                    logger.info("Created initial cafe_visit with %d photos for registration", len(request.images))
                except Exception:
                    logger.warning("Error saving registration photos to cafe_visits", exc_info=True)
            
            # What the registrant could see from inside. Approved on arrival: nobody
            # else in the app has better evidence than the person who just stood there
            # and passed the distance check.
            traits_service.record_observations_quietly(
                supabase, cafe_id, request.traits, current_user.id
            )
            badges_service.award_badges_quietly(supabase, current_user.id)

            return {
                "message": "Cafe registered successfully",
                "cafe": new_cafe,
                "triggered_verification": False,
                "auto_bean_dropped": True
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error registering cafe")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

# =========================================================
# Google Places Lookup
# =========================================================

@router.post("/google-places/lookup")
async def lookup_google_maps_url(
    request: GooglePlacesLookupRequest = Body(...),
    current_user = Depends(get_current_user),
):
    """
    Look up cafe information from a Google Maps URL.
    
    Uses Google Places API (New) to extract:
    - Name, address, coordinates
    - Phone number, website
    - Business hours
    
    Requires authentication to prevent API cost abuse.
    Returns 501 if Google Places API key is not configured.
    """
    from app.config import settings
    
    if not settings.google_places_api_key:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google Places API is not configured. Please enter cafe information manually."
        )
    
    # Validate URL format
    url = request.url.strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL is required"
        )
    
    # Basic URL validation
    if not any(domain in url.lower() for domain in [
        "google.com/maps", "maps.google", "maps.app.goo.gl", 
        "goo.gl/maps", "g.co/maps"
    ]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid Google Maps URL"
        )
    
    try:
        from app.services.google_places_service import GooglePlacesService
        
        service = GooglePlacesService(api_key=settings.google_places_api_key)
        result = await service.lookup_from_url(url)
        
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not find place information for this URL"
            )
        
        return GooglePlacesLookupResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Google Places lookup error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to look up place information. Please try again or enter manually."
        )

@router.get("/osm/search")
async def search_osm_location(
    q: str = Query(..., description="Postcode or address to search"),
    lat: Optional[float] = Query(None, description="User's latitude for location-based filtering"),
    lng: Optional[float] = Query(None, description="User's longitude for location-based filtering"),
    countrycode: Optional[str] = Query(None, description="ISO 3166-1 alpha-2 country code (e.g., 'ca', 'us')"),
    osm_service: OSMService = Depends(get_osm_service)
):
    """
    Search for location by postcode or address using OSM Nominatim.
    Returns coordinates for postcode lookup.
    If user location is provided, prioritizes results near the user.
    If countrycode is provided or detected from postcode, filters by country.
    """
    try:
        # Try to detect country from postcode format if not provided
        detected_country = None
        if not countrycode:
            detected_country = detect_country_from_postcode(q)
        
        countrycodes = countrycode or detected_country
        
        # Normalize postcode (remove spaces for better search)
        normalized_query = q.replace(' ', '').upper()
        
        # Enhance query with country name if countrycode is provided
        search_query = q
        if countrycodes:
            # Map country code to country name for better search results
            country_names = {
                'ca': 'Canada',
                'us': 'United States',
                'gb': 'United Kingdom',
                'au': 'Australia',
                'kr': 'South Korea',
                'jp': 'Japan',
                'de': 'Germany',
                'fr': 'France',
                'es': 'Spain',
                'it': 'Italy',
                'nl': 'Netherlands',
                'be': 'Belgium',
                'ch': 'Switzerland',
                'at': 'Austria',
                'se': 'Sweden',
                'no': 'Norway',
                'dk': 'Denmark',
                'fi': 'Finland',
                'pl': 'Poland',
                'pt': 'Portugal',
                'ie': 'Ireland',
                'nz': 'New Zealand',
                'sg': 'Singapore',
                'my': 'Malaysia',
                'th': 'Thailand',
                'id': 'Indonesia',
                'ph': 'Philippines',
                'vn': 'Vietnam',
                'tw': 'Taiwan',
                'hk': 'Hong Kong',
                'cn': 'China',
                'in': 'India',
                'br': 'Brazil',
                'mx': 'Mexico'
            }
            country_name = country_names.get(countrycodes.lower())
            if country_name:
                # Try multiple query formats for better results
                # Format 1: Original with country
                # Format 2: Normalized (no spaces) with country
                # Format 3: Original postcode only (fallback)
                search_queries = [
                    f"{q}, {country_name}",
                    f"{normalized_query}, {country_name}",
                    q
                ]
            else:
                search_queries = [q, normalized_query]
        else:
            search_queries = [q, normalized_query]
        
        # If user location is provided, use viewbox to prioritize nearby results
        viewbox = None
        if lat is not None and lng is not None:
            # Create a viewbox around user location (±5 degrees = ~500km radius)
            viewbox = {
                'west': lng - 5.0,
                'south': lat - 5.0,
                'east': lng + 5.0,
                'north': lat + 5.0
            }
        
        # Try multiple query formats
        results = []
        for query in search_queries:
            # Try search with country filter first
            temp_results = await osm_service.search(query, limit=10, countrycodes=countrycodes, viewbox=viewbox)
            
            if temp_results and len(temp_results) > 0:
                results = temp_results
                break
            
            # If no results with country filter, try without country filter
            if countrycodes:
                temp_results = await osm_service.search(query, limit=10, countrycodes=None, viewbox=viewbox)
                if temp_results and len(temp_results) > 0:
                    results = temp_results
                    break
        
        if not results or len(results) == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found"
            )
        
        # Filter results by country if countrycode is provided
        if countrycodes:
            filtered_results = []
            country_names_map = {
                'ca': ['canada'],
                'us': ['united states', 'united states of america'],
                'gb': ['united kingdom', 'great britain'],
                'au': ['australia'],
                'kr': ['south korea', 'korea, republic of', 'korea'],
                'jp': ['japan'],
                'de': ['germany'],
                'fr': ['france'],
                'es': ['spain'],
                'it': ['italy'],
                'nl': ['netherlands'],
                'be': ['belgium'],
                'ch': ['switzerland'],
                'at': ['austria'],
                'se': ['sweden'],
                'no': ['norway'],
                'dk': ['denmark'],
                'fi': ['finland'],
                'pl': ['poland'],
                'pt': ['portugal'],
                'ie': ['ireland'],
                'nz': ['new zealand'],
                'sg': ['singapore'],
                'my': ['malaysia'],
                'th': ['thailand'],
                'id': ['indonesia'],
                'ph': ['philippines'],
                'vn': ['vietnam'],
                'tw': ['taiwan'],
                'hk': ['hong kong'],
                'cn': ['china'],
                'in': ['india'],
                'br': ['brazil'],
                'mx': ['mexico']
            }
            valid_country_names = country_names_map.get(countrycodes.lower(), [])
            
            for result in results:
                result_address = result.get("address", {})
                result_country = result_address.get("country", "").lower()
                if valid_country_names and any(name in result_country for name in valid_country_names):
                    filtered_results.append(result)
            
            if filtered_results:
                results = filtered_results
        
        # If user location is provided, find the closest result
        if lat is not None and lng is not None:
            best_result = results[0]
            min_distance = float('inf')
            
            for result in results:
                result_lat = float(result.get("lat", 0))
                result_lng = float(result.get("lon", 0))
                distance = calculate_earth_distance(lat, lng, result_lat, result_lng)
                
                if distance < min_distance:
                    min_distance = distance
                    best_result = result
            
            first_result = best_result
        else:
            first_result = results[0]
        
        return {
            "lat": float(first_result.get("lat", 0)),
            "lng": float(first_result.get("lon", 0)),
            # Same postal shape the reverse lookup returns, so a searched address and a
            # pinned one cannot be told apart once they are stored.
            "display_name": format_address(first_result)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error searching location")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/osm/reverse")
async def reverse_geocode_location(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    osm_service: OSMService = Depends(get_osm_service)
):
    """
    Reverse geocode coordinates to address using OSM Nominatim.
    Returns address information for given coordinates.
    """
    try:
        osm_data = await osm_service.reverse_geocode(lat, lng)
        
        if not osm_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Address not found for this location"
            )
        
        # Map country name to ISO 3166-1 alpha-2 code
        country_name = osm_data.get("country", "")
        country_code = get_country_code_from_name(country_name) if country_name else None
        
        return {
            "display_name": osm_data.get("display_name", ""),
            "road": osm_data.get("road"),
            "city": osm_data.get("city"),
            "province": osm_data.get("province"),
            "country": country_name,
            "country_code": country_code,
            "postcode": osm_data.get("postcode")
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error reverse geocoding location")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/admin/pending", response_model=CafeSearchResponse)
async def get_pending_cafes(
    current_user = Depends(require_admin_role),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get all pending cafes (Admin only).
    
    Returns:
        List of pending cafes with verification info
    """
    try:
        result = supabase.table("cafes").select("*").eq("status", "pending").execute()
        
        if not result.data:
            return CafeSearchResponse(cafes=[], total_count=0)
        
        # Sort by created_at descending (most recent first)
        # Handle None values by using a default date
        sorted_data = sorted(
            result.data, 
            key=lambda x: x.get("created_at") or "1970-01-01T00:00:00Z", 
            reverse=True
        )
        
        # Collect cafe IDs for batch image lookup
        cafe_ids = [cafe.get("id") for cafe in sorted_data]

        # Batch fetch images from cafe_visits for all pending cafes
        cafe_images_map = {}
        if cafe_ids:
            try:
                visits_result = supabase.table("cafe_visits").select(
                    "cafe_id, photo_urls, visited_at"
                ).in_("cafe_id", cafe_ids).eq(
                    "is_public", True
                ).not_.is_("photo_urls", "null").order(
                    "visited_at", desc=False
                ).execute()

                if visits_result.data:
                    for visit in visits_result.data:
                        cid = visit.get("cafe_id")
                        if cid not in cafe_images_map:
                            cafe_images_map[cid] = []
                        photo_urls = visit.get("photo_urls", [])
                        if photo_urls:
                            for url in photo_urls:
                                if url not in cafe_images_map[cid]:
                                    cafe_images_map[cid].append(url)
            except Exception:
                logger.warning("Error batch fetching images for pending cafes", exc_info=True)

        cafes = []
        for cafe in sorted_data:
            cafe_id = cafe.get("id")

            # Parse datetime fields
            created_at_str = cafe.get("created_at")
            created_at = date_parser.parse(created_at_str) if created_at_str else datetime.now(timezone.utc)

            updated_at_str = cafe.get("updated_at")
            updated_at = date_parser.parse(updated_at_str) if updated_at_str else None

            verified_at_str = cafe.get("verified_at")
            verified_at = date_parser.parse(verified_at_str) if verified_at_str else None

            # Build image list
            main_image = cafe.get("main_image")
            all_images = []
            if main_image:
                all_images.append(main_image)
            for url in cafe_images_map.get(cafe_id, []):
                if url not in all_images:
                    all_images.append(url)
            if not main_image and all_images:
                main_image = all_images[0]

            cafes.append(CafeResponse(
                id=str(cafe_id),
                name=cafe.get("name"),
                address=cafe.get("address"),
                latitude=Decimal(str(cafe.get("latitude"))),
                longitude=Decimal(str(cafe.get("longitude"))),
                phone=cafe.get("phone"),
                website=cafe.get("website"),
                description=cafe.get("description"),
                source_type=cafe.get("source_type"),
                status=cafe.get("status", "pending"),
                verification_count=cafe.get("verification_count", 1),
                verified_at=verified_at,
                admin_verified=cafe.get("admin_verified", False),
                navigator_id=str(cafe.get("navigator_id")) if cafe.get("navigator_id") else None,
                created_at=created_at,
                updated_at=updated_at,
                main_image=main_image,
                images=all_images if all_images else None,
                business_hours=cafe.get("business_hours"),
            ))

        for item, row in zip(cafes, sorted_data):
            item.has_deletion_history = bool(row.get("blacklist_history_id"))
        return CafeSearchResponse(cafes=cafes, total_count=len(cafes))

    except Exception as e:
        logger.exception("Error getting pending cafes")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.get("/admin/all", response_model=CafeSearchResponse)
async def get_all_cafes_admin(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str = Query("", max_length=100),
    cafe_status: Optional[str] = Query(None, alias="status"),
    brand_status: Optional[str] = Query(None, description="local | franchise | unknown"),
    current_user = Depends(require_admin_role),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get all cafes with pagination and optional status filter (Admin only).

    Args:
        page: Page number (default 1)
        page_size: Number of items per page (default 20)
        cafe_status: Optional status filter (pending/verified/disputed)
        brand_status: Optional brand-classification filter (local/franchise/unknown).
            'unknown' is the review queue for cafes we could not classify.
    """
    try:
        offset = (page - 1) * page_size
        # Same name/address substring search as the map, stripped of filter syntax.
        term = "".join(c for c in q.strip() if c.isalnum() or c.isspace() or c in "-'")

        # Count query
        count_query = supabase.table("cafes").select("id", count="exact")
        if term:
            count_query = count_query.or_(f"name.ilike.%{term}%,address.ilike.%{term}%")
        if cafe_status:
            count_query = count_query.eq("status", cafe_status)
        if brand_status:
            count_query = count_query.eq("brand_status", brand_status)
        count_result = count_query.execute()
        total_count = count_result.count if count_result.count is not None else 0

        # Data query with pagination
        data_query = supabase.table("cafes").select("*")
        if term:
            data_query = data_query.or_(f"name.ilike.%{term}%,address.ilike.%{term}%")
        if cafe_status:
            data_query = data_query.eq("status", cafe_status)
        if brand_status:
            data_query = data_query.eq("brand_status", brand_status)
        result = data_query.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()

        if not result.data:
            return CafeSearchResponse(cafes=[], total_count=total_count)

        # Batch fetch images
        cafe_ids = [cafe.get("id") for cafe in result.data]
        cafe_images_map = {}
        if cafe_ids:
            try:
                visits_result = supabase.table("cafe_visits").select(
                    "cafe_id, photo_urls, visited_at"
                ).in_("cafe_id", cafe_ids).eq(
                    "is_public", True
                ).not_.is_("photo_urls", "null").order(
                    "visited_at", desc=False
                ).execute()

                if visits_result.data:
                    for visit in visits_result.data:
                        cid = visit.get("cafe_id")
                        if cid not in cafe_images_map:
                            cafe_images_map[cid] = []
                        photo_urls = visit.get("photo_urls", [])
                        if photo_urls:
                            for url in photo_urls:
                                if url not in cafe_images_map[cid]:
                                    cafe_images_map[cid].append(url)
            except Exception:
                logger.warning("Error batch fetching images for all cafes", exc_info=True)

        cafes = []
        for cafe in result.data:
            cafe_id = cafe.get("id")

            created_at_str = cafe.get("created_at")
            created_at = date_parser.parse(created_at_str) if created_at_str else datetime.now(timezone.utc)

            updated_at_str = cafe.get("updated_at")
            updated_at = date_parser.parse(updated_at_str) if updated_at_str else None

            verified_at_str = cafe.get("verified_at")
            verified_at = date_parser.parse(verified_at_str) if verified_at_str else None

            main_image = cafe.get("main_image")
            all_images = []
            if main_image:
                all_images.append(main_image)
            for url in cafe_images_map.get(cafe_id, []):
                if url not in all_images:
                    all_images.append(url)
            if not main_image and all_images:
                main_image = all_images[0]

            cafes.append(CafeResponse(
                id=str(cafe_id),
                name=cafe.get("name"),
                address=cafe.get("address"),
                latitude=Decimal(str(cafe.get("latitude"))),
                longitude=Decimal(str(cafe.get("longitude"))),
                phone=cafe.get("phone"),
                website=cafe.get("website"),
                description=cafe.get("description"),
                source_type=cafe.get("source_type"),
                status=cafe.get("status", "pending"),
                verification_count=cafe.get("verification_count", 1),
                verified_at=verified_at,
                admin_verified=cafe.get("admin_verified", False),
                navigator_id=str(cafe.get("navigator_id")) if cafe.get("navigator_id") else None,
                created_at=created_at,
                updated_at=updated_at,
                main_image=main_image,
                images=all_images if all_images else None,
                business_hours=cafe.get("business_hours"),
            ))

        for item, row in zip(cafes, result.data):
            item.has_deletion_history = bool(row.get("blacklist_history_id"))
        return CafeSearchResponse(cafes=cafes, total_count=total_count)

    except Exception as e:
        logger.exception("Error getting all cafes for admin")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )

@router.post("/admin/{cafe_id}/verify")
async def admin_verify_cafe(
    cafe_id: str,
    current_user = Depends(require_admin_role),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Admin verify a cafe (Admin only).
    Sets status to 'verified' and admin_verified to True.
    Founding Crew information is preserved (1 or 2 users).
    
    Args:
        cafe_id: ID of the cafe to verify
        
    Returns:
        Updated cafe information
    """
    try:
        # Get cafe
        cafe_result = supabase.table("cafes").select("*").eq("id", cafe_id).single().execute()
        
        if not cafe_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        cafe = cafe_result.data
        
        # Update cafe: set status to verified, admin_verified to True
        update_data = {
            "status": "verified",
            "admin_verified": True,
            "verified_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Verify count remains as is (1 or 2)
        # Founding Crew info is preserved
        
        result = supabase.table("cafes").update(update_data).eq("id", cafe_id).execute()
        
        if not result.data or len(result.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to verify cafe"
            )
        
        updated_cafe = result.data[0]
        _drop_trending_cache()

        return {
            "message": "Cafe verified by admin",
            "cafe": CafeResponse(
                id=str(updated_cafe.get("id")),
                name=updated_cafe.get("name"),
                address=updated_cafe.get("address"),
                latitude=updated_cafe.get("latitude"),
                longitude=updated_cafe.get("longitude"),
                phone=updated_cafe.get("phone"),
                website=updated_cafe.get("website"),
                description=updated_cafe.get("description"),
                source_type=updated_cafe.get("source_type"),
                status=updated_cafe.get("status"),
                verification_count=updated_cafe.get("verification_count"),
                verified_at=updated_cafe.get("verified_at"),
                admin_verified=updated_cafe.get("admin_verified", False),
                navigator_id=str(updated_cafe.get("navigator_id")) if updated_cafe.get("navigator_id") else None,
                created_at=updated_cafe.get("created_at"),
                updated_at=updated_cafe.get("updated_at")
            )
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error verifying cafe")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


def _drop_trending_cache() -> None:
    """
    Forget the memoised trending lists after an admin changes what exists.

    The discover cards are served from `visits._trending_cache`, keyed by viewport, and
    a deleted cafe stays in every key that already held it until the TTL runs out. So
    an admin deletes a cafe, reloads discover, and it is still there. Imported inside
    the function because `visits` imports from this module.
    """
    from app.api.v1 import visits

    visits._trending_cache.clear()


@router.delete("/admin/{cafe_id}")
async def admin_delete_cafe(
    cafe_id: str,
    current_user = Depends(require_admin_role),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Delete a cafe (Admin only).
    Hard delete - removes cafe and related data (cascade).
    
    Args:
        cafe_id: ID of the cafe to delete
        
    Returns:
        Success message
    """
    try:
        # Check if cafe exists
        result = supabase.rpc("delete_cafe_with_history", {"target": cafe_id}).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        # The RPC stores the minimal identity and deletes in the same transaction.
        _drop_trending_cache()

        return {
            "message": "Cafe deleted successfully",
            "cafe_id": cafe_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error deleting cafe")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


# =========================================================
# Admin Update Cafe
# =========================================================

class AdminCafeUpdateRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    business_hours: Optional[dict] = None  # JSON object with day-by-day hours
    main_image: Optional[str] = None       # Main image URL
    images: Optional[List[str]] = None     # Gallery image URLs
    brand_override: Optional[bool] = None  # True = force franchise, False = force local
    serves_coffee: Optional[bool] = None   # False hides a venue that does not serve coffee
    # What a Google Maps lookup returned for this cafe. A seeded row carries an OSM
    # node's idea of where a shop is and what it is called; Google usually has the
    # better answer, and the place id is what the photo fallback needs to show anything
    # at all. Corrections, not a re-registration -- see the drift check below.
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    google_place_id: Optional[str] = None
    source_url: Optional[str] = None

@router.patch("/admin/{cafe_id}")
async def admin_update_cafe(
    cafe_id: str,
    request: AdminCafeUpdateRequest = Body(...),
    current_user = Depends(require_admin_role),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Update a cafe's information (Admin only).
    Only non-null fields will be updated.
    
    Args:
        cafe_id: ID of the cafe to update
        request: Fields to update
        
    Returns:
        Updated cafe data
    """
    try:
        # Check if cafe exists
        cafe_result = supabase.table("cafes").select("*").eq("id", cafe_id).single().execute()
        
        if not cafe_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        # Build update data (only include non-null fields)
        update_data = {}
        if request.name is not None:
            update_data["name"] = request.name
        if request.address is not None:
            update_data["address"] = request.address
        if request.phone is not None:
            update_data["phone"] = request.phone
        if request.website is not None:
            update_data["website"] = request.website
        if request.description is not None:
            update_data["description"] = request.description
        if request.business_hours is not None:
            update_data["business_hours"] = request.business_hours
        if request.main_image is not None:
            update_data["main_image"] = request.main_image
        if request.serves_coffee is not None:
            update_data["serves_coffee"] = request.serves_coffee
            update_data["category_source"] = "admin"
        if request.google_place_id is not None:
            update_data["google_place_id"] = request.google_place_id
        if request.source_url is not None:
            update_data["source_url"] = request.source_url

        # The 100m drift guard protects the self-serve Google-lookup flow a registrant
        # runs on themselves. An admin applying the same lookup here already judged the
        # match by eye, so their update is a correction by definition -- no gate.
        if request.latitude is not None and request.longitude is not None:
            update_data["latitude"] = request.latitude
            update_data["longitude"] = request.longitude

        has_image_update = request.images is not None

        # Brand-level franchise override. Stored on the brand, not the cafe, so it
        # applies to every location of that brand and survives re-classification.
        if request.brand_override is not None:
            brand_key = cafe_result.data.get("brand_key") or franchise_service.brand_key(
                cafe_result.data.get("name", "")
            )
            supabase.table("cafe_brands").upsert({
                "brand_key": brand_key,
                "display_name": cafe_result.data.get("name", brand_key),
                "admin_override": request.brand_override,
                "lookup_source": "admin",
                "checked_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            update_data["brand_key"] = brand_key
            update_data["brand_status"] = (
                franchise_service.FRANCHISE if request.brand_override
                else franchise_service.LOCAL
            )

        if not update_data and not has_image_update:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )

        # Add updated_at timestamp
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Update the cafe (if there are cafe-level fields to update)
        if update_data:
            result = supabase.table("cafes").update(update_data).eq("id", cafe_id).execute()

            if not result.data:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to update cafe"
                )

        # Update gallery images via admin cafe_visit record
        if has_image_update:
            # Phase 1: Clean up removed images from ALL cafe_visits for this cafe
            try:
                # Fetch all current images from all visits for this cafe
                all_visits = supabase.table("cafe_visits").select("id, photo_urls").eq("cafe_id", cafe_id).not_.is_("photo_urls", "null").execute()
                
                # Determine URLs that were removed by admin
                current_all_urls = set()
                if all_visits.data:
                    for visit in all_visits.data:
                        for url in (visit.get("photo_urls") or []):
                            if isinstance(url, str) and url.strip():
                                current_all_urls.add(url)
                
                new_images_set = set(request.images) if request.images is not None else set()
                removed_urls = current_all_urls - new_images_set
                
                # Remove deleted URLs from ALL cafe_visits for this cafe (including other users)
                if removed_urls and all_visits.data:
                    for visit in all_visits.data:
                        visit_photos = visit.get("photo_urls") or []
                        if not visit_photos: continue
                        
                        updated_photos = [url for url in visit_photos if url not in removed_urls]
                        if len(updated_photos) != len(visit_photos):
                            supabase.table("cafe_visits").update(
                                {"photo_urls": updated_photos, "has_photos": len(updated_photos) > 0}
                            ).eq("id", visit["id"]).execute()
                            
                # Also check main_image from cafe
                cafe_main_image = cafe_result.data.get("main_image") if cafe_result.data else None
                if cafe_main_image and cafe_main_image in removed_urls:
                    supabase.table("cafes").update({"main_image": None}).eq("id", cafe_id).execute()
                    
            except Exception as e:
                logger.warning("Error cleaning up removed images globally", exc_info=True)


            admin_user_id = current_user.id
            admin_comment = "Admin Edit"

            # Look for existing admin visit record
            existing_visit = supabase.table("cafe_visits").select("id").eq(
                "cafe_id", cafe_id
            ).eq("user_id", admin_user_id).eq("comment", admin_comment).execute()

            if request.images:
                if existing_visit.data:
                    supabase.table("cafe_visits").update(
                        {"photo_urls": request.images, "visited_at": datetime.now(timezone.utc).isoformat()}
                    ).eq("id", existing_visit.data[0]["id"]).execute()
                else:
                    visit_data = {
                        "cafe_id": cafe_id,
                        "user_id": admin_user_id,
                        "photo_urls": request.images,
                        "is_public": True,
                        "anonymous": False,
                        "comment": admin_comment,
                        "has_photos": True,
                        "visited_at": datetime.now(timezone.utc).isoformat(),
                    }
                    supabase.table("cafe_visits").insert(visit_data).execute()
            elif existing_visit.data:
                # images is explicitly empty list - remove admin visit photos
                supabase.table("cafe_visits").update(
                    {"photo_urls": []}
                ).eq("id", existing_visit.data[0]["id"]).execute()

        # Re-fetch the updated cafe
        updated_cafe = supabase.table("cafes").select("*").eq("id", cafe_id).single().execute()
        _drop_trending_cache()

        return {
            "message": "Cafe updated successfully",
            "cafe": updated_cafe.data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error updating cafe")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


# =========================================================
# Drop Bean Feature
# =========================================================

def calculate_growth_level(drop_count: int) -> int:
    """Calculate growth level based on drop count."""
    if drop_count >= 15:
        return 5  # Roasted Bean
    elif drop_count >= 10:
        return 4  # Green Bean
    elif drop_count >= 5:
        return 3  # Coffee Cherry
    elif drop_count >= 3:
        return 2  # Coffee Tree
    return 1  # First Sprout


# English only, and only for API readers -- what a person sees is translated from
# the level number on the client.
GROWTH_LEVEL_NAMES = {
    1: "First Sprout",
    2: "Coffee Tree",
    3: "Coffee Cherry",
    4: "Green Bean",
    5: "Roasted Bean"
}


@router.post("/{cafe_id}/drop-bean")
async def drop_bean(
    cafe_id: str,
    user_lat: float = Query(..., ge=-90, le=90, description="User's current latitude"),
    user_lng: float = Query(..., ge=-180, le=180, description="User's current longitude"),
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Drop a bean at a cafe.
    
    - Requires user to be within 50m of the cafe
    - Limited to once per day per cafe
    - Updates growth level based on total drops
    
    Growth Levels:
    - Lv 1: First Sprout (1 drop)
    - Lv 2: Coffee Tree (3 drops)
    - Lv 3: Coffee Cherry (5 drops)
    - Lv 4: Green Bean (10 drops)
    - Lv 5: Roasted Bean (15 drops)
    """
    try:
        # 1. Check if cafe exists
        cafe_result = supabase.table("cafes").select("id, name, latitude, longitude").eq("id", cafe_id).single().execute()
        
        if not cafe_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cafe not found"
            )
        
        cafe = cafe_result.data
        cafe_lat = float(cafe.get("latitude", 0))
        cafe_lng = float(cafe.get("longitude", 0))
        
        # 2. Distance verification (50m limit)
        distance = calculate_earth_distance(user_lat, user_lng, cafe_lat, cafe_lng)
        max_distance = 50  # meters
        
        if distance > max_distance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"You must be within {max_distance}m of the cafe to drop a bean. Current distance: {distance:.0f}m"
            )
        
        # 2.5 Fraud detection - check location consistency (Option A: log only)
        check_location_consistency(
            supabase=supabase,
            user_id=current_user.id,
            current_lat=user_lat,
            current_lng=user_lng,
            action_type="drop_bean"
        )
        
        # 3. Check for existing bean record (user + cafe)
        bean_result = supabase.table("cafe_beans").select("*").eq(
            "cafe_id", cafe_id
        ).eq(
            "user_id", current_user.id
        ).execute()
        
        existing_bean = bean_result.data[0] if bean_result.data else None
        
        # 4. Check daily limit - already dropped today?
        today = datetime.now(timezone.utc).date().isoformat()
        
        if existing_bean:
            # Check if dropped today
            last_dropped = existing_bean.get("last_dropped_at")
            if last_dropped:
                last_dropped_date = date_parser.parse(last_dropped).date().isoformat()
                if last_dropped_date == today:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="You have already dropped a bean here today. Come back tomorrow!"
                    )
        
        # 5. Create or update bean record
        if existing_bean:
            # Update existing bean
            new_drop_count = existing_bean.get("drop_count", 1) + 1
            new_growth_level = calculate_growth_level(new_drop_count)
            
            supabase.table("cafe_beans").update({
                "drop_count": new_drop_count,
                "growth_level": new_growth_level,
                "last_latitude": user_lat,
                "last_longitude": user_lng,
                "last_dropped_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", existing_bean["id"]).execute()
            
            bean_id = existing_bean["id"]
            drop_count = new_drop_count
            growth_level = new_growth_level
            
        else:
            # Create new bean
            new_bean = supabase.table("cafe_beans").insert({
                "cafe_id": cafe_id,
                "user_id": current_user.id,
                "drop_count": 1,
                "growth_level": 1,
                "last_latitude": user_lat,
                "last_longitude": user_lng,
                "first_dropped_at": datetime.now(timezone.utc).isoformat(),
                "last_dropped_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            
            bean_id = new_bean.data[0]["id"]
            drop_count = 1
            growth_level = 1
        
        # 6. Record the drop in cafe_bean_drops
        supabase.table("cafe_bean_drops").insert({
            "bean_id": bean_id,
            "user_id": current_user.id,
            "cafe_id": cafe_id,
            "latitude": user_lat,
            "longitude": user_lng,
            "dropped_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        
        # 7. Check for level up
        old_level = existing_bean.get("growth_level", 0) if existing_bean else 0
        leveled_up = growth_level > old_level
        
        # 8. Calculate and update streak
        streak_info = await calculate_user_streak(supabase, current_user.id)
        
        # 9. Auto-verification: Check if 3 unique users have dropped beans
        triggered_verification = False
        cafe_status_result = supabase.table("cafes").select("status, navigator_id, blacklist_history_id").eq("id", cafe_id).single().execute()
        cafe_status = cafe_status_result.data.get("status") if cafe_status_result.data else "pending"

        # App-seeded cafes (e.g. OSM import) have no navigator yet — the
        # first real bean drop claims it.
        navigator_id = cafe_status_result.data.get("navigator_id") if cafe_status_result.data else None
        if not navigator_id:
            navigator_id = current_user.id
            supabase.table("cafes").update({"navigator_id": navigator_id}).eq("id", cafe_id).execute()

        if cafe_status == "pending" and not (cafe_status_result.data or {}).get("blacklist_history_id"):
            # Count unique users who dropped beans at this cafe
            unique_users_result = supabase.table("cafe_beans").select("user_id").eq("cafe_id", cafe_id).execute()
            unique_user_ids = list(set([bean["user_id"] for bean in unique_users_result.data])) if unique_users_result.data else []
            unique_user_count = len(unique_user_ids)
            
            if unique_user_count >= 3:
                # Update cafe to verified, sync verification_count
                supabase.table("cafes").update({
                    "status": "verified",
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                    "verification_count": unique_user_count
                }).eq("id", cafe_id).execute()

                triggered_verification = True
                logger.info("Cafe %s auto-verified by 3 unique bean droppers", cafe_id)
            else:
                # Sync verification_count to current unique bean dropper count
                supabase.table("cafes").update({
                    "verification_count": unique_user_count
                }).eq("id", cafe_id).execute()
        
        badges_service.award_badges_quietly(supabase, current_user.id)

        return {
            "message": "Bean dropped successfully!",
            "cafe_id": cafe_id,
            "cafe_name": cafe.get("name"),
            "drop_count": drop_count,
            "growth_level": growth_level,
            "growth_level_name": GROWTH_LEVEL_NAMES.get(growth_level, "Unknown"),
            "leveled_up": leveled_up,
            "next_level_at": get_next_level_threshold(drop_count),
            "streak": streak_info,
            "triggered_verification": triggered_verification
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error dropping bean")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )


async def calculate_user_streak(supabase: Client, user_id: str) -> dict:
    """
    Calculate user's drop streak based on their drop history.
    
    A streak is maintained if the user drops a bean within 7 days of their last drop.
    The streak increases by 1 for each consecutive "active period" (days with at least one drop).
    
    Returns:
        dict with current_streak, max_streak, last_drop_date
    """
    try:
        from datetime import timedelta
        
        # Get user's last 30 drops ordered by date
        drops_result = supabase.table("cafe_bean_drops").select(
            "dropped_at"
        ).eq(
            "user_id", user_id
        ).order(
            "dropped_at", desc=True
        ).limit(100).execute()
        
        if not drops_result.data:
            return {
                "current_streak": 1,  # This is their first drop
                "max_streak": 1,
                "last_drop_date": datetime.now(timezone.utc).date().isoformat(),
                "streak_active": True
            }
        
        # Parse dates and get unique drop dates
        drop_dates = set()
        for drop in drops_result.data:
            dropped_at = drop.get("dropped_at")
            if dropped_at:
                drop_date = date_parser.parse(dropped_at).date()
                drop_dates.add(drop_date)
        
        sorted_dates = sorted(drop_dates, reverse=True)
        today = datetime.now(timezone.utc).date()
        
        # Add today since we just dropped
        if today not in drop_dates:
            sorted_dates.insert(0, today)
        
        # Calculate current streak (consecutive days with drops within 7-day gaps)
        current_streak = 1
        if len(sorted_dates) > 1:
            for i in range(len(sorted_dates) - 1):
                gap = (sorted_dates[i] - sorted_dates[i + 1]).days
                if gap <= 7:  # Within 7-day window
                    current_streak += 1
                else:
                    break
        
        # Get or update max streak from user profile
        user_result = supabase.table("users").select(
            "max_streak, current_streak"
        ).eq("id", user_id).single().execute()
        
        stored_max_streak = 1
        if user_result.data:
            stored_max_streak = user_result.data.get("max_streak") or 1
        
        new_max_streak = max(current_streak, stored_max_streak)
        
        # Update user's streak in database
        supabase.table("users").update({
            "current_streak": current_streak,
            "max_streak": new_max_streak,
            "last_drop_date": today.isoformat()
        }).eq("id", user_id).execute()
        
        return {
            "current_streak": current_streak,
            "max_streak": new_max_streak,
            "last_drop_date": today.isoformat(),
            "streak_active": True
        }
        
    except Exception:
        logger.error("Error calculating streak", exc_info=True)
        # Return default if error
        return {
            "current_streak": 1,
            "max_streak": 1,
            "last_drop_date": datetime.now(timezone.utc).date().isoformat(),
            "streak_active": True
        }


def get_next_level_threshold(current_drops: int) -> Optional[int]:
    """Get the drop count needed for next level."""
    thresholds = [3, 5, 10, 15]
    for threshold in thresholds:
        if current_drops < threshold:
            return threshold
    return None  # Already max level


@router.get("/{cafe_id}/my-bean")
async def get_my_bean(
    cafe_id: str,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client)
):
    """
    Get user's bean status for a specific cafe.
    Returns drop count, growth level, and whether they can drop today.
    """
    try:
        # Get bean record
        bean_result = supabase.table("cafe_beans").select("*").eq(
            "cafe_id", cafe_id
        ).eq(
            "user_id", current_user.id
        ).execute()
        
        if not bean_result.data:
            return {
                "has_bean": False,
                "drop_count": 0,
                "growth_level": 0,
                "growth_level_name": None,
                "can_drop_today": True,
                "next_level_at": 1
            }
        
        bean = bean_result.data[0]
        
        # Check if can drop today
        today = datetime.now(timezone.utc).date().isoformat()
        last_dropped = bean.get("last_dropped_at")
        can_drop_today = True
        
        if last_dropped:
            last_dropped_date = date_parser.parse(last_dropped).date().isoformat()
            can_drop_today = last_dropped_date != today
        
        growth_level = bean.get("growth_level", 1)
        drop_count = bean.get("drop_count", 1)
        
        return {
            "has_bean": True,
            "drop_count": drop_count,
            "growth_level": growth_level,
            "growth_level_name": GROWTH_LEVEL_NAMES.get(growth_level, "Unknown"),
            "can_drop_today": can_drop_today,
            "first_dropped_at": bean.get("first_dropped_at"),
            "last_dropped_at": bean.get("last_dropped_at"),
            "next_level_at": get_next_level_threshold(drop_count)
        }
        
    except Exception as e:
        logger.exception("Error getting bean status")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again."
        )
