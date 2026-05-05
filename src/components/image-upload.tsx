'use client';
import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ImageUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

export function ImageUpload({
  value = [],
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

    toProcess.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        if (dataUrl) {
          onChange([...value, dataUrl]);
        }
      };
      reader.readAsDataURL(file);
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
    onChange(value.filter((_, i) => i !== index));
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
              <img src={url} alt={`Upload ${i + 1}`} className="h-full w-full object-cover" />
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
              PNG, JPG, WEBP up to 5MB
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
