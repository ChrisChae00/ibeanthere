'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

/*
  Token proof surface.

  Everything below is read back from the live cascade rather than imported from a
  TypeScript object, so what you see is what the app actually renders. If a token is
  missing or resolves to nothing, it shows up here as blank instead of silently
  inheriting somewhere in a feature page.

  This is also where the control surface is judged: hover and press states cannot be read
  off a stylesheet.

  Names on this page are the names in the code — the token as it is written in
  `tokens.css` and the theme as it is keyed in `palettes.ts` (`espresso`, not
  "Espresso"). A label that only exists on this page is a label nobody can grep.
*/

const SURFACES = [
  '--surface-page', '--surface-raised', '--surface-elevated',
  '--surface-sunken', '--surface-hover', '--surface-inverse',
] as const;
/*
  There is no third `muted` tier on purpose. Mixing secondary ink toward transparent
  lands at 2.7-3.1:1 on the light themes, and a token that cannot pass AA is a trap for
  whoever reaches for it next. If a third tier is ever needed, it gets designed with its
  contrast, not derived from one that barely clears.
*/
const INKS = [
  '--ink-primary', '--ink-secondary', '--ink-on-brand',
  '--ink-on-media', '--ink-inverse',
] as const;
const ACCENTS = ['--brand', '--brand-hover', '--brand-muted', '--scrim-media'] as const;
const EDGES = ['--edge-subtle', '--edge-default', '--edge-strong', '--edge-rule'] as const;
const STATES = ['--state-success', '--state-warning', '--state-danger', '--state-pending'] as const;
const DOMAIN = [
  '--star-filled', '--star-empty', '--star-empty-edge',
  '--marker-cafe', '--marker-user', '--marker-pending', '--marker-ring',
] as const;

/** The tile ground under a map marker. OpenStreetMap stays light in every theme. */
const OSM_TILE = '#f2efe9';

/** sRGB relative luminance, per WCAG 2.1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Resolves any CSS colour syntax (including color-mix) by letting the browser do it.
 * Returns the alpha too: several tokens are deliberately translucent, and measuring
 * their raw channels against a background reports a contrast they never actually have.
 */
function parseColor(value: string): [number, number, number, number] | null {
  if (!value) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const match = resolved.match(/(\d+(?:\.\d+)?)/g);
  if (!match || match.length < 3) return null;
  // color-mix() comes back as `color(srgb r g b / a)` with 0-1 channels, while plain
  // colours come back as `rgb()` with 0-255. Reading one as the other turns every
  // mixed token into near-black and reports contrast failures that do not exist.
  const scale = resolved.startsWith('color(') ? 255 : 1;
  const alpha = match.length > 3 ? Number(match[3]) : 1;
  return [Number(match[0]) * scale, Number(match[1]) * scale, Number(match[2]) * scale, alpha];
}

