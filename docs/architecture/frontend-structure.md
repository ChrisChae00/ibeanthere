# Frontend Repository Structure

## Analytics

Four events and a pageview, mounted once from `ClientProviders` as `AnalyticsWatcher`.
`posthog-js` is imported at runtime rather than bundled, no URL leaves the browser with
an identifier in it, and nothing is stored on the reader's device. Absent
`NEXT_PUBLIC_POSTHOG_KEY` it is entirely inert, which is the local default. The CSP in
`next.config.js` has to name the host or every event is dropped silently.

Full contract, including what each event carries and why the identity is bootstrapped
rather than `identify()`d: `docs/architecture/analytics.md`.

## Coffee workflow changes (`4f95bfe`)

- `CafeTraits.tsx` submits suggestions through `suggestTraitObservation`; pending
  submissions leave approved summaries unchanged. Trait reads use `no-store`.
- `admin/TraitSuggestionsList.tsx` displays the pending queue grouped by cafe, with each
  claim's note and admin-only evidence, and calls admin approve/reject endpoints.
  Backend authorization enforces access. Per-cafe actions approve every claim at once or
  delete the cafe; the website and Maps links let a reviewer check a claim without
  leaving the queue.
- **Admin cafe edits fill from Google.** The edit modal takes a Google Maps URL and
  applies the same lookup the registration form uses, filling name, address, phone,
  website, hours, coordinates and `place_id`. Nothing is written until Save. The backend
  refuses a coordinate move beyond 100m: past that the URL describes a different shop,
  and accepting it would carry this cafe's logs and badges somewhere nobody earned them.
- **Admin modals were unusable and are fixed.** The backdrop used `bg-opacity-50`, which
  Tailwind v4 removed, so `bg-black` painted the page solid black; and the only way out
  was one button. They now use `bg-black/50`, close on Escape and on a backdrop click,
  and lock background scrolling while open.
- **Admin actions drop the cached lists.** Verifying, editing or deleting a cafe
  revalidates the cafe tags and `trending-cafes`, and the backend clears its memoised
  trending lists. Without both, a deleted cafe kept appearing on discover for up to four
  hours after the row was gone.
- `CoffeeLogForm.tsx` asks purchase users whether the cafe sells beans (checked by
  default). Unchecking submits a negative observation, and the form says the answer is
  reviewed before it reaches the cafe page — it is stored `pending` unless the log also
  carried a check-in the backend measured. “Want again” starts unset; selecting the
  chosen answer again clears the local selection.
- `app/actions/cafe.ts` revalidates after log creation and My Logs edits/deletes. It
  drops both `cafe-${cafeId}` and the broad `cafe` tag: a detail page is cached under
  whichever identifier its URL carried, usually a slug, while every caller here holds a
  UUID, so the narrow tag alone left slug-cached pages stale for two minutes. The action
  now also requires a session and a well-formed identifier — a Server Action is a public
  endpoint, and an anonymous caller could otherwise clear the cache in a loop.
  Detail fetches retain their 120-second revalidation. Remaining gap: a visibility change
  made outside this frontend invalidates nothing, since the backend has no way to reach
  Next's cache (SEC-10 in the [security audit](../security-audit-2026-09-09.md)).
- `shared/ui/FlipText.tsx` supplies the landing link hover animation. CSS handles
  reduced motion; duplicate letter faces are hidden from accessibility and selection.

The production build passed before this commit, with Supabase Edge Runtime warnings.
That check does not establish browser accessibility or resolution of audit findings.

