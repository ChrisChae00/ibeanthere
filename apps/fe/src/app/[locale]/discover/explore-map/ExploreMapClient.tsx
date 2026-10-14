'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import MapSection from '@/components/map/MapSection';
import Link from 'next/link';
import { getGoogleCafePhoto, getTrendingCafes, searchCafesByText, type TrendingSortBy } from '@/lib/api/cafes';
import { PlusIcon, SearchIcon } from '@/shared/ui';
import { GoogleCafePhoto, TrendingCafeResponse } from '@/types/api';
import { useLocation } from '@/hooks/useLocation';
import { TrendingCafesSection, CafeCard } from '@/components/cafe';
import { CAFE_GRID_ITEMS_PER_PAGE, GOOGLE_PLACE_PHOTO_PER_PAGE_LIMIT, TRENDING_CAFES_COUNT } from '@/lib/constants/cafe';
import { RegisterCafeCTA } from '@/components/cafe/TrendingCafesSection';
import { isOpenNow } from '@/lib/utils/businessHours';

type FilterType = 'all' | 'closest' | 'most_popular';
type GooglePhotoState = GoogleCafePhoto | null | 'loading';

const resolvedGooglePhoto = (photo?: GooglePhotoState) =>
  photo === 'loading' ? undefined : photo;

// Sorting happens on the server: the grid only ever holds the pages fetched so
// far, so sorting client-side would only reorder those and leave later pages
// appended out of order.
const FILTER_SORT: Record<FilterType, TrendingSortBy> = {
  all: 'trending',
  closest: 'distance',
  most_popular: 'popular',
};

interface ExploreMapClientProps {
  locale: string;
  initialCafes: TrendingCafeResponse[];
}

