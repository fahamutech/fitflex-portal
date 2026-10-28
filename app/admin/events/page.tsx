'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, type AdminEventDetail, type AdminEventOrderDetail, type AdminEventRow, type Bilingual, type EventAuditRow, type EventOrderRow } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { EVENTS_MODULE } from '@/lib/flags';
import { AUDIT_ACTIONS, AUDIT_ACTION_PREFIX, ORGANIZER_STATUS, REJECT_REASONS, auditActionLabel, distanceLabel, errorCode, errorKey, eventDateTime, eventStatusOf, closeReasonKey, isFeatureOff, maskContact, orderStatusOf, registrationStatusOf, rejectReasonKey, relativeTime, typeKey } from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, PageHeader, Segmented, Select, SkeletonTable, Textarea, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { EventReviewSummary } from '@/components/event-review-summary';
import { EventRegistrationsTable } from '@/components/event-registrations-table';
import { EventOrdersTable } from '@/components/event-orders-table';
import { hasRegistrationData } from '@/components/organizer/event-views';
import { useEventsOptions } from '@/components/events-options';
import { LifecycleButtons, LifecycleDialogs, type LifecycleAction } from '@/components/event-lifecycle';
import { EventsUnavailable, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { useApp } from '../../providers';

const TABS = ['submitted', 'published', 'cancelled', 'all', 'audit'] as const;
type Tab = (typeof TABS)[number];

function OrganizerBadge({ status }: { status: string }) {
  const { t } = useApp();
  const s = ORGANIZER_STATUS[status as keyof typeof ORGANIZER_STATUS] ?? ORGANIZER_STATUS.draft;
  return <Badge tone={s.tone}>{t(s.key)}</Badge>;
}

/** The queue (spec §8.1): Submitted (count) · Published · Cancelled · All, plus the audit tab. */
function Queue({ tab, onTab, onOpen }: { tab: Tab; onTab: (t: Tab) => void; onOpen: (id: string) => void }) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<AdminEventRow[] | null>(null);
  const [counts, setCounts] = useState<{ submitted: number } | null>(null);
  const [state, setState] = useState<'ok' | 'error' | 'off'>('ok');
  const load = useCallback(async () => {
    if (!token || tab === 'audit') return;
    setRows(null); setState('ok');
    try {
      const out: AdminEventRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await api.adminEvents(token, { ...(tab === 'all' ? {} : { status: tab }), cursor, limit: 50 });
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch (err) { setState(isFeatureOff(err) ? 'off' : 'error'); }
  }, [token, tab]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (token) api.adminEventsSummary(token).then(setCounts).catch(() => setCounts(null)); }, [token, rows]);

  if (state === 'off') return <EventsUnavailable />;
  const columns: ColumnDef<AdminEventRow>[] = [
    { key: 'title', header: t('events.list.col.title'), sortable: true, cell: r => <div className="min-w-[200px]"><p className="line-clamp-2 font-medium text-[var(--color-fg-primary)]">{r.title}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{r.organizer?.name}</p></div> },
    { key: 'organizerStatus', header: t('admin.events.col.organizerStatus'), cell: r => <OrganizerBadge status={r.organizer?.status} /> },
    { key: 'startsAt', header: t('events.list.col.starts'), sortable: true, cell: r => eventDateTime(r.startsAt, r.timezone, locale, r.timezoneAbbr) },
    { key: 'categoriesCount', header: t('events.list.col.categories'), cell: r => `${r.categoriesCount ?? 0} · ${(r.distancesM ?? []).map(distanceLabel).join(' ')}` },
    { key: 'submittedAt', header: t('admin.events.col.submittedAt'), sortable: true, cell: r => <span title={r.submittedAt ?? ''}>{relativeTime(r.submittedAt, locale)}</span> },
    { key: 'permitOnFile', header: t('admin.events.col.permit'), cell: r => <Badge tone={r.permitOnFile ? 'success' : 'warning'}>{t(r.permitOnFile ? 'admin.events.permit.onFile' : 'admin.events.permit.missing')}</Badge> },
    { key: 'status', header: t('events.list.col.status'), sortable: true, cell: r => { const s = eventStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
  ];
  const segLabel = (k: Tab) => (k === 'submitted' && counts ? `${t('admin.events.tab.submitted')} (${counts.submitted})` : t(`admin.events.tab.${k}` as 'admin.events.tab.all'));
  return (
    <div className="space-y-4" data-testid="admin-events-queue">
      <PageHeader title={t('admin.events.title')} />
      <Segmented className="w-fit flex-wrap" value={tab} onChange={v => onTab(v as Tab)} options={TABS.map(k => [k, segLabel(k)] as [string, string])} />
      {tab === 'audit' ? <AuditTable /> : state === 'error' ? <PageError onRetry={() => void load()} /> : !rows ? <div aria-busy="true"><SkeletonTable /></div> : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('admin.events.tableLabel')} dense onRowClick={r => onOpen(r.id)}
            defaultSort={{ key: tab === 'submitted' ? 'submittedAt' : 'startsAt', dir: 'desc' }}
            emptyState={t(tab === 'submitted' ? 'admin.events.empty.submitted' : 'admin.events.empty.other')}
            actions={r => <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onOpen(r.id); }} data-testid={`admin-event-open-${r.id}`}>{t('events.list.open')}</Button>} />
        </CardContent></Card>
      )}
    </div>
  );
}

