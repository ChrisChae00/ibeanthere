'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { BookOpen, Coffee, FileText, Map as MapIcon, Search, Settings, User, X } from 'lucide-react';
import { Avatar, CoffeeBean, Logo, PlusIcon } from '@/shared/ui';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { searchCafesByText } from '@/lib/api/cafes';
import { searchUsers } from '@/lib/api/users';
import { PAGES, QUICK_PAGE_IDS, matchDrinks, matchPages } from '@/lib/search/pages';

/*
  One search for the three kinds of thing a reader looks for by name: a cafe, a
  person, a page of the app. Base UI's Autocomplete carries the combobox semantics,
  arrow keys, Enter and dismissal; everything here is what to list and how a row
  says which kind it is.

  The kinds are told apart by the shape of the leading mark, not by colour: a cafe
  is a square photograph, a person a round one, a page an outlined glyph. The group
  heading says it again in words for anyone who does not read shapes.
*/

type Kind = 'cafe' | 'person' | 'page';
type Category = 'all' | Kind;

type Hit = {
  key: string;
  kind: Kind;
  label: string;
  sub?: string;
  href: string;
  image?: string;
  icon?: Mark;
};

type Group = { value: Kind | 'quick'; items: Hit[] };

// The endpoints' own minimums; a shorter query would only earn a 422.
const CAFE_MIN = 2;
// People need three letters, or two when the query has Hangul in it -- the server's rule.
const personMin = (q: string) => (/[\u3131-\u318e\uac00-\ud7a3]/.test(q) ? 2 : 3);
const FETCH_LIMIT = 10;
// Per kind on the "All" tab. A category tab shows everything that came back.
const ALL_TAB_LIMIT = { cafe: 4, person: 3, page: 4 } as const;

type Mark = ComponentType<{ className?: string }>;

/*
  The mark each page already wears elsewhere, so a row here is recognised rather than
  read: the profile menu's person, log sheet, bean and gear, the landing's map and
  book, the plus on every "register a cafe" button, and the cup the pending list
  draws for a cafe still waiting.
*/
// The bean is a solid shape with air inside its box; the profile menu sets it a notch
// larger than the line marks for the same reason.
const BeanMark: Mark = ({ className }) => (
  <CoffeeBean size="inherit" className={`${className} h-[1.1rem] w-[1.1rem]`} />
);
const PlusMark: Mark = ({ className }) => <PlusIcon size={16} className={className} />;

const PAGE_ICONS: Record<string, Mark> = {
  map: MapIcon,
  dropbean: BeanMark,
  register_cafe: PlusMark,
  pending: Coffee,
  guide: BookOpen,
  my_logs: FileText,
  my_beans: BeanMark,
  profile: User,
  settings: Settings,
};

const CATEGORIES: Category[] = ['all', 'cafe', 'person', 'page'];

