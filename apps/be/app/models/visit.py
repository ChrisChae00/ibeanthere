from pydantic import BaseModel, Field, model_validator
from typing import Any, Dict, Optional, List
from datetime import datetime
from decimal import Decimal

class CafeViewCreate(BaseModel):
    """Request model for recording a cafe view"""
    cafe_id: str
    user_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

class CafeViewResponse(BaseModel):
    """Response model for cafe view"""
    id: str
    cafe_id: str
    user_id: Optional[str] = None
    viewed_at: datetime


class BeanRef(BaseModel):
    """
    The bean a log points at, as it is shown to a reader.

    Deliberately not the `beans` row: no `created_by`, no `created_at`. Somebody
    adding a bean to the shared catalogue while writing a private log must not become
    visible through that log.
    """
    id: str
    name: str
    roaster_name: Optional[str] = None


class CoffeeLogFields(BaseModel):
    """
    Everything a person can put in a coffee log, shared by all four models below.

    These fields used to be written out four times — create, update, response and the
    public response — so every column change was a four-place edit and the fourth was
    the one that got forgotten. They live here once.

    What is NOT here: the eight workspace columns (wifi_*, outlet_info,
    furniture_comfort, noise_*, temperature_lighting, facilities_info), parking_info,
    and the free-text bean_origin / processing_method / roast_level /
    extraction_method / extraction_equipment. The columns still exist on cafe_visits;
    nothing reads or writes them. Dropping columns is not reversible and the old rows
    are somebody's records, so they stay until that is its own decision.
    """
    rating: Optional[int] = Field(None, ge=1, le=5, description="Rating must be between 1 and 5")
    comment: Optional[str] = Field(None, max_length=1000, description="Comment must be less than 1000 characters")
    photo_urls: Optional[List[str]] = Field(None, max_length=5, description="Maximum 5 photos")
    coffee_type: Optional[str] = Field(None, max_length=100)
    dessert: Optional[str] = Field(None, max_length=200, description="Dessert ordered")
    price: Optional[Decimal] = Field(None, description="Price paid")
    price_currency: Optional[str] = Field(None, max_length=10, description="Currency code (USD, KRW, EUR, etc.)")
    atmosphere_rating: Optional[int] = Field(None, ge=1, le=5, description="Atmosphere rating (1-5)")
    atmosphere_tags: Optional[List[str]] = Field(None, description="Cafe atmosphere tags (e.g., cozy, modern, minimalist)")
    acidity_rating: Optional[int] = Field(None, ge=0, le=10, description="Acidity intensity rating (0-10)")
    body_rating: Optional[int] = Field(None, ge=0, le=10, description="Body intensity rating (0-10)")
    sweetness_rating: Optional[int] = Field(None, ge=0, le=10, description="Sweetness intensity rating (0-10)")
    bitterness_rating: Optional[int] = Field(None, ge=0, le=10, description="Bitterness intensity rating (0-10)")
    aftertaste_rating: Optional[int] = Field(None, ge=0, le=10, description="Aftertaste intensity rating (0-10)")
    aroma_rating: Optional[int] = Field(None, ge=0, le=10, description="Aroma intensity rating (0-10)")
    overall_taste_rating: Optional[int] = Field(None, ge=0, le=10, description="Overall taste rating (0-10)")
    # The catalogue bean this log points at. Optional on purpose: someone who does not
    # know the roaster still has a log to write, and `bean_name_raw` takes what they
    # can read off the cup or the bag.
    bean_id: Optional[str] = Field(None, description="Catalogue bean this log refers to")
    bean_name_raw: Optional[str] = Field(None, max_length=200, description="Bean as written, when it is not in the catalogue")
    want_again: Optional[bool] = Field(None, description="Would drink or buy this again")


LOG_MODES = ("drink", "purchase")


class CafeVisitCreate(CoffeeLogFields):
    """Request model for recording a cafe visit"""
    cafe_id: str
    check_in_lat: Optional[Decimal] = None
    check_in_lng: Optional[Decimal] = None
    distance_meters: Optional[int] = None
    duration_minutes: Optional[int] = None
    auto_detected: bool = False
    confirmed: bool = True
    mode: str = Field("drink", description="drink | purchase")
    is_public: bool = True
    anonymous: bool = False
    # Buying a bag here is evidence the cafe sells them, but it is not recorded by
    # inference: a private purchase log must not move a public count on its own, or a
    # cafe with one visitor leaks that visitor's private log through the number. The
    # form asks, and this carries the answer. Not a column on cafe_visits.
    sells_beans: Optional[bool] = None

    @model_validator(mode="after")
    def _check_mode(self):
        _validate_log_state(self.mode, self.rating)
        return self


