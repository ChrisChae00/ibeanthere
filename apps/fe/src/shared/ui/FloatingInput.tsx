'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/*
  A field whose label sits on its top rule and drops inside it while there is nothing
  to read. The log form asks for several optional things in a row, and a stack of
  permanent labels above permanent boxes made a short form look long.

  The rule, the padding and the focus state belong to the wrapper; the input itself is
  bare. That is not tidiness -- a textarea's own padding scrolls with its text, so a
  long comment rode up into the top padding and came out from behind the label at the
  rule. Padding the wrapper instead leaves the text scrolling inside its own box,
  where it cannot reach the edge.

  Nothing is filled. Raised, the label paints over the rule to cut it, and it can only
  paint one colour -- so it must have one colour behind it. Fill the field and the
  label straddles a boundary: its top half lands on the container, its bottom half on
  the field, and one of them is wrong. Three of the four themes hid that by setting
  `--c-raised` and `--c-elevated` to the same value; espresso does not.

  No `useState` here on purpose. Whether the field is empty is already a CSS
  question (`:placeholder-shown`), and the version that tracked it in React only
  updated on change and blur: a field rendered with a value already in it -- every
  edit -- opened with the label lying across the text.
*/

type FieldProps = InputHTMLAttributes<HTMLInputElement> &
  TextareaHTMLAttributes<HTMLTextAreaElement>;

export interface FloatingInputProps extends Omit<FieldProps, 'size' | 'placeholder'> {
  label: string;
  error?: string;
  multiline?: boolean;
  /** Sits in the field's bottom corner: a character count, a unit, a short note. */
  endHint?: ReactNode;
}

const FloatingInput = forwardRef<HTMLInputElement | HTMLTextAreaElement, FloatingInputProps>(
  ({ label, error, multiline = false, endHint, className, id, rows = 4, ...props }, ref) => {
    const generatedId = useId();
    const fieldId = id || generatedId;
    const Component = multiline ? 'textarea' : 'input';

    return (
      <div>
        {/* `field-float` in globals.css places the label and moves it. */}
        <div className="field-float">
          <div
            className={cn(
              'rounded-(--radius-control) border px-3 pt-3 transition-colors',
              'focus-within:border-brand',
              endHint ? 'pb-7' : 'pb-3',
              error ? 'border-state-danger' : 'border-edge-rule'
            )}
          >
            <Component
              id={fieldId}
              ref={ref as never}
              /* A non-empty placeholder would keep `:placeholder-shown` false and pin
                 the label up with nothing under it. */
              placeholder=" "
              rows={multiline ? rows : undefined}
              aria-invalid={Boolean(error)}
              className={cn(
                'block w-full bg-transparent text-ink-primary outline-none',
                'placeholder:text-transparent',
                multiline ? 'scrollbar-quiet h-24 resize-none leading-relaxed' : 'h-5',
                className
              )}
              {...props}
            />
          </div>
          <label htmlFor={fieldId}>{label}</label>
          {endHint && (
            <span className="landing-micro pointer-events-none absolute bottom-2 right-3 text-ink-secondary">
              {endHint}
            </span>
          )}
        </div>
        {error && <p className="mt-1 text-sm text-state-danger">{error}</p>}
      </div>
    );
  }
);

FloatingInput.displayName = 'FloatingInput';

export default FloatingInput;