function useSearchResults(query: string, locale: string, retry: number) {
  const t = useTranslations('search');
  const { user } = useAuth();
  const debounced = useDebounce(query.trim(), 250);
  const [remote, setRemote] = useState<{ q: string; cafes: Hit[]; people: Hit[]; failed: boolean }>({
    q: '',
    cafes: [],
    people: [],
    failed: false,
  });

  useEffect(() => {
    if (debounced.length < CAFE_MIN) return;
    let cancelled = false;
    const q = debounced;

    // `searchCafesByText` answers [] on failure, so only the people call can tell us
    // the service is down; a failure there is reported rather than shown as "no one".
    Promise.all([
      searchCafesByText(q, FETCH_LIMIT),
      q.length >= personMin(q)
        ? searchUsers(q, FETCH_LIMIT).then(
            (rows) => ({ rows, failed: false }),
            () => ({ rows: [], failed: true }),
          )
        : Promise.resolve({ rows: [], failed: false }),
    ]).then(([cafes, people]) => {
      if (cancelled) return;
      setRemote({
        q,
        failed: people.failed,
        cafes: cafes.map((cafe) => ({
          key: `cafe:${cafe.id}`,
          kind: 'cafe',
          label: cafe.name,
          sub: cafe.address,
          href: `/${locale}/cafes/${cafe.slug || cafe.id}`,
          image: cafe.main_image,
        })),
        people: people.rows.map((person) => ({
          key: `person:${person.username}`,
          kind: 'person',
          label: person.display_name,
          sub: `@${person.username}`,
          href: `/${locale}/profile/${person.username}`,
          image: person.avatar_url,
        })),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [debounced, locale, retry]);

  const trimmed = query.trim();
  const signedIn = Boolean(user);
  const pageLabel = (id: string) => t(`pages.${id}.label`);

  const toPageHit = (id: string, path: string): Hit => ({
    key: `page:${id}`,
    kind: 'page',
    label: pageLabel(id),
    sub: t(`pages.${id}.description`),
    href: `/${locale}${path}`,
    icon: PAGE_ICONS[id] ?? FileText,
  });

  // Pages are matched on every keystroke; they are local and need no debounce.
  const pages: Hit[] = trimmed
    ? [
        ...matchPages(trimmed, pageLabel, signedIn).map((page) => toPageHit(page.id, page.path)),
        ...matchDrinks(trimmed, locale === 'ko' ? 'ko' : 'en').map((drink) => ({
          key: `drink:${drink.slug}`,
          kind: 'page' as const,
          label: drink.name,
          sub: t('guide_article'),
          href: `/${locale}/learn/coffee/${drink.slug}`,
          icon: BookOpen,
        })),
      ]
    : [];

  const quick: Hit[] = PAGES.filter((page) => QUICK_PAGE_IDS.includes(page.id)).map((page) =>
    toPageHit(page.id, page.path),
  );

  const settled = remote.q === debounced && debounced === trimmed;
  const loading = trimmed.length >= CAFE_MIN && !settled;
  // Results from a previous query stay out of the list rather than flashing under the new one.
  const fresh = settled ? remote : { cafes: [], people: [], failed: false };

  return { trimmed, pages, quick, loading, ...fresh };
}

function Leading({ hit }: { hit: Hit }) {
  // A stored photo URL can outlive the photo; a broken frame reads worse than none.
  const [broken, setBroken] = useState(false);
  if (hit.kind === 'person') {
    return <Avatar src={hit.image} alt="" size="md" className="shrink-0" />;
  }
  if (hit.kind === 'cafe') {
    return (
      // Without a photo, the same logo on the same sunken ground the map's cafe cards use.
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) bg-surface-sunken text-ink-secondary">
        {hit.image && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- cafe photo hosts are not in `remotePatterns`
          <img
            src={hit.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <Logo size={24} className="opacity-60" />
        )}
      </span>
    );
  }
  const Icon = hit.icon ?? FileText;
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-control) border border-edge-default"
    >
      <Icon className="menu-mark" />
    </span>
  );
}

function ResultRow({ hit, onPick }: { hit: Hit; onPick: (hit: Hit) => void }) {
  return (
    <Autocomplete.Item
      value={hit}
      /*
        A tap has no hover to highlight the row first, so the row picks itself. Safari
        swallows the click that a tap would synthesise -- the list prevents the default
        on `pointerdown` to keep focus in the input -- so touch is taken on the release.
      */
      onPointerUp={(e) => e.pointerType !== 'mouse' && onPick(hit)}
      onClick={() => onPick(hit)}
      className="menu-item cursor-pointer outline-hidden"
    >
      <Leading hit={hit} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink-primary" title={hit.label}>
          {hit.label}
        </span>
        {hit.sub && <span className="truncate text-xs text-ink-secondary">{hit.sub}</span>}
      </span>
    </Autocomplete.Item>
  );
}

/*
  Everything under the input: the category row, the status line and the grouped list.
  Shared by the bar's popup and the phone's sheet, so the two cannot drift.
*/
function ResultsBody({
  locale,
  query,
  category,
  onCategory,
  groups,
  status,
  onPick,
  listClassName,
}: {
  locale: string;
  query: string;
  category: Category;
  onCategory: (c: Category) => void;
  groups: Group[];
  status: ReactNode;
  onPick: (hit: Hit) => void;
  listClassName: string;
}) {
  const t = useTranslations('search');

  return (
    <>
      {query && (
        <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              // Keeps focus in the input, so the popup stays open and typing carries on.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCategory(c)}
              className={`control-flat h-8 rounded-(--radius-pill) px-3 text-xs font-medium ${
                category === c ? 'is-active' : ''
              }`}
            >
              {t(`categories.${c}`)}
            </button>
          ))}
        </div>
      )}

      <Autocomplete.Status>
        {status && <div className="px-3 py-3 text-sm text-ink-secondary">{status}</div>}
      </Autocomplete.Status>

      <Autocomplete.List className={`scrollbar-quiet overflow-y-auto overscroll-contain outline-0 ${listClassName}`}>
        {(group: Group) => (
          <Autocomplete.Group key={group.value} items={group.items} className="block pb-1 last:pb-0">
            <Autocomplete.GroupLabel className="landing-micro px-3 pt-2 pb-1.5 text-ink-secondary">
              {t(`groups.${group.value}`)}
            </Autocomplete.GroupLabel>
            <Autocomplete.Collection>
              {(hit: Hit) => <ResultRow key={hit.key} hit={hit} onPick={onPick} />}
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>

      {/* An empty cafe search is an invitation, not a dead end. */}
      {status && !groups.length && (category === 'all' || category === 'cafe') && query.length >= CAFE_MIN && (
        <div className="px-3 pb-2">
          <a
            href={`/${locale}/discover/register-cafe`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              onPick({ key: 'register', kind: 'page', label: '', href: `/${locale}/discover/register-cafe` });
            }}
            className="text-sm font-medium text-ink-primary underline underline-offset-2"
          >
            {t('register_cafe')}
          </a>
        </div>
      )}
    </>
  );
}

