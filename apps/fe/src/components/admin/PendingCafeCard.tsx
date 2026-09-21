'use client';

import { useEffect, useState } from 'react';
import { PendingCafe } from '@/lib/api/admin';
import { useTranslations } from 'next-intl';
import { Card, Badge, Button } from '@/components/ui';
import { BusinessHours } from '@/types/map';
import OpeningHoursInput from '@/components/cafe/OpeningHoursInput';
import { isTemporarilyClosed, setTemporarilyClosed } from '@/lib/utils/businessHours';
import PhotoUploadWithMain from '@/shared/ui/PhotoUploadWithMain';
import CafeTraitAdminControls from './CafeTraitAdminControls';
import { useAuth } from '@/hooks/useAuth';
import { lookupGoogleMapsUrl } from '@/lib/api/cafes';

interface PendingCafeCardProps {
  cafe: PendingCafe;
  onVerify: (cafeId: string) => void;
  onDelete: (cafeId: string) => void;
  onEdit: (cafeId: string, data: EditCafeData) => void;
  isVerifying?: boolean;
  isDeleting?: boolean;
  isEditing?: boolean;
}

export interface EditCafeData {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  description?: string;
  business_hours?: BusinessHours;
  main_image?: string;
  images?: string[];
  /* Only set when a Google Maps lookup filled the form. */
  latitude?: number;
  longitude?: number;
  google_place_id?: string;
  source_url?: string;
}

