import type { ReactNode } from 'react';
import { PixelImage } from '@/shared/ui';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle: string;
}

/*
  Photograph on the left, form on the right, split in half. It sits inset as a card
  rather than bleeding to the edge: it is a picture beside the form, not the page's
  ground.

  Below `lg` the photograph is not rendered at all and the form is the whole page: a
  half-width panel on a phone is a strip of wall above the fields. The photograph's
  tiles stay lazy for the same reason -- a lazy image inside `display: none` is never
  fetched.

  The height is the viewport less the fixed header (`h-16`, which `main` pads for), so
  the photograph ends at the fold instead of running 64px under it.

  The title here is set as a paragraph, not a heading. It disappears on a phone, so
  the page's `h1` belongs to the form column, which is the one thing every width shows.
*/
export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="grid min-h-[calc(100svh-var(--nav-h))] lg:grid-cols-2">
      <div className="hidden p-4 lg:block">
        <div className="relative h-full overflow-hidden rounded-card bg-scrim-media">
          <PixelImage src="/pics/auth-panel.webp" sizes="50vw" />
          <div className="absolute inset-0 bg-linear-to-t from-scrim-media/85 via-scrim-media/25 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
            <p className="landing-display max-w-lg text-5xl text-ink-on-media break-keep xl:text-6xl">
              {title}
            </p>
            <p className="mt-6 max-w-md border-t border-ink-on-media/20 pt-6 text-lg leading-relaxed text-balance text-ink-on-media/85 break-keep">
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-surface-page px-6 py-12 md:py-16">
        <div className="w-full max-w-105">{children}</div>
      </div>
    </div>
  );
}

/*
  The form column's own heading, shared by every auth screen and every state of one
  (a form, its "email sent", its "done"). It is the page's `h1` for the reason above,
  and it blurs in first so the form's own stagger follows it.
*/
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="blur-fade mb-8 text-center">
      <h1 className="text-3xl text-ink-primary md:text-4xl">{title}</h1>
      {subtitle && (
        <p className="mt-2 text-sm text-balance text-ink-secondary break-keep">{subtitle}</p>
      )}
    </div>
  );
}
