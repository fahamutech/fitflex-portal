'use client';
import React, { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './shared';
import { useApp } from '../../app/providers';

/* ── Scroll lock ─────────────────────────────────────────── */
// Locks the page behind a modal: body plus any scrolling ancestor of the dialog (the portal scrolls inside
// <main>, not the body). Reference counted so stacked dialogs unlock only when the last one closes.
const locks = new Map<HTMLElement, { count: number; prev: string }>();
function lockScroll(from: HTMLElement | null): () => void {
  const targets: HTMLElement[] = [document.body];
  for (let el = from?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY;
    if (o === 'auto' || o === 'scroll') targets.push(el);
  }
  for (const el of targets) {
    const hit = locks.get(el);
    if (hit) hit.count += 1;
    else { locks.set(el, { count: 1, prev: el.style.overflow }); el.style.overflow = 'hidden'; }
  }
  return () => {
    for (const el of targets) {
      const hit = locks.get(el);
      if (!hit) continue;
      hit.count -= 1;
      if (hit.count <= 0) { el.style.overflow = hit.prev; locks.delete(el); }
    }
  };
}

/* Esc closes; Tab stays inside the panel; focus moves in on open and returns to what opened it; page scroll is locked. */
function useModalBehavior(open: boolean, panelRef: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const unlock = lockScroll(panel);
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    (panel?.querySelector<HTMLElement>('[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ?? panel)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); unlock(); if (opener && document.contains(opener)) opener.focus(); };
  }, [open, panelRef]);
}

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
  const titleId = useId();
  const { t } = useApp();

  useModalBehavior(open, panelRef, onClose);

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
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full outline-none rounded-[var(--radius-2xl)] bg-[var(--color-bg-primary)]',
          'shadow-[var(--shadow-xl)] flex flex-col max-h-[90vh] max-h-[90dvh]',
          widths[size],
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-0">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pro.close')}
            className="shrink-0 p-2.5 -m-1.5 rounded-[var(--radius-md)] text-[var(--color-fg-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-fg-primary)] transition-colors"
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
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalBehavior(open, panelRef, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm outline-none rounded-[var(--radius-2xl)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-xl)] overflow-hidden"
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
          <h3 id={titleId} className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h3>
          {description && (
            <p id={descId} className="mt-2 text-sm text-[var(--color-fg-quaternary)]">{description}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <Button variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={busy} data-autofocus>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            size="md"
            className="flex-1"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.pleaseWait') : (confirmLabel ?? t('common.confirm'))}
          </Button>
        </div>
      </div>
    </div>
  );
}
