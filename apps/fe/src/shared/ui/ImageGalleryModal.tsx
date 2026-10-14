'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ImageGalleryModalProps, GalleryImage } from '@/types/gallery';
import ImageLightbox from './ImageLightbox';

/*
  Every photograph of one cafe, as a grid, with one tab for the menu shots.

  The two views are deliberately different jobs: the grid is for scanning what a
  place looks like, the lightbox (opened by clicking any tile) is for reading one
  photograph. Menu photographs are the exception a reader arrives with a purpose
  for — "what do they serve, what does it cost" — so they get their own tab
  rather than being somewhere in a grid of forty interiors.
*/

type Tab = 'all' | 'menu';

export default function ImageGalleryModal({
  images,
  isOpen,
  onClose,
  onImageClick,
  title
}: ImageGalleryModalProps) {
  const t = useTranslations('gallery');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => setMounted(true), []);

  // The page behind a full-screen modal must not scroll under it.
  useEffect(() => {
    if (!isOpen) return;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen || images.length === 0) return null;

  const menuImages = images.filter((image) => image.category === 'menu');
  const shown: GalleryImage[] = tab === 'menu' ? menuImages : images;

  const handleImageClick = (image: GalleryImage) => {
    /*
      The lightbox is given the filtered list, not the whole one: arrowing out of
      the menu tab into the interiors would silently undo the filter the reader
      just applied.
    */
    const index = shown.indexOf(image);
    if (onImageClick) {
      onImageClick(images.indexOf(image));
      return;
    }
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const tabClass = (value: Tab) =>
    `landing-micro min-h-11 rounded-(--radius-pill) px-5 control-flat ${tab === value ? 'is-active' : ''}`;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-1500 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8 backdrop-blur-[2px]"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-4xl rounded-(--radius-card) border border-edge-rule bg-surface-raised shadow-(--shadow-panel)"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title || t('all_photos')}
        >
          <div className="sticky top-0 z-10 rounded-t-(--radius-card) border-b border-edge-rule bg-surface-raised">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              {/* A cafe's name is data, so it keeps the body face here too. */}
              <h2 className="font-sans text-lg font-semibold text-ink-primary">
                {title || t('all_photos')}
              </h2>
              <button
                onClick={onClose}
                className="control-flat grid size-9 place-items-center rounded-(--radius-pill)"
                aria-label={t('close')}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 px-5 pb-4">
              <button className={tabClass('all')} onClick={() => setTab('all')}>
                {t('all_photos')} {images.length}
              </button>
              <button className={tabClass('menu')} onClick={() => setTab('menu')}>
                {t('menu_photos')} {menuImages.length}
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            /*
              An empty menu tab is the normal state until photographs start carrying
              a category, so it says what is missing rather than looking broken.
            */
            <p className="px-5 py-16 text-center text-sm text-ink-secondary">
              {t('no_menu_photos')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3 md:grid-cols-4">
              {shown.map((image) => (
                <button
                  key={image.url}
                  type="button"
                  className="relative aspect-square overflow-hidden rounded-(--radius-control) border border-edge-rule bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  onClick={() => handleImageClick(image)}
                >
                  {/* The sunken ground is the placeholder: it is already behind the
                      image, so a tile that has not loaded yet is a panel rather than a
                      hole, without a load-state set to keep in sync. */}
                  <img
                    src={image.url}
                    alt={image.alt || ''}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ImageLightbox
        images={shown}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>,
    document.body
  );
}
