'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/shared/ui';
const InteractiveMap = dynamic(() => import('./InteractiveMap'), {
  loading: () => <div className="h-full w-full flex items-center justify-center"><LoadingSpinner /></div>,
  ssr: false
});
import LocationPermissionOverlay from './LocationPermissionOverlay';
import { MapControlGroup, MAP_FILTER_IDS, type MapFilterId } from './MapFilters';

import CafeInfoModal from './CafeInfoModal';
import { useLocation } from '@/hooks/useLocation';
import { useMapData } from '@/hooks/useMapData';
import { useVisitDetection } from '@/hooks/useVisitDetection';

import { useToast } from '@/contexts/ToastContext';
import { CafeMapData } from '@/types/map';

import { API_BASE_URL, apiFetch } from '@/lib/api/client';
import { calculateDistance } from '@/lib/utils/checkIn';
import { getTrendingCafes } from '@/lib/api/cafes';

/*
  One banner for every state the map can be in: searching, showing the trending
  fallback, or failed. The three used to be separate overlays -- and the failure had no
  overlay at all, because `useMapData` keeps the previous results on error, so a failed
  search looked exactly like a successful one that found the same cafes.
*/
function MapStatusBanner({
  message,
  busy,
  onRetry,
  retryLabel
}: {
  message: string | null;
  busy?: boolean;
  onRetry?: () => void;
  retryLabel: string;
}) {
  if (!message) return null;

  return (
    <div
      role="status"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-(--z-map-chrome) flex items-center gap-2 rounded-(--radius-pill) border border-edge-rule bg-surface-raised px-3 py-1.5 text-xs text-ink-secondary shadow-sm"
    >
      {busy && <LoadingSpinner size="sm" />}
      <span className="whitespace-nowrap">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-(--radius-control) px-1 font-medium text-ink-primary underline underline-offset-2 hover:opacity-80"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}


/*
  The card opens beside the pin, not in the middle of the screen: what was tapped has to
  stay in view. It sits above the pin where there is room and below it otherwise, and is
  held inside the frame horizontally so it never hangs off the map's edge.
*/
const CARD_WIDTH = 340;
const CARD_GAP = 14;
const FRAME_MARGIN = 12;
/* Half the selected pin's icon, so the card clears the pin instead of touching it. */
const PIN_HALF_WIDTH = 22;

/* A pin panned off the map takes its card with it, rather than leaving the card pinned
   to the frame's edge pointing at nothing. */
function isPointInFrame(point: { x: number; y: number }, frame: HTMLElement | null) {
  if (!frame) return true;
  return point.x >= 0 && point.x <= frame.clientWidth && point.y >= 0 && point.y <= frame.clientHeight;
}

function cardPosition(
  point: { x: number; y: number },
  frame: HTMLElement | null,
  cardHeight: number
): React.CSSProperties {
  const width = frame?.clientWidth ?? CARD_WIDTH;
  const height = frame?.clientHeight ?? 0;

  /*
    The pin has been panned to the lower left, so wherever the card actually fits to the
    right of it, that is where it goes -- clear of the pin, centred on it vertically.
    The test is whether it fits, not how wide the viewport is: the map is one column of
    a two-column page, so a wide screen does not mean a wide frame.
  */
  const left = point.x + PIN_HALF_WIDTH + CARD_GAP;
  if (left + CARD_WIDTH <= width - FRAME_MARGIN) {
    const room = Math.max(height - FRAME_MARGIN * 2, 220);
    /* Before the first measurement the card fills the room and is pinned to the top;
       once its height is known it is centred on the pin. */
    const resolvedHeight = Math.min(cardHeight || room, room);
    const top = Math.min(
      Math.max(point.y - resolvedHeight / 2, FRAME_MARGIN),
      Math.max(height - resolvedHeight - FRAME_MARGIN, FRAME_MARGIN)
    );

    /*
      The cap is the room left *below the card's own top*, not the whole frame: a card
      that grows after it is placed -- opening the week's hours does exactly that -- would
      otherwise run past the bottom of the map, where the frame clips it and the rest of
      the record cannot be reached at all.
    */
    return { left, top, maxHeight: Math.max(height - top - FRAME_MARGIN, 220) };
  }

  /* No room beside it: the card keeps the pin's own column, above or below. */
  const halfCard = Math.min(CARD_WIDTH, width - FRAME_MARGIN * 2) / 2;
  const minLeft = halfCard + FRAME_MARGIN;
  const maxLeft = Math.max(width - halfCard - FRAME_MARGIN, minLeft);
  const columnLeft = Math.min(Math.max(point.x, minLeft), maxLeft);

  const roomAbove = point.y - FRAME_MARGIN * 2;
  const above = roomAbove > 260;

  return {
    left: columnLeft,
    top: above ? point.y - CARD_GAP : point.y + CARD_GAP,
    transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    maxHeight: Math.max((above ? roomAbove : height - point.y - CARD_GAP * 2), 220),
  };
}

interface MapWithFiltersProps {
  locale: string;
  mapTitle?: string;
  mapSubtitle?: string;
}

export default function MapWithFilters({ locale, mapTitle, mapSubtitle }: MapWithFiltersProps) {
  const t = useTranslations('map');

  const { coords, getCurrentLocation, error: locationError } = useLocation();
  const { cafes: allCafes, isLoading, error, searchCafes, fetchTrendingFallback, isTrendingFallback, clearCache } = useMapData();

  const { showToast } = useToast();
  
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedCafe, setSelectedCafe] = useState<CafeMapData | null>(null);
  /* Where the selected pin currently is, in the map's pixel space, so the card can open
     beside it and stay there while the map moves under it. */
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number } | null>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  /*
    Centring the card on the pin needs its height, and the card is as tall as the cafe's
    own record -- and taller again the moment the week's hours are opened. So it is
    observed, not measured once.
  */
  const [cardNode, setCardNode] = useState<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    if (!cardNode) {
      setCardHeight(0);
      return;
    }

    const observer = new ResizeObserver(() => setCardHeight(cardNode.offsetHeight));
    observer.observe(cardNode);
    return () => observer.disconnect();
  }, [cardNode]);

  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<MapFilterId>>(new Set());
  /* null until the reader asks for trending: the list is a second request, and most
     visits never turn the filter on. */
  const [trendingIds, setTrendingIds] = useState<Set<string> | null>(null);

  const [forceCenterUpdate, setForceCenterUpdate] = useState(false);
  const [locationPermission, setLocationPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  // Track last search location to prevent excessive API calls
  const lastSearchRef = useRef<{ lat: number; lng: number } | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const expansionAttemptedRef = useRef(false);
  const trendingFallbackAttemptedRef = useRef(false);

  const MIN_CAFE_COUNT = 9;
  const EXPANDED_RADIUS = 150000; // 150km
  const LOCAL_RADIUS = 5000; // 5km — walking-and-a-bit, which is what "local" means here
  /*
    Trending is "trending around here", not "trending anywhere": a global top-50 matched
    nearly every pin on the map and the filter said nothing. It needs a shared location,
    the way the local filter does.
  */
  const TRENDING_POOL = 10;

  // Dynamic search based on visible area with debouncing
  const handleBoundsChanged = useCallback((bounds: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Debounce the search - increased to 1500ms for less frequent requests
    debounceTimeoutRef.current = setTimeout(() => {
      try {
        // Calculate center of visible bounds
        const centerLat = (bounds.ne.lat + bounds.sw.lat) / 2;
        const centerLng = (bounds.ne.lng + bounds.sw.lng) / 2;
        
        // Validate bounds
        if (isNaN(centerLat) || isNaN(centerLng) || Math.abs(centerLat) > 90 || Math.abs(centerLng) > 180) {
          console.error('Invalid bounds:', bounds);
          return;
        }
        
        // Only search if location changed significantly (at least 1km)
        const SEARCH_THRESHOLD = 1000; // meters
        if (lastSearchRef.current) {
          const R = 6371000;
          const latDiff = centerLat - lastSearchRef.current.lat;
          const lngDiff = centerLng - lastSearchRef.current.lng;
          const dist = R * Math.sqrt(
            Math.pow(latDiff * Math.PI / 180, 2) + 
            Math.pow(lngDiff * Math.PI / 180, 2) * Math.pow(Math.cos(centerLat * Math.PI / 180), 2)
          );
          
          if (dist < SEARCH_THRESHOLD) {
            return; // Location hasn't changed enough
          }
          // Center changed significantly — allow re-expansion for new area
          expansionAttemptedRef.current = false;
          trendingFallbackAttemptedRef.current = false;
        }

        lastSearchRef.current = { lat: centerLat, lng: centerLng };
        
        // Calculate radius in meters (expand to load more cafes around map)
        const R = 6371000; // Earth radius in meters
        const latDiff = bounds.ne.lat - bounds.sw.lat;
        const lngDiff = bounds.ne.lng - bounds.sw.lng;
        const latDist = R * Math.abs(latDiff) * (Math.PI / 180);
        const lngDist = R * Math.abs(lngDiff) * Math.cos(bounds.ne.lat * Math.PI / 180) * (Math.PI / 180);
        const radius = Math.max(latDist, lngDist) * 2.0;
        
        searchCafes({
          lat: centerLat,
          lng: centerLng,
          radius: Math.floor(Math.min(radius, 150000))
        });
      } catch (error) {
        console.error('Error in handleBoundsChanged:', error);
      }
    }, 1500); // 1500ms debounce for less frequent requests
  }, [searchCafes]);

  // Check permission state on mount and auto-start tracking if granted
  useEffect(() => {
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((result) => {
        const state = result.state as 'prompt' | 'granted' | 'denied';
        // Only auto-set if granted. If denied or prompt, let user try clicking 'Share Location'.
        // This fixes the issue where Safari reports 'denied' and hides the button immediately.
        if (state === 'granted') {
          setLocationPermission('granted');
        } else {
          setLocationPermission('prompt');
        }
        
        // Auto-start location tracking if permission already granted
        // Check user preference from localStorage
        const autoTrackingEnabled = typeof window !== 'undefined' 
          ? localStorage.getItem('location_auto_tracking_enabled') !== 'false'
          : true; // Default to true for SSR
        
        if (state === 'granted' && autoTrackingEnabled) {
          getCurrentLocation()
            .then(() => {
              setTrackingEnabled(true);
            })
            .catch((error) => {
              // Silently handle timeout errors during auto-load
              if (process.env.NODE_ENV === 'development') {
                console.debug('Location auto-load timeout (expected):', error.message);
              }
              // Still enable tracking even if initial location fetch fails
              setTrackingEnabled(true);
            });
        }
        
        result.onchange = () => {
          const newState = result.state as 'prompt' | 'granted' | 'denied';
          setLocationPermission(newState);
          
          // Check user preference from localStorage
          const autoTrackingEnabled = typeof window !== 'undefined' 
            ? localStorage.getItem('location_auto_tracking_enabled') !== 'false'
            : true; // Default to true for SSR
          
          // Auto-start tracking when permission changes to granted (if user preference allows)
          if (newState === 'granted' && !trackingEnabled && autoTrackingEnabled) {
            getCurrentLocation()
              .then(() => {
                setTrackingEnabled(true);
              })
              .catch((error) => {
                if (process.env.NODE_ENV === 'development') {
                  console.debug('Location auto-load timeout (expected):', error.message);
                }
                setTrackingEnabled(true);
              });
          } else if (newState !== 'granted' && trackingEnabled) {
            // Stop tracking if permission is revoked
            setTrackingEnabled(false);
          }
        };
      }).catch(() => {
        setLocationPermission('prompt');
      });
    }
  }, [getCurrentLocation, trackingEnabled]);

  // Update center when location is available and trigger initial search
  useEffect(() => {
    if (coords) {
      const newCenter = { lat: coords.latitude, lng: coords.longitude };
      setCenter(newCenter);
      
      let forceReload = false;
      
      // Check if cache needs refresh after cafe registration
      if (typeof window !== 'undefined') {
        const needsRefresh = localStorage.getItem('cafe_cache_needs_refresh');
        if (needsRefresh === 'true') {
          clearCache();
          lastSearchRef.current = null;
          forceReload = true;
          localStorage.removeItem('cafe_cache_needs_refresh');
        }
      }
      
      // Only search if this is a new location or forced reload
      if (forceReload || !lastSearchRef.current ||
          Math.abs(lastSearchRef.current.lat - newCenter.lat) > 0.001 ||
          Math.abs(lastSearchRef.current.lng - newCenter.lng) > 0.001) {

        lastSearchRef.current = newCenter;
        expansionAttemptedRef.current = false;
        trendingFallbackAttemptedRef.current = false;

        // Initial load: 20km radius
        searchCafes({
          lat: newCenter.lat,
          lng: newCenter.lng,
          radius: 20000
        }, forceReload);
      }
    }
  }, [coords, searchCafes, clearCache]);

  // Progressive expansion: if initial 20km search returned < MIN_CAFE_COUNT, expand to 150km (once)
  useEffect(() => {
    // Guard: skip if loading, already attempted, no center, or no initial search done yet
    if (isLoading || expansionAttemptedRef.current || !center || !lastSearchRef.current) return;
    if (allCafes.length < MIN_CAFE_COUNT) {
      expansionAttemptedRef.current = true;
      searchCafes({
        lat: center.lat,
        lng: center.lng,
        radius: EXPANDED_RADIUS
      });
    }
  }, [allCafes.length, isLoading, center, searchCafes]);

  // Trending fallback: if 150km expansion returned 0 cafes, load global trending top 8
  useEffect(() => {
    if (isLoading || !expansionAttemptedRef.current || trendingFallbackAttemptedRef.current) return;
    if (allCafes.length === 0 && !isTrendingFallback) {
      trendingFallbackAttemptedRef.current = true;
      fetchTrendingFallback();
    }
  }, [allCafes.length, isLoading, isTrendingFallback, fetchTrendingFallback]);

  const handleLocationClick = () => {
    // If coords already exist, update center immediately
    if (coords) {
      const newCenter = { lat: coords.latitude, lng: coords.longitude };
      setCenter(newCenter);
      setForceCenterUpdate(true);
      setTimeout(() => setForceCenterUpdate(false), 100);
    }
    
    // Try to get fresh location
    getCurrentLocation(0)
      .then(() => {
        // Location successfully retrieved - center will be updated by useEffect
        setForceCenterUpdate(true);
        setTimeout(() => setForceCenterUpdate(false), 100);
      })
      .catch((error) => {
        // Only show error for critical failures, not timeouts
        // Timeout errors keep previous coords, so location is still available
        if (error.message === 'Location request timeout') {
          // Use cached/previous location - center already updated above if coords exist
          if (process.env.NODE_ENV === 'development') {
            console.debug('Location request timeout, using cached location');
          }
          // If coords exist, center was already updated above
          if (coords) {
            setForceCenterUpdate(true);
            setTimeout(() => setForceCenterUpdate(false), 100);
          }
        } else if (error.message === 'Location permission denied') {
          // Permission denied - don't show error as it's handled elsewhere
          if (process.env.NODE_ENV === 'development') {
            console.debug('Location permission denied');
          }
        } else {
          // Other errors - show notification
          if (process.env.NODE_ENV === 'development') {
            console.debug('Location request failed:', error.message);
          }
          showToast(t('location_error'), 'error');
        }
      });
  };

  const handleRequestPermission = async (): Promise<boolean> => {
    try {
      await getCurrentLocation(0);
      setLocationPermission('granted');
      // Auto-start tracking when permission is granted (if user preference allows)
      const autoTrackingEnabled = typeof window !== 'undefined' 
        ? localStorage.getItem('location_auto_tracking_enabled') !== 'false'
        : true; // Default to true for SSR
      if (autoTrackingEnabled) {
        setTrackingEnabled(true);
      }
      return true;
    } catch (error) {
      setLocationPermission('denied');
      return false;
    }
  };

  // Visit detection hook
  const { isTracking, nearbyStays, startTracking, stopTracking, permissionGranted } = useVisitDetection(
    allCafes,
    () => {},
    {
      enabled: trackingEnabled,
      minStayDuration: 0,
      maxStayDuration: 600000,
      proximityRadius: 50
    }
  );

  const handleCafeClick = useCallback(async (cafe: CafeMapData) => {
    setSelectedCafe(cafe);
    
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafe.id}/view`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      // fetch only rejects on network failure, so a throttled or rejected view
      // looks like success unless the status is checked. 204 = deliberately dropped.
      if (!res.ok || res.status === 204) {
        console.error('Cafe view not recorded:', res.status, cafe.id);
      }
    } catch (error) {
      console.error('Failed to record cafe view:', error);
    }
  }, []);



  const handleRefreshCafes = useCallback(async () => {
    clearCache();
    lastSearchRef.current = null;
    if (center) {
      await searchCafes({
        lat: center.lat,
        lng: center.lng,
        radius: 20000
      }, true);
      showToast(t('cafes_refreshed'), 'success');
    }
  }, [center, clearCache, searchCafes, showToast, t]);

  // Fetched once, the first time the trending filter is switched on.
  useEffect(() => {
    if (!activeFilters.has('trending') || trendingIds || !coords) return;

    let cancelled = false;
    getTrendingCafes(TRENDING_POOL, 0, { lat: coords.latitude, lng: coords.longitude }, 'trending')
      .then((list) => {
        if (!cancelled) setTrendingIds(new Set(list.map((cafe) => cafe.id)));
      })
      .catch(() => {
        if (!cancelled) setTrendingIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilters, trendingIds, coords]);

  const matchesFilter = useCallback((cafe: CafeMapData, filter: MapFilterId) => {
    switch (filter) {
      case 'local':
        return !!coords && calculateDistance(coords.latitude, coords.longitude, cafe.latitude, cafe.longitude) <= LOCAL_RADIUS;
      case 'verified':
        return cafe.status === 'verified';
      case 'sells_beans':
      case 'roasts_on_site':
      case 'filter_coffee':
        // No observation is not a denial, but it is not a promise either, so an
        // unflagged cafe stays out of a filter that claims the trait.
        return cafe.trait_flags?.[filter] === true;
      case 'trending':
        // Before the list arrives nothing is known to be trending, so nothing passes --
        // showing every pin would say "these are all trending", which is worse than a
        // moment of emptiness.
        return !!trendingIds?.has(cafe.id);
    }
  }, [coords, trendingIds]);

  // Conditions narrow together; none set means the map is unfiltered.
  const visibleCafes = allCafes.filter((cafe) =>
    [...activeFilters].every((filter) => matchesFilter(cafe, filter))
  );

  const filterCounts = Object.fromEntries(
    MAP_FILTER_IDS.map((filter) => [filter, allCafes.filter((cafe) => matchesFilter(cafe, filter)).length])
  ) as Record<MapFilterId, number>;

  const toggleFilter = (filter: MapFilterId) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (!next.delete(filter)) next.add(filter);
      return next;
    });
  };

  // Escape closes the card, the way it closed the dialog this replaced.
  useEffect(() => {
    if (!selectedCafe) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCafe(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCafe]);

  const handleSearchSelect = (cafe: CafeMapData) => {
    setCenter({ lat: cafe.latitude, lng: cafe.longitude });
    setForceCenterUpdate(true);
    setTimeout(() => setForceCenterUpdate(false), 100);
    handleCafeClick(cafe);
  };

  return (
    <div className="flex-1 flex flex-col relative">
      {/*
        The masthead carries the words only. The controls that act on the map now live on
        the map, where the thing they change is: a header rail of buttons made the reader
        look away from the map to operate it, and put a lifted pill next to a heading.
      */}
      <div className="mb-3">
        {/*
          Title and controls share the headline's line, so the count no longer holds a
          row of its own and the map gets that height back. The count sits under the
          group it describes.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {mapTitle && <h2 className="text-xl text-ink-primary sm:text-2xl">{mapTitle}</h2>}
          <MapControlGroup
            active={activeFilters}
            onToggle={toggleFilter}
            counts={filterCounts}
            localDisabled={!coords}
            trendingDisabled={!coords}
            onLocate={handleLocationClick}
            onRefresh={handleRefreshCafes}
            refreshDisabled={isLoading}
            onSelectCafe={handleSearchSelect}
          />
        </div>
        {mapSubtitle && <p className="mt-1 text-ink-secondary">{mapSubtitle}</p>}

        <p className="landing-micro mt-2 text-ink-secondary sm:text-right">
          {activeFilters.size > 0
            ? t('cafes_shown', { shown: visibleCafes.length, total: allCafes.length })
            : t('cafes_on_map', { count: allCafes.length })}
          {isTracking && nearbyStays.length > 0 && (
            <span className="ml-2 text-ink-primary">
              · {t('nearby_now', { count: nearbyStays.length })}
            </span>
          )}
        </p>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-[400px]">
        {locationPermission !== 'granted' ? (
          <LocationPermissionOverlay
            onRequestPermission={handleRequestPermission}
            permissionState={locationPermission}
          />
        ) : !center ? (
          <div className="flex h-full items-center justify-center overflow-hidden rounded-(--radius-card) border border-edge-rule bg-surface-raised">
            <div className="text-center">
              <LoadingSpinner size="lg" />
              <p className="text-ink-secondary mt-4 text-sm">{t('loading_location')}</p>
            </div>
          </div>
        ) : (
          <div ref={mapFrameRef} className="relative h-full overflow-hidden rounded-(--radius-card) border border-edge-rule">
            <MapStatusBanner
              message={
                isLoading ? t('loading_cafes')
                : error ? t('search_error')
                : isTrendingFallback ? t('trending_fallback_banner')
                : null
              }
              busy={isLoading}
              onRetry={error && !isLoading ? handleRefreshCafes : undefined}
              retryLabel={t('retry')}
            />
            <InteractiveMap
              cafes={visibleCafes}
              center={center}
              zoom={14}
              userLocation={coords ? { lat: coords.latitude, lng: coords.longitude } : undefined}
              onMarkerClick={handleCafeClick}
              onBoundsChanged={isTrendingFallback ? undefined : handleBoundsChanged}
              forceCenterUpdate={forceCenterUpdate}
              fitToMarkers={isTrendingFallback}
              selectedCafe={selectedCafe}
              onSelectedPointChange={setSelectedPoint}
            />

            {selectedCafe && selectedPoint && isPointInFrame(selectedPoint, mapFrameRef.current) && (
              <div
                ref={setCardNode}
                className="absolute z-(--z-map-modal) w-[340px] max-w-[calc(100%-1.5rem)]"
                style={cardPosition(selectedPoint, mapFrameRef.current, cardHeight)}
              >
                <CafeInfoModal cafe={selectedCafe} onClose={() => setSelectedCafe(null)} />
              </div>
            )}
          </div>
        )}
      </div>



    </div>
  );
}
