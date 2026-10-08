'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, AuditEntry, GeoArea, Promotion, PromotionDetail } from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY, whyKey } from '@/lib/moderation';
import {
  ACTION_KEY, APPROVER_ACTIONS, PLACEMENT_KEY, REASON_REQUIRED, REL_KEY, STATUS_KEY, STATUS_TONE, TYPE_KEY, dateTime, errorBody, errorCode, errorKey, scopeSummary,
} from '@/lib/promotions';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { DateTimeInput } from '@/components/datetime-input';
import { CapacityList } from '@/components/promotion-wizard';

const HIST_KEY: Record<string, MessageKey> = {
  created: 'pro.hist.created', updated: 'pro.hist.updated', submitted: 'pro.hist.submitted', approved: 'pro.hist.approved', rejected: 'pro.hist.rejected',
  reopened: 'pro.hist.reopened', scheduled: 'pro.hist.scheduled', activated: 'pro.hist.activated', paused: 'pro.hist.paused', resumed: 'pro.hist.resumed',
  cancelled: 'pro.hist.cancelled', completed: 'pro.hist.completed', expired: 'pro.hist.expired',
};
const FIELD_KEY: Record<string, MessageKey> = {
  priority: 'pro.field.priority', boostWeight: 'pro.field.boostWeight', endsAt: 'pro.field.endsAt', startsAt: 'pro.field.startsAt', placements: 'pro.field.placements',
  commercialRef: 'pro.field.commercialRef', status: 'pro.field.status',
};

/** One history line: what happened, and for an edit which fields moved from what to what. */
function describe(e: AuditEntry, t: (k: MessageKey) => string): { title: string; detail: string | null } {
  const verb = e.action.replace(/^promotion\./, '');
  const key = HIST_KEY[verb];
  const title = key ? t(key) : verb.replace(/_/g, ' ');
  const after = e.after ?? {};
  let detail: string | null = typeof after.reason === 'string' && after.reason ? after.reason : null;
  if (verb === 'updated' && e.before) {
    const changes = Object.keys(after).filter(k => FIELD_KEY[k] && JSON.stringify((e.before as Record<string, unknown>)[k]) !== JSON.stringify(after[k]))
      .map(k => `${t(FIELD_KEY[k])}: ${show(k, (e.before as Record<string, unknown>)[k])} → ${show(k, after[k])}`);
    detail = changes.join('; ') || null;
  }
  return { title, detail };
}
const show = (k: string, v: unknown) => (k === 'endsAt' || k === 'startsAt' ? dateTime(String(v)) : Array.isArray(v) ? v.join(', ') : v == null ? '—' : String(v));

/**
 * One promotion: its terms, whether the entity may still be promoted, how much
 * room its placements have, what can be done next (only what the server allows,
 * and only what the admin's permissions cover), and every change so far.
 */
