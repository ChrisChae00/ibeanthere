import { cache } from 'react';
import { TrendingCafeResponse, CafeSearchResponse, CafeRegistrationRequest, CafeRegistrationResponse, LocationSearchResult, CafeDetailResponse, GooglePlacesLookupResult, GoogleCafePhoto, TraitSummary, TraitSuggestion, CafeBeansResponse } from '@/types/api';
import { API_BASE_URL, getAuthHeaders, handleResponse, apiFetch, ApiError } from './client';

export async function registerCafe(
  data: CafeRegistrationRequest
): Promise<CafeRegistrationResponse> {
  try {
    const headers = await getAuthHeaders();
    
    const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError('Authentication required', 401, 'NOT_AUTHENTICATED');
      }
      if (response.status === 409) {
        const errorData = await response.json();
        return {
          success: false,
          error: 'DUPLICATE_CAFE',
          message: errorData.detail || errorData.message || 'A cafe already exists at this location',
          existingCafe: errorData.cafe
        };
      }
      if (response.status === 400) {
        const errorData = await response.json();
        return {
          success: false,
          error: 'DISTANCE_TOO_FAR',
          message: errorData.detail || errorData.message || 'You must be within 50m of the cafe'
        };
      }
      throw new ApiError('Failed to register cafe', response.status, 'REGISTER_CAFE_FAILED');
    }
    
    const result = await response.json();
    return {
      success: true,
      cafe: result.cafe,
      check_in: result.check_in,
      message: result.message
    };
  } catch (error) {
    console.error('Error registering cafe:', error);
    if (error instanceof ApiError && error.isAuthError) {
      throw error;
    }
    if (error instanceof ApiError) {
      return {
        success: false,
        error: error.code || 'NETWORK_ERROR',
        message: error.message
      };
    }
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: 'Failed to register cafe. Please try again.'
    };
  }
}

export async function lookupGoogleMapsUrl(
  url: string
): Promise<GooglePlacesLookupResult> {
  try {
    const headers = await getAuthHeaders();

    const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/google-places/lookup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError('Authentication required', 401, 'NOT_AUTHENTICATED');
      }
      if (response.status === 501) {
        return { success: false, error: 'NOT_CONFIGURED' };
      }
      if (response.status === 400) {
        return { success: false, error: 'INVALID_URL' };
      }
      if (response.status === 404) {
        return { success: false, error: 'PLACE_NOT_FOUND' };
      }
      return { success: false, error: 'LOOKUP_FAILED' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('Error looking up Google Maps URL:', error);
    if (error instanceof ApiError && error.isAuthError) {
      throw error;
    }
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: 'Failed to look up place information. Please try again.',
    };
  }
}

export async function searchLocationByPostcode(
  postcode: string,
  userLocation?: { lat: number; lng: number },
  countryCode?: string
): Promise<LocationSearchResult | null> {
  try {
    let url = `${API_BASE_URL}/api/v1/cafes/osm/search?q=${encodeURIComponent(postcode)}`;
    
    if (userLocation) {
      url += `&lat=${userLocation.lat}&lng=${userLocation.lng}`;
    }
    
    if (countryCode) {
      url += `&countrycode=${encodeURIComponent(countryCode)}`;
    }
    
    const response = await apiFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return {
      lat: data.lat,
      lng: data.lng,
      display_name: data.display_name
    };
  } catch (error) {
    console.error('Error searching location by postcode:', error);
    return null;
  }
}

export async function reverseGeocodeLocation(
  lat: number,
  lng: number
): Promise<{ display_name: string; country_code?: string } | null> {
  try {
    const url = `${API_BASE_URL}/api/v1/cafes/osm/reverse?lat=${lat}&lng=${lng}`;
    
    const response = await apiFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return {
      display_name: data.display_name || '',
      country_code: data.country_code || undefined
    };
  } catch (error) {
    console.error('Error reverse geocoding location:', error);
    return null;
  }
}

export type TrendingSortBy = 'trending' | 'distance' | 'popular';

export async function getTrendingCafes(
  limit: number = 10,
  offset: number = 0,
  location?: { lat: number; lng: number },
  sortBy: TrendingSortBy = 'trending'
): Promise<TrendingCafeResponse[]> {
  try {
    let url = `${API_BASE_URL}/api/v1/cafes/trending?limit=${limit}&offset=${offset}&sort_by=${sortBy}`;

    if (location) {
      url += `&lat=${location.lat}&lng=${location.lng}&radius=50000`;
    }

    const response = await apiFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 14400, tags: ['trending-cafes'] },
    });

    return await handleResponse<TrendingCafeResponse[]>(response);
  } catch (error) {
    console.error('Error fetching trending cafes:', error);
    return [];
  }
}

