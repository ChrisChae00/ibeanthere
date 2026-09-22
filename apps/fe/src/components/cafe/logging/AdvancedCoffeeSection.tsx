'use client';

import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IntensitySlider } from '@/shared/ui';

/*
  How it tasted, on seven sliders. Only the overall one is offered outright: most
  people have an answer to "how was it" and no answer to "how was the aftertaste",
  and six sliders sitting open made the honest reply -- leave them alone -- look
  like six things left unfinished. The six live behind their own disclosure.

  Everything else this section used to hold is gone: bean origin, process and roast
  level are properties of a bean, not of one cup, so they belong to the catalogue
  row the log points at -- typed free-hand into every log they were seven spellings
  of the same coffee. Extraction method and equipment described the barista's work,
  which is not what this app asks anyone to remember.
*/

interface AdvancedCoffeeSectionProps {
  overallTasteRating: number | undefined;
  onOverallTasteRatingChange: (value: number | undefined) => void;
  aromaRating: number | undefined;
  onAromaRatingChange: (value: number | undefined) => void;
  acidityRating: number | undefined;
  onAcidityRatingChange: (value: number | undefined) => void;
  sweetnessRating: number | undefined;
  onSweetnessRatingChange: (value: number | undefined) => void;
  bitternessRating: number | undefined;
  onBitternessRatingChange: (value: number | undefined) => void;
  bodyRating: number | undefined;
  onBodyRatingChange: (value: number | undefined) => void;
  aftertasteRating: number | undefined;
  onAftertasteRatingChange: (value: number | undefined) => void;
}

export default function AdvancedCoffeeSection({
  overallTasteRating,
  onOverallTasteRatingChange,
  aromaRating,
  onAromaRatingChange,
  acidityRating,
  onAcidityRatingChange,
  sweetnessRating,
  onSweetnessRatingChange,
  bitternessRating,
  onBitternessRatingChange,
  bodyRating,
  onBodyRatingChange,
  aftertasteRating,
  onAftertasteRatingChange,
}: AdvancedCoffeeSectionProps) {
  const t = useTranslations('cafe.log');

  const sliders = [
    { label: t('aroma'), value: aromaRating, onChange: onAromaRatingChange },
    { label: t('acidity'), value: acidityRating, onChange: onAcidityRatingChange },
    { label: t('sweetness'), value: sweetnessRating, onChange: onSweetnessRatingChange },
    { label: t('bitterness'), value: bitternessRating, onChange: onBitternessRatingChange },
    { label: t('body'), value: bodyRating, onChange: onBodyRatingChange },
    { label: t('aftertaste'), value: aftertasteRating, onChange: onAftertasteRatingChange },
  ];

  return (
    <div className="space-y-4">
      {/* No "Tasting notes" heading above it: the slider under that heading was
          labelled "Overall Taste", which is the same sentence twice and one of them
          took a row. */}
      <IntensitySlider
        value={overallTasteRating}
        onChange={onOverallTasteRatingChange}
        label={t('overall_taste')}
        min={0}
        max={10}
        step={1}
      />
      <Collapsible.Root>
        <Collapsible.Trigger className="control-flat group flex min-h-11 w-full items-center justify-between rounded-(--radius-control) px-4 text-sm">
          {t('detailed_taste')}
          <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Panel className="space-y-4 pt-4">
          {sliders.map((slider) => (
            <IntensitySlider
              key={slider.label}
              value={slider.value}
              onChange={slider.onChange}
              label={slider.label}
              min={0}
              max={10}
              step={1}
            />
          ))}
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