```
apps/fe/
├── .env.local            # Environment variables
├── next.config.js        # Next.js configuration, including the CSP
├── package.json          # Node dependencies and scripts
├── postcss.config.js     # Tailwind v4 entry point
├── tsconfig.json         # TypeScript compiler configurations
├── scripts/              # Repo maintenance scripts, not app code
│   └── build-fonts.py    # Vendors the webfaces and regenerates fonts.css
├── public/
│   └── fonts/            # Self-hosted webfaces, split by character range
└── src/                  # Main source code directory
    ├── app/              # Next.js App Router hierarchy
    ├   ├── [locale]/     # Internationalization routing
    ├── components/       # Domain-specific UI elements
    │   ├── admin/
    │   ├── auth/
    │   ├── cafe/
    │   ├── common/
    │   ├── landing/
    │   ├── layout/
    │   ├── learn/
    │   ├── map/
    │   ├── profile/
    │   ├── providers/
    │   ├── settings/
    │   ├── shared/
    │   ├── ui/           # Legacy; see the note under Styling
    │   └── visits/
    ├── contexts/         # Global React context providers
    ├── features/         # Feature-based architectures and hooks
    ├── hooks/            # Global custom React Hooks
    ├── i18n/             # Localization configs and dictionaries
    ├── lib/              # Utils and client configurations (e.g., Supabase)
    │   └── api/          # Every call to the backend. See Key Features
    ├── middleware.ts     # Edge middleware for navigation/auth
    ├── shared/           # Common code bridging multiple features
    │   ├── contexts/
    │   ├── lib/
    │   ├── types/
    │   └── ui/           # The UI primitives in actual use
    ├── styles/           # See Styling below
    └── types/            # App-wide TypeScript definitions
```

## Coffee guide (`/learn/coffee`)

- **Three kinds of thing, not a timeline.** The old "roadmap" joined five stages with a
  rail and era pills, which told the reader that cold brew branched off espresso and that
  a 1940s Irish coffee came after a 1980s flat white. The hub now groups pages by what
  they are (brewing methods, espresso drinks, coffee with something added); dates live
  in their own list, with no connecting line, where a year only claims a year.
- **Content is data, both languages side by side.** `src/data/coffee/drinks/*.ts`, one
  file per page. Each paragraph carries the `SourceId`s that back it, rendered directly
  under it; `sources.ts` holds every title, publisher and URL once. `reviewed` is the day
  the page's sources were last opened and feeds `dateModified` and the sitemap's
  `lastmod` -- change it when the sources are checked again, never on deploy.
- **Eight thin pages were folded into the page that answers the same question**
  (hand-drip, iced-americano, ristretto, lungo, breve, dutch-coffee, nitro, con-panna).
  `next.config.js` redirects them permanently; the list lives there only.
- **Server components, no motion.** Everything, including sources, is in the server
  HTML and readable with JavaScript off. The one client component is `MapPrompt`, for
  the `learn_cta_clicked` event.
- **Structured data states only what the page shows**: `Article` (headline = the H1,
  `citation` = the linked sources, author and publisher = the site, no invented person)
  and a two-item `BreadcrumbList`. No FAQ markup.
- `npx tsx scripts/check-coffee-guide.ts` fails if the two languages drift apart: section
  anchors, which paragraph cites which source, related links to merged pages, duplicate
  titles.
- **`.paper-grain`** (globals.css) is the hub and the drink page's own background, on top
  of `--surface-page` rather than in place of it: a neutral SVG noise texture, tinted by
  `mix-blend-mode: overlay` from whatever the theme's own page colour is, so one class
  works unmodified across all four themes. Photos per drink are a later addition this
  makes room for, not built yet.

## Settings (2026-09-11)

