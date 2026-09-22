'use client';

/*
  The landing page.

  A broadsheet: type carries the structure, rules replace cards, and the only
  filled control on the page is the primary action. The content is the product's
  own -- five growth stages, cafe registration, three explorer types, one
  primary action.

  It uses the project's own tokens throughout. No new colour is introduced, so
  all four themes still work; the reference's single-accent-on-monochrome logic
  maps onto `--brand` sitting alone on `--surface-page`.

  The hero is the exception: it runs over the same moving backdrop as the live
  variant, so its type is set in `--ink-on-media` against the scrim rather than
  in page ink. The brand colour cannot mark anything up there -- Morning
  Coffee's brown measures 1.2:1 on the scrim -- so emphasis inside the headline
  is carried by opacity of one light ink, the same way the header does it.
*/

import { useAuth } from '@/hooks/useAuth';
import HeroMedia from './HeroMedia';
import { GlobeCanvas, type GlobeTheme } from './GlobeCanvas';
import { Map, BookOpen, Share2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { GrowthTrack } from './GrowthTrack';
import { CoffeeBean, FlipText } from '@/shared/ui';
import type { CafeStats } from '@/lib/api/stats';
import Marquee from './Marquee';
import WaveDivider from './WaveDivider';
import { Counter, Reveal, RevealWords } from './motion';

type Stage = {
  title: string;
  badge: string;
  description: string;
};

export type LandingMessages = {
  heroLine1: string;
  heroLine2: string;
  heroLine3: string;
  /* Rich text: the product name inside it is set in the display face. */
  heroLede: ReactNode;
  heroCta: string;
  heroCtaLoggedIn: string;
  heroCtaSecondary: string;
  indexTitle: string;
  indexNote: string;
  registerTitle: string;
  registerLede: string;
  registerCta: string;
  /* Summary line and the detail behind it, one pair per disclosure. */
  registerNotes: { title: string; body: string }[];
  personasTitle: string;
  personasNote: string;
  closeLine1: string;
  closeLine2: string;
  closeNote: string;
  closeNoteSource: string;
  closeCta: string;
  closeCtaLoggedIn: string;
  marquee: string;
  /* Only the label under the hero figure; the rest of the stats copy is unused
     until the growth chart comes back. */
  stats: { cafes: string };
  stages: Stage[];
  personas: { title: string; description: string }[];
};

/*
  The globe, themed for the dark break it sits in.

  cobe takes plain RGB triples, not CSS colours, so these cannot come from the
  token layer. They are read against `--surface-inverse`, the darkest slot in
  all four themes, so one set holds everywhere.
*/
const DARK_GLOBE: GlobeTheme = {
  /*
    `dark: 0` lights the whole sphere: with a night side, half the land is in
    shadow at any moment and the globe reads as a mood rather than as a map.
  */
  dark: 0,
  // White ocean. cobe draws the landmass dots against the base colour, so a
  // white sphere is what makes the coastlines legible on a dark ground.
  baseColor: [1, 1, 1],
  markerColor: [0.55, 0.35, 0.23],
  glowColor: [0.32, 0.25, 0.2],
  /*
    Latitude the camera looks at, in radians. Equator-centred put the whole
    northern landmass -- Canada especially -- on the receding upper curve where
    the dots crowd together and stop reading. This is about 13 degrees north:
    enough to look down on the globe at a slight angle and open up the north,
    short of the shipped 0.3 which spends the top of the sphere on the Arctic.
  */
  theta: 0.23,
  // Eased back from Earth's real 23.5 degrees, then set by eye.
  tiltDeg: 23,
};

/*
  One mark per explorer type, in the shipped section's order: a map, a book, a
  share graph. The shipped section fills them at 48px in blue, amber and orange
  inside rounded cards -- three accent colours and a box, neither of which this
  page has. Here they are hairline drawings at 32px, set in page ink and picking
  up the brand only when the column they belong to is hovered, which is the same
  move the heading underneath already makes.
*/
const PERSONA_MARKS = [Map, BookOpen, Share2];

/*
  Indents for the three stepped hero lines, in character widths.

  All three are set by eye rather than by a formula -- the step widens as it
  descends, so the staircase leans into the last line instead of marching. The
  third carries the alignment that matters: the final "e" of "was once" sits
  over the end of "secret" on the line below, one space to the left of where
  that "e" would land exactly on the letter boundary. The numbers are measured
  in this face against this copy, and they move if either changes.
*/
const STEP_INDENTS_CH = [0, 1.64, 4.63];

/*
  The page's one horizontal measure. Everything hangs off it. The page bleeds past
  a landscape notch (`bleed-x`), so the measure takes the inset back.
*/
const MEASURE =
  'mx-auto w-full max-w-[1400px] pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] md:pl-[calc(2.5rem+env(safe-area-inset-left))] md:pr-[calc(2.5rem+env(safe-area-inset-right))]';

export default function Landing({
  messages,
  locale,
  stats,
}: {
  messages: LandingMessages;
  locale: string;
  stats: CafeStats | null;
}) {
  const { user, isLoading } = useAuth();
  const isLoggedIn = !isLoading && !!user;

  const primaryHref = isLoggedIn ? `/${locale}/discover/dropbean` : `/${locale}/register`;

  return (
    <div className="bleed-x bg-surface-page text-ink-primary">
      <LandingHero
        messages={messages}
        locale={locale}
        primaryHref={primaryHref}
        primaryLabel={isLoggedIn ? messages.heroCtaLoggedIn : messages.heroCta}
        stats={stats}
      />

      {/*
        The strip is a section, not a divider, so it is set in the display face
        at reading size. It butts straight onto the photograph -- the hero ends
        on its own rule and the strip picks it up -- and carries all of the air
        between itself and the index below.
      */}
      <Marquee
        text={messages.marquee}
        duration={60}
        size="display"
        className="mb-[56px] md:mb-[76px]"
      />

      <GrowthIndex messages={messages} />

      <WaveDivider from="var(--surface-page)" to="var(--surface-inverse)" />

      <RegisterSection messages={messages} locale={locale} />

      <WaveDivider from="var(--surface-inverse)" to="var(--surface-page)" />

      <Personas messages={messages} />

      <WaveDivider from="var(--surface-page)" to="var(--surface-raised)" />

      <ClosingAction
        messages={messages}
        primaryHref={primaryHref}
        primaryLabel={isLoggedIn ? messages.closeCtaLoggedIn : messages.closeCta}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- hero --- */

function LandingHero({
  messages,
  locale,
  primaryHref,
  primaryLabel,
  stats,
}: {
  messages: LandingMessages;
  locale: string;
  primaryHref: string;
  primaryLabel: string;
  stats: CafeStats | null;
}) {
  /*
    The three stepped lines, split out of the two copy lines the live hero sets
    as one. Splitting here rather than adding three more message keys keeps one
    copy of the words, so the two variants cannot drift apart.

    The split is on the first space, which reads correctly in both locales --
    "Every | good cafe" and "좋은 | 카페는".
  */
  const [firstWord, ...restWords] = messages.heroLine1.split(' ');
  const steps = [firstWord, restWords.join(' '), messages.heroLine2].filter(Boolean);

  return (
    /*
      Pulled up under the fixed header so the media runs behind it, exactly as
      the live hero does. `min-h-lvh` so the backdrop is a full field rather
      than a band. On touch, 5rem more: iOS 26 Safari draws the page under its
      bottom toolbar about 58px past `100lvh`, and no viewport unit reaches it.
      ponytail: fixed 5rem overshoot; measure screen height in JS if a device still shows a gap.
    */
    <header className="relative -mt-[var(--nav-h)] min-h-lvh pointer-coarse:min-h-[calc(100lvh+5rem)] overflow-hidden">
      <HeroMedia />

      <div className={`relative ${MEASURE} flex min-h-lvh flex-col justify-center pt-[calc(7rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] md:pt-[calc(8rem+env(safe-area-inset-top))]`}>
        {/*
          A stepped headline. The first three lines each take one more indent
          than the last, and the fourth returns to the margin -- so the eye
          walks down the steps and lands on the line that carries the sentence.

          The indents are in `ch` -- one character width of the face at its
          current size -- so the staircase holds its shape at every size the
          clamp produces. A pixel indent would read as two characters at the top
          of the clamp and as four at the bottom.
        */}
        <h1 className="landing-display text-[clamp(2.5rem,8vw,7rem)] text-ink-on-media drop-shadow-lg break-keep">
          {steps.map((step, index) => (
            <span
              key={step}
              className="block"
              style={{ paddingLeft: `${STEP_INDENTS_CH[index]}ch` }}
            >
              <RevealWords text={step} stagger={0.07} />
            </span>
          ))}
          <span className="block">
            <RevealWords text={messages.heroLine3} stagger={0.06} />
          </span>
        </h1>

        <div className="mt-12 grid gap-10 border-t border-ink-on-media/20 pt-8 md:mt-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Reveal trigger="load" delay={0.2}>
            <p className="max-w-2xl text-lg leading-relaxed text-ink-on-media/85 drop-shadow-sm break-keep md:text-xl">
              {messages.heroLede}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              {/*
                The only filled control on the page. Its shadow is tinted with
                the brand rather than with grey, so the elevation belongs to the
                accent system instead of reading as generic UI depth.
              */}
              <a
                href={primaryHref}
                className="landing-micro inline-flex min-h-[52px] items-center btn-fill btn-shade rounded-control px-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {primaryLabel}
              </a>
              {/*
                The rule under this link is the link's own edge, so it holds still
                while the letters turn -- an underline that moved with them would
                read as the control sliding. `hover:opacity-70` is gone: the turn is
                the hover state now, and dimming a thing that is already moving says
                the same thing twice.
              */}
              <a
                href={`/${locale}/discover/explore-map`}
                className="flip-host landing-micro inline-flex min-h-[52px] items-center border-b border-ink-on-media pb-1 text-ink-on-media focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
              >
                <FlipText>{messages.heroCtaSecondary}</FlipText>
              </a>
            </div>
          </Reveal>

          {/*
            The headline figure. `leading-none` overrides the display face's
            0.88 line box -- at 0.88 the glyphs sit taller than their own block
            and the label underneath collides with the digits.
          */}
          <Reveal trigger="load" delay={0.3} className="md:text-right">
            <Counter
              value={stats?.total_cafes ?? 0}
              className="landing-display block text-[clamp(3rem,9vw,7rem)] leading-none text-ink-on-media tabular-nums"
            />
            <span className="landing-micro mt-4 block text-ink-on-media/70">{messages.stats.cafes}</span>
          </Reveal>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- index --- */

/**
 * The five growth stages as one dial. This replaces a list that gave each stage
 * its own screen and let the scroll carry the emphasis from row to row: five
 * screens for five sentences, and on a phone nothing moved but the ink. The dial
 * puts all five on the ring at once and lets a drag, a tap or an arrow pick one.
 *
 * It climbs left to right and stops: a roasted bean is the last thing that
 * happens to a bean, so the journey must not read as a loop. The drop counts sit
 * under the nodes as an axis, which says how far along a stage is without
 * spending a sentence on it.
 */
function GrowthIndex({ messages }: { messages: LandingMessages }) {
  return (
    <section className={`${MEASURE} pb-20 md:pb-28`}>
      <Reveal>
        {/*
          Not held to a 3xl column: at that width the line broke in two for the
          sake of a measure nothing else on the page is keeping.
        */}
        <h2 className="landing-display text-[clamp(2.5rem,6vw,5rem)] break-keep">
          {messages.indexTitle}
        </h2>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-secondary break-keep">
          {messages.indexNote}
        </p>
      </Reveal>

      <Reveal className="mt-6 md:mt-10">
        <GrowthTrack stages={messages.stages} />
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------ register --- */

function RegisterSection({ messages, locale }: { messages: LandingMessages; locale: string }) {
  return (
    // The dark editorial break. Full-bleed on purpose: it is the page turning
    // over, so it must not sit inside the measure. It also names the surface a
    // `btn-line` on it flips to, which is this band rather than a card.
    <section className="bg-surface-inverse text-ink-inverse [--btn-line-ink:var(--ink-inverse)] [--btn-line-on:var(--surface-inverse)]">
      <div className={`${MEASURE} py-24 md:py-32`}>
        {/*
          The globe column has to be at least as wide as the canvas it holds:
          the canvas sizes itself in pixels and stretches to its cell, so a
          narrower column squashes the sphere into an ellipse instead of
          scaling it down.

          Which is why the split waits for `xl` rather than `md`. On a tablet
          the fixed 29rem column was taking two thirds of the row and leaving
          the headline to set itself one word per line in what was left. Below
          that width the two stack, at full measure each, and the globe keeps
          its size.
        */}
        <div className="grid items-center gap-14 xl:grid-cols-[minmax(0,1fr)_minmax(29rem,30rem)] xl:gap-16">
          <Reveal>
            {/* Smaller than the page's other headings: this one shares its row. */}
            <h2 className="landing-display text-[clamp(2.25rem,5.5vw,4.5rem)] break-keep">
              {messages.registerTitle}
            </h2>
            <p className="mt-8 max-w-xl text-lg leading-relaxed opacity-80 break-keep">
              {messages.registerLede}
            </p>

            {/*
              The three facts used to sit open under a paragraph that said the
              same things again at length. They are now the paragraph: each one
              is a line you can read at a glance and open only if you want the
              detail behind it.

              `details`/`summary` rather than state and buttons -- the element
              is a disclosure already, keyboard-operable and announced as one,
              and it does not need the section to hold open/closed state.
            */}
            <ul className="mt-10 grid gap-px bg-ink-inverse/20">
              {messages.registerNotes.map((note) => (
                <li key={note.title} className="bg-surface-inverse">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-4 py-4 transition-opacity duration-200 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
                      {/*
                        One mark per row rather than a number. Three facts, not
                        three steps -- an ordinal would promise an order that
                        does not exist. The bean turns a full circle each time
                        the row opens or closes: the same 360 degrees either
                        way, so opening and closing read as one gesture and its
                        undo rather than two different ones.
                      */}
                      <CoffeeBean
                        size="inherit"
                        className="h-4 w-4 shrink-0 text-(--brand-muted) transition-transform duration-500 ease-out group-open:rotate-[360deg]"
                      />
                      <span className="text-sm leading-relaxed break-keep">{note.title}</span>
                      {/*
                        A plus that becomes a minus: the crossbar is the one
                        that turns. Drawn rather than a glyph so it inherits the
                        stroke weight of the rules around it.
                      */}
                      <svg
                        aria-hidden
                        viewBox="0 0 12 12"
                        className="ml-auto h-3 w-3 shrink-0 opacity-60"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      >
                        <line x1="1" y1="6" x2="11" y2="6" />
                        <line
                          x1="6"
                          y1="1"
                          x2="6"
                          y2="11"
                          className="origin-center transition-transform duration-300 group-open:rotate-90 group-open:opacity-0"
                        />
                      </svg>
                    </summary>
                    {/*
                      Full ink, not a dimmed one: the body only exists once
                      someone has opened it, and setting it back from the line
                      that opened it makes the answer harder to read than the
                      question.
                    */}
                    <p className="pb-5 pl-[1.625rem] text-sm leading-relaxed break-keep">
                      {note.body}
                    </p>
                  </details>
                </li>
              ))}
            </ul>

            <a
              href={`/${locale}/discover/register-cafe`}
              className="landing-micro btn-line mt-10 inline-flex min-h-[52px] items-center rounded-control px-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {messages.registerCta}
            </a>
          </Reveal>

          {/*
            The globe, in place of the cropped interior shot that was here. The
            point being made is "a cafe anywhere", which a turning planet says
            and a photograph of one room does not. Same component and same dark
            theming as the live variant uses.
          */}
          <Reveal delay={0.12} className="flex justify-center xl:justify-end">
            <GlobeCanvas theme={DARK_GLOBE} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ personas --- */

function Personas({ messages }: { messages: LandingMessages }) {
  return (
    <section className={`${MEASURE} py-20 md:py-28`}>
      {/*
        Stacked rather than headline-left / note-right: side by side, the note
        took enough of the row that the headline set itself over two lines for
        no reason. On its own line it fits, and the note reads as its subtitle.
      */}
      <Reveal className="border-b border-edge-default pb-8">
        <h2 className="landing-display text-[clamp(2.5rem,7vw,5.5rem)] break-keep">
          {messages.personasTitle}
        </h2>
        <p className="mt-5 text-base leading-relaxed text-ink-secondary break-keep">
          {messages.personasNote}
        </p>
      </Reveal>

      {/*
        No cards, no bordered box, no hover-scale on the column itself. Three
        columns of type separated by rules; the interaction lives inside each
        column rather than on it, so the grid never grows a shadow or a
        background the way a card would.
      */}
      <div className="mt-px grid grid-cols-1 gap-px bg-edge-subtle md:grid-cols-3">
        {messages.personas.map((persona, index) => {
          const Mark = PERSONA_MARKS[index] ?? PERSONA_MARKS[0];
          return (
          <Reveal key={persona.title} delay={index * 0.08} className="group bg-surface-page py-10 md:px-8">
            {/*
              The mark lifts and the rule under the heading grows in from the left --
              a print convention (a byline mark stepping off the page) rather than a
              UI one, which is why it is a translate and a width, never a scale. The
              column itself does not move: only the two elements small enough that
              their own motion doesn't read as the whole block shifting.

              Both the mark and the heading go to primary ink on hover, not to brand.
              Espresso sets `--c-brand` and `--c-ink-soft` to the same #d4c7b8, so a
              brand hover over secondary ink was a no-op in that theme -- the column
              simply did not respond. The muted/primary gap is guaranteed in all four
              themes, since that is the gap the AA work was built on. The new rule
              under the heading is the one element allowed to use `--brand` instead,
              because as a fill rather than text it never depends on that gap.
            */}
            <Mark
              aria-hidden
              strokeWidth={1}
              className="mb-6 h-8 w-8 text-ink-secondary transition-[color,transform] duration-300 group-hover:-translate-y-1 group-hover:text-ink-primary"
            />
            <h3 className="landing-display text-[clamp(1.75rem,3vw,2.5rem)] transition-colors duration-300 group-hover:text-ink-primary break-keep">
              {persona.title}
            </h3>
            <span
              aria-hidden
              className="mt-3 block h-px w-8 bg-brand transition-[width] duration-300 ease-out group-hover:w-16"
            />
            <p className="mt-4 text-base leading-relaxed text-ink-secondary break-keep">
              {persona.description}
            </p>
          </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- close --- */

function ClosingAction({
  messages,
  primaryHref,
  primaryLabel,
}: {
  messages: LandingMessages;
  primaryHref: string;
  primaryLabel: string;
}) {
  return (
    /* The closing block is the one raised surface on the page -- without it the
       section reads as a continuation of the personas above. The footer's wave
       pours out of the page ground, so this section pours itself back down to it
       first rather than handing the footer a colour it cannot know about. */
    <section className="bg-surface-raised">
      <div className={`${MEASURE} py-24 md:py-32`}>
        <h2 className="landing-display text-[clamp(3rem,10vw,9rem)] break-keep">
          <span className="block">
            <RevealWords text={messages.closeLine1} />
          </span>
          <span className="block text-brand">
            <RevealWords text={messages.closeLine2} stagger={0.07} />
          </span>
        </h2>

        <Reveal delay={0.2} className="mt-12 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <a
            href={primaryHref}
            className="landing-micro inline-flex min-h-[56px] w-fit items-center btn-fill btn-shade rounded-control px-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {primaryLabel}
          </a>
          {/*
            The attribution floats rather than sitting in the run of text. A right float
            placed after the quote lands flush right on whatever line the quote ends on,
            and drops to its own right-aligned line only when that line has no room left
            -- which is the reading either way: the quote, then its source at the far
            end. `flow-root` is what keeps the float inside the paragraph's height.
          */}
          <p className="flow-root max-w-xl text-sm italic leading-relaxed text-ink-secondary break-keep">
            {messages.closeNote}
            <span className="float-right ml-4 whitespace-nowrap not-italic">
              {messages.closeNoteSource}
            </span>
          </p>
        </Reveal>
      </div>
      <WaveDivider from="var(--surface-raised)" to="var(--surface-page)" />
    </section>
  );
}

/* ---------------------------------------------------------------- wave --- */