function useSearchState(locale: string, onDone: () => void) {
  const t = useTranslations('search');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [retry, setRetry] = useState(0);
  const results = useSearchResults(query, locale, retry);
  const { trimmed, pages, quick, loading, cafes, people, failed } = results;

  const groups = useMemo<Group[]>(() => {
    if (!trimmed) return [{ value: 'quick', items: quick }];
    const all = category === 'all';
    const pick = (kind: Kind, hits: Hit[]): Group[] =>
      (all || category === kind) && hits.length
        ? [{ value: kind, items: all ? hits.slice(0, ALL_TAB_LIMIT[kind]) : hits }]
        : [];
    return [...pick('cafe', cafes), ...pick('person', people), ...pick('page', pages)];
  }, [trimmed, category, cafes, people, pages, quick]);

  let status: ReactNode = null;
  if (loading) {
    status = t('searching');
  } else if (failed && (category === 'person' || !groups.length)) {
    status = (
      <span className="flex items-center gap-2">
        {t('error')}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setRetry((n) => n + 1)}
          className="font-medium text-ink-primary underline underline-offset-2"
        >
          {t('retry')}
        </button>
      </span>
    );
  } else if (category === 'person' && trimmed.length < personMin(trimmed)) {
    status = t('person_min', { min: personMin(trimmed) });
  } else if (trimmed && trimmed.length < CAFE_MIN && category === 'cafe') {
    status = t('cafe_min', { min: CAFE_MIN });
  } else if (trimmed && !groups.length) {
    status = t('empty', { query: trimmed });
  }

  /*
    A touch pick lands on `pointerup`, and Chrome still sends the click a tap
    synthesises afterwards -- by then the list has been cleared and redrawn, so that
    click would land on whatever row now sits under the finger and navigate again.
    One press is one pick: a second within the window a tap spans is ignored.
  */
  const lastPickAt = useRef(0);
  const pick = (hit: Hit) => {
    const now = Date.now();
    if (now - lastPickAt.current < 700) return;
    lastPickAt.current = now;
    router.push(hit.href);
    setQuery('');
    setCategory('all');
    onDone();
  };

  /*
    Enter and a press both arrive as an `item-press` change carrying the row's label,
    not the row, so the row's own click does the picking (Enter clicks the highlighted
    row) and the change is only kept out of the query. The highlighted row is tracked
    for the Enter fallback below.
  */
  const highlighted = useRef<Hit | undefined>(undefined);
  const rootProps = {
    items: groups,
    filter: null,
    value: query,
    autoHighlight: true,
    itemToStringValue: (hit: Hit) => hit.label,
    onItemHighlighted: (hit: Hit | undefined) => {
      highlighted.current = hit;
    },
    onValueChange: (value: string, details: { reason: string }) => {
      if (details.reason === 'item-press') return;
      setQuery(value);
    },
  };

  /*
    Results arrive after the keystroke, so `autoHighlight` has often already run on an
    empty list and nothing is highlighted. Enter then means the first row -- the one a
    reader is looking at when they press it.
  */
  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || highlighted.current) return;
    const first = groups[0]?.items[0];
    if (!first || !query.trim()) return;
    e.preventDefault();
    pick(first);
  };

  return { query, setCategory, category, groups, status, loading, pick, rootProps, onInputKeyDown };
}