- **The two OS-native `<select>`s are gone.** Theme and language now use `NavSelect`
  (`components/layout/NavSelect.tsx`, already the header's own switcher), given two new
  optional props -- `triggerClassName` and `panelClassName` -- so a caller outside the
  nav bar can draw a row-width `control-flat` trigger instead of the pill. This was the
  actual fix for "the dropdown isn't in our font": a native `<select>`'s closed box
  already inherits the page's body font through Tailwind's preflight, but Chrome on
  macOS renders the *open* option list in OS chrome regardless of CSS, which no
  amount of `font-family` reaches. A custom-drawn popup is the only fix; other native
  selects in the app (report reason, admin filters, cafe forms) carry the same
  limitation and were left alone -- not requested, and a larger, riskier change.
- **The page sits on one `--radius-card` panel** (`border-edge-rule`, `bg-surface-raised`,
  no shadow) instead of directly on `--surface-page`, matching the panel convention
  elsewhere (`PublicProfileClient`, `my-beans`). All four sections share one `py-10`, the
  first included -- it started as `pb-10` only, which read as more space below the card
  than above it.
- **`Button`'s `danger` variant is fixed, not banned.** It used to map to shadcn's
  `destructive` (a 10% tint under `--state-danger` text, 2.4-3.5:1, why design-language.md
  §4 ruled it out) and most call sites drew a `bg-state-danger` dot beside an ink label by
  hand instead. It now maps to shadcn's plain `outline` and draws `.btn-line-danger`
  (globals.css) over it: a rule in the danger colour at rest, filled solid only on hover
  or press, same mechanic as `btn-line`. Sign out and delete account (`variant="danger"`,
  no dot) are the first callers; the hand-drawn dot elsewhere still reads the same and
  was left alone. The hover text is `--ink-on-brand`, by direction rather than
  measurement -- it clears Dark Roast's own danger fill (5.31:1) but not the three light
  themes' (3.25-3.52:1, under the 4.5:1 body threshold); see design-language.md §4 and §7
  for the reasoning and the fourth on-the-record exception this adds.
- **An account with no password gets a real next step**, not just an explanation.
  `SetPasswordPrompt` names the linked provider (`user.identities` from the server,
  capitalised) and sends the same reviewed, rate-limited reset-link mail the sign-in
  page's "forgot password" already does (`AuthRepository.sendPasswordResetEmail`) --
  reused rather than a second client-side `updateUser` path with no current password to
  verify. Unlike that flow, the confirmation names the reader's own email outright: they
  are already authenticated as themself, so there is no enumeration question to hedge.
- **Body text was already Inter/Pretendard everywhere** (`--font-body` in tokens.css);
  nothing in `@theme`/`tokens.css` changed. The display serif (`h1`-`h3`,
  `--font-display`) stays on the page's own `h1` -- the user chose to keep it when asked,
  rather than flatten the editorial identity design-language.md §1 leads with. The four
  section headings (`h2`) opt out with `font-sans`: read as data groupings, not headlines.
- **Section copy is short on purpose, not accidentally missing.** Each of the four
  sections keeps one line under its heading (`preferences_description` etc.) -- cut once
  for being redundant restatement, put back shorter, cozy rather than clinical ("Make
  yourself at home." / "원하는 분위기로 꾸며보세요"). The delete section's own line stays
  a real warning, not decoration, and was never on the table.
- **Korean settings copy is one register, 해요체**, not the 합니다체/해요체 mix it had.
  Two strings stay formal by request -- the provider sign-in state and the delete
  warning -- because they read as a status/consequence statement rather than the app
  talking to the reader; the rest (confirmations, the preferences line, toasts) stays
  casual. Section titles favour short compounds a Korean settings page would actually
  use (`테마 및 언어`, `개인정보 및 이용 안내`) over a literal pairing of the English words.
- **Account deletion**: the dialog calls `deleteCurrentUser` (`app/actions/account.ts`),
  which forwards to the backend's `DELETE /users/me`. Full flow, release order (migration
  024 before the backend release) and verification: `docs/architecture/account-deletion.md`.

## Legal pages (2026-09-13)

`/privacy`, `/terms` and `/contact` render from `i18n/messages/{en,ko}.json` under
`legal.*`; the pages hold only the section order and the `last_updated` date, which is a
literal in each page file and has to be moved by hand when the copy changes.

The copy had drifted from the product, so each claim now maps to something in the repo.
Check this list before editing either document again -- the failure mode is a policy that
describes an app nobody built.

| Claim | What backs it |
|---|---|
| Website, not a mobile app | `apps/fe` is the only client |
| Session cookie only; no beacons, pixels or tracking cookies | `lib/analytics.ts` `persistence: 'memory'`; the Supabase auth cookie is the rest |
| Four analytics events, not three | `AnalyticsEvent` union in `lib/analytics.ts` |
| Named processors | Supabase, Render, Vercel, Cloudflare, Resend, PostHog, Google Maps |
| A report reaches the operator by mail | `services/email.py` `send_new_report_notification` |
| Deletion removes the account, logs and photos; place data stays with attribution removed | `account-deletion.md` |
| Licence ends when content leaves the active service | not perpetual any more; deletion has to mean something |
| No arbitration, no class-action waiver | removed; the liability section already cited the Ontario consumer act that voids them |
| The operator is a person | there is no incorporated entity |

Two things the documents deliberately no longer say: that a reader has communication
preferences (there is no such setting, and no marketing mail is sent), and that analytics
can be turned off in the app (it cannot).

**Consent is recorded but never read.** `consent_version` is written at signup
(`SignupForm.tsx`, `CompleteProfileForm.tsx`, both `'1.0.0'`) and nothing compares it
against a current version, so a policy change reaches existing accounts silently. That is
tolerable while a change only narrows what the operator claims. A change that takes
something away needs a version bump and a re-consent gate first, and neither exists.

## Sign-out confirmation (`d84257b`)

`shared/ui/ConfirmDialog.tsx` wraps `Modal` with body text, cancel and confirm. Every
string is a prop: the three callers read from three different namespaces. The profile
menu and the mobile drawer close first and render the dialog outside their own popup --
inside the drawer it would unmount in the same frame that opens it.

The confirm takes the `danger` variant to match the row that opened it, which is already
drawn in the danger colour at rest in both menus. The browser's own `confirm()` is not
used, for the reason already recorded against the unfollow dialog: it blocks the page and
cannot be translated.

## Landing register notes (`142f05c`)

The three geometric marks (circle, triangle, square) are one `CoffeeBean` now -- the
shapes implied an order the three facts do not have. It turns a full circle on open and
back on close, as `group-open:rotate-[360deg]` with a 500ms transition. This works only
because Tailwind v4 emits the individual `rotate` property, which interpolates as an
angle; a `transform: rotate(360deg)` would compute to the identity matrix and never
animate.

## Profile and social (`0ecb396`, `882f917`)

- **Trust is followers and following.** `user_trust` has one row per "A trusts B";
  the profile header shows both directions as counts, and either one opens
  `TrustListModal` — fetched on open, not with the profile, because the list is
  unbounded and the page only ever asks about one person.
- **The server says whether you follow this person.** `is_trusted_by_me` rides on the
  public-profile response, which now takes optional auth. The page used to download its
  own entire following list and search it for one name, and answered "you follow
  nobody" for the whole time a newline in a PostgREST `select` was silently dropping the
  embed and returning `[]`. A multi-line `select` string is that bug waiting to happen —
  keep them on one line.
- **Unfollowing asks first.** The button that undoes it is the same button that did it,
  one click away, and the feed of logs it empties does not refill on its own. A `Modal`,
  not `confirm()`: the browser dialog cannot be translated and cannot name the person.
- **Reporting lives in the overflow.** `shared/ui/ActionsMenu` (was
  `components/cafe/CafeActionsMenu`, never cafe-specific) — a rare, irreversible-feeling
  action does not get a control in the row beside the one people came for.
- **Cafe hunter types, not flavour notes.** The eight `taste_tags` describe how someone
  reads a cafe (`bean_hunter`, `quiet_corner`, `work_friendly`), not what an espresso
  tastes like. Ids are enforced only in `app/models/user.py`; `user_taste_tags.tag` has
  no CHECK, so renaming one needs a data pass (migration 023, local).
- **`/shop` and `/community` are gone** (`c9fe635`). Neither was reachable from the app,
  both were in the sitemap, and the shop still sold gear for working in cafes — the
  framing the log was rewritten to drop. The badge gallery went with `/community`; a
  profile badge row is the open replacement.

## Auth screens (`4ea7194`, `cd3f579`)

- **One layout, five pages.** `features/auth/presentation/components/AuthLayout` is
  sign-in, sign-up, forgot-password, reset-password and complete-profile: the landing
  hero's still on the left as an inset card, the form on the right, only the form below
  `lg`. The rules behind it are in `design-language.md` §5 and §6.
- **`AuthHeading` is the page's `h1`, and a form renders its own.** A form with states
  ("sent", "done", "link expired") changes its heading with them, so the heading lives
  in the form component rather than the page. Sign-in and sign-up pass theirs from the
  page because they have one state.
- **`shared/ui/PixelImage`** is magicui's pixel-image rewritten as CSS
  (`.pixel-tile`, `.pixel-color` in `globals.css`): deterministic tile delays, no timer,
  held until the image loads, lazy `next/image` tiles that share one request.
- **`shared/ui/Input` merges classes with `cn()`.** A caller's `className` now wins over
  the base; the only other callers passing one were the two reset forms, whose dead
  overrides went in the same commit.
- **Reset emails go through Supabase's own mailer**, configured in the dashboard — not
  the backend's Resend client. Addresses, SMTP and the template (kept only in the
  dashboard) are written down in `email.md`. When a mail does not arrive, look in the
  Supabase auth log, or send from a development build: the forgot-password form prints
  the real error only in development, because in production it would reveal which
  addresses have an account (design-language §2).

