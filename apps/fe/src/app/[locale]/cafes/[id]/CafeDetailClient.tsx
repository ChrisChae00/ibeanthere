'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Images, Plus } from 'lucide-react';
import { CafeDetailResponse } from '@/types/api';
import { GalleryImage } from '@/types/gallery';
import CafeInfoSection from '@/components/cafe/CafeInfoSection';
import FoundingCrewAvatars from '@/components/cafe/FoundingCrewAvatars';
import CafePhotoHero from '@/components/cafe/CafePhotoHero';
import { ActionsMenu, LogIcon } from '@/shared/ui';
import CoffeeLogFeed from '@/components/cafe/CoffeeLogFeed';
import CafeTraits from '@/components/cafe/CafeTraits';
import CafeBeansRecent from '@/components/cafe/CafeBeansRecent';
import DropBeanButton from '@/components/cafe/DropBeanButton';
import SaveButtons from '@/components/cafe/SaveButtons';
import CollectionSelectorModal from '@/components/cafe/CollectionSelectorModal';
import { useAuth } from '@/hooks/useAuth';
import { ReportModal, useReportModal } from '@/features/report';
import { capture } from '@/lib/analytics';

const ImageGalleryModal = dynamic(() => import('@/shared/ui/ImageGalleryModal'), { ssr: false });

interface CafeDetailClientProps {
  cafe: CafeDetailResponse;
}

