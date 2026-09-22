'use client';

import { useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LogFormData, CoffeeLog } from '@/types/api';
import { Button, FloatingInput, PhotoUpload, StarRating } from '@/shared/ui';
import NavSelect from '@/components/layout/NavSelect';
import { useAuth } from '@/hooks/useAuth';
import AdvancedCoffeeSection from './logging/AdvancedCoffeeSection';
import BeanPicker, { BeanSelection, EMPTY_SELECTION } from './logging/BeanPicker';

/*
  One screen, two things a person can record here: a cup they drank, or a bag they
  bought. The mode is the first control because it changes what the rest of the form
  is asking for -- a drink wants a rating, a purchase wants to know which bean.

  A drink is the long one -- eleven questions, and a form that asks eleven questions
  to record one coffee gets abandoned at the fourth -- so all it shows outright is a
  photo, the rating it requires, would-you-again and who can see it. The rest waits
  behind "add details".

  A bag asks three more things in total and shows all of them. There is nothing to
  protect the reader from, and hiding them only meant they went unanswered.
*/

interface CoffeeLogFormProps {
  initialData?: CoffeeLog;
  onSubmit: (data: LogFormData) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

const COFFEE_TYPES = [
  'Espresso', 'Americano', 'Latte', 'Cappuccino', 'Macchiato',
  'Cortado', 'Mocha', 'Flat White', 'Cold Brew', 'Iced Coffee', 'Other',
];

/* The two places this app has cafes in. A log written before the list was cut can
   still carry something else, so the stored code is offered back to it below rather
   than silently rewritten to CAD the next time that log is saved. */
const CURRENCIES = ['CAD', 'USD'];

/* Zone names identify a country even where two countries keep the same clock:
   Toronto and New York are both Eastern and are still different zones.
   ponytail: the common US zones only. A reader in one of the smaller ones gets CAD
   and the picker; extend the list if that ever shows up in real logs. */
const US_TIME_ZONES = new Set([
  'America/New_York',
  'America/Detroit',
  'America/Chicago',
  'America/Menominee',
  'America/Denver',
  'America/Boise',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Juneau',
  'America/Indiana/Indianapolis',
  'America/Kentucky/Louisville',
  'Pacific/Honolulu',
]);

const ATMOSPHERE_TAGS = [
  'cozy', 'modern', 'minimalist', 'casual',
  'industrial', 'vintage', 'bright', 'spacious', 'artistic',
];

/* The clock, not the language: someone in Toronto reading the app in Korean is
   still paying in dollars, and the browser language said otherwise. */
function defaultCurrency() {
  if (typeof window === 'undefined') return 'CAD';
  try {
    return US_TIME_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone) ? 'USD' : 'CAD';
  } catch {
    return 'CAD';
  }
}

/* Three states of one decision, not two independent switches. Two toggles let a
   reader set "not public" and "anonymous" together and then wonder which won. */
type Visibility = 'public' | 'anonymous' | 'private';

