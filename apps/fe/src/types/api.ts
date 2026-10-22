export interface BusinessHoursData {
  [key: string]: {
    open: string;
    close: string;
    closed: boolean;
  };
}

export interface CafeSearchResponse {
  cafes: Array<{
    id: string;
    name: string;
    slug?: string;
    latitude: number;
    longitude: number;
    rating?: number;
    address: string;
    phone?: string;
    website?: string;
    description?: string;
    source_type?: string;
    source_url?: string;
    business_hours?: BusinessHoursData;
    timezone?: string;
    status: 'pending' | 'verified' | 'disputed';
    verification_count: number;
    verified_at?: string;
    admin_verified?: boolean;
    navigator_id?: string;
    created_at: string;
    updated_at?: string;
    founding_crew?: {
      navigator?: {
        user_id: string;
        username?: string;
      };
    };
    main_image?: string;
    trait_flags?: Record<string, boolean>;
  }>;
  total_count: number;
  cache_hit?: boolean;
}

export interface TrendingCafeResponse {
  id: string;
  slug?: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  status?: 'pending' | 'verified' | 'disputed';
  view_count_14d: number;
  visit_count_14d: number;
  trending_score: number;
  trending_rank?: number;
  image?: string;
  main_image?: string;
  business_hours?: BusinessHoursData;
  timezone?: string;
}

export interface GoogleCafePhoto {
  image_url: string;
  source_url: string;
  provider: 'Google Maps';
  author_attributions: Array<{
    display_name?: string;
    uri?: string;
    photo_uri?: string;
  }>;
}

export interface CafeRegistrationRequest {
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  phone?: string;
  website?: string;
  description?: string;
  postcode?: string;
  source_url?: string;
  business_hours?: BusinessHoursData;
  user_location?: {
    lat: number;
    lng: number;
  };
  source_type?: 'google_url' | 'map_click' | 'manual' | 'postcode';
  serves_coffee?: boolean;
  /* Written as approved observations: the registrant passed a 100m check. */
  traits?: Record<string, boolean>;
  images: string[];
  main_image_index?: number;
}


export interface CafeRegistrationResponse {
  success: boolean;
  cafe?: {
    id: string;
    name: string;
    address?: string;
    latitude: number;
    longitude: number;
    status: string;
    verification_count: number;
  };
  check_in?: {
    cafe_id: string;
    user_id: string;
    checkin_order: number;
    founding_role: string;
    triggered_verification: boolean;
  };
  message?: string;
  error?: string;
  existingCafe?: {
    id: string;
    name: string;
    slug?: string;
    latitude: number;
    longitude: number;
    address?: string;
  };
}

export interface GooglePlacesLookupData {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  business_hours?: BusinessHoursData;
  google_maps_url?: string;
  /* Google's own id for the place. The photo fallback cannot ask for anything
     without it, and a seeded cafe has none until an admin pastes a Maps URL. */
  place_id?: string;
}

export interface GooglePlacesLookupResult {
  success: boolean;
  data?: GooglePlacesLookupData;
  error?: string;
  message?: string;
}

export interface LocationSearchResult {
  lat: number;
  lng: number;
  display_name: string;
}

export interface CoffeeLog {
  id: string;
  cafe_id: string;
  user_id: string;
  visited_at: string;
  /* 'drink' | 'purchase'. A purchase has no rating; see LogFormData. */
  mode: 'drink' | 'purchase';
  rating?: number;
  comment?: string;
  photo_urls?: string[];
  is_public: boolean;
  anonymous: boolean;
  coffee_type?: string;
  dessert?: string;
  price?: number;
  price_currency?: string;
  atmosphere_rating?: number;
  atmosphere_tags?: string[];
  acidity_rating?: number;
  body_rating?: number;
  sweetness_rating?: number;
  bitterness_rating?: number;
  aftertaste_rating?: number;
  aroma_rating?: number;
  overall_taste_rating?: number;
  bean_id?: string;
  bean_name_raw?: string;
  want_again?: boolean;
  bean?: BeanRef;
  author_display_name?: string;
  author_username?: string;
  author_avatar_url?: string;
  updated_at?: string;
}

export interface CafeDetailResponse {
  id: string;
  name: string;
  slug?: string;
  latitude: number;
  longitude: number;
  rating?: number;
  address: string;
  phone?: string;
  website?: string;
  description?: string;
  source_type?: string;
  source_url?: string;
  business_hours?: BusinessHoursData;
  timezone?: string;
  status: 'pending' | 'verified' | 'disputed';
  verification_count: number;
  verified_at?: string;
  admin_verified?: boolean;
  navigator_id?: string;
  created_at: string;
  updated_at?: string;
  founding_crew?: {
    navigator?: {
      user_id: string;
      username?: string;
    };
  };
  average_rating?: number;
  log_count: number;
  recent_logs?: CoffeeLog[];
  total_beans_dropped?: number;
  main_image?: string;
  images?: string[];
}