/*
  The page opens on the photograph. Everything that used to compete with it — a
  strip of six thumbnails in its own titled section, a "View All" link, a stats
  card of three numbers — either folded into the cards below or became one door:
  the photograph itself opens the collection, and so does the count beside the
  cafe's details.
*/
export default function CafeDetailClient({ cafe }: CafeDetailClientProps) {
  const t = useTranslations('cafe.detail');
  const tReport = useTranslations('report');
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;
  const { user } = useAuth();
  const { modalState, openCafeReport, closeModal } = useReportModal();

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  /* Closing the picker is the moment the save buttons can be wrong, so it is the
     moment they re-read what is actually saved. */
  const [saveSync, setSaveSync] = useState(0);

  /* Keyed on the cafe rather than the mount: the router keeps this component alive
     across a slug change, and the uuid is what joins this to `cafe_action_taken` --
     the URL may carry either a slug or an id for the same place. */
  useEffect(() => {
    capture('cafe_detail_opened', { cafe_id: cafe.id });
  }, [cafe.id]);

  const foundingCrew = cafe.founding_crew;

  const galleryImages: GalleryImage[] = (cafe.images || [])
    .filter((url) => url && typeof url === 'string' && url.trim().length > 0)
    .map((url, index) => ({
      url,
      alt: `${cafe.name} photo ${index + 1}`,
      source: 'log' as const
    }));

  const requireAuth = (then: () => void) => (e?: React.MouseEvent) => {
    if (user) {
      then();
      return;
    }
    e?.preventDefault();
    router.push(`/${locale}/signin`);
  };

  const cafePath = cafe.slug || cafe.id;
  const logPagePath = `/${locale}/cafes/${cafePath}/log`;
  const hasStats =
    cafe.average_rating !== undefined ||
    (cafe.total_beans_dropped ?? 0) > 0 ||
    (cafe.log_count ?? 0) > 0;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      {/*
        The photograph and the cafe's details are one card, not two: they are the same
        subject, and a gap between them read as the photograph belonging to the page
        rather than to this cafe. The image is flush to the card's edges, so the card's
        own radius is what rounds it.
      */}
      <section className="mb-8 overflow-hidden rounded-(--radius-card) border border-edge-rule bg-surface-raised">
        <CafePhotoHero
          images={galleryImages}
          cafeName={cafe.name}
          onOpen={() => setGalleryOpen(true)}
          /*
            The overflow lives on the photograph's far corner, away from the crew and
            away from the actions the reader came for.
          */
          cornerAction={
            <ActionsMenu
              label={t('more_actions')}
              onMedia
              items={[
                {
                  key: 'report',
                  label: tReport('report_issue'),
                  onClick: requireAuth(() => openCafeReport(cafe.id, cafe.name)),
                },
              ]}
            />
          }
          overlay={
            foundingCrew?.navigator ? (
              <FoundingCrewAvatars variant="stack" navigator={foundingCrew.navigator} />
            ) : null
          }
        />

        <div className="p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            {/* A cafe's name is data, not the page's own voice: body face, like the cards. */}
            <h1 className="font-sans text-3xl font-bold wrap-break-word text-ink-primary">
              {cafe.name}
            </h1>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <SaveButtons
                cafeId={cafe.id}
                syncToken={saveSync}
                onOpenCollectionSelector={() => setCollectionModalOpen(true)}
              />
              {/*
                The same door the log feed carries, at the top where the other two
                marks are. Writing a log was reachable only by scrolling past the
                photos, the details and the beans, so the quick thing to do here was
                always the bean -- and a log drops one anyway.

                A mark beside the save marks, not a second button: it is the same kind
                of act as favouriting, one tap on this cafe, and two filled buttons
                beside a title read as a choice between equals. Same box, same size and
                same ring as `SaveButtons` draws, so the row stays one row of marks
                with the bean button at its end.
              */}
              {user ? (
                <Link
                  href={logPagePath}
                  aria-label={t('write_log')}
                  title={t('write_log')}
                  className="flex items-center justify-center rounded-lg p-2 text-textSecondary transition-all duration-200 hover:bg-brand/10 hover:text-brand focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <LogIcon size={24} />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={requireAuth(() => router.push(logPagePath))}
                  aria-label={t('write_log')}
                  title={t('write_log')}
                  className="flex items-center justify-center rounded-lg p-2 text-textSecondary transition-all duration-200 hover:bg-brand/10 hover:text-brand focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <LogIcon size={24} />
                </button>
              )}
              <DropBeanButton
                cafeId={cafe.id}
                cafeLat={cafe.latitude}
                cafeLng={cafe.longitude}
                size="sm"
                showGrowthInfo={true}
              />
            </div>
          </div>

          {/* Every rule on this page is drawn in the brand: these separate the card's
              own sections rather than dividing fields inside one, and the brand is what
              says the section belongs to this app rather than to the record. */}
          <div className="mt-2 mb-4 h-px bg-brand" />

          <CafeInfoSection cafe={cafe} showFoundingCrew={false} />

          {galleryImages.length > 0 && (
            /*
              The second door into the collection, for a reader who has scrolled
              past the photograph and is reading the details.
            */
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="control-flat mt-6 inline-flex min-h-11 items-center gap-2 rounded-(--btn-radius) px-5 text-sm font-medium"
            >
              <Images className="size-4" aria-hidden />
              {t('photos')} {galleryImages.length}
            </button>
          )}

          {hasStats && (
            /*
              Subgrid, so the three numbers share one row no matter how many lines
              each label takes. On a phone "AVERAGE RATING" and "BEANS DROPPED" wrap
              to two lines and "TOTAL LOGS" does not, which left the numbers sitting
              at three different heights -- and numbers meant to be read across have
              to sit on one line. A min-height on the label would fix today's three
              strings and break on the first translation that needs a third line.
            */
            <div className="mt-6 grid grid-cols-3 grid-rows-[auto_auto] gap-x-4 border-t border-brand pt-6">
              {[
                {
                  label: t('average_rating'),
                  value: cafe.average_rating ? `${cafe.average_rating.toFixed(1)}/5` : '-',
                },
                { label: t('total_logs'), value: cafe.log_count },
                { label: t('beans_dropped'), value: cafe.total_beans_dropped || 0 },
              ].map((stat) => (
                <div key={stat.label} className="row-span-2 grid grid-rows-subgrid">
                  <p className="landing-micro text-ink-secondary">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold text-ink-primary">{stat.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* The coffee, before the logs. Someone opening this page wants to know what
          they can drink and what they can carry home; the log feed is who said so. */}
      <section className="mb-8 rounded-(--radius-card) border border-edge-rule bg-surface-raised">
        <div className="space-y-6 p-6">
          {/* "The Coffee" titles the whole card, and its brand rule sits under that
              title. What separates the traits from the bean lists is a hairline: they
              are two parts of one section, not two sections. */}
          <CafeTraits cafeId={cafe.id} />
          <div className="h-px bg-edge-rule" />
          <CafeBeansRecent cafeId={cafe.id} />
        </div>
      </section>

      <section className="mb-8 rounded-(--radius-card) border border-edge-rule bg-surface-raised">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-ink-primary">{t('coffee_logs')}</h2>
            {user ? (
              <Link
                href={logPagePath}
                className="btn-line relative inline-flex items-center gap-1.5 rounded-(--radius-control) px-3 py-1.5 text-xs font-medium text-ink-primary before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
                aria-label={t('write_log')}
              >
                <Plus className="size-4" aria-hidden />
                {t('write_log')}
              </Link>
            ) : (
              <button
                onClick={requireAuth(() => router.push(logPagePath))}
                className="btn-line relative inline-flex items-center gap-1.5 rounded-(--radius-control) px-3 py-1.5 text-xs font-medium text-ink-primary before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']"
                aria-label={t('write_log')}
              >
                <Plus className="size-4" aria-hidden />
                {t('write_log')}
              </button>
            )}
          </div>
          {/* Ruled in the ink, not the hairline: this line closes the card's header
              rather than dividing two fields inside it. */}
          <div className="mb-4 h-px bg-brand" />
          <CoffeeLogFeed cafeId={cafe.id} initialLogs={cafe.recent_logs || []} />
        </div>
      </section>

      <ReportModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        targetType={modalState.targetType}
        targetId={modalState.targetId}
        targetUrl={modalState.targetUrl}
      />

      <ImageGalleryModal
        images={galleryImages}
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        title={cafe.name}
      />

      {/*
        Opened by the save press itself, so the cafe is already filed under "Saved for
        later" by the time the list appears: choosing a list moves it rather than
        adding a second copy.
      */}
      <CollectionSelectorModal
        isOpen={collectionModalOpen}
        onClose={() => {
          setCollectionModalOpen(false);
          setSaveSync((n) => n + 1);
        }}
        moveOutOfSaveLater
        cafeId={cafe.id}
        cafeName={cafe.name}
      />
    </div>
  );
}
