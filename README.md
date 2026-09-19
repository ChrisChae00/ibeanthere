<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/brand/lockup-horizontal-cream.svg" />
    <img src="./docs/brand/lockup-horizontal.svg" alt="ibeanthere" width="360" />
  </picture>
</p>

<p align="center">
  <em>A map for remembering the cup you liked, and finding the next coffee and the beans to take home.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.0.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/Status-Live-success?style=flat-square" alt="Status" />
  <img src="https://img.shields.io/badge/Market-Kitchener--Waterloo-8C5A3A?style=flat-square" alt="Market" />
</p>

<p align="center">
  <strong><a href="https://ibeanthere.app">ibeanthere.app</a></strong>
</p>

<p align="center">
  <a href="#why-20-exists">Why 2.0</a> •
  <a href="#the-logo">The Logo</a> •
  <a href="#decisions-worth-defending">Decisions</a> •
  <a href="#results">Results</a> •
  <a href="#engineering-notes">Engineering</a> •
  <a href="#stack">Stack</a> •
  <a href="#run-it-locally">Run it</a>
</p>

---

## Why 2.0 exists

Version 1 promised "an app for saving independent cafes." Google Maps and Naver already do that, with more data and a decade of head start. Saving a place is not a problem anyone had.

The version 2 promise is narrower and, so far, unclaimed:

> Remember the cup you liked. Find the next coffee, and the beans to take home.

That reframing changed the data model, the map, the badges and the onboarding, because the unit of value moved from **a place you saved** to **a coffee you drank**.

### Who it is for

Someone local who tries new coffee and buys beans when they like one. Coffee knowledge is not an entry requirement. Early users are picked by a recent decision they struggled with, not by "likes coffee" as an interest.

### The three moments it plans for

1. Before going somewhere new for coffee.
2. When the bag at home runs out and the next one has to be chosen.
3. When trying to remember what that good coffee actually was.

**Daily opens are not a goal.** Consumption frequency and app frequency are different problems: someone who drinks the same beans every morning has no reason to log it every morning. Notifications and streak badges can force the number up. This bets on being the thing that comes to mind in those three moments instead.

### First market: Kitchener-Waterloo, on purpose

The promise is completeness, not density:

> Every place in KW where you can buy beans is here.

A small pool is why this market was chosen: it is the only size where auditing every cafe by hand over two weekends is realistic. It is also a university town, so every September and January regenerates a cohort of people who just moved and do not know where the coffee is. Ontario expansion waits until KW is proven; the seed script already carries the bounding box.

