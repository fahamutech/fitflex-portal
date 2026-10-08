'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ModerationAction, ModerationDetail, ModerationEntityType } from '@/lib/api';
import { ACTION_HINT_KEY, ACTION_KEY, DESTRUCTIVE, STATUS_KEY, STATUS_TONE, TYPE_KEY, dateTime, errorKey, whyKey } from '@/lib/moderation';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

/**
 * One listing under moderation: what it is, whether it can be listed and
 * promoted (and why not), what can be done to it, and every decision so far.
 * The server decides which actions are open; this only offers them.
 */
export function ModerationEntityView({ entityType, entityId, onBack, onChanged }: {
  entityType: ModerationEntityType; entityId: string; onBack: () => void; onChanged?: () => void;
}) {
  const { token, t, hasPermission } = useApp();
  const canDecide = hasPermission('moderation_decide');
  const [data, setData] = useState<ModerationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: ModerationAction; reasonRequired: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await api.moderationDetail(token, entityType, entityId));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }, [token, entityType, entityId, t]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="moderation-entity">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="moderation-back">
        <ArrowLeft className="h-4 w-4" />{t('mod.back')}
      </button>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {data && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t(TYPE_KEY[data.entityType])}</p>
              <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]" data-testid="moderation-name">{data.summary.name}</h1>
              {data.summary.subtitle && <p className="text-sm text-[var(--color-fg-tertiary)]">{data.summary.subtitle}</p>}
            </div>
            <Badge tone={STATUS_TONE[data.moderationStatus]} dot>{t(STATUS_KEY[data.moderationStatus])}</Badge>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><h2 className="font-semibold">{t('mod.eligibility.title')}</h2></CardHeader>
              <CardContent>
                {data.eligibility.ok ? (
                  <p className="flex items-start gap-2 text-sm" data-testid="moderation-eligible">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success-600)]" />{t('mod.eligibility.yes')}
                  </p>
                ) : (
                  <div className="text-sm" data-testid="moderation-ineligible">
                    <p className="flex items-center gap-2 font-medium"><XCircle className="h-4 w-4 text-[var(--color-error-600)]" />{t('mod.eligibility.no')}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-6 text-[var(--color-fg-tertiary)]">
                      {data.eligibility.reasons.map(code => { const k = whyKey(code); return <li key={code}>{k ? t(k) : code}</li>; })}
                    </ul>
                  </div>
                )}
                {data.reason && data.moderationStatus !== 'approved' && (
                  <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm">{data.reason}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold">{t('mod.actions')}</h2></CardHeader>
              <CardContent>
                {!canDecide ? (
                  <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="moderation-view-only">{t('mod.viewOnly')}</p>
                ) : data.allowedActions.length === 0 ? (
                  <p className="text-sm text-[var(--color-fg-quaternary)]">{t('mod.noActions')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.allowedActions.map(a => (
                      <Button key={a.action} size="sm" variant={DESTRUCTIVE.includes(a.action) ? 'secondary' : 'primary'}
                        onClick={() => { setNotice(null); setPending(a); }} data-testid={`moderation-action-${a.action}`}>
                        {t(ACTION_KEY[a.action])}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><h2 className="font-semibold">{t('mod.history')}</h2></CardHeader>
            <CardContent>
              {data.history.length === 0 ? (
                <p className="text-sm text-[var(--color-fg-quaternary)]">{t('mod.history.empty')}</p>
              ) : (
                <ol className="space-y-3" data-testid="moderation-history">
                  {data.history.map(h => (
                    <li key={h.id} className="border-l-2 border-[var(--color-border-secondary)] pl-3 text-sm">
                      <p className="font-medium">
                        {t(ACTION_KEY[h.action])}
                        <span className="ml-2 font-normal text-[var(--color-fg-tertiary)]">
                          {h.fromStatus ? t(STATUS_KEY[h.fromStatus]) : '—'} → {t(STATUS_KEY[h.toStatus])}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--color-fg-quaternary)]">{dateTime(h.at)} · {h.actor}</p>
                      {h.reason && <p className="mt-1 text-[var(--color-fg-secondary)]">{h.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {pending && (
            <DecisionDialog entityType={entityType} entityId={entityId} action={pending.action} reasonRequired={pending.reasonRequired}
              onClose={() => setPending(null)}
              onDone={async held => {
                setPending(null);
                setNotice([t('mod.done'), held > 0 ? t('mod.held').replace('{count}', String(held)) : ''].filter(Boolean).join(' '));
                await load();
                onChanged?.();
              }} />
          )}
        </>
      )}
    </div>
  );
}

function DecisionDialog({ entityType, entityId, action, reasonRequired, onClose, onDone }: {
  entityType: ModerationEntityType; entityId: string; action: ModerationAction; reasonRequired: boolean;
  onClose: () => void; onDone: (heldPromotions: number) => void;
}) {
  const { token, t } = useApp();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.moderationDecide(token, entityType, entityId, action, reason);
      onDone(out.heldPromotions ?? 0);
    } catch (err) {
      setError(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t(ACTION_KEY[action])} description={t(ACTION_HINT_KEY[action])} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="moderation-decision">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={reasonRequired ? t('mod.reason.label') : t('mod.reason.optional')}>
          <textarea className="ui-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000}
            required={reasonRequired} data-testid="moderation-reason" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('mod.cancel')}</Button>
          <Button type="submit" disabled={busy || (reasonRequired && !reason.trim())} data-testid="moderation-confirm">{t('mod.confirm')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