export function PromotionDetailView({ id, areas, onBack, onEdit, onChanged }: {
  id: string; areas: GeoArea[]; onBack: () => void; onEdit: (id: string) => void; onChanged?: () => void;
}) {
  const { token, user, t, hasPermission } = useApp();
  const [data, setData] = useState<PromotionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setData(await api.promotionDetail(token, id)); }
    catch (err) { setError(t(errorKey(err))); }
  }, [token, id, t]);
  useEffect(() => { load(); }, [load]);

  const p = data?.promotion;
  const mine = !!p && !!user && (user.id === p.createdBy || user.id === p.submittedBy);
  const allowed = (data?.allowedActions ?? []).filter(a => (APPROVER_ACTIONS.includes(a) ? hasPermission('promotions_approve') : hasPermission('promotions')));
  const blockedBySelf = !!p && p.status === 'pending_approval' && mine && hasPermission('promotions_approve');

  const finish = async (message?: string) => {
    setDialog(null);
    if (message) setNotice(message);
    await load();
    onChanged?.();
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="text-sm text-[var(--color-fg-tertiary)]">{label}</dt><dd className="text-sm sm:col-span-2">{value}</dd></div>
  );

  return (
    <div className="space-y-6" data-testid="promotion-detail">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="promotion-back">
        <ArrowLeft className="h-4 w-4" />{t('pro.back')}
      </button>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!data && !error && <Spinner className="h-6 w-6" />}
      {data && p && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[p.entityType])} · {t(TYPE_KEY[p.type])}</p>
              <h1 className="text-xl font-semibold" data-testid="promotion-name">{p.entity?.name ?? p.entityId}</h1>
              {p.statusReason && <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]">{p.statusReason}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasPermission('promotion_analytics') && (
                <Link href={`/admin/promotion-analytics?item=${encodeURIComponent(p.id)}`} className="text-sm text-[var(--color-fg-brand)] hover:underline" data-testid="promotion-performance-link">{t('pan.performance')}</Link>
              )}
              {p.isCommercial && <Badge tone="warning">{p.label ?? t('pro.commercial')}</Badge>}
              <Badge tone={STATUS_TONE[p.effectiveStatus]} dot><span data-testid="promotion-status">{t(STATUS_KEY[p.effectiveStatus])}</span></Badge>
            </div>
          </div>
          {p.effectiveStatus !== p.status && <Alert tone="info">{t('pro.detail.effective').replace('{status}', t(STATUS_KEY[p.effectiveStatus]))}</Alert>}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><h2 className="font-semibold">{t('pro.detail.terms')}</h2></CardHeader>
              <CardContent>
                <dl className="divide-y divide-[var(--color-border-secondary)]" data-testid="promotion-terms">
                  {row(t('pro.wiz.step.placement'), p.placements.map(pl => t(PLACEMENT_KEY[pl])).join(', '))}
                  {row(t('pro.wiz.review.where'), scopeSummary(p.geoScope, areas, t('pro.everywhere')))}
                  {row(t('pro.wiz.review.when'), `${dateTime(p.startsAt)} → ${dateTime(p.endsAt)}`)}
                  {row(t('pro.wiz.step.priority'), <span data-testid="promotion-priority">{p.priority}</span>)}
                  {row(t('pro.wiz.priority.weight'), p.boostWeight)}
                  {p.categories.length > 0 && row(t('pro.wiz.targeting.categories'), p.categories.join(', '))}
                  {row(t('pro.wiz.step.commercial'), p.isCommercial ? <>{t('pro.wiz.commercial.yes')}{p.relationshipType ? ` · ${t(REL_KEY[p.relationshipType] ?? 'pro.commercial')}` : ''}{p.commercialRef ? ` · ${p.commercialRef}` : ''}</> : t('pro.wiz.commercial.no'))}
                  {p.partnerRef && row(t('pro.wiz.commercial.partner'), p.partnerRef)}
                  {p.campaignId && row(t('pro.wiz.commercial.campaign'), p.campaignId)}
                  {p.notes && row(t('pro.wiz.commercial.notes'), p.notes)}
                  {row(t('pro.detail.people'), `${p.createdBy}${p.approvedBy ? ` · ${t('pro.hist.approved')}: ${p.approvedBy}` : ''}`)}
                </dl>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader><h2 className="font-semibold">{t('pro.detail.actions')}</h2></CardHeader>
                <CardContent>
                  {blockedBySelf && <p className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="promotion-self-approval">{t('pro.detail.selfApproval')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {allowed.filter(a => !(blockedBySelf && (a === 'approve'))).map(a => (
                      <Button key={a} size="sm" variant={a === 'approve' || a === 'activate' || a === 'submit' ? 'primary' : 'secondary'}
                        onClick={() => { setNotice(null); a === 'edit' ? onEdit(id) : setDialog(a); }} data-testid={`promotion-action-${a}`}>
                        {t(ACTION_KEY[a])}
                      </Button>
                    ))}
                    {allowed.length === 0 && !blockedBySelf && <p className="text-sm text-[var(--color-fg-quaternary)]">{t('pro.detail.noActions')}</p>}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><h2 className="font-semibold">{t('pro.detail.eligibility')}</h2></CardHeader>
                <CardContent>
                  {data.eligibility.ok ? (
                    <p className="flex items-start gap-2 text-sm" data-testid="promotion-eligible"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success-600)]" />{t('pro.detail.eligible')}</p>
                  ) : (
                    <div className="text-sm" data-testid="promotion-ineligible">
                      <p className="flex items-center gap-2 font-medium"><XCircle className="h-4 w-4 text-[var(--color-error-600)]" />{t('pro.detail.notEligible')}</p>
                      <ul className="mt-2 list-disc pl-6 text-[var(--color-fg-tertiary)]">{data.eligibility.reasons.map(c => { const k = whyKey(c); return <li key={c}>{k ? t(k) : c}</li>; })}</ul>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><h2 className="font-semibold">{t('pro.detail.capacity')}</h2></CardHeader>
                <CardContent><CapacityList rows={data.capacity} /></CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader><h2 className="font-semibold">{t('pro.detail.history')}</h2></CardHeader>
            <CardContent>
              <ol className="space-y-3" data-testid="promotion-history">
                {data.history.map(h => {
                  const { title, detail } = describe(h, t);
                  return (
                    <li key={h.id} className="border-l-2 border-[var(--color-border-secondary)] pl-3 text-sm">
                      <p className="font-medium">{title}</p>
                      <p className="text-xs text-[var(--color-fg-quaternary)]">{dateTime(h.at)} · {h.actor}</p>
                      {detail && <p className="mt-1 text-[var(--color-fg-secondary)]">{detail}</p>}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {dialog === 'edit_live' && <LiveEditDialog p={p} onClose={() => setDialog(null)} onDone={() => finish(t('pro.saved'))} />}
          {dialog && dialog !== 'edit_live' && (
            <ActionDialog id={id} action={dialog} onClose={() => setDialog(null)} onDone={warn => finish(warn ? t('pro.saved') + ' ' + t('pro.detail.fullWarning') : t('pro.saved'))} />
          )}
        </>
      )}
    </div>
  );
}

function ActionDialog({ id, action, onClose, onDone }: { id: string; action: string; onClose: () => void; onDone: (warning: boolean) => void }) {
  const { token, t } = useApp();
  const needsReason = REASON_REQUIRED.includes(action);
  const asksReason = needsReason || action === 'pause';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true); setError(null); setDetailRows([]);
    try {
      const out = await api.promotionAction(token, id, action as Parameters<typeof api.promotionAction>[2], reason);
      onDone(!!out.warnings?.length);
    } catch (err) {
      const body = errorBody<{ reasons?: string[]; capacity?: Array<{ placement: keyof typeof PLACEMENT_KEY; full: boolean }> }>(err);
      setError(t(errorKey(err)));
      if (errorCode(err) === 'entity_not_promotable') setDetailRows((body?.reasons ?? []).map(c => { const k = whyKey(c); return k ? t(k) : c; }));
      if (errorCode(err) === 'placement_full') setDetailRows((body?.capacity ?? []).filter(c => c.full).map(c => t(PLACEMENT_KEY[c.placement])));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t(ACTION_KEY[action])} description={t(`pro.action.${action}.hint` as MessageKey)} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="promotion-action-dialog">
        {error && <Alert tone="error">{error}{detailRows.length > 0 && <ul className="mt-1 list-disc pl-5">{detailRows.map(r => <li key={r}>{r}</li>)}</ul>}</Alert>}
        {asksReason && (
          <Field label={needsReason ? t('pro.reason') : t('pro.reasonOptional')}>
            <textarea className="ui-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required={needsReason} data-testid="promotion-reason" />
          </Field>
        )}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('pro.cancel')}</Button>
          <Button type="submit" disabled={busy || (needsReason && !reason.trim())} data-testid="promotion-confirm">{t('pro.confirm')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function LiveEditDialog({ p, onClose, onDone }: { p: Promotion; onClose: () => void; onDone: () => void }) {
  const { token, t } = useApp();
  const [priority, setPriority] = useState(String(p.priority));
  const [weight, setWeight] = useState(String(p.boostWeight));
  const [endsAt, setEndsAt] = useState(p.endsAt);
  const [ref, setRef] = useState(p.commercialRef ?? '');
  const [notes, setNotes] = useState(p.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await api.updatePromotion(token, p.id, {
        priority: Number(priority), boostWeight: Number(weight), endsAt,
        ...(ref.trim() ? { commercialRef: ref.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(t(errorKey(err)));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('pro.action.edit_live')} description={t('pro.action.edit_live.hint')} size="md">
      <form onSubmit={submit} className="space-y-4" data-testid="promotion-live-edit">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pro.wiz.priority.priority')}><input className="ui-input" type="number" min={1} max={100} value={priority} onChange={e => setPriority(e.target.value)} data-testid="live-priority" /></Field>
          <Field label={t('pro.wiz.priority.weight')}><input className="ui-input" type="number" min={0} max={1} step={0.05} value={weight} onChange={e => setWeight(e.target.value)} /></Field>
        </div>
        <Field label={t('pro.wiz.schedule.end')}><DateTimeInput value={endsAt} onChange={setEndsAt} data-testid="live-end" /></Field>
        <Field label={t('pro.wiz.commercial.reference')}><input className="ui-input" value={ref} onChange={e => setRef(e.target.value)} maxLength={200} /></Field>
        <Field label={t('pro.wiz.commercial.notes')}><textarea className="ui-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} /></Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('pro.cancel')}</Button>
          <Button type="submit" disabled={busy} data-testid="live-save">{t('pro.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