export async function getGoogleCafePhoto(cafeId: string): Promise<GoogleCafePhoto | null> {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}/google-photo`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (response.status === 204 || response.status === 429 || response.status === 502) return null;
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function getPendingCafes(): Promise<CafeSearchResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/pending`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  return handleResponse<CafeSearchResponse>(response);
}

async function _getCafeDetail(cafeId: string): Promise<CafeDetailResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 120, tags: ['cafe', `cafe-${cafeId}`] },
  });

  return handleResponse<CafeDetailResponse>(response, { 404: 'CAFE_NOT_FOUND' });
}

// React.cache() memoizes per render cycle — generateMetadata and the page
// component both call this, but only one network request is made per render.
export const getCafeDetail = cache(_getCafeDetail);

export async function searchCafes(
  lat: number,
  lng: number,
  radius: number = 2000
): Promise<CafeSearchResponse> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/v1/cafes/search?lat=${lat}&lng=${lng}&radius=${radius}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }
  );

  return handleResponse<CafeSearchResponse>(response);
}

/**
 * Find cafes by name or address across the whole database, not only the area the map
 * has loaded. Returns an empty list on failure -- the caller is a search box, and a
 * thrown error there would take the map down with it.
 */
export async function searchCafesByText(query: string, limit = 20): Promise<CafeSearchResponse['cafes']> {
  try {
    const response = await apiFetch(
      `${API_BASE_URL}/api/v1/cafes/search/text?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    if (!response.ok) return [];
    const result = await handleResponse<CafeSearchResponse>(response);
    return result.cafes || [];
  } catch (error) {
    console.error('Error searching cafes by text:', error);
    return [];
  }
}

/*
  Coffee traits and the beans seen at a cafe.

  Both are derived from what people have written, and both change the moment
  somebody writes something -- so `no-store`. A cached "sells beans" is a promise
  the shop stopped keeping last month.
*/
export async function getCafeTraits(cafeId: string): Promise<TraitSummary[]> {
  /* Signed out is a normal way to read this page, so the token is optional here --
     the backend uses it only to fill in `mine`, and refuses nothing without it. */
  const headers = await getAuthHeaders(false);
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}/traits`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  return handleResponse<TraitSummary[]>(response);
}

/*
  A claim made from the cafe page is a suggestion, not a change. The server decides
  that, not this call -- there is no status in the body to forge. The summary comes
  back unmoved, which is the honest answer: nothing counts until someone reviews it.

  Two things the server decides from who is calling: an admin's answer is the record
  rather than a request, and only an admin's `evidence` is kept. Sending one from
  anywhere else is not refused, it is dropped.
*/
export async function suggestTraitObservation(
  cafeId: string,
  trait: string,
  value: boolean,
  note?: string,
  observedAt?: string,
  evidence?: string
): Promise<{ submitted: boolean; traits: TraitSummary[] }> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}/traits/${trait}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ value, note, observed_at: observedAt, evidence }),
  });
  return handleResponse<{ submitted: boolean; traits: TraitSummary[] }>(response);
}

export async function clearTraitObservation(cafeId: string, trait: string): Promise<TraitSummary[]> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}/traits/${trait}`, {
    method: 'DELETE',
    headers,
  });
  return handleResponse<TraitSummary[]>(response);
}

export async function getCafeBeans(cafeId: string): Promise<CafeBeansResponse> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/${cafeId}/beans`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  return handleResponse<CafeBeansResponse>(response);
}


/* The admin queue: cafe-page suggestions and researched seed claims -- see
   TraitSuggestionsList. */
export async function getTraitSuggestions(): Promise<TraitSuggestion[]> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(`${API_BASE_URL}/api/v1/cafes/traits/suggestions`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const data = await handleResponse<{ suggestions: TraitSuggestion[] }>(response);
  return data.suggestions;
}

export async function approveTraitSuggestion(suggestionId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(
    `${API_BASE_URL}/api/v1/cafes/traits/suggestions/${suggestionId}/approve`,
    { method: 'POST', headers }
  );
  await handleResponse(response);
}

export async function rejectTraitSuggestion(suggestionId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await apiFetch(
    `${API_BASE_URL}/api/v1/cafes/traits/suggestions/${suggestionId}`,
    { method: 'DELETE', headers }
  );
  await handleResponse(response);
}
