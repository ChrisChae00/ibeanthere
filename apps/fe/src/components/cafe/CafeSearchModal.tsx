'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocation } from '@/hooks/useLocation';
import { searchCafes } from '@/lib/api/cafes';
import { calculateDistance } from '@/lib/utils/checkIn';
import { CafeMapData } from '@/types/map';
import { CafeSearchResponse } from '@/types/api';
import { LoadingSpinner } from '@/shared/ui';
import { ErrorAlert } from '@/shared/ui';
import { LocationIcon } from '@/shared/ui';
import { SearchIcon } from '@/shared/ui';
import { Modal, Input, Button } from '@/components/ui';
import { Logo } from '@/shared/ui';

interface CafeSearchModalProps {
  onClose: () => void;
}

export default function CafeSearchModal({ onClose }: CafeSearchModalProps) {
  const t = useTranslations('cafe.log');
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;
  const { coords, getCurrentLocation, isLoading: locationLoading, error: locationError } = useLocation();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [cafes, setCafes] = useState<CafeMapData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (coords) {
      setUserLocation({ lat: coords.latitude, lng: coords.longitude });
    }
  }, [coords]);

  const handleSearchNearby = useCallback(async () => {
    if (!userLocation) {
      try {
        const location = await getCurrentLocation();
        const newLocation = { lat: location.latitude, lng: location.longitude };
        setUserLocation(newLocation);
        await performSearch(newLocation);
      } catch (err) {
        setError(t('location_error'));
      }
    } else {
      await performSearch(userLocation);
    }
  }, [userLocation, getCurrentLocation, t]);

  const performSearch = useCallback(async (location: { lat: number; lng: number }) => {
    setIsLoading(true);
    setError(null);

    try {
      const result: CafeSearchResponse = await searchCafes(location.lat, location.lng, 2000);
      
      const mappedCafes: CafeMapData[] = (result.cafes || []).map((cafe) => ({
        id: cafe.id || '',
        name: cafe.name || '',
        slug: cafe.slug,
        latitude: typeof cafe.latitude === 'string' ? parseFloat(cafe.latitude) : cafe.latitude || 0,
        longitude: typeof cafe.longitude === 'string' ? parseFloat(cafe.longitude) : cafe.longitude || 0,
        rating: cafe.rating ? (typeof cafe.rating === 'string' ? parseFloat(cafe.rating) : cafe.rating) : undefined,
        address: cafe.address || '',
        phoneNumber: cafe.phone,
        website: cafe.website,
        source_url: cafe.source_url,
        businessHours: cafe.business_hours,
        status: cafe.status || 'pending',
        verification_count: cafe.verification_count || 1,
        foundingCrew: cafe.founding_crew
      }));

      setCafes(mappedCafes);
    } catch (err) {
      setError(t('search_error'));
      setCafes([]);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const filteredCafes = useMemo(() => {
    if (!searchQuery.trim()) {
      return cafes;
    }

    const query = searchQuery.toLowerCase();
    return cafes.filter(cafe => 
      cafe.name.toLowerCase().includes(query) ||
      cafe.address.toLowerCase().includes(query)
    );
  }, [cafes, searchQuery]);

  const sortedCafes = useMemo(() => {
    if (!userLocation) {
      return filteredCafes;
    }

    return [...filteredCafes].sort((a, b) => {
      const distanceA = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        a.latitude,
        a.longitude
      );
      const distanceB = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        b.latitude,
        b.longitude
      );
      return distanceA - distanceB;
    });
  }, [filteredCafes, userLocation]);

  const handleCafeSelect = useCallback((cafe: CafeMapData) => {
    const cafePath = cafe.slug || cafe.id;
    router.push(`/${locale}/cafes/${cafePath}/log`);
  }, [router, locale]);

  const getDistance = useCallback((cafe: CafeMapData): number | null => {
    if (!userLocation) return null;
    return calculateDistance(
      userLocation.lat,
      userLocation.lng,
      cafe.latitude,
      cafe.longitude
    );
  }, [userLocation]);

  return (
    <Modal isOpen onClose={onClose} title={t('search_cafe')} size="sm">
      <div className="space-y-4">
          {/* Search Input */}
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            icon={<SearchIcon size={18} className="text-cardTextSecondary" />}
          />

          {/* Search Nearby Button */}
          <Button
            onClick={handleSearchNearby}
            fullWidth
            loading={locationLoading || isLoading}
            leftIcon={<LocationIcon size={20} className="text-primaryText" />}
          >
            {t('search_nearby')}
          </Button>

          {/* Error Messages */}
          {(error || locationError) && (
            <ErrorAlert message={error || t('location_error')} />
          )}

          {!userLocation && !locationLoading && !error && (
            <p className="text-sm text-cardTextSecondary">
              {t('location_permission_required')}
            </p>
          )}

          {/* Results */}
          {isLoading && cafes.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : sortedCafes.length === 0 && cafes.length > 0 ? (
            <div className="text-center py-12">
              <Logo size={48} className="text-cardTextSecondary opacity-50 mx-auto mb-3" />
              <p className="text-cardTextSecondary">
                {t('no_cafes_found')}
              </p>
            </div>
          ) : sortedCafes.length === 0 ? (
            <div className="text-center py-12">
              <Logo size={48} className="text-cardTextSecondary opacity-50 mx-auto mb-3" />
              <p className="text-cardTextSecondary">
                {t('select_cafe_to_write_log')}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {sortedCafes.map((cafe) => {
                const distance = getDistance(cafe);
                return (
                  <button
                    key={cafe.id}
                    onClick={() => handleCafeSelect(cafe)}
                    className="w-full text-left p-4 bg-surface border border-border rounded-lg hover:bg-surface hover:border-primary/30 hover:shadow-xs active:scale-[0.98] transition-all focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-cardText text-base mb-1 line-clamp-1">
                          {cafe.name}
                        </h3>
                        {cafe.address && (
                          <p className="text-sm text-cardTextSecondary line-clamp-2">
                            {cafe.address}
                          </p>
                        )}
                        {cafe.rating && (
                          <div className="flex items-center gap-1 mt-2">
                            <span className="text-accent text-sm">⭐</span>
                            <span className="text-sm text-cardTextSecondary">
                              {cafe.rating.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                      {distance !== null && (
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <div className="flex items-center gap-1">
                            <LocationIcon size={16} className="text-primary" />
                            <span className="text-sm font-medium text-cardText whitespace-nowrap">
                              {Math.round(distance)}m
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </Modal>
  );
}