## Header search (2026-09-16)

- **One field for cafes, people and pages.** `components/layout/SiteSearch.tsx` exports
  `SiteSearchBar` (left of the theme switcher at `xl`) and `SiteSearchSheet` (a button
  left of the hamburger below `xl`, opening a full-width sheet across the top). Both
  share one state hook and one results body, so they cannot drift. Base UI
  `Autocomplete` supplies the combobox semantics, arrow keys and dismissal.
- **Sources.** Cafes come from `GET /cafes/search/text`, people from
  `GET /users/search` (display name or username; operator accounts are never offered),
  pages from `lib/search/pages.ts`: a hand-written list of destinations with keywords in
  both locales, plus the coffee guide's drinks. Routes are not read off the router: a
  route is not a destination, and a list is the only place the words a reader would
  type can live.
- **Minimum lengths are the server's.** Cafes need two characters. People need three,
  or two when the query has Hangul in it -- a syllable carries what two or three Latin
  letters do, and most Korean names are two syllables. `personMin` mirrors
  `user_search_min_length`; change both together.
- **A press means its own row** (2026-09-19). An `item-press` change carries the row's
  label, not the row, so the row itself does the picking. It used to follow the
  highlighted row instead, which a pointer sets by hovering and a finger never sets, so
  on a phone a press went nowhere or opened whichever row happened to be highlighted.
  Enter still means the highlighted row: Base UI clicks it.
