'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from '@/hooks/useLocation';
import { useToast } from '@/contexts/ToastContext';
import CoffeeBean from '@/shared/ui/CoffeeBean';
import LoadingSpinner from '@/shared/ui/LoadingSpinner';

import confetti from 'canvas-confetti';

// What `cafes.py` enforces on the way in; the copy names it too.
const DROP_RADIUS_M = 50;

interface DropBeanButtonProps {
  cafeId: string;
  cafeLat: number;
  cafeLng: number;
  initialBeanStatus?: {
    has_bean: boolean;
    drop_count: number;
    growth_level: number;
    growth_level_name: string | null;
    can_drop_today: boolean;
    next_level_at: number | null;
  };
  onSuccess?: (result: DropBeanResult) => void;
  size?: 'sm' | 'md' | 'lg';
  showGrowthInfo?: boolean;
}

interface DropBeanResult {
  message: string;
  cafe_id: string;
  cafe_name: string;
  drop_count: number;
  growth_level: number;
  growth_level_name: string;
  leveled_up: boolean;
  next_level_at: number | null;
}

export default function DropBeanButton({
  cafeId,
  cafeLat,
  cafeLng,
  initialBeanStatus,
  onSuccess,
  size = 'md',
  showGrowthInfo = true
}: DropBeanButtonProps) {
  const t = useTranslations('drop_bean');
  const { user } = useAuth();
  const { showToast } = useToast();
  const { getCurrentLocation, isLoading: locationLoading, error: locationError } = useLocation();
  
  const [isLoading, setIsLoading] = useState(false);
  const [beanStatus, setBeanStatus] = useState(initialBeanStatus);

  // Calculate distance to cafe
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const triggerConfetti = (leveledUp: boolean = false) => {
    if (leveledUp) {
      // Special level-up celebration - bigger and more colorful!
      const duration = 2500;
      const animationEnd = Date.now() + duration;
      const colors = ['#FFD700', '#FFA500', '#8B4513', '#32CD32', '#FF6347'];

      // Fire confetti from multiple angles
      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          clearInterval(interval);
          return;
        }

        // Star burst from center
        confetti({
          particleCount: 3,
          angle: randomInRange(55, 125),
          spread: randomInRange(50, 70),
          origin: { y: 0.6 },
          colors: colors,
          shapes: ['star', 'circle'],
          scalar: randomInRange(0.8, 1.2),
        });

        // Side bursts
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.7 },
          colors: ['#FFD700', '#FFA500'],
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.7 },
          colors: ['#FFD700', '#FFA500'],
        });
      }, 50);

      // Initial big burst
      confetti({
        particleCount: 100,
        spread: 100,
        origin: { y: 0.6 },
        colors: colors,
        shapes: ['star', 'circle'],
        scalar: 1.2,
      });
    } else {
      // Normal drop celebration
      const end = Date.now() + 1000;

      const frame = () => {
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#8B4513', '#D2691E', '#CD853F'] // Coffee colors
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#8B4513', '#D2691E', '#CD853F']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
  };

  const handleDropBean = async () => {
    if (!user) {
      showToast(t('login_required'), 'error');
      return;
    }

    setIsLoading(true);

    try {
      // The 50m check needs where the user is now, not a fix saved minutes ago
      const position = await getCurrentLocation(30_000);
      const userLat = position.latitude;
      const userLng = position.longitude;

      /*
        The same 50m the server enforces, not a roomier client gate. A wider one
        only bought the reader a round trip that comes back as the API's own
        English sentence; refusing here says the distance in their language.
      */
      const distance = calculateDistance(userLat, userLng, cafeLat, cafeLng);
      if (distance > DROP_RADIUS_M) {
        showToast(t('too_far', { distance: Math.round(distance) }), 'error');
        setIsLoading(false);
        return;
      }

      // Call API
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(
        `${apiUrl}/api/v1/cafes/${cafeId}/drop-bean?user_lat=${userLat}&user_lng=${userLng}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        /*
          Every branch answers in the reader's language. `data.detail` is written for
          a developer reading a log, in English whatever the locale -- it goes to the
          console, not to a toast.
        */
        const data = await response.json().catch(() => null);
        console.error('Drop bean rejected:', response.status, data);
        if (response.status === 409) {
          showToast(t('already_today'), 'error');
        } else if (response.status === 400) {
          /*
            No distance in this one. The number we hold already passed the gate
            above, so printing it here would read "Too far (43m away, must be
            within 50m)" whenever the server measures from a pin this page has
            not seen move.
          */
          showToast(t('too_far_server'), 'error');
        } else {
          showToast(t('error'), 'error');
        }
        setIsLoading(false);
        return;
      }

      const result: DropBeanResult = await response.json();
      setBeanStatus({
        has_bean: true,
        drop_count: result.drop_count,
        growth_level: result.growth_level,
        growth_level_name: result.growth_level_name,
        can_drop_today: false,
        next_level_at: result.next_level_at
      });
      
      triggerConfetti(result.leveled_up);
      
      // Show toast notification
      if (result.leveled_up) {
        // The stage's own name, not the server's: `growth_level_name` comes back in
        // English whatever locale asked for it.
        const levelName = t(`levels.${result.growth_level}`);
        showToast(`🎉 ${t('level_up_title')} ${t('level_up', { level: levelName })}`, 'success', 4000);
      } else {
        showToast(`☕ ${t('success')}`, 'success', 2000);
      }

      if (onSuccess) {
        onSuccess(result);
      }

    } catch (err: any) {
      console.error('Error dropping bean:', err);
      const errorMessage = err.message || locationError || t('error');
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getAccessToken = async (): Promise<string> => {
    const { createClient } = await import('@/shared/lib/supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  };

  const canDrop = !beanStatus || beanStatus.can_drop_today;
  const growthLevel = beanStatus?.growth_level || 0;
  const dropCount = beanStatus?.drop_count || 0;
  const nextLevelAt = beanStatus?.next_level_at;

  return (
    <div className="relative flex flex-col items-center gap-2">
      {showGrowthInfo && beanStatus?.has_bean && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-medium text-ink-secondary">
            {t('drops', { count: dropCount })}
          </span>
        </div>
      )}
      
      {/*
        The label slides out and the bean rides in behind it, while the dot the
        label sat beside grows into the fill. It is one gesture read two ways: the
        bean is the thing being dropped, and the button fills the way a cup does.

        Written here rather than pulled from a variant, because the whole point is
        the two stacked layers -- a `variant` prop cannot express a control whose
        content moves.
      */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleDropBean();
        }}
        disabled={!canDrop || isLoading || locationLoading}
        className={`group relative overflow-hidden whitespace-nowrap rounded-(--btn-radius) border border-brand bg-surface-raised font-semibold text-ink-primary disabled:cursor-not-allowed disabled:opacity-60 ${
          size === 'sm' ? 'h-(--btn-height-sm) px-5 text-sm' : 'h-(--btn-height-md) px-6'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          {isLoading || locationLoading ? (
            <LoadingSpinner size="sm" />
          ) : (
            /*
              `scale-[100]` on a 8px dot covers any button this system builds; the
              growth is what paints the fill, so there is no colour transition to
              keep in sync with it.
            */
            <span className="size-2 rounded-full bg-brand transition-transform duration-300 ease-out group-hover:scale-[100] group-disabled:scale-100" />
          )}
          <span className="inline-block transition-all duration-300 group-hover:translate-x-10 group-hover:opacity-0 group-disabled:translate-x-0 group-disabled:opacity-100">
            {canDrop ? t('button') : t('already_today')}
          </span>
        </span>

        <span className="absolute inset-0 z-10 flex translate-x-10 items-center justify-center gap-2 text-ink-on-brand opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-disabled:opacity-0">
          <span>{canDrop ? t('button') : t('already_today')}</span>
          <CoffeeBean size="inherit" className="size-4" />
        </span>
      </button>

      {!canDrop && showGrowthInfo && nextLevelAt && (
        <div className="text-[10px] text-ink-secondary text-center mt-0.5 opacity-80">
          {t('next_level', { drops: nextLevelAt - dropCount })}
        </div>
      )}
    </div>
  );
}