function AuditTable({ eventId }: { eventId?: string }) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<EventAuditRow[] | null>(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try {
      const page = eventId ? await api.adminEventAudit(token, eventId) : await api.adminEventsAudit(token, { action: action || undefined });
      setRows(page.items ?? []);
    } catch { setError(true); }
  }, [token, eventId, action]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <PageError onRetry={() => void load()} />;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;
  const columns: ColumnDef<EventAuditRow>[] = [
    { key: 'at', header: t('admin.events.audit.when'), sortable: true, cell: r => eventDateTime(r.at, 'Africa/Dar_es_Salaam', locale) },
    { key: 'actor', header: t('admin.events.audit.actor'), cell: r => r.actor?.name ?? r.actor?.id ?? '—' },
    { key: 'action', header: t('admin.events.audit.action'), sortable: true, cell: r => <Badge tone="gray">{auditActionLabel(r.action, t)}</Badge> },
    { key: 'reason', header: t('admin.events.audit.reason'), cell: r => [r.reason ? t(rejectReasonKey(r.reason)) : null, r.note].filter(Boolean).join(' · ') || '—' },
  ];
  return (
    <div data-testid={eventId ? 'admin-event-audit' : 'admin-events-audit'}>
      <DataTable columns={columns} data={rows} keyFn={(r, i) => r.id ?? String(i)} label={t('admin.events.audit')} dense defaultSort={{ key: 'at', dir: 'desc' }} emptyState={t('admin.events.audit.empty')}
        extraFilters={!eventId ? (
          <Select size="sm" aria-label={t('admin.events.audit.filterAction')} value={action} onChange={e => setAction(e.target.value)}>
            <option value="">{t('admin.events.audit.allActions')}</option>
            {AUDIT_ACTIONS.map(a => <option key={a} value={`${AUDIT_ACTION_PREFIX}${a}`}>{auditActionLabel(a, t)}</option>)}
          </Select>
        ) : undefined} />
    </div>
  );
}

/** One event (spec §8.1): read-only review, decision card, organizer card, audit card. */
const DETAIL_VIEWS = ['review', 'orders', 'registrations'] as const;
type DetailView = (typeof DETAIL_VIEWS)[number];