- **Touch is taken on the release**, because Safari sends no click for a tap at all --
  the list prevents the default on `pointerdown` to keep focus in the input, and WebKit
  drops the compatibility click that follows. Chrome sends it, so a second pick within
  700ms of the first is ignored; by then the list has been cleared and redrawn, and that
  click would otherwise land on whatever row has taken that place. Checked on Chromium,
  Firefox and WebKit, phone and desktop widths.
- **Results arrive after the keystroke**, so when nothing is highlighted Enter takes the
  first row.
- **Category chips keep the popup open** by preventing `mousedown`, which would move
  focus out of the input and close it. `/` focuses the bar from anywhere that is not
  already taking text.

## Own profile at a public address (2026-09-16)

`/profile/{username}` with your own name replaces itself with `/profile`. A follow list
or a search can link there, and the public page offered to follow yourself. The check
compares against the stored profile's username, case-insensitively; it used to read
`user_metadata.username`, which a Google account never carries and which goes stale
once the name is changed.

## Hero media (2026-09-16)

`components/landing/HeroMedia.tsx` plays one of two cuts of the same clip:
`hero-loop.mp4` (2.36:1) from 1024px up, `hero-loop-tall.mp4` (9:16, 720x1280, ~0.85MB)
below it, re-chosen on every width change. Each has a still that is its own first
frame (`hero-wide.webp`, `hero-portrait.webp`), so the fade-in changes nothing on
screen. Neither plays under reduced motion or Save-Data. The source clip holds only the
middle band of the photograph -- no ceiling, no floor -- so the phone cut is tighter
than a still of the photograph could be, and cannot be widened without a new clip.
The clip is also a redrawn version of the photograph rather than the photograph set in
motion (scale drifts across the frame, colour runs ~10% darker), so compositing it
into the photograph to recover that band leaves visible seams. `hero-tall.webp` is
still the auth screen's inset.

## Screen edges on iOS (2026-09-17)

The page runs edge to edge (`viewport-fit=cover` in `app/[locale]/layout.tsx`).
Measured on an iPhone 16 Pro in Safari 26, which is what the rules below answer to:

- **Safari gives a normal tab no safe-area insets.** `env(safe-area-inset-*)` reads 0 in
  portrait, so the insets only take effect in landscape and as a home-screen app. They
  are still applied everywhere an edge is touched, so those two cases hold.
