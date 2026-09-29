'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { registerCafe, searchLocationByPostcode, reverseGeocodeLocation, lookupGoogleMapsUrl } from '@/lib/api/cafes';
import { isAuthError } from '@/lib/api/client';
import { useLocation } from '@/hooks/useLocation';
import { validateInitialDistance } from '@/lib/utils/checkIn';
import { CafeRegistrationRequest } from '@/types/api';
import { BusinessHours } from '@/types/map';
import { ErrorAlert, Button, Input } from '@/components/ui';
import { useToast } from '@/contexts/ToastContext';
import { PhotoUploadWithMain } from '@/shared/ui';
import { useAuth } from '@/hooks/useAuth';
import OpeningHoursInput from './OpeningHoursInput';

interface RegisterCafeFormProps {
  initialLocation?: { lat: number; lng: number };
  userLocation?: { lat: number; lng: number };
  onSuccess?: () => void;
  onCancel?: () => void;
}

type LocationMode = 'current' | 'map' | 'postcode';

const MAX_PHOTOS = 5;

export default function RegisterCafeForm({
  initialLocation,
  userLocation: providedUserLocation,
  onSuccess,
  onCancel
}: RegisterCafeFormProps) {
  const t = useTranslations('cafe.register');
  const tErrors = useTranslations('errors');
  const tTraits = useTranslations('cafe.traits');
  const { showToast } = useToast();
  const { user } = useAuth();
  
  const { coords } = useLocation();
  
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    website: '',
    postcode: '',
    source_url: ''
  });
  
  const [businessHours, setBusinessHours] = useState<BusinessHours | undefined>(undefined);
  
  const [cafeLocation, setCafeLocation] = useState<{ lat: number; lng: number } | null>(
    initialLocation || null
  );
  const [locationMode, setLocationMode] = useState<LocationMode>('current');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchingPostcode, setIsSearchingPostcode] = useState(false);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [error, setError] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [isValidDistance, setIsValidDistance] = useState(false);
  const [addressFetched, setAddressFetched] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [isDetectingCountry, setIsDetectingCountry] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [mainImageIndex, setMainImageIndex] = useState(0);
  const [servesCoffee, setServesCoffee] = useState(false);
  /* undefined means "did not look", which is not the same claim as "no". */
  const [traits, setTraits] = useState<Record<string, boolean | undefined>>({});
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /* Google filled the identity fields; they are its answer until the user drops it. */
  const [lookupApplied, setLookupApplied] = useState(false);
  const lookupCacheRef = useRef<Record<string, import('@/types/api').GooglePlacesLookupResult>>({});
  
  const userLocation = providedUserLocation || (coords ? { lat: coords.latitude, lng: coords.longitude } : null);
  
  // Country options
  const countries = [
    { code: 'ca', name: 'Canada' },
    { code: 'us', name: 'United States' },
    { code: 'gb', name: 'United Kingdom' },
    { code: 'au', name: 'Australia' },
    { code: 'kr', name: 'South Korea' },
    { code: 'jp', name: 'Japan' },
    { code: 'de', name: 'Germany' },
    { code: 'fr', name: 'France' },
    { code: 'es', name: 'Spain' },
    { code: 'it', name: 'Italy' },
    { code: 'nl', name: 'Netherlands' },
    { code: 'be', name: 'Belgium' },
    { code: 'ch', name: 'Switzerland' },
    { code: 'at', name: 'Austria' },
    { code: 'se', name: 'Sweden' },
    { code: 'no', name: 'Norway' },
    { code: 'dk', name: 'Denmark' },
    { code: 'fi', name: 'Finland' },
    { code: 'pl', name: 'Poland' },
    { code: 'pt', name: 'Portugal' },
    { code: 'ie', name: 'Ireland' },
    { code: 'nz', name: 'New Zealand' },
    { code: 'sg', name: 'Singapore' },
    { code: 'my', name: 'Malaysia' },
    { code: 'th', name: 'Thailand' },
    { code: 'id', name: 'Indonesia' },
    { code: 'ph', name: 'Philippines' },
    { code: 'vn', name: 'Vietnam' },
    { code: 'tw', name: 'Taiwan' },
    { code: 'hk', name: 'Hong Kong' },
    { code: 'cn', name: 'China' },
    { code: 'in', name: 'India' },
    { code: 'br', name: 'Brazil' },
    { code: 'mx', name: 'Mexico' }
  ];
  
  // Detect country from user location on mount
  useEffect(() => {
    if (userLocation && !selectedCountry && !isDetectingCountry) {
      setIsDetectingCountry(true);
      reverseGeocodeLocation(userLocation.lat, userLocation.lng)
        .then((result) => {
          if (result?.country_code) {
            setSelectedCountry(result.country_code);
          }
          setIsDetectingCountry(false);
        })
        .catch(() => {
          setIsDetectingCountry(false);
        });
    }
  }, [userLocation, selectedCountry, isDetectingCountry]);
  
  useEffect(() => {
    if (locationMode === 'current' && coords && !cafeLocation) {
      setCafeLocation({ lat: coords.latitude, lng: coords.longitude });
    }
  }, [coords, locationMode, cafeLocation]);
  
  useEffect(() => {
    if (userLocation && cafeLocation) {
      const validation = validateInitialDistance(
        userLocation.lat,
        userLocation.lng,
        cafeLocation.lat,
        cafeLocation.lng,
        100
      );
      setDistance(validation.distance);
      setIsValidDistance(validation.valid);
    } else {
      setDistance(null);
      setIsValidDistance(false);
    }
  }, [userLocation, cafeLocation]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError('');
  };
  
  const handlePostcodeSearch = async () => {
    if (!formData.postcode.trim()) {
      setError(t('postcode_required'));
      return;
    }
    
    setIsSearchingPostcode(true);
    setError('');
    
    try {
      const result = await searchLocationByPostcode(
        formData.postcode,
        userLocation || undefined,
        selectedCountry || undefined
      );
      
      if (result) {
        setCafeLocation({ lat: result.lat, lng: result.lng });
        if (!formData.address) {
          setFormData(prev => ({ ...prev, address: result.display_name }));
        }
        setLocationMode('postcode');
        showToast(t('postcode_search_success'), 'success', 1400);
      } else {
        setError(t('postcode_not_found'));
      }
    } catch (error) {
      console.error('Postcode search error:', error);
      setError(t('postcode_search_failed'));
    } finally {
      setIsSearchingPostcode(false);
    }
  };
  
  /*
    Nominatim's policy forbids a request per keystroke, so the address field searches
    on a press, not while typing. What comes back moves the pin, which is what the
    100 m check reads — a searched address the user is not standing at will fail it,
    and that is the intended answer, not a bug.
  */
  const handleAddressSearch = async () => {
    const query = formData.address.trim();
    if (!query || isSearchingAddress) return;

    setIsSearchingAddress(true);
    setError('');
    try {
      const result = await searchLocationByPostcode(
        query,
        userLocation || undefined,
        selectedCountry || undefined
      );
      if (result) {
        setCafeLocation({ lat: result.lat, lng: result.lng });
        setFormData(prev => ({ ...prev, address: result.display_name || prev.address }));
        setAddressFetched(true);
        setLocationMode('postcode');
        showToast(t('address_search_success'), 'success', 1400);
      } else {
        setError(t('address_search_not_found'));
      }
    } catch (err) {
      console.error('Address search error:', err);
      setError(t('address_search_failed'));
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleGooglePlacesLookup = async () => {
    const trimmedUrl = formData.source_url.trim();
    if (!trimmedUrl) {
      setError(t('google_maps_auto_fill_invalid_url'));
      return;
    }

    // Prevent duplicate concurrent requests
    if (isLookingUp) return;

    // Check cache first — skip API call if same URL was already looked up
    const cached = lookupCacheRef.current[trimmedUrl];
    if (cached) {
      if (cached.success && cached.data) {
        applyLookupData(cached);
        showToast(t('google_maps_auto_fill_success'), 'success', 1400);
      }
      return;
    }

    setIsLookingUp(true);
    setError('');

    try {
      const result = await lookupGoogleMapsUrl(trimmedUrl);

      // Cache the result
      lookupCacheRef.current[trimmedUrl] = result;

      if (result.success && result.data) {
        applyLookupData(result);
        showToast(t('google_maps_auto_fill_success'), 'success');
      } else {
        if (result.error === 'NOT_CONFIGURED') {
          setError(t('google_maps_auto_fill_not_configured'));
        } else if (result.error === 'PLACE_NOT_FOUND') {
          setError(t('google_maps_auto_fill_not_found'));
        } else if (result.error === 'INVALID_URL') {
          setError(t('google_maps_auto_fill_invalid_url'));
        } else {
          setError(t('google_maps_auto_fill_failed'));
        }
      }
    } catch (error) {
      console.error('Google Places lookup error:', error);
      if (isAuthError(error)) {
        setError(tErrors('not_authenticated'));
      } else {
        setError(t('google_maps_auto_fill_failed'));
      }
    } finally {
      setIsLookingUp(false);
    }
  };

  const applyLookupData = (result: import('@/types/api').GooglePlacesLookupResult) => {
    if (!result.data) return;

    setLookupApplied(true);

    setFormData(prev => ({
      ...prev,
      name: result.data!.name || prev.name,
      address: result.data!.address || prev.address,
      phone: result.data!.phone || prev.phone,
      website: result.data!.website || prev.website,
      source_url: result.data!.google_maps_url || prev.source_url,
    }));

    if (result.data.latitude != null && result.data.longitude != null) {
      setCafeLocation({ lat: result.data.latitude, lng: result.data.longitude });
      setAddressFetched(true);
    }

    if (result.data.business_hours && Object.keys(result.data.business_hours).length > 0) {
      setBusinessHours(result.data.business_hours as BusinessHours);
      // Scroll opening hours into view on mobile so user sees the result
      setTimeout(() => {
        document.getElementById('opening-hours-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  };

  /*
    Discarding is a reset, not an unlock: half of Google's answer left in the fields
    with the other half retyped is a record that matches neither source. Uploaded
    photos survive — they are the user's own and already in storage.
  */
  const handleDiscardLookup = () => {
    setLookupApplied(false);
    setFormData({ name: '', address: '', phone: '', website: '', postcode: '', source_url: '' });
    setBusinessHours(undefined);
    setAddressFetched(false);
    setDetailsOpen(false);
    setError('');
    lookupCacheRef.current = {};
    /* Back to where the map put them, which is what the 100 m check reads. */
    setCafeLocation(initialLocation || (coords ? { lat: coords.latitude, lng: coords.longitude } : null));
    setLocationMode(initialLocation ? 'map' : 'current');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    if (!formData.name.trim()) {
      setError(t('name_required'));
      setIsLoading(false);
      return;
    }
    
    if (!cafeLocation) {
      setError(t('location_required'));
      setIsLoading(false);
      return;
    }
    
    if (!userLocation) {
      setError(t('location_permission_required'));
      setIsLoading(false);
      return;
    }
    
    if (!isValidDistance) {
      setError(t('distance_too_far'));
      setIsLoading(false);
      return;
    }

    if (!servesCoffee) {
      setError(t('serves_coffee_required'));
      setIsLoading(false);
      return;
    }
    
    try {
      const requestData: CafeRegistrationRequest = {
        name: formData.name,
        latitude: cafeLocation.lat,
        longitude: cafeLocation.lng,
        address: formData.address || undefined,
        phone: formData.phone || undefined,
        website: formData.website || undefined,
        source_url: formData.source_url || undefined,
        business_hours: businessHours,
        user_location: userLocation,
        serves_coffee: servesCoffee,
        traits: Object.fromEntries(
          Object.entries(traits).filter(([, value]) => value !== undefined)
        ) as Record<string, boolean>,
        source_type: formData.source_url ? 'google_url' : locationMode === 'current' ? 'manual' : locationMode === 'map' ? 'map_click' : 'postcode',
        images: photos.length > 0 ? photos : undefined,
        main_image_index: photos.length > 0 ? mainImageIndex : undefined
      };
      
      const response = await registerCafe(requestData);
      
      if (response.success) {
        if (onSuccess) {
          onSuccess();
        }
      } else {
        if (response.error === 'DUPLICATE_CAFE') {
          setError(t('duplicate_detected'));
        } else if (response.error === 'DISTANCE_TOO_FAR') {
          setError(t('distance_too_far'));
        } else if (response.error === 'NOT_AUTHENTICATED') {
          setError(tErrors('not_authenticated'));
        } else {
          setError(response.message || t('registration_failed'));
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (isAuthError(error)) {
        setError(tErrors('not_authenticated'));
      } else {
        setError(t('registration_failed'));
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    if (initialLocation) {
      setCafeLocation(initialLocation);
      setLocationMode('map');
      setAddressFetched(false);
      
      // Check distance first before auto-filling address
      if (userLocation) {
        const validation = validateInitialDistance(
          userLocation.lat,
          userLocation.lng,
          initialLocation.lat,
          initialLocation.lng,
          100
        );
        
        // Only auto-fill address if distance is valid (within 100m)
        if (validation.valid) {
          // Auto-fill address from coordinates
          reverseGeocodeLocation(initialLocation.lat, initialLocation.lng)
            .then((result) => {
              if (result && result.display_name) {
                setFormData(prev => ({ ...prev, address: result.display_name }));
                setAddressFetched(true);
              }
            })
            .catch((error) => {
              console.error('Error reverse geocoding:', error);
            });
        } else {
          // Distance is too far, don't update address
          setAddressFetched(true);
        }
      } else {
        // No user location, auto-fill address anyway
        reverseGeocodeLocation(initialLocation.lat, initialLocation.lng)
          .then((result) => {
            if (result && result.display_name) {
              setFormData(prev => ({ ...prev, address: result.display_name }));
              setAddressFetched(true);
            }
          })
          .catch((error) => {
            console.error('Error reverse geocoding:', error);
          });
      }
    }
  }, [initialLocation, userLocation]);
  
  useEffect(() => {
    if (locationMode === 'current' && coords && cafeLocation && !addressFetched) {
      // Auto-fill address when using current location
      reverseGeocodeLocation(cafeLocation.lat, cafeLocation.lng)
        .then((result) => {
          if (result && result.display_name) {
            setFormData(prev => ({ ...prev, address: result.display_name }));
            setAddressFetched(true);
          }
        })
        .catch((error) => {
          console.error('Error reverse geocoding:', error);
        });
    }
  }, [locationMode, coords, cafeLocation, addressFetched]);
  
  /* Opened by the lookup when it actually has something to show there. */
  const detailsFilled = Boolean(formData.phone || formData.website || businessHours);

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-6">
        <ErrorAlert message={error} />

        {/*
          The Google link is a tool, not a field: it fills the form below rather than
          being one of its answers, so it sits above the form's own rule.
        */}
        <div className="flex flex-col gap-2">
          <label htmlFor="source_url" className="text-sm font-semibold text-ink-primary">
            {t('quick_fill_label')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="source_url"
              type="url"
              name="source_url"
              value={formData.source_url}
              onChange={handleInputChange}
              placeholder={t('google_maps_url_placeholder')}
              readOnly={lookupApplied}
            />
            {lookupApplied ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscardLookup}
                /* Discarding throws work away, so it is painted as the destructive
                   verb it is. Hover is the outline control's own, unchanged. */
                className="w-full whitespace-nowrap border-state-danger text-state-danger sm:w-auto"
              >
                {t('quick_fill_discard')}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleGooglePlacesLookup}
                disabled={!formData.source_url.trim()}
                loading={isLookingUp}
                className="w-full whitespace-nowrap sm:w-auto"
              >
                {isLookingUp ? t('google_maps_auto_fill_loading') : t('google_maps_auto_fill')}
              </Button>
            )}
          </div>
          {/* Indented to the field's own text, so a hint reads as belonging to it. */}
          <p className="px-4 text-xs text-ink-secondary">
            {lookupApplied ? t('quick_fill_locked') : t('quick_fill_hint')}
          </p>
        </div>

        <div className="border-t border-edge-rule" />

        {/*
          Name and address are the two fields the duplicate check and the map identity
          are built on, so while they are Google's answer they are shown, not edited.
          Editing one of them by hand would produce a row that claims a Google identity
          it no longer matches.
        */}
        <Input
          label={t('name_label')}
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          placeholder={t('name_placeholder')}
          readOnly={lookupApplied}
          required
        />

        <div>
          <label htmlFor="address" className="mb-2 block text-sm font-semibold text-ink-primary">
            {t('address_label')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="address"
              name="address"
              value={formData.address}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddressSearch();
                }
              }}
              placeholder={t('address_placeholder')}
              readOnly={lookupApplied}
            />
            {!lookupApplied && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddressSearch}
                disabled={!formData.address.trim()}
                loading={isSearchingAddress}
                className="w-full whitespace-nowrap sm:w-auto"
              >
                {t('address_search')}
              </Button>
            )}
          </div>
          {formData.address && (
            <p className="mt-2 px-4 text-xs text-ink-secondary">
              {addressFetched ? t('address_auto_filled') : t('address_edit_hint')}
            </p>
          )}

          {/*
            One proximity readout, not two. Distance is what decides whether the form
            can be submitted; GPS accuracy only explains a distance that looks wrong,
            so it is a note under it rather than a badge of its own.
          */}
          {distance !== null && (
            <p
              className={`landing-micro mt-3 px-4 ${isValidDistance ? 'text-state-success' : 'text-state-danger'}`}
            >
              {isValidDistance
                ? t('location_status_ok', { distance: Math.round(distance) })
                : t('location_status_far', { distance: Math.round(distance) })}
            </p>
          )}
          {coords?.accuracy != null && coords.accuracy > 50 && (
            <p className="mt-1 px-4 text-xs text-ink-secondary">
              {t('location_accuracy_note', { accuracy: Math.round(coords.accuracy) })}
            </p>
          )}
        </div>

        {/* Everything a cafe page can live without on the day it is registered. */}
        {/* A rule and a row, not a box: the form is already inside one panel. */}
        <details
          className="group border-t border-edge-rule"
          open={detailsOpen || detailsFilled}
          onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-ink-primary">
            <span>
              {t('details_toggle')}
              <span className="ml-2 font-normal text-ink-secondary">{t('details_hint')}</span>
            </span>
            <ChevronDown size={16} aria-hidden className="shrink-0 text-ink-secondary transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-6 pb-2">
            <Input
              label={t('phone_label')}
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              placeholder={t('phone_placeholder')}
            />
            <Input
              label={t('website_label')}
              type="url"
              name="website"
              value={formData.website}
              onChange={handleInputChange}
              placeholder={t('website_placeholder')}
            />
            <div id="opening-hours-section">
              <OpeningHoursInput value={businessHours} onChange={setBusinessHours} />
            </div>
          </div>
        </details>

        {/* Photos stay in the open: they are the one optional thing worth doing while standing there. */}
        <PhotoUploadWithMain
          photos={photos}
          onChange={setPhotos}
          mainIndex={mainImageIndex}
          onMainIndexChange={setMainImageIndex}
          userId={user?.id || ''}
          maxPhotos={MAX_PHOTOS}
        />

        {/*
          What the registrant can see from where they are standing. They passed the
          100m check to get here, which is the strongest evidence any surface in the
          app collects -- so these apply without review, unlike the same three
          questions asked from a cafe page by someone who may never have visited.

          Three states, and "not sure" is the default. A checkbox would have made
          "unchecked" mean both "no" and "I did not look", and the map filter reads
          these.
        */}
        <fieldset className="space-y-3 border-t border-edge-rule pt-4">
          <legend className="text-sm font-medium text-ink-primary">{t('coffee_traits')}</legend>
          <p className="landing-micro text-ink-secondary">{t('coffee_traits_hint')}</p>
          {(['sells_beans', 'filter_coffee', 'roasts_on_site'] as const).map((trait) => (
            <div key={trait} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm text-ink-primary">{t(`trait_${trait}`)}</span>
              <span className="inline-flex shrink-0 -space-x-px">
                {[true, false].map((value, index) => (
                  <button
                    key={String(value)}
                    type="button"
                    aria-pressed={traits[trait] === value}
                    onClick={() =>
                      setTraits((current) => ({
                        ...current,
                        [trait]: current[trait] === value ? undefined : value,
                      }))
                    }
                    /* `w-16` on both: "Yes" and "No" are different lengths, and a
                       pair that changes size between them reads as two controls. */
                    className={`control-flat min-h-11 w-16 text-sm ${
                      index === 0 ? 'rounded-l-(--radius-pill)' : 'rounded-r-(--radius-pill)'
                    } ${traits[trait] === value ? 'is-active' : ''}`}
                  >
                    {value ? tTraits('yes') : tTraits('no')}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </fieldset>

        {/* Coffee confirmation — the app only lists cafes that serve coffee */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={servesCoffee}
            onChange={(e) => setServesCoffee(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
          />
          <span className="text-sm text-ink-primary">{t('serves_coffee_confirm')}</span>
        </label>

        {/*
          The postcode path cannot pass the 100m check today; it is kept, closed, for
          when registering somewhere you are not becomes allowed.
        */}
        <details className="group border-t border-edge-rule">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm text-ink-secondary">
            <span>{t('postcode_fallback')}</span>
            <ChevronDown size={16} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="pb-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                {/* The arrow is an icon, not a data-URI with a colour baked into it. */}
                <ChevronDown
                  size={14}
                  aria-hidden
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary"
                />
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="h-12 w-full cursor-pointer appearance-none rounded-2xl border border-border bg-cardBackground pl-4 pr-9 text-sm text-cardText sm:w-36"
                  disabled={isDetectingCountry}
                  aria-label={t('country_select')}
                >
                  <option value="">{t('country_select')}</option>
                  {countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                name="postcode"
                value={formData.postcode}
                onChange={handleInputChange}
                placeholder={t('postcode_placeholder')}
              />
              <Button
                type="button"
                onClick={handlePostcodeSearch}
                disabled={!formData.postcode.trim()}
                loading={isSearchingPostcode}
                className="w-full whitespace-nowrap sm:w-auto"
              >
                {t('search_postcode')}
              </Button>
            </div>
          </div>
        </details>

        <div className="flex gap-4 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={isLoading}
            disabled={!isValidDistance || !formData.name.trim() || !servesCoffee}
          >
            {t('submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
