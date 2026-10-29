'use client';
// Events S5 (spec §8.3-§8.5): the small dialogs the kit desk, the bibs page and the registration drawer share.
import { useEffect, useRef, useState } from 'react';
import type { KitCollectBody } from '@/lib/api';
import { errorKey } from '@/lib/events';
import { BIB_PATTERN, newIdempotencyKey } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../app/providers';

const MANUAL_REASONS = ['phone_lost', 'no_signal', 'screen_damaged', 'other'] as const;
export const reasonOk = (v: string) => v.trim().length >= 10 && v.trim().length <= 300;

/** A required free-text reason (10 to 300 chars, saved in the audit log): override, void, bib change and release. */
export function ReasonDialog({ open, onClose, title, body, label, confirmLabel, tone = 'primary', onConfirm, testId }: {
  open: boolean; onClose: () => void; title: string; body?: string; label: string; confirmLabel: string; tone?: 'primary' | 'danger';
  onConfirm: (reason: string, idempotencyKey: string) => Promise<void>; testId: string;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setReason(''); setError(null); setBusy(false); key.current = newIdempotencyKey(); } }, [open]);
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(reason.trim(), key.current); }
    catch (err) { setError(errorKey(err)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={title} description={body} size="md">
      <div className="space-y-3" data-testid={testId}>
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={label} hint={`${t('events.kit.reason.hint')} (${reason.trim().length}/300)`} required>
          <Textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} data-testid={`${testId}-reason`} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.kit.cancel')}</Button>
        <Button variant={tone === 'danger' ? 'destructive' : 'primary'} loading={busy} disabled={!reasonOk(reason)} onClick={() => void go()} data-testid={`${testId}-confirm`}>{confirmLabel}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** §8.3 manual handover: why the code was not scanned, and a tick that the ID was checked in person. */
export function ManualHandoverDialog({ open, onClose, name, registrationId, collectionPointId, points = [], onDone, collect }: {
  open: boolean; onClose: () => void; name: string; registrationId: string; collectionPointId?: string; points?: Array<{ id?: string; name: string }>; onDone: () => void;
  collect: (body: KitCollectBody, idempotencyKey: string) => Promise<unknown>;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [idChecked, setIdChecked] = useState(false);
  const [point, setPoint] = useState(collectionPointId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setPoint(collectionPointId ?? ''); setReason(''); setIdChecked(false); setError(null); setBusy(false); key.current = newIdempotencyKey(); } }, [open, collectionPointId]);
  async function go() {
    setBusy(true); setError(null);
    try {
      await collect({ method: 'manual', registrationId, manualReason: reason as (typeof MANUAL_REASONS)[number], ...(point ? { collectionPointId: point } : {}) }, key.current);
      onDone();
    } catch (err) { setError(errorKey(err)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('events.kit.manual.title')} description={name} size="md">
      <div className="space-y-4" data-testid="manual-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={t('events.kit.manual.reason.label')} required>
          <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="manual-reason">
            <option value="">—</option>
            {MANUAL_REASONS.map(r => <option key={r} value={r}>{t(`events.kit.manual.reason.${r}` as MessageKey)}</option>)}
          </Select>
        </Field>
        {points.some(p => p.id) && (
          <Field label={t('events.kit.point.label')} required>
            <Select value={point} onChange={e => setPoint(e.target.value)} data-testid="manual-point">
              <option value="">—</option>
              {points.filter(p => p.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Checkbox label={t('events.kit.manual.idCheck')} checked={idChecked} onChange={e => setIdChecked(e.target.checked)} data-testid="manual-id-check" />
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.kit.cancel')}</Button>
        <Button loading={busy} disabled={!reason || !idChecked || (points.some(p => p.id) && !point)} onClick={() => void go()} data-testid="manual-confirm">{t('events.kit.confirm')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** §8.4 assign / change one bib: upper-case, `[A-Za-z0-9-]`, up to 12; a change needs a reason (10 to 300). */
export function BibDialog({ open, onClose, name, current, onSave }: {
  open: boolean; onClose: () => void; name: string; current: string | null;
  onSave: (body: { bibNumber: string; reason?: string; replace?: boolean }, idempotencyKey: string) => Promise<void>;
}) {
  const { t } = useApp();
  const changing = !!current;
  const [bib, setBib] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const key = useRef(newIdempotencyKey());
  useEffect(() => { if (open) { setBib(current ?? ''); setReason(''); setError(null); setBusy(false); key.current = newIdempotencyKey(); } }, [open, current]);
  const valid = BIB_PATTERN.test(bib) && (!changing || reasonOk(reason)) && bib !== current;
  async function go() {
    setBusy(true); setError(null);
    try { await onSave({ bibNumber: bib.toUpperCase(), ...(changing ? { reason: reason.trim(), replace: true } : {}) }, key.current); }
    catch (err) { setError(errorKey(err)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={changing ? t('events.bibs.change') : t('events.bibs.assign')} description={name} size="md">
      <div className="space-y-4" data-testid="bib-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Field label={t('events.bibs.input.label')} hint={t('events.bibs.input.hint')} required>
          <Input value={bib} maxLength={12} onChange={e => setBib(e.target.value.toUpperCase())} className="font-mono uppercase" data-testid="bib-input" />
        </Field>
        {changing && (
          <Field label={t('events.bibs.changeReason')} hint={t('events.kit.reason.hint')} required>
            <Textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} data-testid="bib-reason" />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.kit.cancel')}</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void go()} data-testid="bib-save">{t('events.bibs.save')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
