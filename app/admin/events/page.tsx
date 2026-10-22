'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, type AdminEventDetail, type AdminEventRow, type Bilingual, type EventAuditRow } from '@/lib/api';
import { EVENTS_MODULE } from '@/lib/flags';
import { AUDIT_ACTIONS, AUDIT_ACTION_PREFIX, ORGANIZER_STATUS, REJECT_REASONS, auditActionLabel, distanceLabel, errorCode, errorKey, eventDateTime, eventStatusOf, isFeatureOff, rejectReasonKey, relativeTime, typeKey } from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, PageHeader, Segmented, Select, SkeletonTable, Textarea, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { EventReviewSummary } from '@/components/event-review-summary';
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
function Detail({ id, onBack }: { id: string; onBack: () => void }) {
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
      <div className="grid gap-6 lg:grid-cols-3">
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
      </div>

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

function AdminEventsInner() {
  const { t } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useDocumentTitle(t('admin.events.title'));
  const event = params.get('event');
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'submitted';
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  if (!EVENTS_MODULE) return <EventsUnavailable />;
  if (event) return <Detail id={event} onBack={() => go({ event: null })} />;
  return <Queue tab={tab} onTab={v => go({ tab: v === 'submitted' ? null : v })} onOpen={id => go({ event: id })} />;
}

export default function AdminEventsPage() {
  return <Suspense fallback={null}><AdminEventsInner /></Suspense>;
}