function Detail({ id, view, onView, onBack }: { id: string; view: DetailView; onView: (v: DetailView) => void; onBack: () => void }) {
  const { t, token, locale, hasPermission } = useApp();
  const toast = useToast();
  const [doc, setDoc] = useState<AdminEventDetail | null>(null);
  const [state, setState] = useState<'ok' | 'error' | 'off'>('ok');
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);
  const [auditKey, setAuditKey] = useState(0);
  const [order, setOrder] = useState<EventOrderRow | null>(null);
  const [ordersKey, setOrdersKey] = useState(0);
  // S3 §6.5: the orders and registrations tabs exist only while the server says registration is on.
  const registrationOn = !!useEventsOptions()?.registration;
  useDocumentTitle(doc?.title ? `${doc.title} · ${t('admin.events.title')}` : t('admin.events.title'));
  const load = useCallback(async () => {
    if (!token) return;
    setState('ok');
    try { setDoc(await api.adminEvent(token, id)); setAuditKey(k => k + 1); } catch (err) { setState(isFeatureOff(err) ? 'off' : 'error'); }
  }, [token, id]);
  useEffect(() => { void load(); }, [load]);

  async function decide(decision: 'approve' | 'reject') {
    if (!token) return;
    if (decision === 'reject' && (!reason || !note.trim())) return;
    setBusy(true);
    try {
      await api.adminEventDecision(token, id, decision === 'approve' ? { decision, ...(note.trim() ? { note: note.trim() } : {}) } : { decision, reason, note: note.trim() });
      toast.success(t(decision === 'approve' ? 'admin.events.published.toast' : 'admin.events.rejected.toast'));
      setDialog(null); setNote(''); setReason('');
      await load();
    } catch (err) {
      if (errorCode(err) === 'invalid_transition') { toast.error(t('admin.events.error.invalidTransition')); setDialog(null); await load(); }
      else toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  async function run(action: LifecycleAction, body?: { reason?: string; note?: Bilingual }) {
    if (!token || (action !== 'cancel' && action !== 'archive' && action !== 'complete')) return;
    try { await api.adminEventAction(token, id, action, body); toast.success(t('events.action.done')); await load(); }
    catch (err) { if (errorCode(err) === 'invalid_transition') { toast.error(t('admin.events.error.invalidTransition')); await load(); } throw err; }
  }

  if (state === 'off') return <EventsUnavailable />;
  if (state === 'error') return <PageError onRetry={() => void load()} />;
  if (!doc) return <PageLoading />;
  const st = eventStatusOf(doc.status);
  const canKyc = hasPermission('kyc');
  const laterActions = (['cancel', 'complete', 'archive'] as LifecycleAction[]).filter(a => doc.allowedActions?.includes(a));
  return (
    <div className="space-y-4" data-testid="admin-event-detail">
      <PageHeader title={doc.title} description={<span className="inline-flex items-center gap-2"><Badge tone={st.tone}>{t(st.key)}</Badge><span>{doc.organizer?.name}</span></span>}
        actions={<Button variant="ghost" onClick={onBack}>{t('admin.events.backToQueue')}</Button>} />
      {!doc.permitOnFile && <div data-testid="admin-permit-missing"><Alert tone="warning">{t('events.review.permitMissing')}</Alert></div>}
      {/* S3 §6.5: orders and registrations of the event, full names (scope events). */}
      {registrationOn && <Segmented className="w-fit" value={view} onChange={v => onView(v as DetailView)} options={DETAIL_VIEWS.map(v => [v, t(v === 'review' ? 'admin.events.view.review' : v === 'orders' ? 'admin.events.view.orders' : 'admin.events.view.registrations')] as [string, string])} />}
      {view === 'orders' && !registrationOn && <EventsUnavailable />}
      {view === 'registrations' && !registrationOn && <EventsUnavailable />}
      {view === 'orders' && registrationOn && (
        <>
          <EventOrdersTable eventId={id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="admin" published={hasRegistrationData(doc)} onOpen={setOrder} reloadKey={ordersKey} />
          <AdminOrderDialog eventId={id} row={order} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} onClose={() => setOrder(null)} onChanged={() => { setOrdersKey(k => k + 1); setAuditKey(k => k + 1); }} />
        </>
      )}
      {view === 'registrations' && registrationOn && <EventRegistrationsTable eventId={id} timezone={doc.timezone} timezoneAbbr={doc.timezoneAbbr} fieldPolicy="admin" published={hasRegistrationData(doc)} />}
      {view === 'review' && <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Checkbox label={t('admin.events.previewAsMember')} checked={preview} onChange={e => setPreview(e.target.checked)} data-testid="admin-preview-member" />
          <EventReviewSummary doc={doc} lang={preview ? locale : 'en'} />
        </div>
        <div className="space-y-4">
          <Card data-testid="admin-decision-card">
            <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('admin.events.decision')}</h2></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {doc.status === 'submitted' ? (
                <>
                  <Button onClick={() => setDialog('approve')} data-testid="admin-approve">{t('admin.events.approve')}</Button>
                  <Button variant="destructive" onClick={() => setDialog('reject')} data-testid="admin-reject">{t('admin.events.reject')}</Button>
                </>
              ) : laterActions.length ? <LifecycleButtons actions={laterActions} onPick={setLifecycle} size="md" testPrefix="admin-action" />
                : <p className="text-sm text-[var(--color-fg-quaternary)]">{t('admin.events.noDecision')}</p>}
            </CardContent>
          </Card>
          <Card data-testid="admin-organizer-card">
            <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('admin.events.organizerCard')}</h2></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="font-medium text-[var(--color-fg-primary)]">{doc.organizer?.name}</p>
              <OrganizerBadge status={doc.organizer?.status} />
              <div>
                {doc.organizer?.kycCaseId ? (
                  canKyc
                    ? <Link href={`/admin/kyc?case=${encodeURIComponent(doc.organizer.kycCaseId)}`} className="inline-flex" data-testid="admin-open-kyc"><Button variant="secondary" size="sm">{t('admin.events.openKyc')}</Button></Link>
                    : <span title={t('admin.events.openKycNoScope')}><Button variant="secondary" size="sm" disabled data-testid="admin-open-kyc" aria-describedby="kyc-no-scope">{t('admin.events.openKyc')}</Button><span id="kyc-no-scope" className="mt-1 block text-xs text-[var(--color-fg-quaternary)]">{t('admin.events.openKycNoScope')}</span></span>
                ) : <p className="text-xs text-[var(--color-fg-quaternary)]">{t('admin.events.noKycCase')}</p>}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="admin-audit-card">
            <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('admin.events.audit')}</h2></CardHeader>
            <CardContent><AuditTable key={auditKey} eventId={id} /></CardContent>
          </Card>
        </div>
      </div>}

      <Dialog open={dialog === 'approve'} onClose={() => setDialog(null)} title={t('admin.events.approveTitle')} description={t('admin.events.approveBody')} size="md">
        <Field label={t('admin.events.approveNote')}><Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="admin-approve-note" /></Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button loading={busy} onClick={() => void decide('approve')} data-testid="admin-approve-confirm">{t('admin.events.approve')}</Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={dialog === 'reject'} onClose={() => setDialog(null)} title={t('admin.events.rejectTitle')} size="md">
        <div className="space-y-4">
          <Field label={t('admin.events.rejectReason')} required>
            <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="admin-reject-reason">
              <option value="">—</option>
              {REJECT_REASONS.map(r => <option key={r} value={r}>{t(rejectReasonKey(r))}</option>)}
            </Select>
          </Field>
          <Field label={t('admin.events.rejectNote')} required><Textarea rows={4} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="admin-reject-note" /></Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={busy} disabled={!reason || !note.trim()} onClick={() => void decide('reject')} data-testid="admin-reject-confirm">{t('admin.events.reject')}</Button>
        </DialogFooter>
      </Dialog>
      <LifecycleDialogs action={lifecycle} onClose={() => setLifecycle(null)} run={run} />
    </div>
  );
}

