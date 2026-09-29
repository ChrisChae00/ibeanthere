'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import CameraIcon from './CameraIcon';
import { useToast } from '@/contexts/ToastContext';
import { uploadCafeImage } from '@/shared/lib/supabase/storage';
import { isHeicFile, convertHeicToWebp, HeicNotSupportedError } from '@/shared/lib/image/convertHeicToWebp';
import { indexAfterMove, usePhotoReorder } from '@/shared/lib/image/usePhotoReorder';
import PhotoTileControls from './PhotoTileControls';

interface PhotoUploadWithMainProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  mainIndex: number;
  onMainIndexChange: (index: number) => void;
  userId: string;
  maxPhotos?: number;
  maxSizeMB?: number;
}

export default function PhotoUploadWithMain({
  photos,
  onChange,
  mainIndex,
  onMainIndexChange,
  userId,
  maxPhotos = 5,
  maxSizeMB = 5
}: PhotoUploadWithMainProps) {
  const t = useTranslations('cafe.register');
  const tLog = useTranslations('cafe.log');
  const { showToast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [convertingCount, setConvertingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;

    const remainingSlots = maxPhotos - photos.length;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    const newPhotos: string[] = [];

    for (let file of filesToProcess) {
      // Convert HEIC to WebP before any other processing
      if (isHeicFile(file)) {
        setConvertingCount(prev => prev + 1);
        try {
          file = await convertHeicToWebp(file);
        } catch (error) {
          console.error('Error converting HEIC file:', error);
          /* Toasts, not `alert()`: a picker can hand over several files at once, and a
             stack of blocking dialogs is one per bad file with the page frozen between. */
          showToast(error instanceof HeicNotSupportedError
            ? tLog('heic_browser_not_supported')
            : tLog('heic_conversion_failed'), 'error');
          setConvertingCount(prev => prev - 1);
          continue;
        }
        setConvertingCount(prev => prev - 1);
      }

      if (file.size > maxSizeMB * 1024 * 1024) {
        showToast(tLog('photo_too_large', { maxSize: maxSizeMB }), 'error');
        continue;
      }

      if (!file.type.startsWith('image/')) {
        showToast(tLog('invalid_file_type'), 'error');
        continue;
      }

      setUploadingCount(prev => prev + 1);
      try {
        const url = await uploadCafeImage(file, userId);
        newPhotos.push(url);
      } catch (error) {
        // Say so. A photo that silently never arrives reads as one the reader added.
        console.error('Error uploading file:', error);
        showToast(tLog('photo_upload_error'), 'error');
      } finally {
        setUploadingCount(prev => prev - 1);
      }
    }

    if (newPhotos.length > 0) {
      const updatedPhotos = [...photos, ...newPhotos];
      onChange(updatedPhotos);

      // If this is the first photo, auto-select as main
      if (photos.length === 0) {
        onMainIndexChange(0);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const removePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    onChange(newPhotos);

    // Adjust main index if needed
    if (newPhotos.length === 0) {
      onMainIndexChange(0);
    } else if (mainIndex === index) {
      // If removing main photo, select first remaining
      onMainIndexChange(0);
    } else if (mainIndex > index) {
      // Adjust main index if removing a photo before it
      onMainIndexChange(mainIndex - 1);
    }
  };

  const setAsMain = (index: number) => {
    onMainIndexChange(index);
  };

  // The main photo is a choice of photo, not of slot, so it travels with the move.
  const { move, tileProps, dragIndex } = usePhotoReorder(photos, (next, from, to) => {
    onChange(next);
    onMainIndexChange(indexAfterMove(mainIndex, from, to));
  });

  const isProcessing = uploadingCount > 0 || convertingCount > 0;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text">
        {t('photos_label')} ({photos.length}/{maxPhotos})
      </label>
      <p className="text-xs text-ink-secondary mb-2">
        {t('photos_hint')}
      </p>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo, index) => (
            <div
              key={photo}
              {...tileProps(index)}
              className={`relative aspect-square rounded-lg overflow-hidden group cursor-grab ${dragIndex === index ? 'opacity-40' : ''}`}
            >
              <img
                src={photo}
                alt={`${tLog('photo')} ${index + 1}`}
                draggable={false}
                className="w-full h-full object-cover"
              />

              {/* Main indicator / Set as main button */}
              <button
                type="button"
                onClick={() => setAsMain(index)}
                className={`absolute top-1 left-1 p-1.5 rounded-full transition-all ${
                  mainIndex === index
                    ? 'bg-accent text-white'
                    : 'bg-black/50 text-white/70 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-white'
                }`}
                title={mainIndex === index ? t('main_photo') : t('set_as_main')}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>

              <PhotoTileControls index={index} count={photos.length} onMove={move} onRemove={removePhoto} />

              {/* Main label */}
              {mainIndex === index && (
                <div className="absolute bottom-0 left-0 right-0 bg-accent text-white text-xs text-center py-1 font-medium">
                  {t('main_photo')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {convertingCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {tLog('converting')}...
        </div>
      )}

      {uploadingCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {tLog('uploading')}...
        </div>
      )}

      {photos.length < maxPhotos && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isProcessing
              ? 'border-border opacity-50 cursor-not-allowed'
              : isDragging
              ? 'border-primary bg-primary/10 cursor-pointer'
              : 'border-border hover:border-primary/50 cursor-pointer'
          }`}
        >
          <CameraIcon className="w-8 h-8 mx-auto mb-2 text-ink-secondary" />
          <p className="text-sm text-ink-secondary">
            {tLog('drag_drop_photos')} {tLog('or')} {tLog('click_to_upload')}
          </p>
          <p className="text-xs text-ink-secondary mt-1">
            {tLog('max_photos', { max: maxPhotos })} ({tLog('max_size')}: {maxSizeMB}MB)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
            disabled={isProcessing}
          />
        </div>
      )}
    </div>
  );
}
