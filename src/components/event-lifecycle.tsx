'use client';
import { useState } from 'react';
import type { Bilingual, EventAllowedAction } from '@/lib/api';
import { ACTION_KEYS, CANCEL_REASONS, LIFECYCLE_ACTIONS, cancelReasonKey, errorCode, errorKey } from '@/lib/events';
import { Alert, Button, Field, Select, Textarea, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

export type LifecycleAction = 'withdraw' | 'cancel' | 'complete' | 'archive' | 'delete';
export type RunLifecycle = (action: LifecycleAction, body?: { reason?: string; note?: Bilingual }) => Promise<void>;

/** The lifecycle buttons a row or document offers (§7.2): the server's `allowedActions` filtered by what the role may do. */
export function lifecycleActions(allowed: EventAllowedAction[] | undefined, canManage: boolean): LifecycleAction[] {
  if (!canManage) return [];
  return LIFECYCLE_ACTIONS.filter(a => allowed?.includes(a)) as LifecycleAction[];
}

export function LifecycleButtons({ actions, onPick, size = 'sm', testPrefix = 'ev-action' }: { actions: LifecycleAction[]; onPick: (a: LifecycleAction) => void; size?: 'sm' | 'md'; testPrefix?: string }) {
  const { t } = useApp();
  return (
    <>
      {actions.map(a => (
        <Button key={a} variant={a === 'cancel' || a === 'delete' ? 'ghost' : 'secondary'} size={size} onClick={() => onPick(a)} data-testid={`${testPrefix}-${a}`}
          className={a === 'cancel' || a === 'delete' ? 'text-[var(--color-error-700)]' : undefined}>
          {t(ACTION_KEYS[a])}
        </Button>
      ))}
    </>
  );
}

/**
 * The confirmation dialogs for withdraw, complete, archive, delete (ConfirmDialog) and cancel (reason + note, §7.2).
 * `run` performs the call; a 409 `has_registrations` on cancel shows the "ask FitFlex" copy inside the dialog.
 */
export function LifecycleDialogs({ action, onClose, run }: { action: LifecycleAction | null; onClose: () => void; run: RunLifecycle }) {
  const { t } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string>('organizer_decision');
  const [noteEn, setNoteEn] = useState('');
  const [noteSw, setNoteSw] = useState('');
  const [blocked, setBlocked] = useState(false);

  async function go(body?: { reason?: string; note?: Bilingual }) {
    if (!action) return;
    setBusy(true); setBlocked(false);
    try { await run(action, body); onClose(); }
    catch (err) {
      if (errorCode(err) === 'has_registrations') { setBlocked(true); return; }
      toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  const close = () => { setBlocked(false); onClose(); };

  if (action === 'cancel') {
    return (
      <Dialog open onClose={close} title={t('events.cancel.title')} description={t('events.cancel.body')} size="md">
        <div className="space-y-4">
          {blocked && (
            <div data-testid="cancel-has-registrations">
              <Alert tone="warning">{t('events.cancel.hasRegistrations')} {t('events.cancel.organizerHint')} <a href="#organizer-help" className="underline">{t('organizer.status.contactSupport')}</a></Alert>
            </div>
          )}
          <Field label={t('events.cancel.reason')} required>
            <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="cancel-reason">
              {CANCEL_REASONS.map(r => <option key={r} value={r}>{t(cancelReasonKey(r))}</option>)}
            </Select>
          </Field>
          <Field label={t('events.cancel.noteEn')}><Textarea rows={3} value={noteEn} onChange={e => setNoteEn(e.target.value)} maxLength={500} data-testid="cancel-note-en" /></Field>
          <Field label={t('events.cancel.noteSw')}><Textarea rows={3} value={noteSw} onChange={e => setNoteSw(e.target.value)} maxLength={500} data-testid="cancel-note-sw" /></Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => void go({ reason, note: { en: noteEn.trim(), sw: noteSw.trim() } })} data-testid="cancel-confirm">{t('events.cancel.action')}</Button>
        </DialogFooter>
      </Dialog>
    );
  }
  const copy: Record<Exclude<LifecycleAction, 'cancel'>, { title: string; body?: string; label: string; tone: 'danger' | 'primary' }> = {
    withdraw: { title: t('events.withdraw.title'), body: t('events.withdraw.body'), label: t('events.withdraw.action'), tone: 'primary' },
    complete: { title: t('events.complete.title'), label: t('events.complete.action'), tone: 'primary' },
    archive: { title: t('events.archive.title'), body: t('events.archive.body'), label: t('events.archive.action'), tone: 'primary' },
    delete: { title: t('events.delete.title'), label: t('events.delete.action'), tone: 'danger' },
  };
  if (!action) return null;
  const c = copy[action];
  return <ConfirmDialog open onClose={close} onConfirm={() => void go()} busy={busy} tone={c.tone} title={c.title} description={c.body} confirmLabel={c.label} />;
}
