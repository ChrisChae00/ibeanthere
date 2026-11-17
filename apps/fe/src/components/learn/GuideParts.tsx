import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { CoffeeDrink, Locale } from '@/data/coffee/types';
import { getSource, type SourceId } from '@/data/coffee/sources';

export const TEXT_LINK =
  'text-ink-primary underline underline-offset-4 decoration-edge-rule hover:decoration-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** "11 September 2026" / "2026년 9월 11일". Fixed to UTC so server and client agree. */
export function formatDay(isoDay: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-CA', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDay}T00:00:00Z`));
}

/*
  The sources for one paragraph, printed directly under it rather than collected at the
  foot of the page: a reader checking a date should not have to work out which of
  twelve references it came from.
*/
export function SourceNote({
  ids,
  label,
  className = 'mt-2',
}: {
  ids?: SourceId[];
  /** Already chosen for the count: "Source" or "Sources". */
  label: string;
  className?: string;
}) {
  if (!ids?.length) return null;
  return (
    <p className={`${className} text-xs leading-relaxed text-ink-secondary`}>
      <span className="font-semibold">{label}:</span>{' '}
      {ids.map((id, i) => {
        const source = getSource(id);
        return (
          <span key={id}>
            <a href={source.url} className={`${TEXT_LINK} text-ink-secondary`}>
              {source.title}
            </a>
            , {source.publisher}
            {source.date ? ` (${source.date})` : ''}
            {i < ids.length - 1 ? '; ' : ''}
          </span>
        );
      })}
    </p>
  );
}

/** One row per drink; the whole row links to its explanation. */
export function DrinkList({ drinks, locale }: { drinks: CoffeeDrink[]; locale: string }) {
  const loc = locale as Locale;
  return (
    <ul className="divide-y divide-edge-rule border-y border-edge-rule">
      {drinks.map(drink => {
        const copy = drink.content[loc];
        return (
          <li key={drink.slug}>
            <Link
              href={`/${locale}/learn/coffee/${drink.slug}`}
              className="group grid grid-cols-[1fr_auto] items-center gap-x-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:grid-cols-[11rem_1fr_auto] sm:py-5"
            >
              <span className="text-base font-semibold text-ink-primary underline-offset-4 group-hover:underline sm:text-lg">
                {copy.name}
              </span>
              <span className="col-start-1 row-start-2 mt-1 text-sm leading-relaxed text-ink-secondary sm:col-start-2 sm:row-start-1 sm:mt-0 sm:text-base">
                {copy.line}
              </span>
              <ChevronRight
                aria-hidden
                className="row-span-2 h-4 w-4 shrink-0 text-ink-secondary group-hover:text-ink-primary sm:row-span-1"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
