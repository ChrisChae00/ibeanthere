'use client';

import { useState, use } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { GrowthIcon, getGrowthLevel } from '@/components/cafe/GrowthIcon';
import { Sprout, Trees, MapPin, ChevronRight, Info, Flame } from 'lucide-react';
import Modal from '@/shared/ui/Modal';
import { LoadingSpinner } from '@/shared/ui';


interface BeanData {
  id: string;
  cafe_id: string;
  cafe_name: string;
  cafe_slug?: string;
  cafe_address?: string;
  latitude: number;
  longitude: number;
  drop_count: number;
  growth_level: number;
  growth_level_name: string;
  first_dropped_at: string;
  last_dropped_at: string;
}

interface UserBeansResponse {
  beans: BeanData[];
  total_count: number;
}

interface StreakData {
  current_streak: number;
  max_streak: number;
  last_drop_date: string | null;
  streak_active: boolean;
}

export default function MyBeansPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = use(props.params);
  const { locale } = params;
  const t = useTranslations('my_beans');
  const tDropBean = useTranslations('drop_bean');
  const { user, isLoading: authLoading } = useAuth();

  const [showLevelModal, setShowLevelModal] = useState(false);

  // Fetcher for SWR
  const fetcher = async (url: string) => {
    const { createClient } = await import('@/shared/lib/supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session?.access_token || ''}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${url}`);
    }

    return response.json();
  };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const { data: beansData, error: beansError, isLoading: beansLoading } = useSWR<UserBeansResponse>(
    user && !authLoading ? `${apiUrl}/api/v1/cafes/user/beans?limit=100` : null,
    fetcher
  );

  const { data: streakData } = useSWR<StreakData>(
    user && !authLoading ? `${apiUrl}/api/v1/users/me/streak` : null,
    fetcher
  );

  const beans = beansData?.beans || [];
  const streak = streakData || null;
  const isLoading = authLoading || (user ? beansLoading : false);
  const error = beansError ? t('error') : null;

  // Calculate stats
  const totalCafes = beans.length;
  const totalDrops = beans.reduce((sum, b) => sum + b.drop_count, 0);
  const maxLevel = beans.length > 0 ? Math.max(...beans.map(b => b.growth_level)) : 0;

  // Group beans by growth level
  const beansByLevel = beans.reduce((acc, bean) => {
    const level = bean.growth_level;
    if (!acc[level]) acc[level] = [];
    acc[level].push(bean);
    return acc;
  }, {} as Record<number, BeanData[]>);

  if (!user && !authLoading) {
    return (
      <main className="min-h-screen bg-surface-page">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
          <div className="space-y-5 py-16 text-center">
            <Trees size={40} className="mx-auto text-ink-secondary" strokeWidth={1.5} />
            <h1 className="text-2xl text-ink-primary">{t('login_required_title')}</h1>
            <p className="mx-auto max-w-md text-ink-secondary">
              {t('login_required_description')}
            </p>
            <Link
              href={`/${locale}/signin`}
              className="btn-shade inline-flex min-h-11 items-center justify-center rounded-(--btn-radius) bg-brand px-8 font-semibold text-ink-on-brand"
            >
              {t('sign_in')}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* Header */}
        <header className="border-b border-edge-rule pb-6">
          <h1 className="text-[clamp(2rem,5vw,3rem)] text-ink-primary">{t('title')}</h1>
          <p className="mt-3 text-ink-secondary">{t('subtitle')}</p>
        </header>

        {/*
          Three counts, divided by the same hairline the page is divided by. They were
          three bordered cards in a gapped row, which made the summary read as heavier
          than the list it summarises -- and stacked a panel inside the page for numbers
          that are one line each.
        */}
        <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-(--radius-card) border border-edge-rule bg-edge-rule">
          <div className="bg-surface-page p-5 text-center">
            <div className="text-3xl text-ink-primary">{totalCafes}</div>
            <div className="landing-micro mt-1 text-ink-secondary">{t('stats.cafes')}</div>
          </div>
          <div className="bg-surface-page p-5 text-center">
            <div className="text-3xl text-ink-primary">{totalDrops}</div>
            <div className="landing-micro mt-1 text-ink-secondary">{t('stats.drops')}</div>
          </div>
          {/* The only one that does anything, so it is the only one that says so. */}
          <button
            onClick={() => setShowLevelModal(true)}
            className="group relative bg-surface-page p-5 text-center hover:bg-surface-hover"
          >
            <Info
              size={14}
              className="absolute right-2 top-2 text-ink-secondary opacity-60 group-hover:opacity-100"
              aria-hidden
            />
            <div className="flex justify-center">
              <GrowthIcon level={maxLevel} size={40} />
            </div>
            <div className="landing-micro mt-1 text-ink-secondary">{t('stats.highest')}</div>
          </button>
        </div>

        {/*
          A streak, stated. It was a raw orange-to-red gradient out of the Tailwind
          palette, which is fixed ink that does not move with the four themes and read
          as the loudest thing on a page whose subject is a quiet record. Live or
          lapsed is now the flame's colour and the word beside it.
        */}
        {streak && streak.current_streak > 0 && (
          <div className="mt-8 rounded-(--radius-card) border border-edge-rule bg-surface-raised p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Flame
                  size={20}
                  strokeWidth={1.5}
                  className={streak.streak_active ? 'text-state-warning' : 'text-ink-secondary'}
                  aria-hidden
                />
                <div>
                  <div className="text-ink-primary">
                    {t('streak.current')}:{' '}
                    {streak.current_streak === 1
                      ? t('streak.day')
                      : t('streak.days', { count: streak.current_streak })}
                  </div>
                  <div className="landing-micro mt-1 text-ink-secondary">
                    {t('streak.best')}:{' '}
                    {streak.max_streak === 1
                      ? t('streak.day')
                      : t('streak.days', { count: streak.max_streak })}
                  </div>
                </div>
              </div>
              {streak.streak_active && (
                <span className="landing-micro text-ink-primary">{t('streak.active')}</span>
              )}
            </div>
            {!streak.streak_active && (
              <p className="mt-3 text-sm text-ink-secondary">{t('streak.info')}</p>
            )}
          </div>
        )}


        {/* Loading State */}
        {isLoading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {/*
          An error says what failed and offers a way on; it does not dress itself as an
          empty shelf. The red here is the theme's danger slot, not `red-50` out of the
          Tailwind palette, which stayed a pale pink on the three dark themes.
        */}
        {error && (
          <div className="mt-8 space-y-4 rounded-(--radius-card) border border-state-danger/40 bg-state-danger/8 p-6 text-center">
            <p className="text-ink-primary">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="control-flat landing-micro min-h-11 rounded-(--radius-pill) border border-edge-rule px-5"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && beans.length === 0 && (
          <div className="mt-8 space-y-5 rounded-(--radius-card) border border-edge-rule bg-surface-raised py-16 text-center">
            <Sprout size={40} className="mx-auto text-ink-secondary" strokeWidth={1.5} />
            <div className="text-2xl text-ink-primary">{t('empty.title')}</div>
            <p className="mx-auto max-w-md px-6 text-ink-secondary">{t('empty.description')}</p>
            <Link
              href={`/${locale}/discover/dropbean`}
              className="btn-shade inline-flex min-h-11 items-center justify-center rounded-(--btn-radius) bg-brand px-8 font-semibold text-ink-on-brand"
            >
              {t('empty.cta')}
            </Link>
          </div>
        )}

        {/* Beans List */}
        {!isLoading && beans.length > 0 && (
          <div className="mt-8 space-y-8">
            {/* Roasted Bean (Level 5) */}
            {beansByLevel[5] && (
              <BeanLevelSection
                level={5}
                beans={beansByLevel[5]}
                locale={locale}
                title={tDropBean('levels.5')}
              />
            )}
            
            {/* Green Bean (Level 4) */}
            {beansByLevel[4] && (
              <BeanLevelSection
                level={4}
                beans={beansByLevel[4]}
                locale={locale}
                title={tDropBean('levels.4')}
              />
            )}
            
            {/* Coffee Cherry (Level 3) */}
            {beansByLevel[3] && (
              <BeanLevelSection
                level={3}
                beans={beansByLevel[3]}
                locale={locale}
                title={tDropBean('levels.3')}
              />
            )}
            
            {/* Coffee Tree (Level 2) */}
            {beansByLevel[2] && (
              <BeanLevelSection
                level={2}
                beans={beansByLevel[2]}
                locale={locale}
                title={tDropBean('levels.2')}
              />
            )}
            
            {/* First Sprout (Level 1) */}
            {beansByLevel[1] && (
              <BeanLevelSection
                level={1}
                beans={beansByLevel[1]}
                locale={locale}
                title={tDropBean('levels.1')}
              />
            )}
          </div>
        )}

        {/* Level Info Modal */}
        <LevelInfoModal
          isOpen={showLevelModal}
          onClose={() => setShowLevelModal(false)}
          currentLevel={maxLevel}
          t={t}
          tDropBean={tDropBean}
        />
      </div>
    </main>
  );
}

function BeanLevelSection({
  level,
  beans,
  locale,
  title,
}: {
  level: number;
  beans: BeanData[];
  locale: string;
  title: string;
}) {
  const t = useTranslations('my_beans');

  /*
    One rule per level and a row per cafe. Each cafe was its own bordered card, so a
    reader with fifteen beans got fifteen boxes and no sense of the grouping the level
    headings were drawing -- and the row count is the thing being read here, not each
    individual entry.
  */
  return (
    <section className="rounded-(--radius-card) border border-edge-rule bg-surface-raised">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <GrowthIcon level={level} size={32} />
          <h2 className="text-xl font-bold text-ink-primary">{title}</h2>
          <span className="landing-micro text-ink-secondary">{beans.length}</span>
        </div>
        {/*
          Ruled in the ink, not the hairline -- the same line that closes a section
          header on the cafe page. Every divider here used to be the same 18% hairline,
          so a level heading landed with no more weight than the gap between two cafes
          under it, and five levels read as one long undifferentiated list.
        */}
        <div className="mb-2 h-px bg-brand" />
        <ul>
          {beans.map((bean) => (
            <li key={bean.id}>
              <Link
                href={`/${locale}/cafes/${bean.cafe_slug || bean.cafe_id}`}
                className="-mx-2 flex items-center justify-between gap-4 rounded-(--radius-control) border-b border-edge-rule px-2 py-4 last:border-0 hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="truncate text-ink-primary">{bean.cafe_name}</div>
                  {bean.cafe_address && (
                    <div className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
                      <MapPin size={12} aria-hidden className="shrink-0" />
                      <span className="truncate">{bean.cafe_address}</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="landing-micro text-ink-secondary">
                    {t('drops_count', { count: bean.drop_count })}
                  </span>
                  <ChevronRight size={16} className="text-ink-secondary" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Level thresholds for display
const LEVEL_DATA = [
  { level: 1, threshold: 1 },
  { level: 2, threshold: 3 },
  { level: 3, threshold: 5 },
  { level: 4, threshold: 10 },
  { level: 5, threshold: 15 },
];

interface LevelInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLevel: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tDropBean: any;
}

function LevelInfoModal({ isOpen, onClose, currentLevel, t, tDropBean }: LevelInfoModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('level_info.title')}
      description={t('level_info.subtitle')}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-secondary">{t('level_info.how_to_level')}</p>

        {/*
          The reader's own level is marked by the one pill on the list, not by tinting
          its whole row: a 10% brand wash behind a row is a lit background rather than
          a chosen state, and it read as "disabled" on the darker themes.
        */}
        <ul>
          {LEVEL_DATA.map(({ level, threshold }) => (
            <li
              key={level}
              className="flex items-center gap-3 border-b border-edge-rule py-3 last:border-0"
            >
              <GrowthIcon level={level} size={36} />
              {/* The pill sits under the name: beside it, it squeezed the name into its own overflow on phones. */}
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1 text-ink-primary">
                {tDropBean(`levels.${level}`)}
                {level === currentLevel && (
                  <span className="landing-micro rounded-(--radius-pill) bg-brand px-2.5 py-1 text-ink-on-brand">
                    {t('level_info.current_highest')}
                  </span>
                )}
              </div>
              <div className="landing-micro shrink-0 text-ink-secondary">
                {t('level_info.drops_required', { count: threshold })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
