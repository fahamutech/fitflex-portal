'use client';
import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ImageUploadProps {
  /** Full-size images (parallel to `thumbnails`, same index = same photo). */
  value: string[];
  /** Small preview images (parallel to `value`). */
  thumbnails: string[];
  onChange: (images: string[], thumbnails: string[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

const FULL_MAX_DIMENSION = 1280;
const FULL_WEBP_QUALITY = 0.8;
const THUMB_MAX_DIMENSION = 320;
const THUMB_WEBP_QUALITY = 0.7;
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

function drawToWebp(img: HTMLImageElement, maxDimension: number, quality: number): string {
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(WEBP_MIME, quality);
}

/**
 * Downscales and re-encodes an uploaded image as WebP, producing both a
 * full-size copy and a small thumbnail. Raw camera photos can be several MB;
 * the API stores images inline (no object storage yet), so every
 * uncompressed byte here is shipped in full on every GET /gyms response.
 * WebP + downscaling keeps gym payloads small, and the thumbnail lets list
 * views avoid loading full-resolution images at all.
 */
async function compressImage(file: File): Promise<{ full: string; thumbnail: string }> {
  const img = await loadImage(file);
  return {
    full: drawToWebp(img, FULL_MAX_DIMENSION, FULL_WEBP_QUALITY),
    thumbnail: drawToWebp(img, THUMB_MAX_DIMENSION, THUMB_WEBP_QUALITY),
  };
}

export function ImageUpload({
  value = [],
  thumbnails = [],
  onChange,
  maxFiles = 5,
  disabled = false,
  className,
}: ImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files || disabled) return;
    const remaining = maxFiles - value.length;
    const toProcess = Array.from(files).slice(0, remaining);
    const nextImages = [...value];
    const nextThumbnails = [...thumbnails];

    toProcess.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      compressImage(file)
        .then(({ full, thumbnail }) => {
          nextImages.push(full);
          nextThumbnails.push(thumbnail);
          onChange(nextImages.slice(0, maxFiles), nextThumbnails.slice(0, maxFiles));
        })
        .catch(() => {
          // Fall back to the original file if compression fails (e.g. unsupported format).
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (dataUrl) {
              nextImages.push(dataUrl);
              nextThumbnails.push(dataUrl);
              onChange(nextImages.slice(0, maxFiles), nextThumbnails.slice(0, maxFiles));
            }
          };
          reader.readAsDataURL(file);
        });
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
    onChange(
      value.filter((_, i) => i !== index),
      thumbnails.filter((_, i) => i !== index)
    );
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
              <img src={thumbnails[i] ?? url} alt={`Upload ${i + 1}`} className="h-full w-full object-cover" />
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
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed p-6 cursor-pointer transition-colors',
            dragOver
              ? 'border-[var(--color-brand-400)] bg-[var(--color-brand-50)]'
              : 'border-[var(--color-border-secondary)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-bg-tertiary)]'
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]">
            <Upload className="h-4 w-4 text-[var(--color-fg-quaternary)]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--color-brand-700)]">
              Click to upload <span className="text-[var(--color-fg-quaternary)] font-normal">or drag and drop</span>
            </p>
            <p className="text-xs text-[var(--color-fg-quaternary)] mt-1">
              PNG, JPG, WEBP up to 5MB &mdash; converted to WebP automatically
            </p>
          </div>
        </div>
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