class CafeVisitUpdate(CoffeeLogFields):
    """
    Update model for confirming auto-detected visits and editing log content.

    Every field is optional here, so this model alone cannot tell whether the result
    is a valid log — switching a purchase to a drink without adding a rating is only
    visible once the patch is merged onto the stored row. That check lives in the
    endpoint (`validate_merged_log`), against the merged state.

    `bean_id: null` sent explicitly means "unlink the bean"; leaving the field out
    means "keep whatever is there". Callers must read `model_fields_set`, not
    truthiness, to tell those apart.
    """
    confirmed: Optional[bool] = None
    duration_minutes: Optional[int] = None
    mode: Optional[str] = Field(None, description="drink | purchase")
    is_public: Optional[bool] = None
    anonymous: Optional[bool] = None


class CafeVisitResponse(CoffeeLogFields):
    """Response model for cafe visit"""
    id: str
    cafe_id: str
    user_id: str
    visited_at: datetime
    check_in_lat: Optional[Decimal] = None
    check_in_lng: Optional[Decimal] = None
    distance_meters: Optional[int] = None
    duration_minutes: Optional[int] = None
    auto_detected: bool
    confirmed: bool
    has_review: bool
    has_photos: bool
    mode: str = "drink"
    is_public: bool = True
    anonymous: bool = False
    bean: Optional[BeanRef] = None
    updated_at: Optional[datetime] = None
    # For public display
    author_display_name: Optional[str] = None

class TrendingCafeResponse(BaseModel):
    """Response model for trending cafe"""
    id: str
    slug: Optional[str] = None
    name: str
    address: str
    latitude: Decimal
    longitude: Decimal
    view_count_14d: int = 0
    visit_count_14d: int = 0
    trending_score: Decimal = Decimal('0.0')
    trending_rank: Optional[int] = None
    image: Optional[str] = None
    main_image: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None

class CafeStatsResponse(BaseModel):
    """Response model for cafe statistics"""
    cafe_id: str
    view_count_total: int = 0
    view_count_14d: int = 0
    visit_count_total: int = 0
    visit_count_14d: int = 0
    trending_score: Decimal = Decimal('0.0')
    trending_rank: Optional[int] = None
    trending_updated_at: Optional[datetime] = None

class CafeLogPublicResponse(CoffeeLogFields):
    """Public response model for coffee logs (anonymous display)"""
    id: str
    cafe_id: str
    visited_at: datetime
    mode: str = "drink"
    bean: Optional[BeanRef] = None
    author_display_name: Optional[str] = None
    author_username: Optional[str] = None
    author_avatar_url: Optional[str] = None
    updated_at: Optional[datetime] = None

class CafeLogsResponse(BaseModel):
    """Response model for paginated coffee logs"""
    logs: List[CafeLogPublicResponse]
    total_count: int
    page: int
    page_size: int
    has_more: bool


def _validate_log_state(mode: Optional[str], rating: Optional[int]):
    """
    Shared rule: a cup you drank gets a rating, a bag you bought does not have to.

    Requiring a rating on a purchase would ask people to score a coffee they have not
    made yet, so they would either invent a number or not record the purchase at all —
    and the purchase is the thing this app most wants to know about.
    """
    if mode is not None and mode not in LOG_MODES:
        raise ValueError(f"mode must be one of {', '.join(LOG_MODES)}")
    if mode == "drink" and rating is None:
        raise ValueError("rating is required when mode is 'drink'")
    return mode


def validate_merged_log(mode: Optional[str], rating: Optional[int]) -> None:
    """
    Validate a PATCH after it has been merged onto the stored row.

    Raises ValueError; the endpoint turns that into a 422. Called with the merged
    values, never with the patch alone — a patch that only changes `mode` is
    invalid or not depending entirely on the rating already on the row.
    """
    _validate_log_state(mode, rating)
