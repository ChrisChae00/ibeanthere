import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/data/coffee/types';
import { getAllCategories, getAllDrinks, getDrinkBySlug, getDrinksByCategory, getLastReviewed } from '@/data/coffee';
import { datedEvents, milkRows, milkSources } from '@/data/coffee/guide';
import MapPrompt from './MapPrompt';
import BrewingMethods from './BrewingMethods';
import { DrinkList, SourceNote, TEXT_LINK, formatDay } from './GuideParts';

const H2 = 'font-display text-3xl leading-tight text-ink-primary sm:text-4xl';

export default async function CoffeeGuide({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'learn.coffee' });
  const loc = locale as Locale;
  const categories = getAllCategories();
  const nameOf = (slug: string) => getDrinkBySlug(slug)?.content[loc].name ?? slug;
  const drinkHref = (slug: string) => `/${locale}/learn/coffee/${slug}`;

  return (
    <div className="paper-grain mx-auto max-w-6xl break-keep px-4 pb-20 sm:px-6 lg:px-8">
      <header className="pb-10 pt-10 sm:pt-14">
        <h1 className="landing-display max-w-[16ch] text-[clamp(2.75rem,7vw,5.5rem)] text-ink-primary">
          {t('title')}
        </h1>
        <p className="mt-6 max-w-[62ch] text-lg leading-relaxed text-ink-secondary">
          {t('lede', { count: getAllDrinks().length })}
        </p>
        <p className="landing-micro mt-8 text-ink-secondary">{t('startLabel')}</p>
        <ul className="mt-3 flex flex-col gap-3 sm:flex-row sm:gap-10">
          {[
            ['espresso', t('startEspresso')],
            ['pour-over', t('startPourOver')],
          ].map(([slug, label]) => (
            <li key={slug}>
              <Link href={drinkHref(slug)} className={`${TEXT_LINK} inline-flex items-center gap-2 font-semibold`}>
                {label}
                <ArrowRight aria-hidden className="h-4 w-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </header>

      {categories.map(category => {
        const copy = category.content[loc];
        const isBrewing = category.id === 'brewing';
        return (
          <section
            key={category.id}
            id={category.id}
            aria-labelledby={`${category.id}-heading`}
            className={`scroll-mt-[calc(var(--nav-h)+2rem)] border-t border-edge-rule pt-10 pb-14 ${isBrewing ? '' : 'lg:grid lg:grid-cols-2 lg:gap-x-16'}`}
          >
            <div className={isBrewing ? 'mb-6' : 'mb-6 lg:mb-0'}>
              <h2 id={`${category.id}-heading`} className={H2}>
                {copy.name}
              </h2>
              <p className="mt-3 max-w-[40ch] leading-relaxed text-ink-secondary">{copy.definition}</p>
            </div>
            {isBrewing ? (
              <BrewingMethods drinks={getDrinksByCategory(category.id)} locale={locale} />
            ) : (
              <DrinkList drinks={getDrinksByCategory(category.id)} locale={locale} />
            )}
          </section>
        );
      })}

      <section id="milk" aria-labelledby="milk-heading" className="scroll-mt-[calc(var(--nav-h)+2rem)] border-t border-edge-rule pt-10 pb-14">
        <h2 id="milk-heading" className={H2}>
          {t('compareHeading')}
        </h2>
        <p className="mt-3 max-w-[62ch] leading-relaxed text-ink-secondary">{t('compareIntro')}</p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge-rule">
                {[t('compareDrink'), t('compareMilk'), t('compareFoam')].map(label => (
                  <th key={label} scope="col" className="landing-micro py-3 pr-6 font-semibold text-ink-secondary">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {milkRows.map(row => (
                <tr key={row.slug} className="border-b border-edge-rule align-top">
                  <th scope="row" className="py-4 pr-6 font-semibold">
                    <Link href={drinkHref(row.slug)} className={TEXT_LINK}>
                      {nameOf(row.slug)}
                    </Link>
                  </th>
                  <td className="py-4 pr-6 text-ink-primary">{row.content[loc].milk}</td>
                  <td className="py-4 text-ink-primary">{row.content[loc].foam}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-secondary">{t('compareNote')}</p>
        <SourceNote ids={milkSources} label={t('sources')} />
      </section>

      <section id="dates" aria-labelledby="dates-heading" className="scroll-mt-[calc(var(--nav-h)+2rem)] border-t border-edge-rule pt-10 pb-14">
        <h2 id="dates-heading" className={H2}>
          {t('datesHeading')}
        </h2>
        <p className="mt-3 max-w-[62ch] leading-relaxed text-ink-secondary">{t('datesIntro')}</p>
        <ol className="mt-6 border-b border-edge-rule">
          {datedEvents.map(event => (
            <li
              key={`${event.when.en}-${event.slug}`}
              className="grid gap-x-6 gap-y-1 border-t border-edge-rule py-4 sm:grid-cols-[9rem_1fr]"
            >
              <span className="font-semibold tabular-nums text-ink-primary">{event.when[loc]}</span>
              <div>
                <p className="leading-relaxed text-ink-primary">
                  {event.text[loc]}{' '}
                  <Link href={drinkHref(event.slug)} className={`${TEXT_LINK} whitespace-nowrap font-semibold`}>
                    {nameOf(event.slug)}
                  </Link>
                </p>
                <SourceNote
                  ids={event.sources}
                  label={event.sources.length > 1 ? t('sources') : t('source')}
                  className="mt-1"
                />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="method-heading" className="border-t border-edge-rule pt-10">
        <h2 id="method-heading" className="font-display text-2xl text-ink-primary">
          {t('methodHeading')}
        </h2>
        <p className="mt-3 max-w-[65ch] leading-relaxed text-ink-secondary">
          {t('methodBody', { date: formatDay(getLastReviewed(), locale) })}
        </p>
      </section>

      <MapPrompt locale={locale} text={t('ctaCafe')} button={t('ctaButton')} cta="cafe" page="guide" />
    </div>
  );
}