Completeness is measured against a stricter set than "places that serve coffee": a cafe is listed only if it is coffee-forward, meaning it can name the roaster of what it pours and coffee is the point of the visit. Holding KW to that bar took the hand-reviewed map from 64 cafes to 39. The rubric is in [cafe curation](./docs/architecture/cafe-curation.md#rule-3-coffee-forward-listing-bar-applied-by-hand).

---

## The Logo

A cup leaves a ring on the table, and that ring is the oldest proof of a visit there is. The line starts heavier at two o'clock where the cup lands, travels around and pools at the bottom the way coffee does, then turns inward into the crease of a coffee bean: the place you visited becomes the coffee you drank. The ring never closes, because there is always a next place. The drop outside the opening is the bean you drop when you log a cup, and it doubles as the dot of the **i**, because the record is yours.

One drawing is used at every size, from the 1024px export to the 32px header, in one flat colour: brand brown on light grounds, cream on dark ones. The app icon, favicons and web manifest icons are all cut from it.

---

## Decisions worth defending

Each one lists what was rejected, because that is where the reasoning lives.

| Decision | Why | Rejected |
|---|---|---|
| A log is an experience; the bean is optional | "I drank this here, liked it, bought the bag" is one record. Requiring origin, process and price to create a bean makes the first log a chore | Bean as the unit of record, with a mandatory catalogue entry before you can log anything |
| A cafe's bean list is derived from public logs | One source of truth, and it can never expose more than the author chose to show | A `cafe_bean_offerings` table fed automatically by every log, which would have leaked who drank what from private and anonymous entries |
| Trait claims need evidence or a queue | Registering means passing a 100m check while standing there; a purchase logged inside the shop means the same check plus having bought the bag. Those write straight through. Everything else waits for review | Trusting every button press on a cafe page, and a review queue nobody drains |
| Franchise filtering reads OpenStreetMap, not a brand list | A hardcoded blocklist stops working the moment you cross a border. Name counting misfires: a global count flags the Toronto cafe "The Link" as a 217-location chain | Maintaining a blocklist by hand, and matching on names |
| Cafe identity is borrowed, not invented | A cafe is the OSM node id or Google place id it already has, each under a partial UNIQUE index | Generating an internal identity and reconciling duplicates later |
| Unclassifiable venues are listed, not rejected | A wrong rejection is invisible to everyone, including the operator. A wrong listing shows up in the review queue | Failing closed on the classifier |
| Listing means coffee-forward, not coffee-serving | A four-tier rubric: own roastery, multi-roaster cafe, espresso and filter bar are listed; tier 4 is defined only as a cafe that cannot name its roaster, so a dessert-first shop that pours a named roaster is listed. Each listed tier is backed by a trait with a dated observation, so tiers are a reviewer's shorthand and never stored | A stored `tier` column that could disagree with the traits; cutting "too much of a dessert shop", which no two reviewers would draw in the same place; equipment and barista-process fields that nobody outside the bar can verify |
| Badges count coming back | Ranking who arrived first rewards the calendar, not the coffee | The 1.x pioneer system (Navigator, Scout), removed in the pivot |

---

## Results

| | Before | After |
|---|---|---|
| Same 5km proximity query, 10,000-row benchmark | 13.8ms | **0.36ms** (~38x, GiST on `earthdistance`) |
| False 429s over 70 rotating client IPs | 11 | **0** |
| Muted text contrast, light themes | 2.35:1 | **≥4.5:1** (WCAG AA) |
| Korean font payload actually downloaded | 887KB | **883KB** (repo 6.1MB → 1.8MB) |
| Feature files touched to swap 5 UI primitives | — | **0** |
| Blocking browser dialogs in app code | 11 | **0** |
| Cafes on the map | 627 | **39 verified KW cafes** (314 after franchise and duplicate removal, then purged and re-seeded by hand against a stricter coffee-forward definition) |

---

## Engineering notes

### Curation: keeping a local coffee map local

Brand size is resolved from the OpenStreetMap `brand:wikidata` tag and counted through Overpass, then cached per brand, so a rejection costs one indexed read. Non-coffee venues are detected from the OSM `cuisine` tag, where a coffee marker always wins, so a cafe that also sells bubble tea stays. Linking stored rows to map nodes uses coordinate proximity plus name matching after exact-coordinate matching silently missed 24 rows named "Starbucks Coffee Company". New local shops in neither dataset get a 25m proximity check instead.

The pass removed 253 franchise locations, 42 tea and juice venues, and 18 duplicates. Every cafe that survived carries its brand verdict and its descriptive traits. Rules: [cafe curation](./docs/architecture/cafe-curation.md).

### Spatial search

The GiST index (`cube` + `earthdistance`, not PostGIS) existed and was unused, with Haversine distance computed in Python. Benchmarking ran against a 10,000-row synthetic Docker dataset isolated from production. The first report compared a ±1° bounding-box query against a 5km radius query, so its 11.1x mixed the index with a smaller search area. Re-measured with the identical 5km predicate and only the index changed, the median went from 13.8ms to 0.36ms (~38x); forcing the planner off the index on the same table gave 14.0ms again, which pins the gain on the index. Buffer counts moved far less on that narrower table (84 to 70), so they are not quoted. The original run is in [PERFORMANCE_REPORT.md](./PERFORMANCE_REPORT.md), which predates this correction.

### Client IP behind a proxy

Behind Render's load balancer, `request.client.host` returned the same value for every user, so a `60/minute` limiter throttled everyone as one bucket. The fix trusts only private ranges, which makes `X-Forwarded-For` parse from the right, past the segment a client can write itself. Setting `--forwarded-allow-ips=*` would have been one flag and would have handed anyone a header that disables throttling. The same audit found the rate-limit key falling back to an unauthenticated `user_id` query parameter, so `?user_id=1,2,3…` bypassed it indefinitely. Removed.

### Design system

Two colour systems had diverged, and forty theme variables were injected by `useEffect` after first paint, so every load flashed. Rebuilding them as three token layers was routine. The proof surface built to check the tokens was not: it found muted text at 2.35:1, a Matcha accent label at 2.62:1, and five CSS variables that 48 files referenced and nothing ever defined. The muted hierarchy had never actually rendered.

Button, Card, Badge, Modal and Tooltip moved onto Base UI behind the existing prop API, so no feature file changed. Accessibility was the reason, not tidiness. The old Modal had no focus trap, no Escape handler and no focus return, which left keyboard and screen reader users tabbing out of an open dialog with no way back.

Fonts are self-hosted because the CSP blocks font CDNs outright. Hahmlet was chosen over Noto Serif KR on what a Korean reader downloads, 883KB against 887KB, rather than on the 3.4x repository size difference that would have picked the other one.

### Security and correctness

Findings that shipped as fixes: report text is escaped in the admin email and dashboard; the password reset form no longer reveals which addresses have an account, and no longer reports success when the mail failed; the follow list had been silently returning empty for every user; map services are held to their published rate limits; five message keys that resolved to nothing now resolve.

Browser-native dialogs are gone from the app. Deleting a coffee log could freeze the tab outright, which left no way to remove a mistaken entry short of deleting the account. Eleven `confirm()` and `alert()` calls now route through the app's own dialog and toast, which also means they are translated, and toasts are announced to screen readers.

### A tap is not a click

Header search results opened nothing on a phone. The press followed the row the list had highlighted, which a mouse sets by hovering and a finger never sets. Fixing only that would have left the bug in place on iOS, because Safari sends no click for a tap on these rows at all: the list prevents the default on `pointerdown` to hold focus in the input, and WebKit then drops the compatibility click, so touch has to be taken on the release. Chrome does send that click, a beat later, after the list has been cleared and redrawn, so it lands on whichever row has moved under the finger. In one recorded run that row was "Register a cafe", which bounced the reader to the sign-in page. One press now counts as one pick. Verified with 24 scripted cases across Chromium, Firefox and WebKit at phone and desktop widths, covering tap, click and keyboard.

### Testing

100 backend tests across 14 modules cover registration policy, trait suggestion evidence, visit and collection privacy, blacklists, account deletion, report safety, badges, and the OSM rate gate. The frontend is verified end to end against a running stack with a real account rather than by build alone: the current run has ten sessions of recorded results, which is where the log deletion freeze, the drop-bean radius mismatch and the silent photo upload failure were found. Run results and evidence are kept with the project rather than in the repository.

---

## Stack

**Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Base UI, next-intl (en/ko), Leaflet, PostHog

**Backend:** FastAPI, Python 3.11, Pydantic, slowapi, PostgreSQL (`cube` and `earthdistance`), Supabase (auth and storage), OpenStreetMap and Overpass

**Four themes** (Morning Coffee, Dark Roast, Matcha Latte, Vanilla Latte) run on the token layer, so contrast is a property of the system rather than of each screen.

---

## Architecture

```text
IBeanThere/
├── apps/
│   ├── fe/                    # Next.js 15 frontend
│   │   ├── src/app/[locale]/  # Localized App Router
│   │   ├── src/shared/ui/     # Primitives (base/ holds the vendor layer)
│   │   ├── src/components/    # Feature components
│   │   ├── src/lib/themes/    # Theme palettes
│   │   └── src/i18n/messages/ # en.json / ko.json
│   │
│   └── be/                    # FastAPI service
│       ├── app/api/v1/        # ~90 routes: cafes, visits, users, collections, admin
│       ├── app/services/      # Overpass, dedupe, curation
│       ├── app/core/          # Permissions, rate limiting, fraud checks
│       └── tests/             # 14 test modules
├── docs/architecture/         # Design docs that ship with the repo
└── docs/brand/                # Logo lockups
```

`docs/architecture/` holds the system designs: frontend and backend structure, curation rules, account deletion, blacklists, collection visibility, the Google photo fallback, analytics, email, and the design language. Product direction, handoff notes and testing evidence stay local, so the repository carries designs rather than working notes.

---

## Run it locally

**Prerequisites:** Node.js 18.18+, Python 3.11, a Supabase project with the `cube` and `earthdistance` extensions enabled.

**Database:** SQL migrations live in `apps/be/scripts/migrations/` and are applied by hand in the Supabase SQL editor, in order. The checked-in set starts at 015, so a fresh checkout is not a full schema bootstrap. See the [backend README](./apps/be/README.md) for the order and prerequisites.

```bash
# Backend
cd apps/be
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add SUPABASE_URL and SUPABASE_SERVICE_KEY
uvicorn app.main:app --reload --port 8000   # docs at /docs
python -m unittest discover -s tests -t tests   # backend tests

# Frontend
cd apps/fe
npm install
cp .env.local.example .env.local            # add NEXT_PUBLIC_SUPABASE_*, NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                                 # http://localhost:3000
```

---

## API surface (`/api/v1`)

| Module | Purpose | Key endpoints |
|---|---|---|
| **Auth** | Session and profile metadata | `/auth/me`, `/auth/verify` |
| **Cafes** | Discovery, geocoding, verification | `GET /cafes`, `POST /cafes/register`, `GET /cafes/{id}/beans`, `GET /cafes/admin/pending` |
| **Visits & logs** | Journaling and geofenced check-ins | `POST /cafes/{id}/visit`, `PATCH /visits/{id}`, `DELETE /visits/{id}` |
| **Beans** | Bean and roaster catalogue, trait suggestions | `GET /beans`, `POST /roasters`, `POST /cafes/{id}/traits` |
| **Users** | Public profiles, follows, badges, deletion | `GET /users/profile/{name}`, `DELETE /users/me` |
| **Collections** | Curated groupings, shareable by token | `GET /collections`, `POST /collections/{id}/share` |
| **Admin** | Review queue, blacklists, deletion history | `GET /admin/blacklists/{kind}`, `DELETE /admin/cafes/{id}` |
| **Reports** | Moderation flagging | `POST /reports` |

---

## Contributing

A personal project, currently open to feedback rather than pull requests. Issues and discussions are welcome.

## License

Code is [MIT](LICENSE). The ibeanthere name, logo and app icons (`docs/brand/` and the logo and icon files in `apps/fe/public/icons/`) are not covered by that license and may not be used without permission.
