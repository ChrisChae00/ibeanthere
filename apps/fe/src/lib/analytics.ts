import type { CaptureResult, PostHog } from 'posthog-js';

/*
  The four-week question, and the smallest instrument that answers it.

  `docs/product/direction.md` asks three things about the people who had a chance to
  come back: did the app pick where they went, did they return on their own, did they
  look at what they wrote. That is three events and a pageview -- plus one for whether
  the coffee guide sends anyone to the map -- not a funnel builder,
  not session replay, not autocapture. Autocapture in particular would record every
  click on a page whose whole content is other people's coffee logs, which is more of
  other people's writing than a usage question needs.

  **Nothing is stored on the reader's device.** `persistence: 'memory'` means no cookie
  and no localStorage entry, so there is no consent banner to show and nothing to clear.
  The cost is stated in the direction doc and is not a bug: an anonymous visitor is a
  new person on every visit, so *return* is only measurable for someone signed in, whose
  id we already know. Every number about coming back is therefore a number about
  logged-in people, and reading it as "our visitors" would overstate it.

  Without `NEXT_PUBLIC_POSTHOG_KEY` every function here does nothing. A developer with
  no key -- and a self-hosted copy -- runs the app with analytics simply absent, rather
  than with a client throwing on each call or, worse, quietly sending somewhere else.

  **`posthog-js` is imported at runtime, not built in.** Imported normally it lands in
  the layout's chunk, which is 285KB of parsed JavaScript on every page in the app --
  more than everything else the layout loads put together, to answer three questions.
  So the module is fetched after mount and only when a key exists, and the calls that
  arrive before it lands wait in a queue.
*/

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/*
  The whole vocabulary. Adding a fourth is a product decision, not a convenience, so it
  costs an edit here -- an event nobody agreed to collect is the one that turns up in a
  dashboard six months later with nobody able to say what it counts.

  - cafe_detail_opened: a cafe page was read.
  - cafe_action_taken:  a door out to the real world -- directions, or the map link.
  - coffee_log_saved:   a cup was written down. `mode` separates drinking from buying.
  - learn_cta_clicked:  a reader of the coffee guide took its one prompt to the map.
                        `cta` says which prompt (`cafe` or `beans`), `page` whether it
                        was the guide itself or a drink page. Which drink is left out,
                        for the same reason its slug is masked in the path.
  - signed_up:          an account was created. `method` is `email` or `google`. Sent
                        from the browser, so an ad blocker hides it: the true total
                        lives in Supabase auth, this one is for trends and sources.

  The three cafe events carry `cafe_id`, and it is the uuid, never the slug: the same
  cafe is reachable under both, and two names for one place is how "opened it, then took
  the directions" stops being visible as one sequence.
*/
export type AnalyticsEvent =
  | 'cafe_detail_opened'
  | 'cafe_action_taken'
  | 'coffee_log_saved'
  | 'learn_cta_clicked'
  | 'signed_up';

let client: PostHog | null = null;

/*
  Calls made before the client exists wait here. It starts as a queue rather than empty
  because the first pageview happens before we know who is reading -- see `start`.

  `null` means no more queueing: either the client landed, or there will never be one.
  An ad blocker makes the import never resolve, so the queue is capped; without a cap it
  would hold a closure per interaction for as long as the tab is open, and these events
  are not worth a leak.
*/
let pending: ((client: PostHog) => void)[] | null = [];
const QUEUE_LIMIT = 20;

function stopQueueing() {
  pending = null;
}

/*
  Start once, with whoever is signed in.

  The id has to be known at `init`, not sent afterwards with `identify`, and PostHog
  says why in a console warning: with memory persistence it mints a fresh anonymous id
  on every page load, so `identify` on each load merges yet another id onto the same
  person until they cross the distinct-id limit -- at which point their events stop
  showing up at all. Bootstrapping the account id instead means a signed-in reader is
  the same person on every visit with nothing stored on their device, which is exactly
  what we wanted from this configuration.

  So the caller waits for the session to resolve before calling this. `identify` below
  is then only for the one transition that can happen mid-page: signing in.
*/
/* Set before the import is awaited, not after. `client` alone is not a guard: React's
   strict mode runs the starting effect twice, and both calls got past a check on a value
   that only exists once the module has landed -- PostHog answered with "You have already
   initialized PostHog!". */
