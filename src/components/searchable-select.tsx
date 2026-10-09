'use client';
import { useState, useRef, useEffect, useId, KeyboardEvent } from 'react';
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
  /** Accessible name of the control; defaults to the placeholder. */
  ariaLabel?: string;
}

/**
 * Searchable (and optionally multi-) select.
 * The trigger is a button (aria-haspopup=listbox, aria-expanded, aria-controls). Opening it moves focus
 * to the search input, which is the ARIA combobox: it owns aria-activedescendant over a listbox of
 * role=option items. Arrow keys / Home / End move, Enter selects, Escape closes and returns focus to the
 * trigger, and focus leaving the control (or a click outside) closes it.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  multiple = false,
  allowCreate = false,
  createLabel,
  onCreateNew,
  disabled = false,
  className,
  ariaLabel,
}: SearchableSelectProps) {
  const { t } = useApp();
  const placeholderText = placeholder ?? t('common.search');
  const createText = createLabel ?? t('common.createNew');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const listId = `${uid}-listbox`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

  const filtered = options.filter(
    (o) =>
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      (o.sub && o.sub.toLowerCase().includes(search.toLowerCase()))
  );
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function closeList() {
    setOpen(false);
    setSearch('');
  }

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

  // Opening: focus the search input and start on the first selected option (or the first option).
  useEffect(() => {
    if (!open) return;
    const firstSelected = options.findIndex((o) => selectedValues.includes(o.value));
    setActiveIndex(firstSelected >= 0 ? firstSelected : 0);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the active option visible.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, filtered.length]);

  function toggleValue(val: string) {
    if (multiple) {
      const arr = selectedValues.includes(val)
        ? selectedValues.filter((v) => v !== val)
        : [...selectedValues, val];
      onChange(arr);
    } else {
      onChange(val);
      closeList();
      triggerRef.current?.focus();
    }
  }

  function removeValue(val: string) {
    if (multiple) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange('');
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const last = filtered.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (last >= 0) setActiveIndex(active >= last ? 0 : active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (last >= 0) setActiveIndex(active <= 0 ? last : active - 1);
        break;
      case 'Home':
        // With text in the box Home/End keep moving the caret.
        if (!search) { e.preventDefault(); setActiveIndex(0); }
        break;
      case 'End':
        if (!search) { e.preventDefault(); setActiveIndex(Math.max(0, last)); }
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[active]) toggleValue(filtered[active].value);
        break;
      case 'Escape':
        // Close just the list (not an enclosing dialog) and give focus back.
        e.preventDefault();
        // React's root is `document` in the app router, so also stop the dialog's own document listener.
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        closeList();
        triggerRef.current?.focus();
        break;
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); closeList(); }
  }

  const selectedLabels = selectedValues
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean) as SelectOption[];

  const name = ariaLabel ?? placeholderText;
  const triggerName = selectedLabels.length ? `${name}: ${selectedLabels.map((o) => o.label).join(', ')}` : name;

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onBlur={(e) => {
        // Focus moved outside the whole control: close.
        if (open && !containerRef.current?.contains(e.relatedTarget as Node | null)) closeList();
      }}
    >
      {/* Trigger */}
      <div
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        className={cn(
          'ui-input flex flex-wrap items-center gap-1.5 min-h-[40px] cursor-pointer',
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'ring-2 ring-[var(--color-brand-500)]'
        )}
      >
        {selectedLabels.map((opt) => (
          <span
            key={opt.value}
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand-50)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand-700)]"
          >
            {opt.label}
            {!disabled && (
              <button
                type="button"
                aria-label={t('common.remove').replace('{name}', opt.label)}
                onClick={(e) => {
                  e.stopPropagation();
                  removeValue(opt.value);
                }}
                className="hover:text-[var(--color-brand-900)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={triggerName}
          onKeyDown={onTriggerKeyDown}
          className="min-h-[1.5rem] min-w-[3rem] flex-1 bg-transparent text-left text-sm text-[var(--color-fg-quaternary)] cursor-[inherit]"
        >
          {selectedLabels.length === 0 ? placeholderText : ''}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          // Clicking the dropdown's padding or icon must not blur the search input (which would close the list).
          onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement) && !(e.target as HTMLElement).closest('button')) e.preventDefault(); }}
          className="absolute z-50 mt-1 w-full rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)] overflow-hidden"
        >
          {/* Search input — the combobox */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border-secondary)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--color-fg-quaternary)] shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered.length ? optionId(active) : undefined}
              aria-label={name}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
              onKeyDown={onInputKeyDown}
              placeholder={placeholderText}
              className="flex-1 bg-transparent text-sm text-[var(--color-fg-primary)] outline-none placeholder:text-[var(--color-fg-quaternary)]"
            />
          </div>

          {/* Options list */}
          <div
            id={listId}
            role="listbox"
            aria-label={name}
            aria-multiselectable={multiple || undefined}
            className="max-h-[200px] overflow-y-auto"
          >
            {filtered.map((opt, i) => {
              const isSelected = selectedValues.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  // Keep focus in the search input while clicking.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => { if (i !== active) setActiveIndex(i); }}
                  onClick={() => toggleValue(opt.value)}
                  className={cn(
                    'w-full flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isSelected
                      ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                      : 'text-[var(--color-fg-primary)]',
                    i === active && (isSelected ? 'bg-[var(--color-brand-100)]' : 'bg-[var(--color-bg-tertiary)]'),
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{opt.label}</div>
                    {opt.sub && (
                      <div className="truncate text-xs text-[var(--color-fg-quaternary)]">{opt.sub}</div>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div role="status" className="px-3 py-4 text-center text-sm text-[var(--color-fg-quaternary)]">
              {t('common.noResults')}
            </div>
          )}

          {/* Create new option */}
          {allowCreate && onCreateNew && (
            <button
              type="button"
              onClick={() => {
                closeList();
                onCreateNew();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--color-brand-700)] border-t border-[var(--color-border-secondary)] hover:bg-[var(--color-brand-50)] transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {createText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
