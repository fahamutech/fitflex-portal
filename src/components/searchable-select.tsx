'use client';
import { useState, useRef, useEffect, ReactNode } from 'react';
import { Search, Plus, X, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '../../app/providers';

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  allowCreate?: boolean;
  createLabel?: string;
  onCreateNew?: () => void;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder: placeholderProp,
  multiple = false,
  allowCreate = false,
  createLabel,
  onCreateNew,
  disabled = false,
  className,
}: SearchableSelectProps) {
  const { t } = useApp();
  const placeholder = placeholderProp ?? t('ui.select.search');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      (o.sub && o.sub.toLowerCase().includes(search.toLowerCase()))
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleValue(val: string) {
    if (multiple) {
      const arr = selectedValues.includes(val)
        ? selectedValues.filter((v) => v !== val)
        : [...selectedValues, val];
      onChange(arr);
    } else {
      onChange(val);
      setOpen(false);
      setSearch('');
    }
  }

  function removeValue(val: string) {
    if (multiple) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange('');
    }
  }

  const selectedLabels = selectedValues
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean) as SelectOption[];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <div
        onClick={() => {
          if (!disabled) {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        className={cn(
          'ui-input flex flex-wrap items-center gap-1.5 min-h-[40px] cursor-pointer',
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'ring-2 ring-[var(--color-brand-500)]'
        )}
      >
        {selectedLabels.length > 0 ? (
          selectedLabels.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand-50)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand-700)]"
            >
              {opt.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeValue(opt.value);
                  }}
                  className="hover:text-[var(--color-brand-900)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-[var(--color-fg-quaternary)] text-sm">{placeholder}</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)] overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border-secondary)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--color-fg-quaternary)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-quaternary)]"
            />
          </div>

          {/* Options list */}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-[var(--color-fg-quaternary)]">
                {t('ui.select.noResults')}
              </div>
            )}
            {filtered.map((opt) => {
              const isSelected = selectedValues.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleValue(opt.value)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                      : 'text-[var(--color-fg-primary)] hover:bg-[var(--color-bg-tertiary)]'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{opt.label}</div>
                    {opt.sub && (
                      <div className="truncate text-xs text-[var(--color-fg-quaternary)]">{opt.sub}</div>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Create new option */}
          {allowCreate && onCreateNew && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSearch('');
                onCreateNew();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--color-brand-700)] border-t border-[var(--color-border-secondary)] hover:bg-[var(--color-brand-50)] transition-colors"
            >
              <Plus className="h-4 w-4" />
              {createLabel ?? t('ui.select.createNew')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
