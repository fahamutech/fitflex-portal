'use client';
import { useEffect, useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useApp } from '../../app/providers';

interface ImageUploadProps {
  /** Auth token — required to upload to the Zebra storage proxy (`POST /storage`). */
  token: string;
  /** Full-size image URLs (parallel to `thumbnails`, same index = same photo). */
  value: string[];
  /** Small preview image URLs (parallel to `value`). */
  thumbnails: string[];
  onChange: (images: string[], thumbnails: string[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

const CLIENT_MAX_DIMENSION = 1280;
const CLIENT_WEBP_QUALITY = 0.85;
const WEBP_MIME = 'image/webp';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

/**
 * Downscales and re-encodes the image as WebP client-side before it ever
 * leaves the browser. Raw camera photos can be several MB; shrinking to
 * `CLIENT_MAX_DIMENSION` here cuts upload bandwidth substantially, on top of
 * whatever additional normalization the backend applies. Falls back to the
 * original file (e.g. unsupported format, canvas errors) so uploads never
 * hard-fail on this optimization — the backend still enforces image-only
 * and re-normalizes regardless.
 */
async function compressClientSide(file: File): Promise<File> {
  const img = await loadImage(file);
  const scale = Math.min(1, CLIENT_MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, WEBP_MIME, CLIENT_WEBP_QUALITY));
  if (!blob) throw new Error('Canvas toBlob failed');

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${baseName}.webp`, { type: WEBP_MIME });
}

/**
 * Uploads to the backend's `/storage/upload` proxy. The backend rejects
 * non-image files, always normalizes the image to WebP (converting if
 * needed), and generates a WebP thumbnail server-side — so gym/trainer
 * records store Zebra URLs rather than base64 data URLs, and list views can
 * load the (much smaller) thumbnail instead of the full-size image.
 */
async function uploadImage(file: File, token: string): Promise<{ full: string; thumbnail: string }> {
  const toUpload = await compressClientSide(file).catch(() => file);
  const uploaded = await api.uploadFile(token, toUpload, toUpload.name);
  return { full: uploaded.url, thumbnail: uploaded.thumbnailUrl };
}

export function ImageUpload({
  token,
  value = [],
  thumbnails = [],
  onChange,
  maxFiles = 5,
  disabled = false,
  className,
}: ImageUploadProps) {
  const { t } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(value);
  const thumbnailsRef = useRef(thumbnails);

  useEffect(() => {
    imagesRef.current = value;
    thumbnailsRef.current = thumbnails;
  }, [value, thumbnails]);

  function handleFiles(files: FileList | null) {
    if (!files || disabled) return;
    const remaining = maxFiles - value.length;
    const toProcess = Array.from(files).slice(0, remaining).filter((f) => f.type.startsWith('image/'));
    if (!toProcess.length) return;
    setUploadError(null);

    toProcess.forEach((file) => {
      setUploading((n) => n + 1);
      uploadImage(file, token)
        .then(({ full, thumbnail }) => {
          const nextImages = [...imagesRef.current, full].slice(0, maxFiles);
          const nextThumbnails = [...thumbnailsRef.current, thumbnail].slice(0, maxFiles);
          imagesRef.current = nextImages;
          thumbnailsRef.current = nextThumbnails;
          onChange(nextImages, nextThumbnails);
        })
        .catch(() => {
          setUploadError(t('ui.upload.failed'));
        })
        .finally(() => setUploading((n) => Math.max(0, n - 1)));
    });
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeImage(index: number) {
    const nextImages = imagesRef.current.filter((_, i) => i !== index);
    const nextThumbnails = thumbnailsRef.current.filter((_, i) => i !== index);
    imagesRef.current = nextImages;
    thumbnailsRef.current = nextThumbnails;
    onChange(nextImages, nextThumbnails);
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Previews */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((url, i) => (
            <div
              key={i}
              className="relative group h-20 w-20 rounded-[var(--radius-lg)] overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--color-bg-tertiary)]"
            >
              <img src={thumbnails[i] ?? url} alt={t('ui.upload.alt').replace('{n}', String(i + 1))} className="h-full w-full object-cover" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {value.length < maxFiles && !disabled && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !uploading && inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed p-6 cursor-pointer transition-colors',
            uploading && 'pointer-events-none opacity-70',
            dragOver
              ? 'border-[var(--color-brand-400)] bg-[var(--color-brand-50)]'
              : 'border-[var(--color-border-secondary)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-bg-tertiary)]'
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]">
            {uploading > 0 ? (
              <Loader2 className="h-4 w-4 text-[var(--color-fg-quaternary)] animate-spin" />
            ) : (
              <Upload className="h-4 w-4 text-[var(--color-fg-quaternary)]" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--color-brand-700)]">
              {uploading > 0 ? (
                t(uploading > 1 ? 'ui.upload.uploadingMany' : 'ui.upload.uploadingOne').replace('{n}', String(uploading))
              ) : (
                <>{t('ui.upload.click')} <span className="text-[var(--color-fg-quaternary)] font-normal">{t('ui.upload.orDrag')}</span></>
              )}
            </p>
            <p className="text-xs text-[var(--color-fg-quaternary)] mt-1">
              {t('ui.upload.hint')}
            </p>
          </div>
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-[var(--color-error-600)]">{uploadError}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple={maxFiles > 1}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