/** Flattens a translucent foreground onto its background before measuring. */
function composite(
  fg: [number, number, number, number],
  bg: [number, number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as [number, number, number];
}

/**
 * Both sides are CSS expressions, not token names, so a pairing that only exists as a
 * mix in a feature file (`bg-brand/12`, the 72% scrim over a blown-out photo) can be
 * measured as the code actually writes it.
 */
function contrast(fg: string, bg: string): number | null {
  const ca = parseColor(fg);
  const cb = parseColor(bg);
  if (!ca || !cb) return null;
  const la = luminance(composite(ca, cb));
  const lb = luminance([cb[0], cb[1], cb[2]]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Swatch({ token, signature }: { token: string; signature: string }) {
  const [value, setValue] = useState('');
  // `signature` is not read in the body - it is here so switching themes re-runs the
  // read. Without it the swatch repaints (the background is a live var) while the value
  // printed under it stays on the first theme, which is worse than showing nothing.
  useEffect(() => setValue(readToken(token)), [token, signature]);

  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-(--radius-control) border border-edge-default"
        style={{ background: `var(${token})` }}
      />
      <div className="leading-tight">
        <code className="text-sm font-medium text-ink-primary">{token}</code>
        <div>
          <code className="text-xs text-ink-secondary">{value || '— unresolved'}</code>
        </div>
      </div>
    </div>
  );
}

function ContrastRow({ label, fg, bg, signature, min = 4.5, note }: {
  /** What the pairing is called in the code that draws it. */
  label: string;
  fg: string;
  bg: string;
  signature: string;
  /**
   * 4.5 for text, 3 for a non-text boundary that carries meaning (a pin, a filled
   * control's silhouette). 0 reports the number without a verdict: a hairline that
   * divides two panels is decoration, and holding it to 3:1 would turn every divider
   * into a border.
   */
  min?: number;
  note?: string;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  // Same as Swatch: `signature` is the trigger, not an input.
  useEffect(() => setRatio(contrast(fg, bg)), [fg, bg, signature]);

  const passes = ratio !== null && ratio >= min;
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-(--radius-control) px-4 py-3"
      style={{ background: bg, color: fg }}
    >
      <span className="text-sm">
        <code>{label}</code>
        {note && <span className="ml-2 opacity-80">{note}</span>}
      </span>
      <span className="text-sm font-semibold tabular-nums">
        {ratio === null
          ? '—'
          : min === 0
            ? `${ratio.toFixed(2)}:1`
            : `${ratio.toFixed(2)}:1 ${passes ? 'PASS' : 'FAIL'} (${min})`}
      </span>
    </div>
  );
}

function Section({ title, note, children }: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="mb-1 text-2xl font-semibold text-ink-primary">{title}</h2>
      {note && <p className="text-sm text-ink-secondary">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function ThemeDemoPage() {
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const themeKey = currentTheme.name;
  // Every read below re-runs when this changes; a stale ratio would report a pass
  // for a theme that fails.
  const signature = themeKey;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-ink-primary">Design tokens</h1>
        <p className="mt-2 max-w-2xl text-ink-secondary">
          Read live from the cascade, not from a palette object. Names are the ones in the
          code: tokens as written in <code>tokens.css</code>, themes as keyed in{' '}
          <code>palettes.ts</code>. Switch themes and confirm every pairing still clears
          its threshold.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {availableThemes.map((theme) => (
            <button
              key={theme.name}
              onClick={() => setTheme(theme.name)}
              className={`control-flat rounded-(--radius-pill) px-5 py-2.5 text-left text-sm font-medium ${
                theme.name === currentTheme.name ? 'is-active' : ''
              }`}
            >
              <code>{theme.name}</code>
              <span className="ml-2 opacity-70">{theme.displayName}</span>
            </button>
          ))}
        </div>
      </header>

      <Section title="Surfaces">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
          {SURFACES.map((s) => <Swatch key={s} signature={signature} token={s} />)}
        </div>
      </Section>

      <Section title="Ink">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
          {INKS.map((s) => <Swatch key={s} signature={signature} token={s} />)}
        </div>
      </Section>

      <Section title="Accent, edges, state">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-5">
          {[...ACCENTS, ...EDGES, ...STATES].map((s) => (
            <Swatch key={s} signature={signature} token={s} />
          ))}
        </div>
      </Section>

      <Section title="Domain" note="Stars and map markers travel with the theme, except the ones printed on OpenStreetMap's tiles.">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
          {DOMAIN.map((s) => <Swatch key={s} signature={signature} token={s} />)}
        </div>
      </Section>

      <Section
        title="Contrast — text (4.5:1)"
        note="Every pairing here must clear 4.5:1 in all four themes, and the derived surfaces count - they are darker than the grounds they come from, so tuning ink against page alone is not enough."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <ContrastRow signature={signature} label="--ink-primary / --surface-page" fg="var(--ink-primary)" bg="var(--surface-page)" />
          <ContrastRow signature={signature} label="--ink-primary / --surface-raised" fg="var(--ink-primary)" bg="var(--surface-raised)" />
          <ContrastRow signature={signature} label="--ink-primary / --surface-elevated" fg="var(--ink-primary)" bg="var(--surface-elevated)" />
          <ContrastRow signature={signature} label="--ink-primary / --surface-sunken" fg="var(--ink-primary)" bg="var(--surface-sunken)" />
          <ContrastRow signature={signature} label="--ink-secondary / --surface-page" fg="var(--ink-secondary)" bg="var(--surface-page)" />
          <ContrastRow signature={signature} label="--ink-secondary / --surface-raised" fg="var(--ink-secondary)" bg="var(--surface-raised)" />
          <ContrastRow signature={signature} label="--ink-secondary / --surface-sunken" fg="var(--ink-secondary)" bg="var(--surface-sunken)" />
          <ContrastRow signature={signature} label="--ink-secondary / --surface-hover" fg="var(--ink-secondary)" bg="var(--surface-hover)" />
          <ContrastRow signature={signature} label="--ink-on-brand / --brand" fg="var(--ink-on-brand)" bg="var(--brand)" />
          <ContrastRow signature={signature} label="--ink-on-brand / --brand-hover" fg="var(--ink-on-brand)" bg="var(--brand-hover)" />
          <ContrastRow signature={signature} label="--ink-inverse / --surface-inverse" fg="var(--ink-inverse)" bg="var(--surface-inverse)" />
        </div>
      </Section>

      <Section
        title="Contrast — Phase 4 surfaces"
        note="The pairings the discover pages introduced: the active filter pill's brand tint, the label on a photo under the scrim, and the ink a status badge falls back to. Status colour is emphasis, never the label itself - it carries no meaning on its own."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <ContrastRow
            signature={signature}
            label="--ink-primary / bg-brand/12 on --surface-raised"
            fg="var(--ink-primary)"
            bg="color-mix(in srgb, var(--brand) 12%, var(--surface-raised))"
            note="active filter pill"
          />
          <ContrastRow
            signature={signature}
            label="--ink-secondary / bg-brand/12 on --surface-raised"
            fg="var(--ink-secondary)"
            bg="color-mix(in srgb, var(--brand) 12%, var(--surface-raised))"
          />
          <ContrastRow
            signature={signature}
            label="--ink-primary / bg-brand/12 on --surface-page"
            fg="var(--ink-primary)"
            bg="color-mix(in srgb, var(--brand) 12%, var(--surface-page))"
          />
          <ContrastRow
            signature={signature}
            label="--ink-on-media / --scrim-media 72% over white"
            fg="var(--ink-on-media)"
            bg="color-mix(in srgb, var(--scrim-media) 72%, white)"
            note="worst case: blown-out photo"
          />
          <ContrastRow
            signature={signature}
            label="--ink-on-media / black 50% + --scrim-media 30% over white"
            fg="var(--ink-on-media)"
            bg="color-mix(in srgb, var(--scrim-media) 30%, color-mix(in srgb, black 50%, white))"
            note="hero: both washes, blown-out frame"
          />
          <ContrastRow
            signature={signature}
            label="--ink-primary / --state-danger 12% on --surface-raised"
            fg="var(--ink-primary)"
            bg="color-mix(in srgb, var(--state-danger) 12%, var(--surface-raised))"
            note="error banner"
          />
        </div>
      </Section>

      <Section
        title="Contrast — non-text (3:1)"
        note="Boundaries, not labels: a filled control's silhouette, a pin on the map. WCAG asks 3:1 of the ones that carry meaning. Hairlines are reported without a verdict - they are decoration, and a divider held to 3:1 becomes a border. matchaLatte's brand is a deliberate exception - see themes.css."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <ContrastRow signature={signature} min={0} label="--edge-rule / --surface-raised" fg="var(--edge-rule)" bg="var(--surface-raised)" note="hairline" />
          <ContrastRow signature={signature} min={0} label="--edge-rule / --surface-page" fg="var(--edge-rule)" bg="var(--surface-page)" note="hairline" />
          <ContrastRow signature={signature} min={0} label="--edge-default / --surface-raised" fg="var(--edge-default)" bg="var(--surface-raised)" note="hairline" />
          <ContrastRow signature={signature} min={3} label="--brand / --surface-page" fg="var(--brand)" bg="var(--surface-page)" note="filled control silhouette" />
          <ContrastRow signature={signature} min={3} label="--brand / --surface-raised" fg="var(--brand)" bg="var(--surface-raised)" />
          <ContrastRow signature={signature} min={3} label={`--marker-cafe / ${OSM_TILE}`} fg="var(--marker-cafe)" bg={OSM_TILE} note="OSM tile" />
          <ContrastRow signature={signature} min={3} label={`--marker-user / ${OSM_TILE}`} fg="var(--marker-user)" bg={OSM_TILE} note="fixed, not theme-derived" />
          <ContrastRow signature={signature} min={3} label={`--marker-pending / ${OSM_TILE}`} fg="var(--marker-pending)" bg={OSM_TILE} />
        </div>
      </Section>

      <Section
        title="Controls"
        note="Flat. A control is a rule and a fill, and state is the fill inverting — hover the outline control, then the selected one. Nothing lifts, nothing glows: no shadow and no transform anywhere in this row."
      >
        <div className="flex flex-wrap items-center gap-6 rounded-(--radius-card) bg-surface-raised p-8">
          <button className="control-flat rounded-(--btn-radius) px-6 py-3">
            control-flat
          </button>
          <button className="control-flat is-active rounded-(--btn-radius) px-6 py-3">
            control-flat is-active
          </button>
          <button className="btn-shade rounded-(--btn-radius) bg-brand px-6 py-3 font-semibold text-ink-on-brand">
            btn-shade on --brand
          </button>
          <input
            className="rounded-(--input-radius) border border-edge-rule bg-surface-raised px-4 text-ink-primary outline-hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
            style={{ height: 'var(--input-height)' }}
            placeholder="--input-height / --input-radius"
          />
          <div className="grid size-12 place-items-center rounded-(--radius-pill) border border-edge-rule bg-surface-raised text-ink-primary">
            &#9733;
          </div>
          <div className="rounded-(--radius-card) border border-edge-rule bg-surface-raised px-6 py-3 text-ink-primary shadow-(--shadow-panel)">
            --shadow-panel (floating panels only)
          </div>
        </div>
      </Section>

      <Section title="Radius" note="Two values and a pill. Nothing else.">
        <div className="flex flex-wrap gap-6">
          {(['--radius-control', '--radius-card', '--radius-pill'] as const).map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div
                className="size-24 border border-edge-default bg-surface-raised"
                style={{ borderRadius: `var(${r})` }}
              />
              <code className="text-xs text-ink-secondary">{r}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale" note="--font-display for headings, --font-body for everything else.">
        <div className="space-y-4">
          <h1 className="text-ink-primary">Heading one</h1>
          <h2 className="text-ink-primary">Heading two</h2>
          <h3 className="text-ink-primary">Heading three</h3>
          <p className="type-subtitle">type-subtitle &mdash; the line under a section heading.</p>
          <p className="type-body text-ink-primary">
            type-body. The editorial contrast is meant to come from the display and body
            split, not from stacking more weights onto one family.
          </p>
          <p className="type-caption">type-caption</p>
        </div>
      </Section>
    </div>
  );
}
