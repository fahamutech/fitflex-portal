'use client';
// Events S7: one confirm dialog for the actions that need a reason (10 to 300 characters, optional Swahili text for the person told) and,
// for the dangerous ones, a typed confirmation (spec §3.14 Desks panel, §4.9 close, §6.3). The answer never carries a user id.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newIdempotencyKey } from '@/lib/events-ops';
import { REASON_MAX, reasonValid, s7ErrorKey } from '@/lib/events-s7';
import { Alert, Button, Field, Input, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

export interface ReasonResult { reason: string; reasonSw?: string; key: string }

export function ReasonTypedDialog({ open, onClose, title, body, tone = 'danger', confirmLabel, testId, reasonLabel, reasonSwLabel, noReason = false,
  typed, typedLabel, onConfirm, extra, extraValid = true, errorText }: {
  open: boolean; onClose: () => void; title: string; body?: ReactNode; tone?: 'danger' | 'primary'; confirmLabel: string; testId: string;
  reasonLabel?: string; /** Offer an optional Swahili reason, shown to the person told. */ reasonSwLabel?: string; /** Typed confirmation only (no reason), e.g. closing a waitlist. */ noReason?: boolean;
  /** Accepted typed texts (compared case-insensitively, trimmed). */ typed?: string[]; typedLabel?: string;
  onConfirm: (r: ReasonResult) => Promise<void>; extra?: ReactNode; extraValid?: boolean;
  /** A text for a refusal the generic map does not know (e.g. "Not available because {feature} is off"); null falls back to the generic text. */ errorText?: (err: unknown) => string | null;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [reasonSw, setReasonSw] = useState('');
  const [typedValue, setTypedValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setReason(''); setReasonSw(''); setTypedValue(''); setError(null); setBusy(false); key.current = newIdempotencyKey(); } }, [open]);
  const typedOk = !typed || typed.some(w => w.toLowerCase() === typedValue.trim().toLowerCase());
  const ok = (noReason || reasonValid(reason)) && (!reasonSwLabel || !reasonSw.trim() || reasonValid(reasonSw)) && typedOk && extraValid;
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm({ reason: reason.trim(), ...(reasonSw.trim() ? { reasonSw: reasonSw.trim() } : {}), key: key.current }); }
    catch (err) { setError(errorText?.(err) ?? t(s7ErrorKey(err))); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={title} size="md">
      <div className="space-y-3" data-testid={testId}>
        {body && <div className="text-sm text-[var(--color-fg-secondary)]">{body}</div>}
        {error && <div role="alert"><Alert tone="error">{error}</Alert></div>}
        {extra}
        {!noReason && (
          <Field label={reasonLabel ?? ''} hint={`${reason.trim().length}/${REASON_MAX}`} required>
            <Textarea rows={3} maxLength={REASON_MAX} value={reason} onChange={e => setReason(e.target.value)} data-testid={`${testId}-reason`} />
          </Field>
        )}
        {!noReason && reasonSwLabel && (
          <Field label={reasonSwLabel} hint={`${reasonSw.trim().length}/${REASON_MAX}`}>
            <Textarea rows={2} maxLength={REASON_MAX} value={reasonSw} onChange={e => setReasonSw(e.target.value)} data-testid={`${testId}-reason-sw`} />
          </Field>
        )}
        {typed && (
          <Field label={typedLabel ?? ''} required>
            <Input value={typedValue} onChange={e => setTypedValue(e.target.value)} autoComplete="off" data-testid={`${testId}-typed`} />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant={tone === 'danger' ? 'destructive' : 'primary'} loading={busy} disabled={!ok} onClick={() => void go()} data-testid={`${testId}-confirm`}>{confirmLabel}</Button>
      </DialogFooter>
    </Dialog>
  );
}
