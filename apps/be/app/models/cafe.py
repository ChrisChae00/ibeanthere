from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from decimal import Decimal

# UGC Verification System Models


class TraitSummary(BaseModel):
    """
    One coffee trait, as a reader sees it.

    Note what is absent: no user ids, and no single "verified" boolean. The counts
    are people, `latest_value` is the most recent claim, and the seed fields are
    kept apart so "we filled this in from a spreadsheet" never reads as "three
    visitors confirmed it".
    """
    trait: str
    yes: int = 0
    no: int = 0
    latest_value: Optional[bool] = None
    last_observed_at: Optional[str] = None
    seed_value: Optional[bool] = None
    seed_observed_at: Optional[str] = None
    mine: Optional[bool] = None
    # Which beans, which filter method. Only ever set on the observation that is
    # currently the state, and only on the two traits that take one.
    note: Optional[str] = None


class TraitObservationCreate(BaseModel):
    """`value` is the claim; `observed_at` defaults to today on the server."""
    value: bool
    observed_at: Optional[str] = None
    # Free text, so it is length-capped here, again in the service, and once more by a
    # CHECK on the column. The backend bypasses RLS, so the database is the last gate.
    note: Optional[str] = Field(None, max_length=200)
    # Admin-only, and only read from an admin's request: the reason behind the claim,
    # kept on a "no" as much as on a "yes". Capped here, in the service and by the
    # column's CHECK, for the same reason the note is.
    evidence: Optional[str] = Field(None, max_length=500)


class CafeBeanEntry(BaseModel):
    """A bean seen at a cafe, derived from public logs."""
    bean_id: str
    name: str
    roaster_name: Optional[str] = None
    origin: Optional[str] = None
    roast_level: Optional[str] = None
    last_seen_at: datetime
    count: int = 1


class CafeBeansResponse(BaseModel):
    """
    What people had, and what people bought -- two lists, never merged.

    A bag bought here does not mean the cafe brews it, and a cup poured here does not
    mean you can buy it. Collapsing them would make the map answer the wrong question.
    """
    drink: List[CafeBeanEntry] = []
    purchase: List[CafeBeanEntry] = []

class CafeBase(BaseModel):
    """Base cafe model with UGC verification fields."""
    name: str
    address: Optional[str] = None
    latitude: Decimal
    longitude: Decimal
    phone: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None

class CafeRegistrationRequest(BaseModel):
    """Request model for cafe registration (UGC)."""
    name: str
    latitude: Decimal = Field(..., ge=-90, le=90)
    longitude: Decimal = Field(..., ge=-180, le=180)
    address: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None
    
    # Location verification (required — backend enforces proximity)
    user_location: dict  # {lat, lng} — must be within 100m of cafe

    # Registrant's confirmation, used only when the map has no cuisine tag
    serves_coffee: bool = False
    # What the person standing in the cafe can see about its coffee. Written as
    # approved observations: they passed a 100m check to get here, which is the
    # strongest evidence any surface in the app collects.
    traits: Optional[Dict[str, bool]] = None
    
    # Source tracking
    source_type: Optional[str] = None  # 'google_url' | 'map_click' | 'manual'
    source_url: Optional[str] = None
    
    # Images
    images: Optional[List[str]] = Field(None, max_length=5, description="Maximum 5 images (base64)")
    main_image_index: Optional[int] = Field(None, ge=0, le=4, description="Index of main image")

class CafeCreate(CafeBase):
    """Model for creating a new cafe entry (internal)."""
    navigator_id: Optional[str] = None  # User ID who first registered
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    normalized_name: Optional[str] = None
    normalized_address: Optional[str] = None

class CafeUpdate(BaseModel):
    """Model for updating cafe information."""
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None

class CafeResponse(BaseModel):
    """Cafe model for API responses with verification info."""
    id: str
    name: str
    slug: Optional[str] = None
    address: Optional[str] = None
    latitude: Decimal
    longitude: Decimal
    phone: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    source_type: Optional[str] = None
    source_url: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None

    # Verification fields
    status: str  # 'pending' | 'verified'
    verification_count: int
    verified_at: Optional[datetime] = None
    admin_verified: bool = False
    has_deletion_history: bool = False  # Only populated by admin list endpoints.
    
    # Founding Crew
    navigator_id: Optional[str] = None
    founding_crew: Optional[Dict[str, Any]] = None
    
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # Coffee log statistics (computed)
    average_rating: Optional[float] = None
    log_count: int = 0
    recent_logs: Optional[List[Dict[str, Any]]] = None
    total_beans_dropped: int = 0
    
    # Images
    main_image: Optional[str] = None
    images: Optional[List[str]] = None

    # Coffee traits: `{trait: True}` only where the current state is yes. Cheap enough
    # to ship with search and map results, which is what the filter chips read.
    trait_flags: Optional[Dict[str, bool]] = None

    class Config:
        from_attributes = True

class CafeSearchParams(BaseModel):
    """Parameters for cafe search."""
    lat: float = Field(..., ge=-90, le=90, description="Latitude")
    lng: float = Field(..., ge=-180, le=180, description="Longitude")
    radius: int = Field(default=2000, ge=100, le=5000, description="Search radius in meters")
    status: Optional[str] = Field(None, description="Filter by status: 'pending' | 'verified'")

class CafeSearchResponse(BaseModel):
    """Response model for cafe search."""
    cafes: List[CafeResponse]
    total_count: int


# =========================================================
# Google Places Lookup Models
# =========================================================

class GooglePlacesLookupRequest(BaseModel):
    """Request model for Google Maps URL lookup."""
    url: str = Field(..., description="Google Maps URL to extract cafe info from")

class GooglePlacesLookupResponse(BaseModel):
    """Response model for Google Maps URL lookup."""
    name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None
    google_maps_url: Optional[str] = None
    place_id: Optional[str] = None