- **`--nav-h`** (`globals.css`) is the fixed bar plus the top inset. Anything that clears
  the header uses it: `main`'s top padding, the hero's pull-up, `Modal`'s top placement,
  the auth layout's height and the guide's `scroll-mt`. A bare `pt-16` or `top-16` goes
  wrong as soon as the inset is not 0.
- **Sideways**, `main`, the header, the footer, the bottom sheet and the search sheet pad
  by the insets (`px-safe`). The landing undoes that with `bleed-x` so its photograph and
  bands still reach the edge, and `MEASURE` adds the inset back to the text.
- **The status bar is painted, not see-through.** Safari 26 ignores `theme-color` and
  tints the status bar from a fixed, full-width element at least 6px tall with its own
  `background-color`, else from the page background. The header is transparent and its
  scrim is an absolute child, which Safari does not sample, so the bar came out beige.
  `.status-tint` is a 6px fixed strip in `--scrim-media`, shown only on coarse pointers
  and stacked under the header so the scrim covers it.
- **Safari draws the page past `100lvh`** under its bottom toolbar: about 58px on that
  phone, and no viewport unit reaches it. On coarse pointers the hero is
  `100lvh + 5rem`. A fixed overshoot; if a device still shows the next section below the
  hero, measure `screen.height` against `100lvh` in JS instead.
- **The canvas is the brand colour.** `html` takes `--brand` and the page colour sits on
  `main`, so overscroll past the footer and the strip under the toolbar continue the
  footer. The page colour cannot stay on `body`: body is `h-full`, so its background would
  end one screen down on a long page.

## Growth track bounds (2026-09-17)

`components/landing/GrowthTrack.tsx` snaps with an underdamped spring. A fast flick back
to the first stage carries enough velocity to settle a few hundredths below 0, and the
segment index taken from that value was -1. `useTransform` runs its transformer during
render, so the lookup on a missing node took the page down with a client-side exception.
Segment indices are clamped to `[0, LAST - 1]` in both `pointAt` and `travelAt`; any new
transform that indexes by track position needs the same clamp.

## Key Features

- **Monorepo-style structure** utilizing App Router (`apps/fe/src/app`)
- **Domain/Feature-based folder architecture** separating primitives (`shared/ui`)
  from feature logic (`features/`, domain `components/`)
- **Built-in i18n capabilities** dynamically routing locales
- **Robust typed configuration** across React, standard web primitives and data
- **Tailwind v4**, configured in CSS rather than a JavaScript config file
- **One door to the backend** (`lib/api/`). `client.ts` holds the base URL, the session
  token, the network-error wrapper and the `detail → message` error shape; each module
  beside it is one area of the API. A component that calls `fetch` on
  `NEXT_PUBLIC_API_URL` with a hand-built `Authorization` header is rebuilding all four,
  and gets a different answer than its neighbours on every one of them.

## Styling

Tailwind v4 has no `tailwind.config.js`. Everything is declared in CSS, and the
stylesheets are layered deliberately:

| File | Holds |
|---|---|
| `styles/globals.css` | The entry point. Imports the rest, declares `@theme`, and holds base and component layers. |
| `styles/fonts.css` | Generated `@font-face` rules. Do not edit by hand — run `scripts/build-fonts.py`. |
| `styles/themes.css` | Layer 1. The only colour literals in the app, one block per theme. |
| `styles/tokens.css` | Layers 2 and 3. Semantic and component tokens, authored once for all themes. |
| `styles/legacy-tokens.css` | Compatibility shims. Scheduled for deletion — see below. |

### Tokens

Three layers, each with one job:

1. **Primitive** (`themes.css`) — the raw palette slots a theme fills in. Adding a theme
   means filling this block and nothing else.
2. **Semantic** (`tokens.css`) — `surface-*`, `ink-*`, `accent*`, `edge-*`, `state-*`,
   plus domain tokens for stars and map markers. **Feature code reads this layer.**

   One naming wrinkle: the brand colour reaches Tailwind as `brand`, not `accent`
   (`bg-brand`, `text-brand`). The old palette already had an `accent` — a pale tint —
   and unmigrated pages still ask for it by that name, so the legacy meaning keeps the
   utility name and the semantic token is exposed under its own. The CSS custom
   property is still `--accent`; only the utility differs.
