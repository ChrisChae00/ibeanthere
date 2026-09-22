'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getMyLogs, deleteLog, updateLog } from '@/lib/api/logs';
import { revalidateCafe } from '@/app/actions/cafe';
import { CoffeeLog, LogFormData } from '@/types/api';
import CoffeeLogCard from '@/components/cafe/CoffeeLogCard';
import CoffeeLogForm from '@/components/cafe/CoffeeLogForm';
import CafeSearchModal from '@/components/cafe/CafeSearchModal';
import { LoadingSpinner, ErrorAlert, ConfirmDialog } from '@/shared/ui';
import { WriteIcon } from '@/components/ui';

type FilterType = 'all' | 'public' | 'private';

const FILTERS: FilterType[] = ['all', 'public', 'private'];

export default function MyLogsClient() {
  const t = useTranslations('cafe.log');
  const [logs, setLogs] = useState<CoffeeLog[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<CoffeeLog | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const myLogs = await getMyLogs();
      setLogs(myLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_loading_logs'));
    } finally {
      setIsLoading(false);
    }
  };

  /*
    The app's own dialog, not `confirm()`: the browser's blocks the page while it
    is up, and a second one queued behind it leaves the tab unresponsive with no
    way back. This one is just state, so a repeat click reopens the same dialog.
  */
  const handleDelete = async () => {
    const logId = pendingDeleteId;
    if (!logId) return;

    setIsDeleting(true);
    try {
      // Read the cafe before the row goes: its page counts this log and lists
      // this bean, and both just changed.
      const cafeId = logs.find(log => log.id === logId)?.cafe_id;
      await deleteLog(logId);
      setLogs(prev => prev.filter(log => log.id !== logId));
      if (cafeId) await revalidateCafe(cafeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_deleting_log'));
    } finally {
      setIsDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const handleEdit = (log: CoffeeLog) => {
    setEditingLog(log);
  };

  const handleUpdate = async (data: LogFormData) => {
    if (!editingLog) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await updateLog(editingLog.id, data);
      await revalidateCafe(editingLog.cafe_id);
      await fetchLogs();
      setEditingLog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_updating_log'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'public') return log.is_public;
    if (filter === 'private') return !log.is_public;
    return true;
  });

  const filterKey = (f: FilterType) =>
    f === 'public' ? 'filter_public' : f === 'private' ? 'filter_private' : f;

  return (
    <main className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/*
          A masthead and a rule under it, the same opening every page in the app uses.
          The count sits in the eyebrow rather than in a stat card: this is a record
          somebody keeps, and how many entries it holds is a fact about the page, not
          a figure worth a panel of its own.
        */}
        <header className="border-b border-edge-rule pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="landing-micro text-ink-secondary">
                {t('log_count', { count: logs.length })}
              </p>
              <h1 className="mt-2 text-[clamp(2rem,5vw,3rem)] text-ink-primary">
                {t('my_logs')}
              </h1>
              <p className="mt-3 text-ink-secondary">{t('my_logs_description')}</p>
            </div>

            {/*
              The same outlined control the cafe page puts beside "Coffee Logs", at
              page scale rather than section scale. Writing a log is the same act from
              either place, so it should not be a quiet line there and a filled slab
              here; the filled control on this page is the one the empty state offers.
            */}
            <button
              onClick={() => setShowSearchModal(true)}
              className="btn-line inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-control) px-5 text-sm font-medium text-ink-primary"
            >
              <WriteIcon size={18} />
              {t('write_log')}
            </button>
          </div>
        </header>

        {/*
          Pills, not underlined tabs: every other grouped control in the app is a pill
          whose fill carries the selection, and an underline row here read as a second
          navigation bar under the header's.
        */}
        <div className="flex flex-wrap gap-2 pt-6">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="control-flat landing-micro min-h-11 rounded-(--radius-pill) border border-edge-rule px-5"
            >
              {t(filterKey(f))}
            </button>
          ))}
        </div>

        {error && (
          <div className="pt-6">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="pt-6">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : filteredLogs.length === 0 ? (
            /*
              An empty list offers the next action. Which sentence depends on why it is
              empty -- "you have written none" and "none are private" are different
              facts, and telling somebody to write their first log when they have
              thirty of them is the app not reading its own screen.
            */
            <div className="space-y-5 rounded-(--radius-card) border border-edge-rule bg-surface-raised py-16 text-center">
              <div className="text-2xl text-ink-primary">
                {logs.length === 0 ? t('no_logs_yet_title') : t('no_logs_in_filter')}
              </div>
              {logs.length === 0 ? (
                <>
                  <p className="mx-auto max-w-md px-6 text-ink-secondary">
                    {t('no_logs_yet_hint')}
                  </p>
                  <button
                    onClick={() => setShowSearchModal(true)}
                    className="btn-shade inline-flex min-h-11 items-center justify-center rounded-(--btn-radius) bg-brand px-8 font-semibold text-ink-on-brand"
                  >
                    {t('write_log')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setFilter('all')}
                  className="control-flat landing-micro min-h-11 rounded-(--radius-pill) border border-edge-rule px-5"
                >
                  {t('filter_all_show')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredLogs.map((log) =>
                editingLog?.id === log.id ? (
                  <div
                    key={log.id}
                    className="rounded-(--radius-card) border border-edge-rule bg-surface-raised p-6 [--field-surface:var(--surface-raised)]"
                  >
                    <h2 className="mb-4 text-xl text-ink-primary">{t('edit_log')}</h2>
                    <CoffeeLogForm
                      initialData={editingLog}
                      onSubmit={handleUpdate}
                      onCancel={() => setEditingLog(null)}
                      isLoading={isSubmitting}
                    />
                  </div>
                ) : (
                  <CoffeeLogCard
                    key={log.id}
                    log={log}
                    onEdit={handleEdit}
                    onDelete={setPendingDeleteId}
                    hideUserInfo={true}
                  />
                )
              )}
            </div>
          )}
        </div>

        {showSearchModal && <CafeSearchModal onClose={() => setShowSearchModal(false)} />}

        <ConfirmDialog
          isOpen={pendingDeleteId !== null}
          onClose={() => setPendingDeleteId(null)}
          onConfirm={handleDelete}
          title={t('confirm_delete_title')}
          body={t('confirm_delete')}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          confirmVariant="danger"
          loading={isDeleting}
        />
      </div>
    </main>
  );
}