export default function PendingCafeCard({
  cafe,
  onVerify,
  onDelete,
  onEdit,
  isVerifying = false,
  isDeleting = false,
  isEditing = false,
}: PendingCafeCardProps) {
  const t = useTranslations('admin');
  const { user } = useAuth();
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState<EditCafeData>({
    name: cafe.name,
    address: cafe.address || '',
    phone: cafe.phone || '',
    website: cafe.website || '',
    description: cafe.description || '',
    business_hours: cafe.business_hours,
  });
  const [mapsUrl, setMapsUrl] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [lookupMessage, setLookupMessage] = useState('');
  const [editPhotos, setEditPhotos] = useState<string[]>(cafe.images || []);
  const [editMainIndex, setEditMainIndex] = useState<number>(() => {
    if (cafe.main_image && cafe.images) {
      const idx = cafe.images.indexOf(cafe.main_image);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  /*
    Pull the shop's real details off its Google Maps page.

    A seeded cafe carries an OpenStreetMap node's idea of the place: often no phone, no
    hours, an address with no street number, and a name last edited by a stranger years
    ago. The same lookup the registration form uses answers all of that from one pasted
    URL. It also brings back `place_id`, which is what the card photo fallback needs
    before it can ask Google for anything.

    Nothing is saved here -- the fields are filled in and the admin still presses Save,
    so a wrong URL is undone by closing the modal.
  */
  const applyGoogleUrl = async () => {
    const url = mapsUrl.trim();
    if (!url) return;

    setLookupState('loading');
    setLookupMessage('');
    try {
      const result = await lookupGoogleMapsUrl(url);
      if (!result.success || !result.data) {
        setLookupState('error');
        setLookupMessage(t('google_lookup_failed'));
        return;
      }
      const found = result.data;
      setEditData((previous) => ({
        ...previous,
        name: found.name || previous.name,
        address: found.address || previous.address,
        phone: found.phone || previous.phone,
        website: found.website || previous.website,
        /*
          Google supplies a timetable, never the closed-for-now mark, and the mark lives
          in the same object -- so taking Google's hours wholesale would quietly reopen a
          shop an admin had shut. Their own statement about the shop survives the lookup;
          if Google is right that it is trading again, the tick box is right there.
        */
        business_hours: found.business_hours
          ? setTemporarilyClosed(
              found.business_hours as BusinessHours,
              isTemporarilyClosed(previous.business_hours)
            )
          : previous.business_hours,
        latitude: found.latitude ?? previous.latitude,
        longitude: found.longitude ?? previous.longitude,
        google_place_id: found.place_id || previous.google_place_id,
        source_url: found.google_maps_url || url,
      }));
      setLookupState('done');
      setLookupMessage(t('google_lookup_applied'));
    } catch {
      setLookupState('error');
      setLookupMessage(t('google_lookup_failed'));
    }
  };

  const handleEditSubmit = () => {
    const mainImage = editPhotos.length > 0 ? editPhotos[editMainIndex] || editPhotos[0] : undefined;
    onEdit(cafe.id, {
      ...editData,
      main_image: mainImage,
      images: editPhotos.length > 0 ? editPhotos : [],
    });
    setShowEditModal(false);
  };

  // A modal with no way out but one button is a trap: Escape is the first thing
  // anybody presses, and on a phone the backdrop is the only thing in reach.
  useEffect(() => {
    if (!showEditModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowEditModal(false);
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [showEditModal]);

  const handleOpenEditModal = () => {
    setMapsUrl('');
    setLookupState('idle');
    setLookupMessage('');
    // Reset image state from latest cafe data when opening
    setEditPhotos(cafe.images || []);
    setEditMainIndex(() => {
      if (cafe.main_image && cafe.images) {
        const idx = cafe.images.indexOf(cafe.main_image);
        return idx >= 0 ? idx : 0;
      }
      return 0;
    });
    setShowEditModal(true);
  };

  return (
    <>
      <Card variant="elevated" padding="lg">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-text mb-2">
              {cafe.name}
            </h3>
            {cafe.has_deletion_history && <p className="text-warning mb-2">{t('deletion_history')}</p>}
            {cafe.address && (
              <p className="text-textSecondary text-sm mb-2">
                {cafe.address}
              </p>
            )}
            <div className="flex gap-4 text-sm text-textSecondary">
              <span>
                {t('verification_count')}: {cafe.verification_count}
              </span>
              <span>
                {t('created_at')}: {new Date(cafe.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>
          <Badge
            variant={cafe.status === 'verified' ? 'success' : cafe.status === 'disputed' ? 'error' : 'warning'}
            size="sm"
          >
            {t(cafe.status as 'pending' | 'verified' | 'disputed')}
          </Badge>
        </div>

        {(cafe.phone || cafe.website || cafe.description) && (
          <div className="mb-4 space-y-2 text-sm text-textSecondary">
            {cafe.phone && (
              <p>
                <span className="font-medium">{t('phone')}:</span> {cafe.phone}
              </p>
            )}
            {cafe.website && (
              <p>
                <span className="font-medium">{t('website')}:</span>{' '}
                <a
                  href={cafe.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {cafe.website}
                </a>
              </p>
            )}
            {cafe.description && (
              <p>
                <span className="font-medium">{t('description')}:</span>{' '}
                {cafe.description}
              </p>
            )}
          </div>
        )}

        {cafe.navigator_id && (
          <div className="mb-4 p-3 bg-primary/10 rounded-lg">
            <p className="text-sm font-medium text-primary mb-1">
              {t('founding_crew')}
            </p>
            <p className="text-xs text-textSecondary">
              {t('navigator')}: {cafe.navigator_id.slice(0, 8)}...
            </p>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <Button
            onClick={handleOpenEditModal}
            disabled={isVerifying || isDeleting}
            variant="secondary"
            className="flex-1"
          >
            {t('edit')}
          </Button>
          {cafe.status === 'pending' && (
            <Button
              onClick={() => onVerify(cafe.id)}
              disabled={isDeleting || isEditing}
              loading={isVerifying}
              className="flex-1"
            >
              {t('verify')}
            </Button>
          )}
          <Button
            onClick={() => onDelete(cafe.id)}
            disabled={isVerifying || isEditing}
            loading={isDeleting}
            variant="danger"
            className="flex-1"
          >
            {t('delete')}
          </Button>
        </div>
      </Card>

      {/* Edit Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-surface rounded-lg p-6 max-w-lg w-full border border-border max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4 text-text">
              {t('edit_cafe_title')}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('google_lookup_label')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={mapsUrl}
                    onChange={(e) => setMapsUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyGoogleUrl();
                      }
                    }}
                    placeholder="https://maps.app.goo.gl/..."
                    className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={applyGoogleUrl}
                    loading={lookupState === 'loading'}
                    disabled={!mapsUrl.trim()}
                  >
                    {t('google_lookup_fetch')}
                  </Button>
                </div>
                <p className={`mt-1 text-xs ${lookupState === 'error' ? 'text-error' : 'text-textSecondary'}`}>
                  {lookupMessage || t('google_lookup_hint')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('cafe_name')}
                </label>
                <input
                  type="text"
                  value={editData.name || ''}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('address')}
                </label>
                <input
                  type="text"
                  value={editData.address || ''}
                  onChange={(e) => setEditData({ ...editData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('phone')}
                </label>
                <input
                  type="text"
                  value={editData.phone || ''}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('website')}
                </label>
                <input
                  type="text"
                  value={editData.website || ''}
                  onChange={(e) => setEditData({ ...editData, website: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-1">
                  {t('description')}
                </label>
                <textarea
                  value={editData.description || ''}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/*
                The listing questions. They write on their own press rather than with
                this modal's Save: each is a dated observation of its own, and half of
                one saved with the rest of the form would be a claim nobody made.
              */}
              <CafeTraitAdminControls cafeId={cafe.id} />

              {/* Opening Hours */}
              <OpeningHoursInput
                value={editData.business_hours}
                onChange={(hours) => setEditData({ ...editData, business_hours: hours })}
              />

              {/* Photo Upload */}
              {user?.id && (
                <PhotoUploadWithMain
                  photos={editPhotos}
                  onChange={setEditPhotos}
                  mainIndex={editMainIndex}
                  onMainIndexChange={setEditMainIndex}
                  userId={user.id}
                />
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={() => setShowEditModal(false)}
                variant="secondary"
                className="flex-1"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleEditSubmit}
                loading={isEditing}
                className="flex-1"
              >
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