let starting = false;

export function start(userId: string | null): void {
  if (starting) return;
  starting = true;

  if (!KEY || typeof window === 'undefined') {
    // No key configured: the queue would otherwise fill to its cap and sit there.
    stopQueueing();
    return;
  }

  import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        persistence: 'memory',
        // Their own id, so no anonymous id is minted and no merge is needed. Absent for
        // a reader who is not signed in -- that visitor is deliberately uncounted
        // across visits.
        bootstrap: userId ? { distinctID: userId, isIdentifiedID: true } : undefined,
        // The App Router changes the URL without a page load, so the automatic version
        // fires once per hard navigation and then never again. Sent by hand instead.
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        /* Skips the remote-config request PostHog makes on every load to fetch feature
           flags, surveys and web-vitals settings. We use none of those, and the whole
           point of the events above is that what gets collected is decided here in the
           repository rather than in a dashboard. Costs one fewer request per page. */
        advanced_disable_flags: true,
        /* The page title, which on a cafe page is its name and street address and on a
           profile page is somebody's username. The shaped path already says which kind
           of page it was, so the title adds nothing a usage question needs. */
        property_denylist: ['title'],
        /* Last stop before anything leaves the browser. `sanitize_properties` does the
           same job and is deprecated; this hook also sees events PostHog raises on its
           own, which is the point -- nothing gets out without passing through here.

           All three bags, not just `properties`. `$set_once` is a *sibling* of
           `properties` on the event, and PostHog fills it with the initial URL, path
           and referrer of the session -- so a reader who arrived on a share link or a
           profile carried that entire URL, token and query included, on their first
           event while `properties` looked clean. The deprecated hook was handed
           `$set_once` explicitly; this one has to reach for it. */
        before_send: sanitizeEvent,
      });

      const queued = pending || [];
      client = posthog;
      stopQueueing();
      for (const send of queued) send(posthog);
    })
    // Blocked, offline, or the CDN is down. Drop what is queued: a client that failed
    // to load is not a reason to hold anything.
    .catch(stopQueueing);
}

function withClient(run: (client: PostHog) => void): void {
  if (client) {
    run(client);
  } else if (pending && pending.length < QUEUE_LIMIT) {
    pending.push(run);
  }
}

/*
  PostHog reads `location` and the clock when an event is *sent*, and the queue above
  means sent is not when it happened. A pageview raised on `/my-logs` while the session
  was still resolving flushes once the module lands, by which point the reader has moved
  on -- and arrives stamped with the page they moved to. Every queued event on a first
  load reported the last page instead of its own, which is exactly the reading
  "did they look back at what they wrote" depends on.

  So the page and the moment are stamped here, at the call. Properties passed to
  `capture` win over the ones PostHog collects for itself, and `before_send` shapes
  ours the same as any other.
*/
function send(event: string, properties: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const timestamp = new Date();
  const { href, pathname } = window.location;
  withClient((posthog) =>
    posthog.capture(
      event,
      { ...properties, $current_url: href, $pathname: pathname },
      { timestamp }
    )
  );
}

export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  send(event, properties || {});
}

/*
  Only for a change of reader within one page: signing in, or signing out. The identity
  a page *starts* with is bootstrapped in `start`, so this is not called on load.

  Only the user id goes across. Email and username are not sent: they are not needed to
  count returns, and an analytics vendor is a second place they would then live.
*/
export function identify(userId: string | null): void {
  withClient((posthog) => {
    if (userId) {
      posthog.identify(userId);
    } else {
      // Signing out mints a new anonymous id, which is the point: what the next person
      // at this browser does is not the last one's history.
      posthog.reset();
    }
  });
}

