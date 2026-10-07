'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import RegisterCafeForm from '@/components/cafe/RegisterCafeForm';
import LocationPermissionOverlay from '@/components/map/LocationPermissionOverlay';
import { LoadingSpinner } from '@/shared/ui';
import { UserLocationIcon } from '@/shared/ui';

const InteractiveMap = dynamic(() => import('@/components/map/InteractiveMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-surface-page">
      <LoadingSpinner size="lg" />
    </div>
  ),
});

export default function RegisterCafePage() {
  const params = useParams();
  const locale = params.locale as string;
  const router = useRouter();
  const t = useTranslations('cafe.register');
  const tMap = useTranslations('map');
  const { user, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const { coords, getCurrentLocation, isLoading: locationLoading, error: locationError } = useLocation();
  
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  
  useEffect(() => {
    if (!authLoading && !user) {
      showToast(t('location_permission_required'), 'warning');
      router.push(`/${locale}/signin`);
    }
  }, [user, authLoading, locale, router, showToast, t]);
  
  useEffect(() => {
    if (coords) {
      setMapCenter({ lat: coords.latitude, lng: coords.longitude });
    } else if (!locationLoading && !locationError) {
      getCurrentLocation().catch(() => {
        // Location request failed, will show default or error state
      });
    }
  }, [coords, locationLoading, locationError, getCurrentLocation]);
  
  const handleMapClick = (location: { lat: number; lng: number }) => {
    setSelectedLocation(location);
  };
  
  const handleReturnToCurrentLocation = () => {
    if (coords) {
      setMapCenter({ lat: coords.latitude, lng: coords.longitude });
      setSelectedLocation(null);
    }
  };
  
  const handleRegistrationSuccess = () => {
    showToast(t('success'), 'success');
    if (typeof window !== 'undefined') {
      localStorage.setItem('cafe_cache_needs_refresh', 'true');
    }
    router.push(`/${locale}/discover/explore-map`);
  };
  
  const handleCancel = () => {
    router.back();
  };
  
  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  
  return (
    <main className="min-h-screen bg-surface-page">
      {/* Masthead, then the rule — the shape every Discover page opens with. */}
      <section className="pt-10 pb-4">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="landing-display text-[clamp(2.5rem,6vw,4.5rem)] text-ink-primary">
            {t('title')}
          </h1>
          <p className="mt-3 text-lg text-ink-secondary">{t('select_on_map_hint')}</p>
        </div>
        <div className="max-w-8xl mx-auto mt-8 px-4 sm:px-6 lg:px-8">
          <div className="border-t border-edge-rule" />
        </div>
      </section>

      <section className="py-6 pb-20">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-2">
            {/*
              The map is the frame and nothing is stacked inside it: its one control —
              recentre on me — sits on the frame's edge, above the picture it changes.
            */}
            <div className="flex min-h-[28rem] flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl text-ink-primary">{tMap('map_title')}</h2>
                {/*
                  The same 44px square the map's own controls are, and the same pin
                  colour, so "me" means one thing across the app. It is not a group
                  because there is only the one verb here.
                */}
                <button
                  onClick={handleReturnToCurrentLocation}
                  aria-label={t('return_to_current_location')}
                  title={t('return_to_current_location')}
                  className="flex h-11 w-11 items-center justify-center rounded-(--radius-pill) border border-edge-rule bg-surface-raised text-ink-primary hover:bg-surface-hover active:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:opacity-60 disabled:hover:bg-surface-raised"
                  disabled={!coords}
                >
                  <UserLocationIcon size={20} color="var(--marker-user)" />
                </button>
              </div>
              {/* A denied prompt never comes back on its own, so show how to allow it in the browser instead */}
              {locationError === 'Location permission denied' ? (
                <div className="min-h-0 flex-1">
                  <LocationPermissionOverlay
                    onRequestPermission={() => getCurrentLocation(0).catch(() => {})}
                    permissionState="denied"
                  />
                </div>
              ) : (
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-(--radius-card) border border-edge-rule">
                  {mapCenter ? (
                    <InteractiveMap
                      cafes={[]}
                      center={mapCenter}
                      zoom={18}
                      userLocation={coords ? { lat: coords.latitude, lng: coords.longitude } : undefined}
                      selectedLocation={selectedLocation || undefined}
                      onMapClick={handleMapClick}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-surface-raised p-8 text-center">
                      <div>
                        <LoadingSpinner size="lg" />
                        <p className="mt-4 text-ink-secondary">
                          {locationLoading ? tMap('loading_location') : tMap('location_permission_title')}
                        </p>
                        {!locationLoading && (
                          <button
                            onClick={() => getCurrentLocation(0).catch(() => {})}
                            className="btn-shade mt-4 min-h-11 rounded-(--btn-radius) bg-brand px-5 font-semibold text-ink-on-brand"
                          >
                            {tMap('share_location')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/*
              The form is framed the way the map is, so the two halves read as one
              spread. Its own heading sits on the same line as the map's, which is what
              keeps the page from looking like a form dropped onto a background.
            */}
            <div className="flex flex-col gap-3">
              <h2 className="flex min-h-11 items-center text-2xl text-ink-primary">
                {t('form_title')}
              </h2>
              <div className="rounded-(--radius-card) border border-edge-rule bg-surface-raised p-6">
                <RegisterCafeForm
                  initialLocation={selectedLocation || undefined}
                  userLocation={coords ? { lat: coords.latitude, lng: coords.longitude } : undefined}
                  onSuccess={handleRegistrationSuccess}
                  onCancel={handleCancel}
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
