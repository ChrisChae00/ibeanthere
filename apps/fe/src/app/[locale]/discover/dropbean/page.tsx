'use client';

import { useEffect, useState, use } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/hooks/useAuth';
import { searchCafes } from '@/lib/api/cafes';
import { CafeMapData } from '@/types/map';
import { calculateDistance } from '@/lib/utils/checkIn';
import { DropBeanButton } from '@/components/cafe';
import { Button, LoadingSpinner, LocationIcon } from '@/shared/ui';

const NEARBY_RADIUS_METERS = 50;

export default function NearbyPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = use(props.params);
  const { locale } = params;
  const t = useTranslations('dropbean');
  const { user } = useAuth();
  const { coords, getCurrentLocation, isLoading: locationLoading, error: locationError } = useLocation();

  const [cafes, setCafes] = useState<(CafeMapData & { distance: number })[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);

  const fetchNearbyCafes = async (lat: number, lng: number) => {
    setIsLoading(true);
    setError(null);

    try {
      // Search cafes within 500m first, then filter to 50m client-side
      const result = await searchCafes(lat, lng, 500);

      // Calculate distance to each cafe and filter to 50m
      const cafesWithDistance = (result.cafes || [])
        .map((cafe: CafeMapData) => ({
          ...cafe,
          distance: calculateDistance(
            lat, lng,
            parseFloat(String(cafe.latitude)),
            parseFloat(String(cafe.longitude))
          )
        }))
        .filter((cafe: CafeMapData & { distance: number }) => cafe.distance <= NEARBY_RADIUS_METERS)
        .sort((a: CafeMapData & { distance: number }, b: CafeMapData & { distance: number }) => a.distance - b.distance);

      setCafes(cafesWithDistance);
    } catch (err) {
      console.error('Failed to fetch nearby cafes:', err);
      setError('Failed to fetch nearby cafes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnableLocation = async () => {
    setLocationRequested(true);
    try {
      const position = await getCurrentLocation();
      await fetchNearbyCafes(position.latitude, position.longitude);
    } catch (err) {
      console.error('Location error:', err);
    }
  };

  // Auto-fetch location if permission is already granted
  useEffect(() => {
    const checkPermissionAndFetch = async () => {
      if (typeof navigator !== 'undefined' && navigator.permissions) {
        try {
          const permission = await navigator.permissions.query({ name: 'geolocation' });
          if (permission.state === 'granted' && !locationRequested) {
            // Permission already granted, auto-fetch location
            handleEnableLocation();
          }
        } catch (err) {
          // Permissions API not supported, wait for coords from hook
          console.log('Permissions API not supported');
        }
      }
    };

    checkPermissionAndFetch();
  }, []);

  useEffect(() => {
    if (coords && !locationRequested) {
      setLocationRequested(true);
      fetchNearbyCafes(coords.latitude, coords.longitude);
    }
  }, [coords]);

  /*
    Every state on this page is one framed panel with a mark, a line and a way out --
    the same shape, so switching between them does not move the page around.
  */
  const Notice = ({
    heading,
    line,
    children
  }: {
    heading: string;
    line: string;
    children?: React.ReactNode;
  }) => (
    <div className="rounded-(--radius-card) border border-edge-rule bg-surface-raised p-8 text-center">
      <h2 className="text-xl text-ink-primary">{heading}</h2>
      <p className="mt-2 text-ink-secondary">{line}</p>
      {children && <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">{children}</div>}
    </div>
  );

  return (
    <main className="min-h-screen bg-surface-page">
      {/* Masthead, then the rule -- the shape every Discover page opens with. */}
      <section className="pt-10 pb-4">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="landing-display text-[clamp(2.5rem,6vw,4.5rem)] text-ink-primary">
                {t('title')}
              </h1>
              <p className="mt-3 text-lg text-ink-secondary">
                {t('subtitle')}
              </p>
            </div>
            <Link
              href={`/${locale}/discover/explore-map`}
              className="control-flat flex min-h-11 items-center gap-2 self-start whitespace-nowrap rounded-(--btn-radius) border border-edge-rule px-6 font-semibold text-ink-primary md:self-auto"
            >
              {t('view_cafe_map')}
            </Link>
          </div>
        </div>
        <div className="max-w-8xl mx-auto mt-8 px-4 sm:px-6 lg:px-8">
          <div className="border-t border-edge-rule" />
        </div>
      </section>

      <section className="py-6 pb-20">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-(--radius-card) border border-edge-rule bg-surface-raised px-5 py-4">
              <p className="text-sm text-ink-primary">{t('load_error')}</p>
              <button
                onClick={() => coords && fetchNearbyCafes(coords.latitude, coords.longitude)}
                className="control-flat min-h-11 rounded-(--btn-radius) border border-edge-rule px-4 text-sm font-medium text-ink-primary"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {/* Location permission required */}
          {!coords && !locationLoading && !locationRequested && (
            <Notice
              heading={t('location_required')}
              line={t('enable_location_hint')}
            >
              <Button
                onClick={handleEnableLocation}
                leftIcon={<LocationIcon size={20} />}
                loading={locationLoading}
              >
                {t('enable_location')}
              </Button>
            </Notice>
          )}

          {/* Looking */}
          {(isLoading || locationLoading) && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <LoadingSpinner size="lg" />
              <p className="text-ink-secondary">{t('loading')}</p>
            </div>
          )}

          {/* Nothing in range */}
          {!isLoading && !locationLoading && locationRequested && cafes.length === 0 && (
            <Notice
              heading={t('no_cafes')}
              line={t('no_cafes_hint')}
            >
              <Link
                href={`/${locale}/discover/register-cafe`}
                className="btn-shade inline-flex min-h-11 items-center justify-center rounded-(--btn-radius) bg-brand px-6 font-semibold text-ink-on-brand"
              >
                {t('register_new_cafe')}
              </Link>
              {coords && (
                <button
                  onClick={() => fetchNearbyCafes(coords.latitude, coords.longitude)}
                  className="control-flat inline-flex min-h-11 items-center justify-center rounded-(--btn-radius) border border-edge-rule px-6 font-medium text-ink-primary"
                >
                  {t('refresh')}
                </button>
              )}
            </Notice>
          )}

          {/* What is in range, nearest first */}
          {!isLoading && cafes.length > 0 && (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-2xl text-ink-primary">{t('cafes_within_50m')}</h2>
                  <span className="landing-micro text-ink-secondary">
                    {t('cafe_count', { count: cafes.length })}
                  </span>
                </div>
                {coords && (
                  <button
                    onClick={() => fetchNearbyCafes(coords.latitude, coords.longitude)}
                    className="control-flat min-h-11 rounded-(--btn-radius) border border-edge-rule px-4 text-sm font-medium text-ink-primary"
                  >
                    {t('refresh')}
                  </button>
                )}
              </div>

              {/*
                A list, not a grid of cards: the page's subject is how close each cafe
                is, and a single column keeps that ordering readable. The gap is the
                hairline -- `gap-px` over `bg-edge-subtle` -- so each row is a plate in
                one frame rather than a panel of its own.
              */}
              <ul className="flex flex-col gap-px overflow-hidden rounded-(--radius-card) border border-edge-rule bg-edge-subtle">
                {cafes.map((cafe) => (
                  <li
                    key={cafe.id}
                    className="flex flex-col gap-4 bg-surface-raised px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <div className="min-w-0">
                      {/* Distance first: it is what decides whether the action below is even allowed. */}
                      <p className="landing-micro text-ink-secondary">
                        {t('m_away', { distance: Math.round(cafe.distance) })}
                        {cafe.status === 'verified' && (
                          <>
                            <span aria-hidden className="px-2">·</span>
                            {t('verified')}
                          </>
                        )}
                      </p>
                      {/* A cafe's name is data, not a headline: body face, not the display serif. */}
                      <h3 className="mt-2 font-sans text-lg font-semibold leading-snug text-ink-primary">
                        <Link
                          href={`/${locale}/cafes/${cafe.slug || cafe.id}`}
                          className="line-clamp-1 transition-colors hover:text-brand"
                        >
                          {cafe.name}
                        </Link>
                      </h3>
                      {cafe.address && (
                        <p className="mt-1 line-clamp-1 text-sm text-ink-secondary" title={cafe.address}>
                          {cafe.address}
                        </p>
                      )}
                    </div>

                    {/*
                      Two ways to record the same visit, and they are not equals. Dropping
                      a bean is what this page is for, so it keeps the filled button; a
                      log is the longer version of the same answer and sits beside it as a
                      rule. Writing one already drops the bean, which is why the line
                      underneath says so -- a reader who does not know that does both, and
                      the second press is the one that feels broken.
                    */}
                    <div className="shrink-0 sm:pl-2">
                      {user ? (
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <div className="flex items-center gap-2">
                            <DropBeanButton
                              cafeId={cafe.id}
                              cafeLat={parseFloat(String(cafe.latitude))}
                              cafeLng={parseFloat(String(cafe.longitude))}
                              size="sm"
                              showGrowthInfo={false}
                            />
                            <Link
                              href={`/${locale}/cafes/${cafe.slug || cafe.id}/log`}
                              className="control-flat flex h-(--btn-height-sm) items-center justify-center rounded-(--btn-radius) px-4 text-sm font-medium"
                            >
                              {t('write_log')}
                            </Link>
                          </div>
                          <p className="landing-micro text-ink-secondary">{t('log_drops_bean')}</p>
                        </div>
                      ) : (
                        <Link
                          href={`/${locale}/signin`}
                          className="btn-shade flex h-(--btn-height-sm) items-center justify-center rounded-(--btn-radius) bg-brand px-5 text-sm font-semibold text-ink-on-brand"
                        >
                          {t('sign_in_to_drop')}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
