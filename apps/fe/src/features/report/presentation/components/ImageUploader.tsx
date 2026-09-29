'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { isHeicFile, convertHeicToWebp, HeicNotSupportedError } from '@/shared/lib/image/convertHeicToWebp';
import { usePhotoReorder } from '@/shared/lib/image/usePhotoReorder';
import PhotoTileControls from '@/shared/ui/PhotoTileControls';

interface ImageUploaderProps {
  images: File[];
  onImagesChange: (images: File[]) => void;
  maxImages?: number;
  maxSizeMB?: number;
  disabled?: boolean;
}

/**
 * Image uploader component with drag & drop support.
 * Displays previews and allows removal of selected images.
 */
export default function ImageUploader({
  images,
  onImagesChange,
  maxImages = 3,
  maxSizeMB = 5,
  disabled = false,
}: ImageUploaderProps) {
  const t = useTranslations('report');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const validateFile = useCallback((file: File): string | null => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type) && !isHeicFile(file)) {
      return t('error_invalid_file_type');
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return t('error_file_too_large', { maxSize: maxSizeMB });
    }

    return null;
  }, [maxSizeMB, t]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const fileArray = Array.from(files);
    const newImages: File[] = [];

    for (let file of fileArray) {
      if (images.length + newImages.length >= maxImages) {
        setError(t('error_max_images', { max: maxImages }));
        break;
      }

      // Convert HEIC before size validation (WebP is smaller)
      if (isHeicFile(file)) {
        setIsConverting(true);
        try {
          file = await convertHeicToWebp(file);
        } catch (conversionError) {
          console.error('Error converting HEIC file:', conversionError);
          setError(conversionError instanceof HeicNotSupportedError
            ? t('heic_browser_not_supported')
            : t('heic_conversion_failed'));
          setIsConverting(false);
          continue;
        }
        setIsConverting(false);
      }

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }

      newImages.push(file);
    }

    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
    }
  }, [images, maxImages, onImagesChange, validateFile, t]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!disabled && e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [disabled, handleFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    e.target.value = '';
  }, [handleFiles]);

  const removeImage = useCallback((index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
    setError(null);
  }, [images, onImagesChange]);

  const { move, tileProps, dragIndex } = usePhotoReorder(images, onImagesChange);

  const canAddMore = images.length < maxImages;
  const isProcessing = disabled || isConverting;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      {canAddMore && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors
            ${isDragging
              ? 'border-primary bg-primary/10'
              : 'border-border hover:border-primary'
            }
            ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.heic,.heif"
            multiple
            onChange={handleInputChange}
            disabled={isProcessing}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            {isConverting ? (
              <svg className="w-6 h-6 animate-spin text-ink-secondary" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Upload className="w-6 h-6 text-ink-secondary" />
            )}
            <p className="text-sm text-ink-secondary">
              {isConverting ? t('converting') : t('drag_drop_or_click')}
            </p>
            {!isConverting && (
              <p className="text-xs text-ink-secondary">
                {t('image_requirements', { max: maxImages, maxSize: maxSizeMB })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-error">{error}</p>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              {...(!disabled && tileProps(index))}
              className={`relative group w-20 h-20 rounded-xl overflow-hidden border border-border ${disabled ? '' : 'cursor-grab'} ${dragIndex === index ? 'opacity-40' : ''}`}
            >
              <img
                src={URL.createObjectURL(file)}
                alt={`Preview ${index + 1}`}
                draggable={false}
                className="w-full h-full object-cover"
              />
              {!disabled && (
                <PhotoTileControls index={index} count={images.length} onMove={move} onRemove={removeImage} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Image count indicator */}
      <p className="text-xs text-ink-secondary">
        {t('images_count', { count: images.length, max: maxImages })}
      </p>
    </div>
  );
}
