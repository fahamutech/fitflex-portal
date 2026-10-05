'use client';
import React, { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './shared';
import { useApp } from '../../app/providers';

/* ── Overlay Dialog ──────────────────────────────────────── */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full rounded-[var(--radius-2xl)] bg-[var(--color-bg-primary)]',
          'shadow-[var(--shadow-xl)] flex flex-col max-h-[90vh]',
          widths[size],
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-[var(--radius-md)] text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — DialogFooter children will stick to bottom */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            {React.Children.toArray(children).filter(
              (child) => !React.isValidElement(child) || child.type !== DialogFooter
            )}
          </div>
          {React.Children.toArray(children).filter(
            (child) => React.isValidElement(child) && child.type === DialogFooter
          )}
        </div>
      </div>
    </div>
  );
}

/* ── DialogFooter ────────────────────────────────────────── */
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-secondary)] rounded-b-[var(--radius-2xl)] bg-[var(--color-bg-secondary)]',
      className,
    )}>
      {children}
    </div>
  );
}

/* ── ConfirmDialog ───────────────────────────────────────── */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
}) {
  const { t } = useApp();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-sm rounded-[var(--radius-2xl)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-xl)] overflow-hidden"
      >
        {/* Icon accent */}
        <div className={cn(
          'mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-[var(--color-error-50)]' : 'bg-[var(--color-brand-50)]',
        )}>
          {tone === 'danger' ? (
            <svg className="h-6 w-6 text-[var(--color-error-600)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          ) : (
            <svg className="h-6 w-6 text-[var(--color-brand-600)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>

        <div className="px-6 py-5 text-center">
          <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h3>
          {description && (
            <p className="mt-2 text-sm text-[var(--color-fg-quaternary)]">{description}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <Button variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t('admin.action.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            size="md"
            className="flex-1"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('ui.pleaseWait') : (confirmLabel ?? t('ui.confirm'))}
          </Button>
        </div>
      </div>
    </div>
  );
}