function visibilityOf(log?: CoffeeLog): Visibility {
  if (!log) return 'public';
  if (!log.is_public) return 'private';
  return log.anonymous ? 'anonymous' : 'public';
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full -space-x-px">
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`control-flat min-h-11 flex-1 px-3 text-sm ${
            index === 0 ? 'rounded-l-(--radius-pill)' : ''
          } ${index === options.length - 1 ? 'rounded-r-(--radius-pill)' : ''} ${
            value === option.id ? 'is-active' : ''
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function CoffeeLogForm({ initialData, onSubmit, onCancel, isLoading }: CoffeeLogFormProps) {
  const t = useTranslations('cafe.log');
  const { user } = useAuth();

  const [mode, setMode] = useState<'drink' | 'purchase'>(initialData?.mode || 'drink');
  const [rating, setRating] = useState<number>(initialData?.rating || 0);
  const [photoUrls, setPhotoUrls] = useState<string[]>(initialData?.photo_urls || []);
  const [coffeeType, setCoffeeType] = useState(initialData?.coffee_type || '');
  const [wantAgain, setWantAgain] = useState<boolean | undefined>(initialData?.want_again ?? undefined);
  const [visibility, setVisibility] = useState<Visibility>(visibilityOf(initialData));

  const [bean, setBean] = useState<BeanSelection>(() =>
    initialData?.bean
      ? {
          roaster: initialData.bean.roaster_name
            ? { id: '', name: initialData.bean.roaster_name }
            : null,
          bean: initialData.bean,
          beanText: '',
        }
      : { ...EMPTY_SELECTION, beanText: initialData?.bean_name_raw || '' }
  );

  const [comment, setComment] = useState(initialData?.comment || '');
  const [dessert, setDessert] = useState(initialData?.dessert || '');
  const [atmosphereTags, setAtmosphereTags] = useState<string[]>(initialData?.atmosphere_tags || []);
  const [price, setPrice] = useState<number | undefined>(initialData?.price);
  const [priceCurrency, setPriceCurrency] = useState<string>(initialData?.price_currency || defaultCurrency);

  const [overallTasteRating, setOverallTasteRating] = useState<number | undefined>(initialData?.overall_taste_rating);
  const [aromaRating, setAromaRating] = useState<number | undefined>(initialData?.aroma_rating);
  const [acidityRating, setAcidityRating] = useState<number | undefined>(initialData?.acidity_rating);
  const [bodyRating, setBodyRating] = useState<number | undefined>(initialData?.body_rating);
  const [sweetnessRating, setSweetnessRating] = useState<number | undefined>(initialData?.sweetness_rating);
  const [bitternessRating, setBitternessRating] = useState<number | undefined>(initialData?.bitterness_rating);
  const [aftertasteRating, setAftertasteRating] = useState<number | undefined>(initialData?.aftertaste_rating);

  const [errors, setErrors] = useState<Record<string, string>>({});

  /* An older log's currency is kept on the list while that log is open, so editing
     one does not quietly re-denominate what it cost. */
  const currencyOptions = CURRENCIES.includes(priceCurrency)
    ? CURRENCIES
    : [...CURRENCIES, priceCurrency];

  const clearError = (field: string) =>
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const newErrors: Record<string, string> = {};
    if (mode === 'drink' && !rating) newErrors.rating = t('rating_required');
    /* Each mode has exactly one thing it will not record without. A bag with no bean
       on it is a row saying somebody was here, which the visit already says. */
    if (mode === 'purchase' && !bean.bean && !bean.beanText.trim()) {
      newErrors.bean = t('bean_required');
    }
    if (comment.length > 1000) newErrors.comment = t('comment_too_long');
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const linkedBeanId = bean.bean && 'id' in bean.bean && bean.bean.id ? bean.bean.id : null;
    /* State outlives the toggle. Answer four sliders as a drink, switch to a bag, and
       those answers were still on the way out with it -- about a coffee nobody had
       drunk yet. Anything the chosen mode does not ask for is not sent. */
    const drinkOnly = <T,>(value: T) => (mode === 'drink' ? value : undefined);

    try {
      await onSubmit({
        mode,
        rating: rating || undefined,
        photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
        coffee_type: drinkOnly(coffeeType || undefined),
        want_again: drinkOnly(wantAgain),
        /* Not asked any more: recording a bag bought here is the claim, and it is
           still the person making it rather than the app inferring it from a log
           they may have kept private. */
        sells_beans: mode === 'purchase' ? true : undefined,
        is_public: visibility !== 'private',
        anonymous: visibility === 'anonymous',
        /* Explicit null so clearing the picker actually unlinks: leaving the key
           out means "keep what is stored", which is the opposite instruction. */
        bean_id: linkedBeanId,
        bean_name_raw: linkedBeanId ? undefined : bean.beanText.trim() || undefined,
        comment: comment.trim() || undefined,
        dessert: drinkOnly(dessert.trim() || undefined),
        atmosphere_tags: drinkOnly(atmosphereTags.length > 0 ? atmosphereTags : undefined),
        price: price || undefined,
        price_currency: price ? priceCurrency : undefined,
        overall_taste_rating: drinkOnly(overallTasteRating),
        aroma_rating: drinkOnly(aromaRating),
        acidity_rating: drinkOnly(acidityRating),
        body_rating: drinkOnly(bodyRating),
        sweetness_rating: drinkOnly(sweetnessRating),
        bitterness_rating: drinkOnly(bitternessRating),
        aftertaste_rating: drinkOnly(aftertasteRating),
      });
    } catch (error) {
      console.error('Error submitting log:', error);
    }
  };

  /* The row is not `items-start`: stretch is what makes the currency match the
     field's height without either of them being told a number. */
  const priceField = (
    <div className="flex gap-2">
      <NavSelect
        label={priceCurrency}
        ariaLabel={t('price_currency')}
        value={priceCurrency}
        onChange={setPriceCurrency}
        options={currencyOptions.map((code) => ({ value: code, label: code }))}
        /* Outlined like the field beside it rather than filled: a fill here would be
           the only filled control left in the form. */
        triggerClassName="group flex w-20 shrink-0 items-center justify-between rounded-(--radius-control) border border-edge-rule px-3 text-sm text-ink-primary transition-colors hover:border-brand"
        /* The default panel is a nav-width 11rem, which three letters do not need.
           A number, not `min-w-0`: the rows carry no width of their own, so removing
           the floor collapses the popup to nothing. */
        panelClassName="min-w-24"
      />
      <div className="flex-1">
        <FloatingInput
          id="log-price"
          type="number"
          label={t('price')}
          value={price?.toString() || ''}
          onChange={(event) => setPrice(event.target.value ? parseFloat(event.target.value) : undefined)}
          min="0"
          step="0.01"
        />
      </div>
    </div>
  );

  /* The count lives in the field's own corner. On its own line below it was a whole
     row of the form spent on a number that matters for the last 200 characters. */
  const commentField = (
    <FloatingInput
      multiline
      label={t('comment')}
      value={comment}
      onChange={(event) => {
        setComment(event.target.value);
        clearError('comment');
      }}
      rows={4}
      maxLength={1000}
      error={errors.comment}
      endHint={`${comment.length}/1000`}
    />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Segmented
        value={mode}
        label={t('mode')}
        onChange={(next) => {
          setMode(next);
          clearError('rating');
        }}
        options={[
          { id: 'drink', label: t('mode_drink') },
          { id: 'purchase', label: t('mode_purchase') },
        ]}
      />

      {/*
        The two modes ask for different things in a different order, so neither
        borrows the other's opening. A drink starts with the cup; a bag starts with
        which bag, because that is the whole content of the log.

        Only a drink has enough left to hide. A bag asks five things and shows all of
        them: hiding them behind a disclosure only meant they went unanswered.
      */}
      {mode === 'drink' ? (
        <>
          <PhotoUpload
            photos={photoUrls}
            onChange={setPhotoUrls}
            userId={user?.id || ''}
            maxPhotos={5}
          />

          {/* Still a `datalist` rather than the app's own menu: the list is a
              shortcut, not the vocabulary, and a cafe is free to sell something
              nobody put in COFFEE_TYPES. */}
          <div>
            <FloatingInput
              id="log-coffee-type"
              list="coffee-types"
              label={t('coffee_type')}
              value={coffeeType}
              onChange={(event) => setCoffeeType(event.target.value)}
            />
            <datalist id="coffee-types">
              {COFFEE_TYPES.map((type) => <option key={type} value={type} />)}
            </datalist>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              {t('rating')} <span className="text-state-danger">*</span>
            </label>
            <StarRating
              rating={rating}
              size="xl"
              onChange={(value) => {
                setRating(value);
                clearError('rating');
              }}
              label={t('rating')}
              starLabel={(value) => t('rate_n', { n: value })}
            />
            {errors.rating && <p className="mt-1 text-sm text-state-danger">{errors.rating}</p>}
          </div>

          {/* Out in the open in both modes. It is the one thing somebody arrives
              wanting to write, and behind a disclosure it went unwritten. */}
          {commentField}

          <Collapsible.Root>
            <Collapsible.Trigger className="control-flat group flex min-h-11 w-full items-center justify-between rounded-(--radius-control) px-4 text-sm">
              {t('add_details')}
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
            </Collapsible.Trigger>
            <Collapsible.Panel className="space-y-6 pt-6">
              <BeanPicker value={bean} onChange={setBean} />
            <AdvancedCoffeeSection
              overallTasteRating={overallTasteRating}
              onOverallTasteRatingChange={setOverallTasteRating}
              aromaRating={aromaRating}
              onAromaRatingChange={setAromaRating}
              acidityRating={acidityRating}
              onAcidityRatingChange={setAcidityRating}
              sweetnessRating={sweetnessRating}
              onSweetnessRatingChange={setSweetnessRating}
              bitternessRating={bitternessRating}
              onBitternessRatingChange={setBitternessRating}
              bodyRating={bodyRating}
              onBodyRatingChange={setBodyRating}
              aftertasteRating={aftertasteRating}
              onAftertasteRatingChange={setAftertasteRating}
            />
            {priceField}
              <FloatingInput
                label={t('dessert')}
                value={dessert}
                onChange={(event) => setDessert(event.target.value)}
              />
            <div>
              <label className="mb-2 block text-sm font-medium text-ink-secondary">
                {t('atmosphere_tags')}{' '}
                {atmosphereTags.length > 0 && (
                  <span className="text-xs text-ink-secondary">({atmosphereTags.length}/3)</span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {ATMOSPHERE_TAGS.map((tag) => {
                  const selected = atmosphereTags.includes(tag);
                  const disabled = !selected && atmosphereTags.length >= 3;
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        setAtmosphereTags(
                          selected
                            ? atmosphereTags.filter((each) => each !== tag)
                            : [...atmosphereTags, tag]
                        )
                      }
                      className={`control-flat min-h-11 rounded-(--radius-pill) px-3 text-sm ${selected ? 'is-active' : ''}`}
                    >
                      {t(`atmosphere_${tag}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </Collapsible.Panel>
          </Collapsible.Root>

          {/*
            Two answers, and neither is chosen until somebody chooses it. A third
            "not sure" option looked tidy and was preselected, which meant every log
            shipped an answer nobody gave. Pressing the chosen one takes it back --
            the same gesture that withdraws a trait observation on the cafe page.

            Drinks only: nobody has tasted a bag they just bought, so there is no
            honest answer to give about it yet. That answer arrives with the cup.
          */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-secondary">{t('want_again')}</label>
            <Segmented
              value={wantAgain === undefined ? '' : wantAgain ? 'yes' : 'no'}
              label={t('want_again')}
              onChange={(next) => setWantAgain((current) => (current === (next === 'yes') ? undefined : next === 'yes'))}
              options={[
                { id: 'yes', label: t('want_again_yes') },
                { id: 'no', label: t('want_again_no') },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          <PhotoUpload
            photos={photoUrls}
            onChange={setPhotoUrls}
            userId={user?.id || ''}
            maxPhotos={5}
          />

          <BeanPicker
            value={bean}
            onChange={(next) => {
              setBean(next);
              clearError('bean');
            }}
            beanRequired
            beanError={errors.bean}
          />

          <div>
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              {t('rating')}
            </label>
            <StarRating
              rating={rating}
              size="xl"
              onChange={setRating}
              label={t('rating')}
              starLabel={(value) => t('rate_n', { n: value })}
            />
          </div>

          {priceField}
          {commentField}
        </>
      )}

      {/* Directly above Save, because the default is public and nobody should find
          that out after pressing it. */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-ink-secondary">{t('visibility')}</label>
        <Segmented
          value={visibility}
          label={t('visibility')}
          onChange={setVisibility}
          options={[
            { id: 'public', label: t('visibility_public') },
            { id: 'anonymous', label: t('visibility_anonymous') },
            { id: 'private', label: t('visibility_private') },
          ]}
        />
        <p className="landing-micro text-ink-secondary">{t(`visibility_${visibility}_note`)}</p>
      </div>

      {!initialData && <p className="landing-micro text-ink-secondary">{t('bean_drop_note')}</p>}

      <div className="flex gap-3">
        {onCancel && (
          <Button type="button" onClick={onCancel} variant="outline" className="flex-1" disabled={isLoading}>
            {t('cancel')}
          </Button>
        )}
        <Button type="submit" className="flex-1" loading={isLoading}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