/** §6.5: one order with lines, participants (name, masked contact), consent timestamps, hold info, and admin cancel with a note (≥ 5 chars). */
function AdminOrderDialog({ eventId, row, timezone, timezoneAbbr, onClose, onChanged }: { eventId: string; row: EventOrderRow | null; timezone: string; timezoneAbbr?: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [doc, setDoc] = useState<AdminEventOrderDetail | null>(null);
  const [error, setError] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const orderId = row?.id ?? null;
  const load = useCallback(async () => {
    if (!token || !orderId) { setDoc(null); return; }
    setError(false);
    try { setDoc(await api.adminEventOrder(token, eventId, orderId)); } catch { setError(true); }
  }, [token, eventId, orderId]);
  useEffect(() => { setNote(''); void load(); }, [load]);
  async function cancel() {
    if (!token || !orderId || note.trim().length < 5) return;
    setBusy(true);
    try {
      await api.adminCancelEventOrder(token, eventId, orderId, note.trim());
      toast.success(t('admin.events.audit.order_cancelled'));
      onChanged(); onClose();
    } catch (err) {
      if (errorCode(err) === 'invalid_transition' || errorCode(err) === 'already_closed') { toast.error(t('events.error.invalid_transition_order')); onChanged(); }
      else toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  const o = doc?.order;
  const status = o?.status ?? row?.status;
  const st = orderStatusOf(status);
  const unpaid = status === 'awaiting_payment';
  const purchaser = doc?.purchaser ?? row?.purchaser;
  const createdBy = doc?.createdBy?.name ?? o?.createdBy?.name ?? null;
  // The admin order detail returns no contact fields (#265): the column only shows when some row has one.
  const hasContact = (doc?.registrations ?? []).some(r => !!r.phone || !!r.email);
  return (
    <Dialog open={!!row} onClose={onClose} title={row ? `${row.reference} · ${row.purchaser?.label ?? ''}` : ''} size="lg">
      <div className="space-y-4 text-sm" data-testid="admin-order-dialog">
        {error ? <PageError onRetry={() => void load()} /> : !doc || !o ? <div aria-busy="true"><SkeletonTable rows={3} /></div> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={st.tone}>{t(st.key)}</Badge>
              {purchaser?.type === 'organization' && <Badge tone="brand">{t('organizer.orders.organisation')}</Badge>}
              <span>{money(o.totalTzs, o.currency)}</span>
              {o.feesTzs > 0 && <span className="text-[var(--color-fg-quaternary)]">{t('organizer.orders.col.fees')}: {money(o.feesTzs, o.currency)}</span>}
            </div>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-testid="admin-order-meta">
              <dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.col.created')}</dt><dd>{eventDateTime(o.createdAt, timezone, locale, timezoneAbbr)}{createdBy ? ` · ${createdBy}` : ''}</dd>
              <dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.col.heldUntil')}</dt><dd>{unpaid ? eventDateTime(o.holdExpiresAt, timezone, locale, timezoneAbbr) : '—'}{o.holdCycle != null ? ` · ${t('admin.events.order.holdCycle')} ${o.holdCycle}` : ''}</dd>
              <dt className="text-[var(--color-fg-quaternary)]">{t('organizer.orders.col.closed')}</dt><dd>{o.closedAt ? `${eventDateTime(o.closedAt, timezone, locale, timezoneAbbr)}${o.closeReason ? ` · ${t(closeReasonKey(o.closeReason))}` : ''}` : '—'}</dd>
              <dt className="text-[var(--color-fg-quaternary)]">{t('admin.events.order.terms')}</dt><dd>{o.termsAcceptedAt ? `${eventDateTime(o.termsAcceptedAt, timezone, locale, timezoneAbbr)}${o.consentTextVersion ? ` · ${o.consentTextVersion}` : ''}` : '—'}</dd>
              {(o.costCentre || o.purchaserReference) && <><dt className="text-[var(--color-fg-quaternary)]">{t('corp.events.costCentre')} / {t('corp.events.reference')}</dt><dd>{[o.costCentre, o.purchaserReference].filter(Boolean).join(' · ')}</dd></>}
            </dl>
            <table className="ui-table ui-table-dense w-full" data-testid="admin-order-lines">
              <thead><tr><th scope="col">{t('organizer.reg.col.ticket')}</th><th scope="col" className="text-right">{t('corp.events.col.places')}</th><th scope="col" className="text-right">{t('corp.events.col.total')}</th></tr></thead>
              <tbody>{(doc.lines ?? []).map(l => <tr key={l.ticketTypeId}><td>{l.ticketTypeName} · {l.categoryName}</td><td className="text-right">{l.quantity}</td><td className="text-right">{money(l.lineTotalTzs, o.currency)}</td></tr>)}</tbody>
            </table>
            <table className="ui-table ui-table-dense w-full" data-testid="admin-order-participants">
              <thead><tr><th scope="col">{t('corp.events.col.name')}</th>{hasContact && <th scope="col">{t('corp.events.col.phone')} / {t('corp.events.col.email')}</th>}<th scope="col">{t('corp.events.col.category')}</th><th scope="col">{t('corp.events.col.status')}</th><th scope="col">{t('organizer.reg.col.claimed')}</th></tr></thead>
              <tbody>
                {(doc.registrations ?? []).map(r => { const rs = registrationStatusOf(r.status); return (
                  <tr key={r.id}><td>{r.firstName} {r.lastName}</td>{hasContact && <td>{[r.phone ? maskContact(r.phone) : null, r.email ? maskContact(r.email) : null].filter(Boolean).join(' · ') || '—'}</td>}<td>{r.categoryName ?? doc.lines?.find(l => l.ticketTypeId === r.ticketTypeId)?.categoryName ?? '—'}</td><td><Badge tone={rs.tone}>{t(rs.key)}</Badge></td><td>{t(r.claimState === 'claimed' || r.claimState === 'self' ? 'common.yes' : 'common.no')}</td></tr>
                ); })}
              </tbody>
            </table>
            {unpaid && (
              <Field label={t('admin.events.order.cancel.note')} required>
                <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500} data-testid="admin-order-cancel-note" />
              </Field>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('events.common.close')}</Button>
        {unpaid && doc && <Button variant="destructive" loading={busy} disabled={note.trim().length < 5} onClick={() => void cancel()} data-testid="admin-order-cancel">{t('admin.events.order.cancel')}</Button>}
      </DialogFooter>
    </Dialog>
  );
}

function AdminEventsInner() {
  const { t } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useDocumentTitle(t('admin.events.title'));
  const event = params.get('event');
  const viewParam = params.get('view');
  const view: DetailView = (DETAIL_VIEWS as readonly string[]).includes(viewParam ?? '') ? (viewParam as DetailView) : 'review';
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'submitted';
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  if (!EVENTS_MODULE) return <EventsUnavailable />;
  if (event) return <Detail id={event} view={view} onView={v => go({ view: v === 'review' ? null : v })} onBack={() => go({ event: null, view: null })} />;
  return <Queue tab={tab} onTab={v => go({ tab: v === 'submitted' ? null : v })} onOpen={id => go({ event: id })} />;
}

export default function AdminEventsPage() {
  return <Suspense fallback={null}><AdminEventsInner /></Suspense>;
}