export function capturePageview(locale: string): void {
  // The raw URL is stamped by `send` and shaped by `sanitizeUrls` on the way out, the
  // same as every other event. `locale` is passed because the shaped path no longer
  // carries it, and which language people read the app in is the one thing the locale
  // segment was telling us.
  send('$pageview', { locale });
}

/*
  The part of this worth a check: which URL an event is allowed to report.

  PostHog reads `$current_url`, `$pathname` and `$referrer` off `location` for *every*
  event, so it is not enough to be careful in `capturePageview` -- the raw URL rides
  along on `cafe_detail_opened` too. Hence a sanitiser at the client, applied once to
  everything, rather than a rule each caller has to remember.

  Two things it fixes. Every path in this app starts with a locale, and the ids in it
  are a cafe uuid or slug, a username, or a share token. Left alone, `/en/cafes/x` and
  `/ko/cafes/x` are two pages and every cafe is its own page, so "how many cafe pages
  were opened" would mean counting a few hundred distinct URLs and no total. And a
  username or a share token in a URL is not ours to hand to an analytics vendor. The
  identity of the *cafe* still travels, as a property of `cafe_detail_opened`, where it
  can be counted or ignored on purpose.

  Query strings go entirely. They are how the rest of the app passes a `returnUrl`, and
  that carries the very path being masked here.
*/

// The segment after one of these is an identifier. Recognising ids by "looks like a
// uuid" instead would leave slugs and usernames -- most of our dynamic URLs -- exposed.
const ID_PARENTS = new Set(['cafes', 'coffee', 'profile', 'shared']);

export function routeShape(pathname: string): string {
  // The locale segment is always first, and travels as its own property instead.
  const rest = pathname.split('/').filter(Boolean).slice(1);
  if (rest.length === 0) return '/';

  const shaped = rest.map((part, index) =>
    index > 0 && ID_PARENTS.has(rest[index - 1]) ? ':id' : part
  );

  return '/' + shaped.join('/');
}

/*
  `origin` is our own. A URL from somewhere else is a referrer: its path is not ours to
  reshape and its shape means nothing to us, so it keeps its path and loses its query --
  where somebody came from is worth knowing, what they searched for on the way is not.
*/
export function shapeUrl(raw: string, origin: string): string {
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL at all: `$referrer` is the string "$direct" on a first visit.
    return raw;
  }
  return url.origin === origin ? url.origin + routeShape(url.pathname) : url.origin + url.pathname;
}

/*
  Matched by suffix rather than by name, so a property PostHog adds in some later version
  is covered without a list to keep up to date. Worth the width: an earlier version of
  this matched `current_url` exactly and sailed past `$session_entry_url`, which carries
  the whole entry URL including its query string.
*/
const URL_KEY = /(url|referrer)$/i;
const PATH_KEY = /pathname$/i;

export function sanitizeUrls(
  properties: Record<string, unknown>,
  origin: string = window.location.origin
): Record<string, unknown> {
  const shaped = { ...properties };
  for (const [key, value] of Object.entries(shaped)) {
    if (typeof value !== 'string') continue;
    if (URL_KEY.test(key)) shaped[key] = shapeUrl(value, origin);
    else if (PATH_KEY.test(key)) shaped[key] = routeShape(value);
  }
  return shaped;
}

/*
  The `before_send` hook, out here so `scripts/check-analytics.ts` can run a real event
  through the thing that actually ships rather than through a copy of it.
*/
export function sanitizeEvent<T extends CaptureResult | null>(event: T): T {
  if (!event) return event;
  event.properties = sanitizeUrls(event.properties || {});
  if (event.$set) event.$set = sanitizeUrls(event.$set);
  if (event.$set_once) event.$set_once = sanitizeUrls(event.$set_once);
  return event;
}
