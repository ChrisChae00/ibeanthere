'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CoffeeLog } from '@/types/api';
import { Card } from '@/shared/ui';
import dynamic from 'next/dynamic';
import { StarRating } from '@/shared/ui';
import { Avatar } from '@/shared/ui';

const ImageLightbox = dynamic(() => import('@/shared/ui/ImageLightbox'), { ssr: false });
import { useAuth } from '@/hooks/useAuth';
import { getCafeDetail } from '@/lib/api/cafes';
import { getCafePath } from '@/lib/utils/slug';

interface CoffeeLogCardProps {
  log: CoffeeLog;
  onEdit?: (log: CoffeeLog) => void;
  onDelete?: (logId: string) => void;
  cafeName?: string;
  hideCafeName?: boolean;
  hideUserInfo?: boolean;
}

export default function CoffeeLogCard({ log, onEdit, onDelete, cafeName, hideCafeName = false, hideUserInfo = false }: CoffeeLogCardProps) {
  const t = useTranslations('cafe.log');
  const params = useParams();
  const locale = params.locale as string;
  const { user } = useAuth();
  const isOwner = user?.id === log.user_id;
  const [cafe, setCafe] = useState<{ name: string; slug?: string } | null>(
    cafeName ? { name: cafeName } : null
  );
  const [isLoadingCafe, setIsLoadingCafe] = useState(!cafeName);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  
  /*
    Only the taste sliders are foldable now. The workspace block and its two JSON
    parsers are gone with the columns that fed them -- wifi and outlets described a
    place to sit, which is not what this app remembers.
  */
  const TASTE_FIELDS = [
    ['overall_taste', log.overall_taste_rating],
    ['aroma', log.aroma_rating],
    ['acidity', log.acidity_rating],
    ['sweetness', log.sweetness_rating],
    ['bitterness', log.bitterness_rating],
    ['body', log.body_rating],
    ['aftertaste', log.aftertaste_rating],
  ] as const;

  const tasteNotes = TASTE_FIELDS.filter(([, value]) => value !== undefined && value !== null);

  useEffect(() => {
    if (cafeName || !log.cafe_id) {
      if (cafeName) {
        setCafe({ name: cafeName });
        setIsLoadingCafe(false);
      }
      return;
    }

    const fetchCafe = async () => {
      try {
        setIsLoadingCafe(true);
        const cafeData = await getCafeDetail(log.cafe_id);
        setCafe({ name: cafeData.name, slug: cafeData.slug });
      } catch (error) {
        console.error('Failed to fetch cafe:', error);
        setCafe({ name: 'Unknown Cafe' });
      } finally {
        setIsLoadingCafe(false);
      }
    };

    fetchCafe();
  }, [log.cafe_id, cafeName]);

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return t('today');
    } else if (diffDays === 1) {
      return t('yesterday');
    } else if (diffDays < 7) {
      return t('days_ago', { count: diffDays });
    } else {
      return date.toISOString().split('T')[0];
    }
  };

  const cafePath = cafe ? getCafePath({ id: log.cafe_id, slug: cafe.slug }, locale) : null;

  const formatPrice = (price: number | undefined, currency?: string) => {
    if (price === undefined || price === null) return null;
    
    const currencySymbols: Record<string, string> = {
      'USD': '$',
      'KRW': '₩',
      'EUR': '€',
      'JPY': '¥',
      'GBP': '£',
      'CNY': '¥',
      'AUD': '$',
      'CAD': '$'
    };
    
    // If currency is provided, use it
    if (currency && currencySymbols[currency]) {
      return `${currencySymbols[currency]}${price}`;
    }
    
    // If currency is provided but not in our list, use it as-is
    if (currency) {
      return `${currency} ${price}`;
    }
    
    // Default: use browser language to determine currency
    if (typeof window !== 'undefined') {
      const lang = navigator.language || navigator.languages?.[0] || 'en';
      let defaultCurrency = 'USD';
      
      if (lang.startsWith('en-CA')) defaultCurrency = 'CAD';
      else if (lang.startsWith('en-US')) defaultCurrency = 'USD';
      else if (lang.startsWith('ko')) defaultCurrency = 'KRW';
      else if (lang.startsWith('ja')) defaultCurrency = 'JPY';
      else if (lang.startsWith('zh-CN')) defaultCurrency = 'CNY';
      else if (lang.startsWith('en-GB')) defaultCurrency = 'GBP';
      else if (lang.startsWith('en-AU')) defaultCurrency = 'AUD';
      
      return `${currencySymbols[defaultCurrency]}${price}`;
    }
    
    // Fallback: just show the number
    return price.toString();
  };

  return (
    <Card>
      {/* Cafe Name */}
      {!hideCafeName && cafe && (
        <div className="pb-2 border-b border-edge-rule">
          {cafePath ? (
            <Link
              href={cafePath}
              className="text-base font-semibold text-ink-primary hover:text-ink-primary transition-colors"
            >
              {cafe.name}
            </Link>
          ) : (
            <p className="text-base font-semibold text-ink-primary">
              {isLoadingCafe ? 'Loading...' : cafe.name}
            </p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!hideUserInfo && (
            log.anonymous || !log.author_username ? (
              <>
                <Avatar
                  alt={log.anonymous ? 'Anonymous' : (log.author_display_name || 'User')}
                  size="sm"
                />
                <div>
                  <p className="text-sm font-medium text-ink-primary">
                    {log.anonymous ? t('anonymous') : (log.author_display_name || 'User')}
                  </p>
                  <p className="text-xs text-ink-secondary">
                    {formatRelativeDate(log.visited_at)}
                  </p>
                </div>
              </>
            ) : (
              <>
                <Link href={`/${locale}/profile/${log.author_username}`}>
                  <Avatar
                    src={log.author_avatar_url}
                    alt={log.author_display_name || 'User'}
                    size="sm"
                    className="cursor-pointer hover:ring-2 hover:ring-brand transition-all"
                  />
                </Link>
                <div>
                  <Link 
                    href={`/${locale}/profile/${log.author_username}`}
                    className="text-sm font-medium text-ink-primary hover:text-ink-primary transition-colors"
                  >
                    {log.author_display_name || 'User'}
                  </Link>
                  <p className="text-xs text-ink-secondary">
                    {formatRelativeDate(log.visited_at)}
                  </p>
                </div>
              </>
            )
          )}
          {hideUserInfo && (
            <p className="text-xs text-ink-secondary">
              {formatRelativeDate(log.visited_at)}
            </p>
          )}
        </div>        {isOwner && (onEdit || onDelete) && (
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(log)}
                className="text-sm text-ink-primary hover:text-ink-primary hover:underline transition-colors"
              >
                {t('edit')}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(log.id)}
                className="text-sm text-state-danger hover:underline"
              >
                {t('delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Rating & Atmosphere Tags */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Only a purchase says so. Drinking is what almost every log is, and a chip
          on all of them labels the ordinary -- it reads as noise and pushes the
          rating and the tags along. A drink log already looks like one: it has
          stars and a coffee type. What needs saying is the exception.
        */}
        {log.mode === 'purchase' && (
          <span className="landing-micro rounded-(--radius-pill) border border-edge-rule px-2 py-1 text-ink-secondary">
            {t('mode_purchase')}
          </span>
        )}
        {/* No stars at all on a log with no rating: an empty five would read as
            "rated zero", and a purchase is not a bad cup. */}
        {log.rating ? (
          <div className="inline-flex items-center gap-2 px-2 py-1 bg-surface-elevated rounded-lg">
            <StarRating rating={log.rating} size="sm" textColor="surface" />
          </div>
        ) : null}
        {log.want_again !== undefined && log.want_again !== null && (
          <span className="landing-micro text-ink-secondary">
            {t(log.want_again ? 'want_again_yes_label' : 'want_again_no_label')}
          </span>
        )}
        {(() => {
          // Parse atmosphere_tags if it's a string (JSONB from database)
          let tags = log.atmosphere_tags;
          if (typeof tags === 'string') {
            try {
              tags = JSON.parse(tags);
            } catch {
              tags = [];
            }
          }
          if (Array.isArray(tags) && tags.length > 0) {
            return (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block px-2 py-1 text-xs font-medium bg-brand/12 text-ink-primary rounded-full border border-edge-rule"
                  >
                    {t(`atmosphere_${tag}`)}
                  </span>
                ))}
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Photos */}
      {log.photo_urls && log.photo_urls.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {log.photo_urls.map((url, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                setLightboxIndex(index);
                setLightboxOpen(true);
              }}
              className="relative shrink-0 w-[42%] sm:w-40 aspect-square snap-start rounded-lg overflow-hidden cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand"
            >
              <img
                src={url}
                alt={`${t('photo')} ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Coffee Type & Price */}
      {(log.coffee_type || log.price) && (
        <div className="flex items-center gap-3 mb-3">
          {log.coffee_type && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand text-ink-on-brand rounded-lg">
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 142 96" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0"
              >
                <path d="M27.15 88.25 c-3.50 -1.50 -4.10 -6.45 -1.10 -8.95 l1.55 -1.30 45.45 0 c48.90 0 47.60 -0.05 48.95 2.45 1 1.95 0.60 4.90 -0.95 6.65 l-1.45 1.65 -45.45 0.10 c-38.30 0.10 -45.65 0 -47 -0.60z" fill="currentColor"/>
                <path d="M53.65 72 c-4.05 -0.85 -8.30 -3.65 -10.40 -7 -2.60 -4.15 -2.75 -5.55 -2.75 -27.80 0 -12.20 0.20 -21.15 0.50 -21.90 0.25 -0.70 1.20 -1.75 2.10 -2.30 1.60 -0.95 2.55 -1 35.40 -1 19 0 35 0.20 36.65 0.50 16.30 2.65 23.90 21.55 13.90 34.65 -4.25 5.60 -9.45 8.15 -17.70 8.75 l-5.10 0.35 -0.35 2.40 c-0.90 6.50 -6.45 12.10 -13.10 13.30 -3.50 0.65 -35.95 0.65 -39.15 0.05z m61.05 -27.55 c4.70 -1.20 7.80 -5.45 7.80 -10.80 0 -6.30 -5.05 -10.65 -12.30 -10.65 l-3.65 0 -0.15 10.80 c-0.10 5.95 -0.05 10.90 0.05 11 0.45 0.40 6.20 0.20 8.25 -0.35z" fill="currentColor"/>
              </svg>
              {log.coffee_type}
            </span>
          )}
          {log.price !== undefined && log.price !== null && (
            <span className="text-sm font-medium text-ink-primary">
              {formatPrice(log.price, log.price_currency) ?? log.price}
            </span>
          )}
        </div>
      )}

      {/* Which bean. The catalogue name when the reader linked one, otherwise what
          they wrote off the bag -- a smaller claim, still worth showing. */}
      {(log.bean || log.bean_name_raw) && (
        <div className="mb-3 text-sm text-ink-primary">
          {log.bean
            ? `${log.bean.name}${log.bean.roaster_name ? ` · ${log.bean.roaster_name}` : ''}`
            : log.bean_name_raw}
        </div>
      )}

      {/* Dessert */}
      {log.dessert && (
        <div className="mb-3">
          <span className="text-xs text-ink-secondary">
            {t('dessert')}: {log.dessert}
          </span>
        </div>
      )}

      {/* Comment */}
      {log.comment && (
        <div className="mb-4 p-3 bg-surface-elevated rounded-lg border border-edge-rule">
          <p className="text-sm text-ink-primary whitespace-pre-wrap">
            {log.comment}
          </p>
        </div>
      )}

      {tasteNotes.length > 0 && (
        <div className="mt-4 border-t border-edge-rule pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            aria-expanded={showAdvanced}
          >
            <span>{t('tasting_notes')}</span>
            <svg
              className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAdvanced && (
            <dl className="mt-4 space-y-1 pl-2 text-sm text-ink-secondary">
              {tasteNotes.map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt>{t(key)}</dt>
                  <dd className="text-ink-primary">{value}/10</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* Photo Lightbox */}
      {log.photo_urls && log.photo_urls.length > 0 && (
        <ImageLightbox
          images={log.photo_urls.map((url, index) => ({
            url,
            alt: `${t('photo')} ${index + 1}`
          }))}
          initialIndex={lightboxIndex}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </Card>
  );
}


