'use client';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '../../../app/providers';

/* ─────────────────────────────────────────────
   Toasts  —  transient, non-blocking feedback
   ───────────────────────────────────────────── */
export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  /** Bold first line above the message. */
  title?: string;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Defaults: 6000, errors 10000. */
  duration?: number;
}

interface ToastItemData extends ToastOptions { id: number; tone: ToastTone; message: string }

export interface ToastApi {
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  warning: (message: string, opts?: ToastOptions) => number;
  /** Dismiss one toast by id, or all of them when called without an id. */
  dismiss: (id?: number) => void;
}

const MAX_VISIBLE = 4;
const noop = () => 0;
const fallbackApi: ToastApi = { success: noop, error: noop, info: noop, warning: noop, dismiss: () => {} };
const ToastCtx = createContext<ToastApi | null>(null);

/** Toast API. Outside a <ToastProvider> it is a harmless no-op (so shared components can call it anywhere). */
export function useToast(): ToastApi {
  return useContext(ToastCtx) ?? fallbackApi;
}

const toneStyles: Record<ToastTone, { box: string; icon: string; Icon: typeof Info }> = {
  success: { box: 'bg-[var(--color-success-50)] border-[var(--color-success-200)] text-[var(--color-success-800)]', icon: 'text-[var(--color-success-600)]', Icon: CheckCircle2 },
  error:   { box: 'bg-[var(--color-error-50)] border-[var(--color-error-200)] text-[var(--color-error-800)]',       icon: 'text-[var(--color-error-600)]',   Icon: AlertCircle },
  info:    { box: 'bg-[var(--color-info-50)] border-[var(--color-info-200)] text-[var(--color-info-800)]',           icon: 'text-[var(--color-info-600)]',    Icon: Info },
  warning: { box: 'bg-[var(--color-warning-50)] border-[var(--color-warning-200)] text-[var(--color-warning-800)]', icon: 'text-[var(--color-warning-600)]', Icon: TriangleAlert },
};

function ToastItem({ toast, onDismiss, closeLabel }: { toast: ToastItemData; onDismiss: (id: number) => void; closeLabel: string }) {
  const duration = toast.duration ?? (toast.tone === 'error' ? 10_000 : 6_000);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);

  // Auto-dismiss; hovering or focusing the toast pauses the countdown and resumes with the time left.
  useEffect(() => {
    if (paused || duration <= 0) return;
    startedAt.current = Date.now();
    const handle = setTimeout(() => onDismiss(toast.id), Math.max(0, remaining.current));
    return () => { clearTimeout(handle); remaining.current -= Date.now() - startedAt.current; };
  }, [paused, duration, onDismiss, toast.id]);

  const { box, icon, Icon } = toneStyles[toast.tone];
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn('pointer-events-auto flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 shadow-[var(--shadow-lg)]', box)}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 h-5 w-5 shrink-0', icon)} />
      <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        {toast.title && <p className="font-semibold">{toast.title}</p>}
        <p className={toast.title ? 'mt-0.5' : 'font-medium'}>{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={closeLabel}
        className="-m-1.5 shrink-0 rounded-[var(--radius-md)] p-2 opacity-70 hover:opacity-100"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useApp();
  const [toasts, setToasts] = useState<ToastItemData[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id?: number) => {
    setToasts(list => (id === undefined ? [] : list.filter(x => x.id !== id)));
  }, []);

  const push = useCallback((tone: ToastTone, message: string, opts?: ToastOptions) => {
    const id = nextId.current++;
    setToasts(list => [...list, { id, tone, message, ...opts }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (m, o) => push('success', m, o),
    error:   (m, o) => push('error', m, o),
    info:    (m, o) => push('info', m, o),
    warning: (m, o) => push('warning', m, o),
    dismiss,
  }), [push, dismiss]);

  const polite = toasts.filter(x => x.tone !== 'error');
  const errors = toasts.filter(x => x.tone === 'error');
  const closeLabel = t('common.dismiss');

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {/* Two always-mounted live regions (so announcements are reliable): errors interrupt, the rest are polite. */}
      <div
        role="region"
        aria-label={t('common.notifications')}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col sm:inset-x-auto sm:right-4 sm:w-96 print:hidden"
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {polite.map(x => <ToastItem key={x.id} toast={x} onDismiss={dismiss} closeLabel={closeLabel} />)}
        </div>
        <div role="alert" className="flex flex-col gap-2 not-empty:mt-2">
          {errors.map(x => <ToastItem key={x.id} toast={x} onDismiss={dismiss} closeLabel={closeLabel} />)}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}