/** The bar's own field, left of the theme switcher. Desktop only. */
export function SiteSearchBar({ locale }: { locale: string }) {
  const t = useTranslations('search');
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const s = useSearchState(locale, () => {
    setOpen(false);
    inputRef.current?.blur();
  });

  // `/` jumps to search from anywhere that is not already taking text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Autocomplete.Root {...s.rootProps} open={open} onOpenChange={setOpen} openOnInputClick>
      <Autocomplete.InputGroup className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text opacity-75" aria-hidden />
        <Autocomplete.Input
          ref={inputRef}
          aria-label={t('label')}
          aria-keyshortcuts="/"
          placeholder={t('placeholder')}
          onKeyDown={s.onInputKeyDown}
          onFocus={() => setOpen(true)}
          className="h-10 w-64 rounded-(--radius-pill) border border-border bg-surface pl-9 pr-3 text-sm text-text placeholder:text-text placeholder:opacity-60 outline-none focus-visible:border-text"
        />
      </Autocomplete.InputGroup>

      <Autocomplete.Portal>
        <Autocomplete.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-(--z-nav-popover) outline-none"
        >
          <Autocomplete.Popup
            aria-busy={s.loading || undefined}
            className="menu-panel nav-opaque motion-slide-up w-104 max-w-(--available-width)"
          >
            <ResultsBody
              locale={locale}
              query={s.query.trim()}
              category={s.category}
              onCategory={s.setCategory}
              groups={s.groups}
              status={s.status}
              onPick={s.pick}
              listClassName="max-h-[min(28rem,calc(var(--available-height)-4rem))]"
            />
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}

/*
  Below `xl`: a button beside the hamburger that opens the same search as a sheet
  across the top of the screen. A dialog, for the same reasons the drawer is one --
  focus trap, Escape, focus restore and scroll lock -- and the list is rendered inline
  in it rather than as a second popup over the sheet.
*/
export function SiteSearchSheet({ locale }: { locale: string }) {
  const t = useTranslations('search');
  const [open, setOpen] = useState(false);
  const s = useSearchState(locale, () => setOpen(false));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <button
            className="nav-pill xl:hidden flex h-11 w-11 items-center justify-center text-text"
            aria-label={t('label')}
          />
        }
      >
        <Search className="h-5 w-5" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="nav-drawer-scrim fixed inset-0 z-(--z-nav-scrim) xl:hidden transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup
          aria-label={t('label')}
          className="nav-opaque fixed inset-x-0 top-0 z-(--z-nav-drawer) flex max-h-[85dvh] flex-col pt-[env(safe-area-inset-top)] px-safe overflow-hidden rounded-b-(--radius-card) border-b border-edge-default bg-surface-raised outline-none xl:hidden transition-transform duration-200 data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full"
        >
          <Autocomplete.Root {...s.rootProps} inline open>
            <div className="flex h-16 shrink-0 items-center gap-2 border-b border-edge-rule px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
              {/* 16px, or iOS zooms the page when the field takes focus. */}
              <Autocomplete.Input
                aria-label={t('label')}
                placeholder={t('placeholder')}
                enterKeyHint="search"
                onKeyDown={s.onInputKeyDown}
                className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink-primary placeholder:text-ink-secondary outline-none"
              />
              <Dialog.Close
                render={
                  <button
                    className="nav-pill flex h-11 w-11 shrink-0 items-center justify-center text-ink-secondary hover:text-ink-primary"
                    aria-label={t('close')}
                  />
                }
              >
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            <div className="flex min-h-0 flex-col px-1.5 py-1.5" aria-busy={s.loading || undefined}>
              <ResultsBody
                locale={locale}
                query={s.query.trim()}
                category={s.category}
                onCategory={s.setCategory}
                groups={s.groups}
                status={s.status}
                onPick={s.pick}
                listClassName="max-h-[calc(85dvh-7.5rem)]"
              />
            </div>
          </Autocomplete.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