export interface CafeLogsResponse {
  logs: CoffeeLog[];
  total_count: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface LogFormData {
  /*
    The unit of a log is an experience, and there are two of them: a cup drunk here,
    or a bag bought here. A drink needs a rating; a purchase does not -- scoring a
    coffee you have not brewed yet means inventing a number or not recording the
    purchase at all, and the purchase is the thing worth knowing.
  */
  mode: 'drink' | 'purchase';
  rating?: number;
  comment?: string;
  photo_urls?: string[];
  is_public: boolean;
  anonymous: boolean;
  coffee_type?: string;
  dessert?: string;
  price?: number;
  price_currency?: string;
  atmosphere_rating?: number;
  atmosphere_tags?: string[];
  acidity_rating?: number;
  body_rating?: number;
  sweetness_rating?: number;
  bitterness_rating?: number;
  aftertaste_rating?: number;
  aroma_rating?: number;
  overall_taste_rating?: number;
  /* Explicit null unlinks the bean; leaving the key out keeps whatever is stored. */
  bean_id?: string | null;
  bean_name_raw?: string;
  want_again?: boolean;
  /* Not stored on the log. Recorded as a coffee-trait observation for the cafe. */
  sells_beans?: boolean;
}

export interface Roaster {
  id: string;
  name: string;
  city?: string;
  website?: string;
}

export interface Bean {
  id: string;
  name: string;
  roaster_id: string;
  roaster_name?: string;
  origin?: string;
  process?: string;
  roast_level?: string;
}

/* What a log carries about its bean. No author, no created_by -- see the backend note. */
export interface BeanRef {
  id: string;
  name: string;
  roaster_name?: string;
}

export interface TraitSummary {
  trait: string;
  yes: number;
  no: number;
  latest_value?: boolean;
  last_observed_at?: string;
  seed_value?: boolean;
  seed_observed_at?: string;
  mine?: boolean;
  /* Which beans, which filter method. Only on the observation that is the state. */
  note?: string;
}

/* Admin-only. `username` never leaves this shape -- readers see no author anywhere. */
export interface TraitSuggestion {
  id: string;
  cafe_id: string;
  cafe_name?: string;
  cafe_slug?: string;
  /* Enough of the cafe to check the claim without leaving the queue. */
  cafe_address?: string;
  cafe_website?: string;
  cafe_status?: string;
  cafe_source_type?: string;
  cafe_latitude?: number;
  cafe_longitude?: number;
  trait: string;
  value: boolean;
  observed_at?: string;
  created_at?: string;
  username?: string;
  /* The free text an admin is being asked to publish. */
  note?: string;
  /* 'user' -- somebody pressed a button. 'seed' -- researched during the import. */
  source?: string;
  /* Why a seeded claim was made: the URL and the sentence behind it. Admin-only. */
  evidence?: string;
}

export interface CafeBeanEntry {
  bean_id: string;
  name: string;
  roaster_name?: string;
  origin?: string;
  roast_level?: string;
  last_seen_at: string;
  count: number;
}

/* Two lists, never merged: poured here is not the same claim as sold here. */
export interface CafeBeansResponse {
  drink: CafeBeanEntry[];
  purchase: CafeBeanEntry[];
}

export interface FoundingStats {
  navigator_count: number;
  regular_count: number;
}

/*
  How somebody reads a cafe, not what they think of a cup. The list used to be flavour
  notes (`acidic`, `full_body`), which described the coffee rather than the person and
  said nothing a reader could recognise themselves in.
*/
export type TasteTag =
  | 'bean_hunter'
  | 'origin_chaser'
  | 'filter_first'
  | 'roaster_pilgrim'
  | 'light_roast'
  | 'dark_roast'
  | 'quiet_corner'
  | 'work_friendly'
  | 'sweet_tooth';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  role?: string;
  founding_stats?: FoundingStats;
  taste_tags?: TasteTag[];
  trust_count?: number;
  following_count?: number;
  is_trusted_by_me?: boolean;
  collections_public?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface UserPublicResponse {
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  founding_stats?: FoundingStats;
  taste_tags?: TasteTag[];
  /* Both directions of the same relation. `trust_count` is followers; either number
     shown without the other reads as a score rather than as a pair. */
  trust_count?: number;
  following_count?: number;
  /** Whether the reader of this response follows this person. */
  is_trusted_by_me?: boolean;
  collections_public?: boolean;
  created_at: string;
}

// =========================================================
// Community Types
// =========================================================

export interface TrustedUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  trust_count: number;
  trusted_at: string;
}



export interface BadgeInfo {
  code: string;
  name: string;
  description: string;
  icon_url?: string;
}

export interface UserBadge {
  badge_code: string;
  awarded_at: string;
}

export type BadgeResponse = UserBadge;

// =========================================================
// Collection Types
// =========================================================

export type CollectionIconType = 'favourite' | 'save_later' | 'custom';

export interface CafePreview {
  id: string;
  name: string;
  main_image?: string;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  icon_type: CollectionIconType;
  color?: string;
  is_public: boolean;
  share_token?: string;
  position: number;
  item_count: number;
  preview_cafes?: CafePreview[];
  created_at: string;
  updated_at?: string;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  cafe_id: string;
  cafe_name: string;
  cafe_slug?: string;
  cafe_address?: string;
  cafe_main_image?: string;
  cafe_latitude?: number;
  cafe_longitude?: number;
  note?: string;
  added_at: string;
}

export interface CollectionDetail extends Collection {
  items: CollectionItem[];
}

export interface CollectionCreateRequest {
  name: string;
  description?: string;
  icon_type?: CollectionIconType;
  color?: string;
  is_public?: boolean;
}

export interface CollectionUpdateRequest {
  name?: string;
  description?: string;
  icon_type?: CollectionIconType;
  color?: string;
  is_public?: boolean;
}

export interface CafeSaveStatus {
  is_favourited: boolean;
  is_saved: boolean;
  saved_collection_ids: string[];
}

export interface QuickSaveResponse {
  action: 'added' | 'removed';
  collection_id: string;
}

export interface ShareTokenResponse {
  share_token: string;
  share_url: string;
}

