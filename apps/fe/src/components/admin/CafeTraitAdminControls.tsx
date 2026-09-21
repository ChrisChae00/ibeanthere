'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TraitSummary } from '@/types/api';
import { clearTraitObservation, getCafeTraits, suggestTraitObservation } from '@/lib/api/cafes';

/*
  The listing questions, answered from the admin card.

  Everywhere else a press is a suggestion that waits in a queue. The queue is this
  same person's, so an admin's press is written into the record at once -- waiting
  would mean reading your own sentence and pressing approve under it.

  Each press is its own dated observation and saves on the press, not with the modal's
  Save. The record is insert-only: answering "no" today supersedes last year's "yes"
  rather than erasing it, which is what makes a shop that changed readable as changed.

  The reason box is `evidence`: admin-only, kept on a no as much as on a yes, and
  returned by no reader-facing endpoint. It is not the public note the cafe page shows.
*/

const TRAITS = ['sells_beans', 'filter_coffee', 'roasts_on_site'] as const;

const EVIDENCE_MAX = 500;

/* Same width whatever the word, for the reason the cafe page's pair is. */
const CHOICE = 'control-flat min-h-11 w-16 text-sm';

export default function CafeTraitAdminControls({ cafeId }: { cafeId: string }) {
  const t = useTranslations('admin.traits');
  const traitLabel = useTranslations('cafe.traits');

  const [summaries, setSummaries] = useState<TraitSummary[] | null>(null);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCafeTraits(cafeId)
      .then((rows) => !cancelled && setSummaries(rows))
      .catch(() => !cancelled && setSummaries([]));
    return () => {
      cancelled = true;
    };
  }, [cafeId]);

  const current = (trait: string) => summaries?.find((row) => row.trait === trait);

  /* One in-flight answer at a time: two presses on the same row would race to be the
     newest observation, and the loser is the one the cafe page would show. */
  const run = async (trait: string, work: () => Promise<TraitSummary[]>) => {
    if (busy) return;
    setBusy(trait);
    setFailed(false);
    try {
      setSummaries(await work());
      setEvidence((rows) => ({ ...rows, [trait]: '' }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const answer = (trait: string, value: boolean) =>
    run(trait, async () => {
      const result = await suggestTraitObservation(
        cafeId,
        trait,
        value,
        undefined,
        undefined,
        evidence[trait],
      );
      return result.traits;
    });

  const clear = (trait: string) => run(trait, () => clearTraitObservation(cafeId, trait));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text">{t('title')}</p>
        <p className="text-xs text-textSecondary">{t('hint')}</p>
      </div>

      <ul className="space-y-3">
        {TRAITS.map((trait) => {
          const value = current(trait)?.latest_value;
          return (
            <li key={trait} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-text">{traitLabel(trait)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex -space-x-px">
                    {[true, false].map((choice, index) => (
                      <button
                        key={String(choice)}
                        type="button"
                        aria-pressed={value === choice}
                        disabled={busy !== null}
                        onClick={() => answer(trait, choice)}
                        className={`${CHOICE} ${
                          index === 0 ? 'rounded-l-(--radius-pill)' : 'rounded-r-(--radius-pill)'
                        } ${value === choice ? 'is-active' : ''}`}
                      >
                        {traitLabel(choice ? 'yes' : 'no')}
                      </button>
                    ))}
                  </span>
                  {/* Only offered when there is something to take back. */}
                  {value !== undefined && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => clear(trait)}
                      className="min-h-11 text-xs text-textSecondary underline underline-offset-2"
                    >
                      {t('clear')}
                    </button>
                  )}
                </span>
              </div>

              <input
                value={evidence[trait] || ''}
                maxLength={EVIDENCE_MAX}
                disabled={busy !== null}
                onChange={(event) =>
                  setEvidence((rows) => ({ ...rows, [trait]: event.target.value }))
                }
                placeholder={t('evidence_placeholder')}
                aria-label={t('evidence_label', { trait: traitLabel(trait) })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </li>
          );
        })}
      </ul>

      {failed && <p className="text-xs text-error">{t('save_failed')}</p>}
    </div>
  );
}
