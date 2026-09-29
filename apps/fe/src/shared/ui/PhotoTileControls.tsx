'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface PhotoTileControlsProps {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

/* A mouse finds these on hover; a finger has no hover, so on touch they stay up. */
const reveal = 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity';
const round = 'absolute p-1 rounded-full bg-black/50 text-white';

/** Remove and move-earlier/later buttons laid over a photo tile inside a `group`. */
export default function PhotoTileControls({ index, count, onMove, onRemove }: PhotoTileControlsProps) {
  const t = useTranslations('cafe.log');

  return (
    <>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className={`${round} top-1 right-1 hover:bg-error ${reveal}`}
        aria-label={t('remove')}
        title={t('remove')}
      >
        <X className="w-4 h-4" />
      </button>
      {index > 0 && (
        <button
          type="button"
          onClick={() => onMove(index, index - 1)}
          className={`${round} left-1 top-1/2 -translate-y-1/2 ${reveal}`}
          aria-label={t('move_earlier')}
          title={t('move_earlier')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          onClick={() => onMove(index, index + 1)}
          className={`${round} right-1 top-1/2 -translate-y-1/2 ${reveal}`}
          aria-label={t('move_later')}
          title={t('move_later')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </>
  );
}
