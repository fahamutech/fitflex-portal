'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §3.1, §3.2, decision D33): the payout schedule on the
// admin event page. A FitFlex admin with scope `events` can change it after publish, with a reason (10 to 300 chars, audited).
import { useState } from 'react';
import { api, type AdminEventDetail, type PayoutSchedule } from '@/lib/api';
import { errorKey, isPublishedLike } from '@/lib/events';
import { PAYOUT_SCHEDULES, payoutKey } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, CardHeader, Field, Radio, Textarea, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

export function AdminPayoutCard({ doc, onChanged }: { doc: AdminEventDetail; onChanged: () => void }) {
  const { t, token, hasPermission } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<PayoutSchedule | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const canEdit = hasPermission('events') && isPublishedLike(doc.status);
  const current = doc.payoutSchedule ?? null;
  const valid = !!choice && choice !== current && reason.trim().length >= 10 && reason.trim().length <= 300;

  async function save() {
    if (!token || !choice) return;
    setBusy(true); setError(null);
    try {
      await api.adminSetPayoutSchedule(token, doc.id, { payoutSchedule: choice, reason: reason.trim() });
      toast.success(t('events.payout.admin.done'));
      setOpen(false); onChanged();
    } catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  return (
    <Card data-testid="admin-payout-card">
      <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('events.payout.title')}</h2></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-base font-medium text-[var(--color-fg-primary)]" data-testid="admin-payout-value">{current ? t(payoutKey(current)) : t('events.payout.notSet')}</p>
        {canEdit && <Button variant="secondary" size="sm" onClick={() => { setChoice(''); setReason(''); setError(null); setOpen(true); }} data-testid="admin-payout-edit">{t('events.payout.admin.edit')}</Button>}
      </CardContent>
      <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} title={t('events.payout.admin.edit')} description={doc.title} size="md">
        <div className="space-y-4" data-testid="admin-payout-dialog">
          {error && <Alert tone="error">{t(error)}</Alert>}
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.payout.title')}</legend>
            {PAYOUT_SCHEDULES.map(s => <div key={s} className="min-h-11"><Radio name="adminPayout" value={s} label={t(payoutKey(s))} checked={choice === s} onChange={() => setChoice(s)} data-testid={`admin-payout-${s}`} /></div>)}
          </fieldset>
          <Field label={t('events.payout.admin.reason')} hint={`${t('events.payout.admin.hint')} (${reason.trim().length}/300)`} required>
            <Textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} data-testid="admin-payout-reason" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('events.kit.cancel')}</Button>
          <Button loading={busy} disabled={!valid} onClick={() => void save()} data-testid="admin-payout-save">{t('events.payout.admin.save')}</Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}
