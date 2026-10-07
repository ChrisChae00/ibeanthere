'use client';

import { useState, useCallback, useEffect } from 'react';

interface LocationState {
  coords: GeolocationCoordinates | null;
  error: string | null;
  isLoading: boolean;
}

// Global singleton state for location to share across all hook instances
let globalCoords: GeolocationCoordinates | null = null;
let lastFetchTime: number = 0;
// Reusing a recent fix across reloads keeps mobile browsers from asking for permission on every page
const CACHE_STALE_TIME = 10 * 60 * 1000;
const STORAGE_KEY = 'last_location';
const listeners = new Set<(coords: GeolocationCoordinates | null) => void>();

function updateGlobalCoords(coords: GeolocationCoordinates | null, time = Date.now()) {
  globalCoords = coords;
  lastFetchTime = time;
  listeners.forEach(listener => listener(coords));
}

function saveCoords(coords: GeolocationCoordinates | null) {
  try {
    if (coords) {
      const { latitude, longitude, accuracy } = coords;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude, longitude, accuracy, time: lastFetchTime }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked (private mode); the in-memory cache still works
  }
}

function loadSavedCoords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved.latitude === 'number' && typeof saved.longitude === 'number' && Date.now() - saved.time < CACHE_STALE_TIME) {
      // Only latitude, longitude and accuracy are read anywhere, so the plain object stands in
      updateGlobalCoords(saved as GeolocationCoordinates, saved.time);
    }
  } catch {
    // Unreadable entry; fall through to a fresh fetch
  }
}

export function useLocation() {
  const [location, setLocation] = useState<LocationState>({
    coords: globalCoords,
    error: null,
    isLoading: false
  });

  // Sync with global state changes
  useEffect(() => {
    const listener = (coords: GeolocationCoordinates | null) => {
      setLocation(prev => ({ ...prev, coords }));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Pass maxAge 0 when the user asks for their location, so a tap always gets a fresh fix
  const getCurrentLocation = useCallback(async (maxAge = CACHE_STALE_TIME): Promise<GeolocationCoordinates> => {
    if (!globalCoords) {
      loadSavedCoords();
    }
    if (globalCoords && (Date.now() - lastFetchTime) < maxAge) {
      return globalCoords;
    }

    const fetchLocation = (options: PositionOptions): Promise<GeolocationCoordinates> => {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            // Update global cache and notify all listeners
            updateGlobalCoords(position.coords);
            saveCoords(position.coords);
            
            setLocation(prev => ({
              ...prev,
              error: null,
              isLoading: false
            }));
            resolve(position.coords);
          },
          (error) => {
            reject(error);
          },
          options
        );
      });
    };

    if (!navigator.geolocation) {
      const error = 'Geolocation not supported by your browser';
      setLocation(prev => ({ ...prev, error, isLoading: false }));
      throw new Error(error);
    }

    setLocation(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Try with high accuracy first
      return await fetchLocation({
        enableHighAccuracy: true,
        timeout: 15000, 
        maximumAge: 10000 
      });
    } catch (firstError: unknown) {
      // If timed out or failed, try again with low accuracy
      try {
        // A denial is final; asking again would show iOS users a second prompt
        if (firstError instanceof GeolocationPositionError && firstError.code === firstError.PERMISSION_DENIED) {
          throw firstError;
        }
        return await fetchLocation({
          enableHighAccuracy: false,
          timeout: 15000, 
          maximumAge: 60000 
        });
      } catch (secondError: unknown) {
        let errorMessage = 'Location error';
        let shouldClearCoords = false;

        if (secondError instanceof GeolocationPositionError) {
          switch (secondError.code) {
            case secondError.PERMISSION_DENIED:
              errorMessage = 'Location permission denied';
              shouldClearCoords = true;
              break;
            case secondError.POSITION_UNAVAILABLE:
              errorMessage = 'Location information unavailable';
              break;
            case secondError.TIMEOUT:
              errorMessage = 'Location request timeout';
              break;
          }
        }

        setLocation(prev => ({
          coords: shouldClearCoords ? null : prev.coords,
          error: errorMessage,
          isLoading: false
        }));
        
        if (shouldClearCoords) {
          updateGlobalCoords(null);
          saveCoords(null);
        }
        
        throw new Error(errorMessage);
      }
    }
  }, []);

  return { 
    ...location, 
    getCurrentLocation
  };
}