3. **Component** (`tokens.css`) — `--btn-*`, `--card-*`, `--input-*`, derived from
   layer 2 and never overridden per theme.

Radius is deliberately three values: `--radius-control`, `--radius-card`,
`--radius-pill`. There is no fourth.

There is no third `muted` ink tier. Derived from secondary it cannot clear WCAG AA on
the light themes, and a token that cannot pass is a trap for whoever reaches for it.

`--surface-sunken` and `--surface-hover` are derived by mixing a ground toward ink, so
they are darker than the ground they come from. Ink tuned to just clear on `page` fails
on both. `/theme-demo` measures all four surfaces — check it there, not by reading the
hex values.

### Themes

Four complete visual themes, not a light/dark pair — Dark Roast *is* the dark mode.
They are applied as `data-theme` on `<html>`, set before first paint by a small inline
script in the root layout, so there is no flash. `ThemeContext` sets the attribute;
`lib/themes/palettes.ts` holds names and display names only, never colour values.

Anything needing a theme colour in JavaScript should read the published custom property
(see `getCSSVariable` in `lib/markerStyles.ts`) rather than importing values, so each
colour has exactly one definition.

### Typography

Serif headings over sans body, in both languages, with the pair chosen per locale via
`:lang()`:

| | Display | Body |
|---|---|---|
| English | Playfair Display | Inter |
| Korean | Hahmlet | Pretendard Variable |

Each stack lists the other locale's face as its fallback, which is load-bearing rather
than defensive: cafe names on the English site are Korean.

Every face is self-hosted, because `next.config.js` restricts `font-src` to `'self'`.
Korean faces are split by `unicode-range`, so the file count is large but a page fetches
only the ranges it displays. Rendering the entire Korean message catalogue needs 24 of
Hahmlet's 92 chunks.

Heading weight is driven through the variable `wght` axis, not `font-weight`, so
`--font-display-weight` governs even where a heading still carries a weight utility
class. **A weight utility therefore does nothing to a heading** — display weight is a
system decision, set in `tokens.css`.

### Relief

`.relief-raised`, `.relief-pressed`, and `.relief-control` are the entire neumorphism
budget, and they belong on interactive controls only. Cards, sections and bento cells
stay flat: relief everywhere reads as muddy, and low-contrast card surfaces fail WCAG.

`.relief-control` carries its own hover and press states, so a control signals state
through depth rather than a colour swap. That is not only stylistic — Matcha Latte's
green has no lighter shade left that still carries a legible label.

### The token proof surface

`/theme-demo` renders every semantic token, both relief states, the radius set and the
type scale, reading values back from the live cascade and measuring contrast per theme.
Relief values cannot be judged by reading CSS; tune them there.

### Scheduled deletions

`styles/legacy-tokens.css`, and the legacy half of the `@theme` block in `globals.css`,
exist so pages that have not been reworked keep rendering unchanged during the UI
migration. **They are meant to be deleted once the last page moves over.** If that has
not happened, the migration is not finished.

Deleting them early does not fail the build — Tailwind simply stops generating the
class, and the page ships with no background instead of an error. So the deletion is
gated on a count, not on a feeling. It reaches zero, then they go:

```sh
cd apps/fe && grep -rlE "\b(bg|text|border|from|to|via|ring|fill|stroke|shadow|divide|outline)-(primary|primaryText|secondary|accent|background|cardBackground|surface|text|textSecondary|border|success|warning|error|textHero|cardText|cardTextSecondary|surfaceText|surfaceTextSecondary|authText|starFilled|starEmpty|starEmptyOutline|cardShadow|pending|userMarkerMap|cafeMarker)\b" src --include="*.tsx" --include="*.ts" | wc -l
```

134 files as of the design-system branch. No lint rule guards this: every one of those
files would trip it, and the allowlist keeping them quiet would cost more than the
count does.

`components/ui/` is likewise vestigial: it holds a single file, while `shared/ui/` holds
the primitives actually imported across the app. Reach for `shared/ui`.