export default function ExploreMapClient({ locale, initialCafes }: ExploreMapClientProps) {
  const t = useTranslations('discover.explore_map');
  const tMap = useTranslations('map');
  const { coords } = useLocation();

  // Panel always shows the trending order, independent of the grid's filter
  const [trendingCafes, setTrendingCafes] = useState<TrendingCafeResponse[]>(
    initialCafes.slice(0, TRENDING_CAFES_COUNT)
  );
  const [cafes, setCafes] = useState<TrendingCafeResponse[]>(initialCafes);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [hasMore, setHasMore] = useState(initialCafes.length === CAFE_GRID_ITEMS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [googlePhotos, setGooglePhotos] = useState<Record<string, GooglePhotoState>>({});
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TrendingCafeResponse[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const requestedGooglePhotos = useRef(new Set<string>());

  const location = useMemo(
    () => (coords ? { lat: coords.latitude, lng: coords.longitude } : undefined),
    [coords]
  );

  useEffect(() => {
    const remaining = GOOGLE_PLACE_PHOTO_PER_PAGE_LIMIT - requestedGooglePhotos.current.size;
    if (remaining <= 0) return;

    const candidates = [...trendingCafes, ...cafes].filter(
      (cafe, index, all) =>
        !cafe.main_image && !cafe.image &&
        !requestedGooglePhotos.current.has(cafe.id) &&
        all.findIndex((item) => item.id === cafe.id) === index
    ).slice(0, remaining);
    if (!candidates.length) return;

    candidates.forEach((cafe) => requestedGooglePhotos.current.add(cafe.id));
    setGooglePhotos((current) => ({
      ...current,
      ...Object.fromEntries(candidates.map((cafe) => [cafe.id, 'loading'])),
    }));
    candidates.forEach((cafe) => {
      getGoogleCafePhoto(cafe.id).then((photo) => {
        setGooglePhotos((current) => ({ ...current, [cafe.id]: photo }));
      });
    });
  }, [trendingCafes, cafes]);

  // Refresh the trending panel once coordinates arrive so it shows local results
  useEffect(() => {
    if (!location) return;

    let cancelled = false;
    getTrendingCafes(TRENDING_CAFES_COUNT, 0, location, 'trending').then((top) => {
      if (!cancelled && top.length > 0) setTrendingCafes(top);
    });

    return () => {
      cancelled = true;
    };
  }, [location]);

  // Load page 1 of the grid whenever the filter or the location changes
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      // The server already rendered page 1 for the default filter without location
      if (!location && activeFilter === 'all') return;
    }

    let cancelled = false;
    setIsLoading(true);

    getTrendingCafes(CAFE_GRID_ITEMS_PER_PAGE, 0, location, FILTER_SORT[activeFilter])
      .then((page) => {
        if (cancelled) return;
        setCafes(page);
        setHasMore(page.length === CAFE_GRID_ITEMS_PER_PAGE);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location, activeFilter]);

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const page = await getTrendingCafes(
        CAFE_GRID_ITEMS_PER_PAGE,
        cafes.length,
        location,
        FILTER_SORT[activeFilter]
      );
      setCafes((prev) => [...prev, ...page]);
      // A short page means the server has nothing left to give
      setHasMore(page.length === CAFE_GRID_ITEMS_PER_PAGE);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleShowLess = () => {
    setCafes((prev) => prev.slice(0, CAFE_GRID_ITEMS_PER_PAGE));
    setHasMore(true);
  };

  /*
    The grid searches every cafe, not the pages it happens to hold: a name the reader
    types is a name they expect to find whether or not it has been paged in yet. An
    active search replaces the grid, so the sort filters and the pager step aside.
  */
  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCafesByText(term, CAFE_GRID_ITEMS_PER_PAGE).then((cafes) => {
        if (cancelled) return;
        setSearchResults(
          cafes.map((cafe) => ({
            id: cafe.id || '',
            slug: cafe.slug,
            name: cafe.name || '',
            address: cafe.address || '',
            latitude: Number(cafe.latitude) || 0,
            longitude: Number(cafe.longitude) || 0,
            status: cafe.status,
            view_count_14d: 0,
            visit_count_14d: 0,
            trending_score: 0,
            main_image: cafe.main_image,
            business_hours: cafe.business_hours,
            timezone: cafe.timezone,
          }))
        );
        setIsSearching(false);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  /*
    'Open now' narrows what is already loaded rather than asking the server: the sorts
    still decide the order, and this only hides the cafes whose door is shut right now.
    A page can come up short of a full row as a result; load more fills it out.
  */
  // ponytail: client-side over loaded pages; move to the trending query if short pages annoy readers
  const loadedCafes = searchResults ?? cafes;
  const gridCafes = openNowOnly
    ? loadedCafes.filter((cafe) => isOpenNow(cafe.business_hours, cafe.timezone))
    : loadedCafes;
  const gridLoading = searchResults ? isSearching : isLoading;

  /*
    Filters carry their state in the fill: the selected one takes the brand, the rest are
    a rule and ink. The page's one filled control is still the register action -- a
    selected filter is a state, not a second primary.
  */
  const filterClass = (filter: FilterType) =>
    `landing-micro min-h-11 rounded-(--radius-pill) px-5 disabled:opacity-50 control-flat ${
      activeFilter === filter ? 'is-active' : ''
    }`;

  return (
    <>
      {/* Main Content Section */}
      <section className="pb-6">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Interactive Map */}
            <MapSection
              locale={locale}
              mapTitle={tMap('map_title')}
              mapSubtitle={tMap('map_subtitle')}
            />

            {/* Top Trending Cafes */}
            <TrendingCafesSection
              cafes={trendingCafes}
              locale={locale}
              isLoading={isLoading && trendingCafes.length === 0}
              googlePhotos={googlePhotos}
            />
          </div>
        </div>
      </section>

      {/* Cafe Grid Section */}
      <section className="py-6">
        <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
          {/*
            The sorts on the left, the two things a reader does with the grid on the
            right: find one cafe, or add the one that is missing. The old "showing N"
            count said nothing the grid was not already showing.
          */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setActiveFilter('all')} className={filterClass('all')}>
                {t('filter_all')}
              </button>
              <button
                onClick={() => setActiveFilter('closest')}
                disabled={!coords}
                title={!coords ? t('no_location') : ''}
                className={filterClass('closest')}
              >
                {t('filter_closest')}
              </button>
              <button
                onClick={() => setActiveFilter('most_popular')}
                className={filterClass('most_popular')}
              >
                {t('filter_most_popular')}
              </button>
              {/* A condition on top of the sort, not a fourth sort, so it toggles on its own. */}
              <button
                onClick={() => setOpenNowOnly((on) => !on)}
                aria-pressed={openNowOnly}
                className={`landing-micro min-h-11 rounded-(--radius-pill) px-5 control-flat ${
                  openNowOnly ? 'is-active' : ''
                }`}
              >
                {t('filter_open_now')}
              </button>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="relative flex items-center">
                <SearchIcon size={16} className="pointer-events-none absolute left-3 text-ink-secondary" />
                <span className="sr-only">{tMap('filters.search')}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tMap('filters.search_placeholder')}
                  className="h-11 w-56 rounded-(--radius-pill) border border-edge-rule bg-surface-raised pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                />
              </label>
              <Link
                href={`/${locale}/discover/register-cafe`}
                className="btn-shade flex min-h-11 items-center gap-2 whitespace-nowrap rounded-(--btn-radius) bg-brand px-5 font-semibold text-ink-on-brand"
              >
                <PlusIcon size={16} />
                {tMap('register_new_cafe')}
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {gridLoading ? (
              Array.from({ length: CAFE_GRID_ITEMS_PER_PAGE }).map((_, index) => (
                <div key={index} className="animate-pulse overflow-hidden rounded-(--radius-card) border border-edge-rule bg-surface">
                  <div className="h-[200px] bg-surface-hover"></div>
                  <div className="space-y-2 p-4">
                    <div className="h-4 rounded-sm bg-surface-hover"></div>
                    <div className="h-3 w-2/3 rounded-sm bg-surface-hover"></div>
                    <div className="mt-3 h-8 w-1/2 rounded-(--radius-pill) bg-surface-hover"></div>
                  </div>
                </div>
              ))
            ) : gridCafes.length === 0 ? (
              <RegisterCafeCTA variant="empty" />
            ) : (
              gridCafes.map((cafe) => (
                <CafeCard
                  key={cafe.id}
                  cafe={cafe}
                  locale={locale}
                  googlePhoto={resolvedGooglePhoto(googlePhotos[cafe.id])}
                  googlePhotoLoading={googlePhotos[cafe.id] === 'loading'}
                  trendingRank={trendingCafes.findIndex((top) => top.id === cafe.id) + 1 || undefined}
                />
              ))
            )}
          </div>
        </div>
      </section>

      {/* Load More Section */}
      {!searchResults && !isLoading && (hasMore || cafes.length > CAFE_GRID_ITEMS_PER_PAGE) ? (
        <section className="py-6">
          <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex gap-4 justify-center">
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="btn-shade min-h-11 rounded-(--btn-radius) bg-brand px-6 font-semibold text-ink-on-brand disabled:opacity-60"
                >
                  {tMap('load_more')}
                </button>
              )}
              {cafes.length > CAFE_GRID_ITEMS_PER_PAGE && (
                <button
                  onClick={handleShowLess}
                  className="control-flat min-h-11 rounded-(--btn-radius) border border-edge-rule px-6 font-medium text-ink-primary"
                >
                  {tMap('show_less')}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
