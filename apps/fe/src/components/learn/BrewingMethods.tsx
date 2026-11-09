'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { CoffeeDrink, Locale } from '@/data/coffee/types';
import PourOverAnimation from './PourOverAnimation';
import FrenchPress from './FrenchPress';
import AeroPress from './AeroPress';
import MokaPot from './MokaPot';
import SiphonCoffee from './SiphonCoffee';
import TurkishCoffee from './TurkishCoffee';
import ColdBrew from './ColdBrew';
import styles from './BrewingMethods.module.css';

export default function BrewingMethods({
  drinks,
  locale,
}: {
  drinks: CoffeeDrink[];
  locale: string;
}) {
  const id = useId();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [animationMounted, setAnimationMounted] = useState(false);
  const [animationSlug, setAnimationSlug] = useState<string | null>(null);
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'entering' | 'exiting'>('idle');
  const loc = locale as Locale;

  function selectMethod(slug: string) {
    const nextSlug = selectedSlug === slug ? null : slug;
    setSelectedSlug(nextSlug);

    if (
      nextSlug === 'pour-over' ||
      nextSlug === 'french-press' ||
      nextSlug === 'aeropress' ||
      nextSlug === 'moka-pot' ||
      nextSlug === 'siphon' ||
      nextSlug === 'turkish-coffee' ||
      nextSlug === 'cold-brew'
    ) {
      setAnimationSlug(nextSlug);
      setAnimationMounted(true);
      setAnimationPhase('entering');
    } else if (animationMounted) {
      setAnimationPhase('exiting');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <ul className="w-full max-w-lg space-y-3">
        {drinks.map(drink => {
          const copy = drink.content[loc];
          const isSelected = drink.slug === selectedSlug;

          return (
            <li key={drink.slug} className="rounded-lg border border-edge-rule p-3">
              <button
                type="button"
                aria-expanded={isSelected}
                aria-controls={`${id}-${drink.slug}-content`}
                onClick={() => selectMethod(drink.slug)}
                className="grid w-full cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="text-base font-semibold text-ink-primary sm:text-lg">
                  {copy.name}
                </span>
                <ChevronRight
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-ink-secondary transition-transform ${isSelected ? 'rotate-90' : ''}`}
                />
              </button>
              <div
                id={`${id}-${drink.slug}-content`}
                aria-hidden={!isSelected}
                inert={!isSelected}
                className={`${styles.cardContent} ${isSelected ? styles.cardContentOpen : ''}`}
              >
                <div className={styles.cardContentInner}>
                  <p className="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
                    {copy.line}
                  </p>
                  <Link
                    href={`/${locale}/learn/coffee/${drink.slug}`}
                    className="mt-3 inline-block text-sm font-semibold text-ink-secondary underline underline-offset-4 decoration-edge-rule hover:text-ink-primary hover:decoration-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {locale === 'ko' ? '→ 클릭하여 전체 설명 보기' : '→ Click to view full explanation'}
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        aria-live="polite"
        className="relative flex items-start justify-center lg:min-h-80"
      >
        <div
          aria-hidden={animationMounted}
          className={`${styles.hint} ${animationMounted ? styles.hintHidden : ''} pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex`}
        >
          <p className="px-6 text-center leading-relaxed text-ink-secondary">
            {locale === 'ko'
              ? '각 추출법들을 눌러 애니메이션을 확인하세요.'
              : 'Click each brewing method to see its animation.'}
          </p>
        </div>
        {animationMounted ? (
          <div
            className={`${styles.animation} ${animationPhase === 'entering' ? styles.fadeIn : ''} ${animationPhase === 'exiting' ? styles.fadeOut : ''}`}
            onAnimationEnd={event => {
              if (event.target === event.currentTarget && animationPhase === 'exiting') {
                setAnimationMounted(false);
                setAnimationSlug(null);
                setAnimationPhase('idle');
              } else if (event.target === event.currentTarget && animationPhase === 'entering') {
                setAnimationPhase('idle');
              }
            }}
          >
            {animationSlug === 'pour-over' ? <PourOverAnimation locale={locale} /> : null}
            {animationSlug === 'french-press' ? <FrenchPress locale={locale} /> : null}
            {animationSlug === 'aeropress' ? <AeroPress locale={locale} /> : null}
            {animationSlug === 'moka-pot' ? <MokaPot locale={locale} /> : null}
            {animationSlug === 'siphon' ? <SiphonCoffee locale={locale} /> : null}
            {animationSlug === 'turkish-coffee' ? <TurkishCoffee locale={locale} /> : null}
            {animationSlug === 'cold-brew' ? <ColdBrew locale={locale} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
