'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Flag, Lock, Plus } from 'lucide-react';
import {
  ApiError, api, type CorporateEventOrderDetail, type CorporateEventOrderRow, type EventRosterRow, type EventRosterValidation, type EventSummary, type ParticipantFields,
  type PublicEventDetail,
} from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { EVENTS_MODULE } from '@/lib/flags';
import {
  DEFAULT_PARTICIPANT_FIELDS, MEMBER_CANCEL_REASONS, canPlaceCorporateOrder, canValidateRoster, errorBody, errorCode, errorKey, eventDateTime, eventDay, fmt,
  holdMinutesLeft, startsWithFormulaChar, maskEmail, maskPhoneLast3, memberCancelReasonKey, newCorporateIdempotencyKey, orderStatusOf, participantCodeKey, placesLeft,
  registrationStatusOf, rosterFieldKey, trackEventsS3Analytics,
} from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, EmptyState, Field, Input, MetricCard, PageHeader, Select, SkeletonTable, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { SearchableSelect } from '@/components/searchable-select';
import { Stepper } from '@/components/stepper';
import { OrgFrame, useMyOrganization, type Mine } from '@/components/b2b-org';
import { EventRosterImport } from '@/components/event-roster-import';
import { corporateEventsOpen, useEventsOptions } from '@/components/events-options';
import { EventsUnavailable, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { useApp } from '../../app/providers';

const STEPS = ['event', 'people', 'check', 'confirm'] as const;
type Step = (typeof STEPS)[number];

/** Re-renders every `ms` so countdowns stay honest (§6.2 "refreshed each minute"). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(h); }, [ms]);
  return now;
}

/** `/org/events` and `/hr/events` (S3 §6.1): the organisation frame, then the same component for both areas. */
export function OrgEventsPage() {
  const { t } = useApp();
  const state = useMyOrganization();
  useDocumentTitle(t('corp.events.title'));
  if (!EVENTS_MODULE) return <EventsUnavailable />;
  return (
    <OrgFrame bare title={t('corp.events.title')} description="" state={state}>
      {(mine, token) => <Suspense fallback={null}><CorporateEventOrders mine={mine} token={token} /></Suspense>}
    </OrgFrame>
  );
}

/** Gates (§6.1, §7.1, D18) then list / wizard / order detail by `?new=1` and `?order=<id>`. */
export function CorporateEventOrders({ mine, token }: { mine: Mine; token: string }) {
  const { t } = useApp();
  const options = useEventsOptions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = useCallback((patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  if (options === undefined) return <PageLoading table />;
  if (!corporateEventsOpen(options)) return <EventsUnavailable />;
  if (!canValidateRoster(mine.permissions)) {
    return <div data-testid="corp-events-forbidden"><EmptyState icon={<Lock />} title={t('organizer.forbidden.title')} body={t('corp.events.noPermission')} /></div>;
  }
  const orgId = mine.organization.id;
  const orgName = mine.organization.tradingName || mine.organization.legalName;
  const active = mine.organization.status === 'active';
  const canPlace = canPlaceCorporateOrder(mine.role);
  const order = params.get('order');
  if (order) return <CorporateOrderDetail token={token} orgId={orgId} orderId={order} onBack={() => go({ order: null })} />;
  if (params.get('new')) {
    return <CorporateWizard token={token} orgId={orgId} orgName={orgName} canPlace={canPlace} holdTtlMinutes={options?.holdTtlMinutes ?? 30} consentVersion={options?.consentTextVersion ?? ''}
      onCancel={() => go({ new: null })} onPlaced={id => go({ new: null, order: id })} />;
  }
  return <CorporateOrdersList token={token} orgId={orgId} active={active} onNew={() => go({ new: '1' })} onOpen={id => go({ order: id })} />;
}

// ── List (§6.2 "List view") ──
function CorporateOrdersList({ token, orgId, active, onNew, onOpen }: { token: string; orgId: string; active: boolean; onNew: () => void; onOpen: (id: string) => void }) {
  const { t, locale } = useApp();
  const [rows, setRows] = useState<CorporateEventOrderRow[] | null>(null);
  const [error, setError] = useState(false);
  const now = useNow(60_000);
  const load = useCallback(async () => {
    setError(false);
    try {
      const out: CorporateEventOrderRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await api.corporateEventOrders(token, orgId, { cursor, limit: 50 });
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch { setError(true); }
  }, [token, orgId]);
  useEffect(() => { void load(); }, [load]);

  const newButton = <Button onClick={onNew} disabled={!active} data-testid="corp-events-new"><Plus aria-hidden="true" className="h-4 w-4" />{t('corp.events.register')}</Button>;
  const columns: ColumnDef<CorporateEventOrderRow>[] = [
    { key: 'reference', header: t('corp.events.col.reference'), sortable: true, cell: r => <span className="font-mono text-xs">{r.reference}</span> },
    { key: 'event', header: t('corp.events.col.event'), cell: r => <div className="min-w-[180px]"><p className="font-medium text-[var(--color-fg-primary)]">{r.event?.title}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{eventDateTime(r.event?.startsAt, r.event?.timezone, locale, r.event?.timezoneAbbr)}</p></div> },
    { key: 'placesCount', header: t('corp.events.col.places'), sortable: true, align: 'right', cell: r => r.placesCount },
    { key: 'totalTzs', header: t('corp.events.col.total'), sortable: true, align: 'right', cell: r => money(r.totalTzs, r.currency) },
    { key: 'status', header: t('corp.events.col.status'), sortable: true, cell: r => { const s = orderStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'holdExpiresAt', header: t('corp.events.col.heldUntil'), cell: r => { const m = r.status === 'awaiting_payment' ? holdMinutesLeft(r.holdExpiresAt, now) : null; return m == null ? '' : fmt(t('corp.events.minutesLeft'), { n: m }); } },
    { key: 'createdBy', header: t('corp.events.col.createdBy'), cell: r => r.createdBy?.name ?? '—' },
    { key: 'createdAt', header: t('corp.events.col.created'), sortable: true, cell: r => eventDateTime(r.createdAt, r.event?.timezone, locale, r.event?.timezoneAbbr) },
  ];
  return (
    <div className="space-y-4" data-testid="corp-events-list">
      <PageHeader title={t('corp.events.title')} actions={newButton} />
      {!active && <div data-testid="corp-org-inactive"><Alert tone="warning">{t('events.error.organization_not_active')}</Alert></div>}
      {error ? <PageError onRetry={() => void load()} /> : !rows ? <div aria-busy="true"><SkeletonTable /></div> : rows.length === 0 ? (
        <EmptyState icon={<Flag />} title={t('corp.events.empty.title')} body={t('corp.events.empty.body')} action={active ? <Button onClick={onNew}>{t('corp.events.register')}</Button> : undefined} />
      ) : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('corp.events.title')} dense defaultSort={{ key: 'createdAt', dir: 'desc' }} onRowClick={r => onOpen(r.id)}
            emptyState={t('corp.events.empty.title')} actions={r => <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onOpen(r.id); }} data-testid={`corp-order-open-${r.id}`}>{t('events.list.open')}</Button>} />
        </CardContent></Card>
      )}
    </div>
  );
}

// ── Wizard (§6.2 steps 1–4) ──
type RowView = { row: EventRosterRow; kind: 'ok' | 'fix' | 'duplicate'; problems: string[]; warnings: string[] };

function CorporateWizard({ token, orgId, orgName, canPlace, holdTtlMinutes, consentVersion, onCancel, onPlaced }: {
  token: string; orgId: string; orgName: string; canPlace: boolean; holdTtlMinutes: number; consentVersion: string; onCancel: () => void; onPlaced: (orderId: string) => void;
}) {
  const { t, locale } = useApp();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [event, setEvent] = useState<PublicEventDetail | null>(null);
  const [eventError, setEventError] = useState(false);
  const [text, setText] = useState('');
  const [validation, setValidation] = useState<EventRosterValidation | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [costCentre, setCostCentre] = useState('');
  const [reference, setReference] = useState('');
  const [teamName, setTeamName] = useState(orgName);
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning' | 'info'; text: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const keyRef = useRef(newCorporateIdempotencyKey());
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api.publicEvents({ availability: 'open', limit: 50 }, token).then(p => setEvents(p.items ?? [])).catch(() => { setEvents([]); setEventError(true); });
  }, [token]);
  useEffect(() => {
    if (!eventId) { setEvent(null); return; }
    let live = true;
    api.publicEvent(eventId, token).then(d => { if (live) setEvent(d); }).catch(() => { if (live) setEvent(null); });
    trackEventsS3Analytics('registration_started', { eventId, source: 'corporate' });
    return () => { live = false; };
  }, [eventId, token]);

  const fields: ParticipantFields = useMemo(() => {
    if (validation?.fields) return validation.fields;
    const f = { ...DEFAULT_PARTICIPANT_FIELDS, ...(event?.participantFields ?? {}) };
    if ((event?.categories ?? []).some(c => c.minAge != null && c.minAge > 0)) f.dateOfBirth = 'required';
    if (event?.kitProvided && !event.participantFields?.kitSize) f.kitSize = 'optional';
    return f;
  }, [validation, event]);

  const textBad = startsWithFormulaChar(costCentre) || startsWithFormulaChar(reference) || startsWithFormulaChar(teamName);
  const clean = !!validation && !!validation.quote && validation.summary.ok > 0 && validation.summary.problems === 0 && validation.duplicates.length === 0 && validation.capacityShort.length === 0;
  const maxReached = !eventId ? 0 : !validation ? 1 : clean ? 3 : 2;
  const goTo = (i: number) => { setStep(Math.max(0, Math.min(STEPS.length - 1, i))); setTimeout(() => headingRef.current?.focus(), 50); };

  /** The message for a refusal: rate limit, `field_too_long` (row index from the server), else the §3.17 map. */
  const errorText = (err: unknown) => {
    const code = errorCode(err);
    if (code === 'rate_limited') return t('corp.events.rateLimited');
    if (code === 'field_too_long') {
      const b = errorBody<{ index?: number; field?: string; max?: number }>(err);
      const label = rosterFieldKey(b?.field);
      return fmt(t('events.error.field_too_long'), { row: (b?.index ?? 0) + 1, field: label ? t(label) : b?.field ?? '', max: b?.max ?? '' });
    }
    return t(errorKey(err));
  };

  const check = async () => {
    if (!eventId || !text.trim()) return;
    setChecking(true); setCheckError(null); setNotice(null);
    try {
      const v = await api.validateEventRoster(token, orgId, { eventId, rawText: text });
      setValidation(v);
      trackEventsS3Analytics('registration_roster_validated', { eventId, rows: v.summary.total, ok: v.summary.ok, problems: v.summary.problems, duplicates: v.summary.duplicates });
      if (v.quote) trackEventsS3Analytics('checkout_quote_created', { eventId, placesCount: v.summary.ok, totalTzs: v.quote.totalTzs, mode: 'corporate' });
      goTo(2);
    } catch (err) {
      setCheckError(errorText(err));
    } finally { setChecking(false); }
  };

  const catName = (id: string | null | undefined) => event?.categories.find(c => c.id === id)?.name ?? '—';
  const ticketName = (id: string | null | undefined) => event?.categories.flatMap(c => c.ticketTypes).find(tt => tt.id === id)?.name ?? '';
  const problemText = (p: { field: string; code: string; minAge?: number; ageOnEventDay?: number }) => {
    const label = rosterFieldKey(p.field);
    const msg = fmt(t(participantCodeKey(p.code)), { minAge: p.minAge ?? '', age: p.ageOnEventDay ?? '' });
    return label ? `${t(label)}: ${msg}` : msg;
  };
  const views: RowView[] = useMemo(() => {
    if (!validation) return [];
    return validation.rows.map(row => {
      const dup = validation.duplicates.find(d => d.index === row.index);
      const problems = row.problems.map(problemText);
      const warnings = (row.warnings ?? []).map(problemText);
      if (dup) {
        problems.push(dup.kind === 'already_registered'
          ? (dup.registrationStatus
            ? fmt(t('corp.events.alreadyRegistered'), { category: catName(row.categoryId), status: t(registrationStatusOf(dup.registrationStatus).key) })
            : fmt(t('corp.events.alreadyRegisteredNoStatus'), { category: catName(row.categoryId) }))
          : `${t('events.validation.listed_twice')}${dup.otherIndex != null ? ` (#${dup.otherIndex + 1})` : ''}`);
      }
      // The server decides (`ok`): problems on an ok row are warnings (e.g. a required field the event cannot collect).
      return { row, kind: dup ? 'duplicate' : !row.ok ? 'fix' : 'ok', problems, warnings };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation, event, locale]);

  const place = async (retried = false) => {
    if (!validation?.quote || !eventId || !canPlace) return;
    if (validation.rows.some(r => !(r.categoryId ?? r.participant.categoryId))) { setNotice({ tone: 'error', text: t('events.error.participant_invalid') }); goTo(2); return; }
    setPlacing(true); setNotice(null); setUncertain(false);
    const v = validation;
    const quoted = validation.quote;
    try {
      const out = await api.createCorporateEventOrder(token, orgId, {
        eventId,
        // The validate output's participant verbatim (whatever resolved ids it carries), plus the wizard's own category and
        // ticket references by id and by name: a row without a category reference is never sent (the backend resolves either).
        rows: v.rows.map(r => {
          const categoryId = r.categoryId ?? r.participant.categoryId ?? undefined;
          const ticketTypeId = r.ticketTypeId ?? r.participant.ticketTypeId ?? undefined;
          const { groupLabel, ...rest } = r.participant;
          return { ...rest, ...(groupLabel ? { groupLabel, group: groupLabel } : {}), categoryId, ticketTypeId, category: catName(categoryId) !== '—' ? catName(categoryId) : undefined, ticketType: ticketName(ticketTypeId) || undefined };
        }),
        ...(costCentre.trim() ? { costCentre: costCentre.trim() } : {}),
        ...(reference.trim() ? { purchaserReference: reference.trim() } : {}),
        ...(teamName.trim() ? { team: { create: { name: teamName.trim() } } } : {}),
        acceptedTerms: true, consentTextVersion: v.consentText?.version ?? consentVersion, expectedTotalTzs: quoted.totalTzs,
      }, keyRef.current);
      trackEventsS3Analytics('order_created', { orderId: out.order.id, eventId, placesCount: out.registrations?.length ?? v.summary.ok, totalTzs: out.order.totalTzs, mode: 'corporate', team: !!out.order.teamId });
      onPlaced(out.order.id);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'participant_invalid') {
        const body = errorBody<{ participants?: Array<{ index: number; problems: Array<{ field: string; code: string }> }> }>(err);
        const byIndex = new Map((body?.participants ?? []).map(p => [p.index, p.problems ?? []]));
        setValidation(cur => cur ? {
          ...cur,
          rows: cur.rows.map(r => (byIndex.has(r.index) ? { ...r, ok: false, problems: byIndex.get(r.index)! } : r)),
          summary: { ...cur.summary, problems: byIndex.size, ok: Math.max(0, cur.summary.total - byIndex.size) },
        } : cur);
        setNotice({ tone: 'error', text: t('events.error.participant_invalid') }); goTo(2);
      } else if (code === 'capacity_unavailable') {
        const body = errorBody<{ ticketTypeId?: string; requested?: number; remaining?: number }>(err);
        setValidation(cur => cur ? { ...cur, capacityShort: body?.ticketTypeId ? [{ ticketTypeId: body.ticketTypeId, requested: body.requested ?? 0, remaining: body.remaining ?? 0 }] : cur.capacityShort } : cur);
        setNotice({ tone: 'error', text: t('events.error.capacity_unavailable') }); goTo(2);
      } else if (code === 'price_changed' || code === 'consent_version_stale') {
        try { setValidation(await api.validateEventRoster(token, orgId, { eventId, rawText: text })); } catch { /* keep the old quote; the notice says to review */ }
        setNotice({ tone: 'warning', text: t(code === 'price_changed' ? 'events.error.price_changed' : 'events.error.consent_version_stale') });
      } else if (code === 'idempotency_key_reused' && !retried) {
        keyRef.current = newCorporateIdempotencyKey();
        setPlacing(false);
        return place(true);
      } else if (!(err instanceof ApiError) || err.status >= 500) {
        setUncertain(true);
      } else {
        setNotice({ tone: 'error', text: errorText(err) });
        toast.error(errorText(err));
      }
    } finally { setPlacing(false); }
  };

  const current = STEPS[step];
  const quote = validation?.quote ?? null;
  const consentText = validation?.consentText;
  const consentLabel = consentText?.organisation?.[locale] ?? (locale === 'sw' ? consentText?.sw : consentText?.en) ?? consentText?.en ?? '';
  const left = validation ? placesLeft(validation.lines, validation.availability) : null;
  const short = validation?.capacityShort ?? [];
  const shownViews = problemsOnly ? views.filter(v => v.kind !== 'ok') : views;
  const rowColumns: ColumnDef<RowView>[] = [
    { key: 'n', header: '#', cell: v => v.row.index + 1 },
    { key: 'name', header: t('corp.events.col.name'), cell: v => `${v.row.participant.firstName ?? ''} ${v.row.participant.lastName ?? ''}`.trim() || '—' },
    { key: 'phone', header: t('corp.events.col.phone'), cell: v => v.row.participant.phone ?? '—' },
    { key: 'email', header: t('corp.events.col.email'), cell: v => v.row.participant.email ?? '—' },
    { key: 'category', header: t('corp.events.col.category'), cell: v => { const tn = ticketName(v.row.ticketTypeId); return `${catName(v.row.categoryId)}${tn ? ` → ${tn}` : ''}`; } },
    { key: 'dob', header: t('corp.events.col.dob'), cell: v => v.row.participant.dateOfBirth ?? '—' },
    { key: 'kit', header: t('corp.events.col.kit'), cell: v => (v.row.participant.kitSize ? String(v.row.participant.kitSize).toUpperCase() : '—') },
    { key: 'group', header: t('corp.events.col.group'), cell: v => v.row.participant.groupLabel ?? '—' },
    { key: 'status', header: t('corp.events.col.status'), cell: v => <Badge tone={v.kind === 'ok' ? 'success' : v.kind === 'fix' ? 'danger' : 'warning'}>{t(v.kind === 'ok' ? 'corp.events.row.ok' : v.kind === 'fix' ? 'corp.events.row.fix' : 'corp.events.row.duplicate')}</Badge> },
    { key: 'problem', header: t('corp.events.col.problem'), cell: v => (v.problems.length || v.warnings.length ? (
      <ul className="list-disc pl-4">
        {v.problems.map((p, i) => <li key={`p${i}`}>{p}</li>)}
        {v.warnings.map((w, i) => <li key={`w${i}`} className="text-[var(--color-fg-quaternary)]" data-testid="corp-row-warning">{t('corp.events.warning')}: {w}</li>)}
      </ul>
    ) : '—') },
  ];

  return (
    <div className="space-y-4" data-testid="corp-wizard">
      <PageHeader title={t('corp.events.register')} actions={<Button variant="ghost" size="sm" onClick={onCancel}>{t('events.wizard.back')}</Button>} />
      <Stepper steps={STEPS.map(s => ({ key: s, label: t(`corp.events.step.${s}` as 'corp.events.step.event') }))} current={step} maxReached={maxReached} onStep={goTo} />
      {notice && <div data-testid="corp-notice"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {uncertain && (
        <div data-testid="corp-uncertain"><Alert tone="error"><span className="flex flex-wrap items-center gap-2">{t('corp.events.uncertain')}<Button variant="link" size="sm" onClick={onCancel}>{t('corp.events.title')}</Button></span></Alert></div>
      )}
      <Card><CardContent className="space-y-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none" data-testid="corp-step-heading">{t(`corp.events.step.${current}` as 'corp.events.step.event')}</h2>

        {current === 'event' && (
          <div className="space-y-4" data-testid="corp-step-event">
            {eventError && <Alert tone="error">{t('common.errorBody')}</Alert>}
            <Field label={t('corp.events.pickEvent')} required>
              <div>
                <SearchableSelect ariaLabel={t('corp.events.pickEvent')} placeholder={t('corp.events.pickEvent')} value={eventId} disabled={events === null}
                  options={(events ?? []).map(e => ({ value: e.id, label: e.title, sub: `${eventDay(e.startsAt, e.timezone, locale)}${e.venue?.city ? ` · ${e.venue.city}` : ''}` }))}
                  onChange={v => { const id = Array.isArray(v) ? v[0] ?? '' : v; setEventId(id); setValidation(null); }} />
              </div>
            </Field>
            {events && events.length === 0 && <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="corp-no-events">{t('corp.events.noOpenEvents')}</p>}
            {event && (
              <div className="space-y-2 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] p-4 text-sm" data-testid="corp-event-card">
                <p className="text-base font-semibold text-[var(--color-fg-primary)]">{event.title}</p>
                <p>{eventDateTime(event.startsAt, event.timezone, locale, event.timezoneAbbr)}{event.venue?.name ? ` · ${event.venue.name}` : ''}{event.venue?.city ? `, ${event.venue.city}` : ''}</p>
                <ul className="space-y-1">
                  {event.categories.map(c => {
                    const prices = c.ticketTypes.map(tt => tt.priceTzs);
                    const range = prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0], 'TZS') : `${money(Math.min(...prices), 'TZS')} – ${money(Math.max(...prices), 'TZS')}`) : '—';
                    return <li key={c.id ?? c.name} className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.name}</span><span>{range}</span>{c.availability && <Badge tone={c.availability === 'open' ? 'success' : c.availability === 'closing_soon' ? 'warning' : 'gray'}>{t(`events.availability.${c.availability}` as 'events.availability.open')}</Badge>}{c.minAge != null && c.minAge > 0 && <span className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('corp.events.minAge'), { n: c.minAge })}</span>}</li>;
                  })}
                </ul>
                {event.refundPolicy?.preset && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.terms.policy')}: {t(`events.terms.policy.${event.refundPolicy.preset}` as 'events.terms.policy.custom')}</p>}
                {event.shareUrl && <a href={event.shareUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--color-brand-700)] underline" data-testid="corp-view-public">{t('corp.events.viewPublic')}</a>}
              </div>
            )}
          </div>
        )}

        {current === 'people' && (
          <EventRosterImport text={text} onText={v => { setText(v); setValidation(null); }} event={event} fields={fields} busy={checking} onCheck={() => void check()} serverError={checkError} />
        )}

        {current === 'check' && validation && (
          <div className="space-y-4" data-testid="corp-step-check">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="corp-check-metrics">
              <MetricCard label={t('corp.events.ready')} value={validation.summary.ok} />
              <MetricCard label={t('corp.events.fix')} value={validation.summary.problems} />
              <MetricCard label={t('corp.events.duplicates')} value={validation.duplicates.length} />
              {short.length ? (
                <div data-testid="corp-capacity-short"><MetricCard label={t('corp.events.placesLeft')} wrapLabel value={<span className="text-[var(--color-error-700)]">{t('events.error.capacity_unavailable')}</span>}
                  sub={short.map(s => fmt(t('corp.events.notEnough'), { ticket: ticketName(s.ticketTypeId) || s.ticketTypeId, requested: s.requested, remaining: s.remaining })).join(' · ')} /></div>
              ) : <MetricCard label={t('corp.events.placesLeft')} value={left == null ? t('corp.events.noLimit') : left} />}
            </div>
            <Card><CardContent>
              <DataTable columns={rowColumns} data={shownViews} keyFn={v => String(v.row.index)} label={t('corp.events.step.check')} dense pageSize={50}
                emptyState={t('corp.events.empty.title')}
                extraFilters={<Checkbox label={t('corp.events.problemsOnly')} checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} data-testid="corp-problems-only" />} />
            </CardContent></Card>
          </div>
        )}

        {current === 'confirm' && validation && quote && (
          <div className="space-y-4" data-testid="corp-step-confirm">
            <table className="ui-table w-full" data-testid="corp-quote">
              <thead><tr><th scope="col">{t('organizer.reg.col.ticket')}</th><th scope="col" className="text-right">{t('corp.events.col.places')}</th><th scope="col" className="text-right">{t('corp.events.unit')}</th><th scope="col" className="text-right">{t('corp.events.col.total')}</th></tr></thead>
              <tbody>
                {quote.lines.map(l => <tr key={l.ticketTypeId}><td>{l.ticketTypeName} · {l.categoryName}</td><td className="text-right">{l.quantity}</td><td className="text-right">{money(l.unitPriceTzs, quote.currency)}</td><td className="text-right">{money(l.lineTotalTzs, quote.currency)}</td></tr>)}
                {quote.discountTzs > 0 && <tr data-testid="corp-quote-discount"><td colSpan={3}>{t('corp.events.discount')}</td><td className="text-right">− {money(quote.discountTzs, quote.currency)}</td></tr>}
                {quote.feesTzs > 0 && <tr data-testid="corp-quote-fee"><td colSpan={3}>{quote.feeLabel?.[locale] ?? t('corp.events.fee')}</td><td className="text-right">{money(quote.feesTzs, quote.currency)}</td></tr>}
                <tr className="font-semibold"><td colSpan={3}>{t('corp.events.col.total')}</td><td className="text-right" data-testid="corp-quote-total">{money(quote.totalTzs, quote.currency)}</td></tr>
              </tbody>
            </table>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('corp.events.costCentre')} error={startsWithFormulaChar(costCentre) ? t('events.error.invalid_text') : undefined}><Input value={costCentre} onChange={e => setCostCentre(e.target.value)} maxLength={80} data-testid="corp-cost-centre" /></Field>
              <Field label={t('corp.events.reference')} hint={t('corp.events.reference.hint')} error={startsWithFormulaChar(reference) ? t('events.error.invalid_text') : undefined}><Input value={reference} onChange={e => setReference(e.target.value)} maxLength={80} data-testid="corp-reference" /></Field>
              <Field label={t('corp.events.teamName')} hint={t('corp.events.teamName.hint')} error={startsWithFormulaChar(teamName) ? t('events.error.invalid_text') : undefined}><Input value={teamName} onChange={e => setTeamName(e.target.value)} maxLength={120} data-testid="corp-team-name" /></Field>
            </div>
            <Checkbox label={consentLabel} checked={consent} onChange={e => setConsent(e.target.checked)} disabled={!canPlace} data-testid="corp-consent" />
            <Checkbox label={t('corp.events.acceptTerms')} checked={terms} onChange={e => setTerms(e.target.checked)} disabled={!canPlace} data-testid="corp-terms" />
            <Alert tone="info">{fmt(t('corp.events.hold'), { n: holdTtlMinutes })}</Alert>
            {!canPlace && <div data-testid="corp-billing-gate"><Alert tone="warning">{t('corp.events.billingOnly')}</Alert></div>}
          </div>
        )}
      </CardContent></Card>

      <div className="flex gap-2" data-testid="corp-footer">
        <Button variant="ghost" disabled={step === 0} onClick={() => goTo(step - 1)} data-testid="corp-prev">{current === 'check' ? t('corp.events.editList') : t('events.wizard.prev')}</Button>
        <div className="flex-1" />
        {current === 'event' && <Button disabled={!eventId || !event} onClick={() => goTo(1)} data-testid="corp-next">{t('events.wizard.next')}</Button>}
        {current === 'check' && <Button disabled={!clean} onClick={() => goTo(3)} data-testid="corp-next">{t('events.wizard.next')}</Button>}
        {current === 'confirm' && quote && (
          <Button disabled={!canPlace || !consent || !terms || textBad} loading={placing} onClick={() => void place()} data-testid="corp-place">{fmt(t('corp.events.place'), { amount: money(quote.totalTzs, quote.currency) })}</Button>
        )}
      </div>
    </div>
  );
}

// ── Order detail (§6.2 "Order detail") ──
function CorporateOrderDetail({ token, orgId, orderId, onBack }: { token: string; orgId: string; orderId: string; onBack: () => void }) {
  const { t, locale } = useApp();
  const toast = useToast();
  const [doc, setDoc] = useState<CorporateEventOrderDetail | null>(null);
  const [state, setState] = useState<'ok' | 'error' | 'notfound'>('ok');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  const load = useCallback(async () => {
    setState('ok');
    try { setDoc(await api.corporateEventOrder(token, orgId, orderId)); }
    catch (err) { setState(errorCode(err) === 'order_not_found' || (err instanceof ApiError && err.status === 404) ? 'notfound' : 'error'); }
  }, [token, orgId, orderId]);
  useEffect(() => { void load(); }, [load]);
  const awaiting = doc?.order.status === 'awaiting_payment';
  useEffect(() => {
    if (!awaiting) return;
    const h = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(h);
  }, [awaiting, load]);
  useDocumentTitle(doc ? fmt(t('corp.events.order.title'), { ref: doc.order.reference, event: doc.event.title }) : t('corp.events.title'));

  async function cancel() {
    if (!reason) return;
    setBusy(true);
    try {
      await api.cancelCorporateEventOrder(token, orgId, orderId, reason);
      trackEventsS3Analytics('order_cancelled', { orderId, reason });
      toast.success(t('events.action.done'));
      setCancelOpen(false); setReason('');
      await load();
    } catch (err) {
      toast.error(t(errorKey(err)));
      if (errorCode(err) === 'invalid_transition' || errorCode(err) === 'already_closed') { setCancelOpen(false); await load(); }
    } finally { setBusy(false); }
  }

  if (state === 'notfound') return <div data-testid="corp-order-notfound"><EmptyState icon={<Flag />} title={t('events.error.order_not_found')} action={<Button variant="secondary" onClick={onBack}>{t('events.wizard.back')}</Button>} /></div>;
  if (state === 'error') return <PageError onRetry={() => void load()} />;
  if (!doc) return <PageLoading table />;
  const { order, event } = doc;
  const st = orderStatusOf(order.status);
  const minutes = holdMinutesLeft(order.holdExpiresAt, now);
  const tz = event.timezone;
  const columns: ColumnDef<CorporateEventOrderDetail['registrations'][number]>[] = [
    { key: 'name', header: t('corp.events.col.name'), sortable: true, cell: r => <span className="font-medium text-[var(--color-fg-primary)]">{r.firstName} {r.lastName}</span> },
    { key: 'phone', header: t('corp.events.col.phone'), cell: r => maskPhoneLast3(r.phone) },
    { key: 'email', header: t('corp.events.col.email'), cell: r => maskEmail(r.email) },
    { key: 'category', header: t('corp.events.col.category'), cell: r => r.categoryName ?? doc.lines.find(l => l.ticketTypeId === r.ticketTypeId)?.categoryName ?? '—' },
    { key: 'group', header: t('corp.events.col.group'), cell: r => r.groupLabel ?? '—' },
    { key: 'kit', header: t('corp.events.col.kit'), cell: r => (r.kitSize ? r.kitSize.toUpperCase() : '—') },
    { key: 'status', header: t('corp.events.col.status'), cell: r => { const s = registrationStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'claimed', header: t('corp.events.order.claimed'), cell: r => t(r.claimState === 'claimed' || r.claimState === 'self' ? 'common.yes' : 'common.no') },
  ];
  return (
    <div className="space-y-4" data-testid="corp-order-detail" data-order-status={order.status}>
      <PageHeader title={fmt(t('corp.events.order.title'), { ref: order.reference, event: event.title })}
        description={<span className="inline-flex items-center gap-2"><Badge tone={st.tone}>{t(st.key)}</Badge><span>{eventDateTime(event.startsAt, tz, locale, event.timezoneAbbr)}</span></span>}
        actions={<Button variant="ghost" size="sm" onClick={onBack}>{t('events.wizard.back')}</Button>} />
      {order.status === 'awaiting_payment' && (
        <div className="space-y-3" data-testid="corp-order-awaiting">
          <Alert tone="warning">{fmt(t('corp.events.order.heldLeft'), { time: eventDateTime(order.holdExpiresAt, tz, locale, event.timezoneAbbr), n: minutes ?? 0 })}</Alert>
          <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-primary)] p-4" data-testid="corp-order-pay-soon">
            <p className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('corp.events.order.paySoon.title')}</p>
            <p className="text-sm text-[var(--color-fg-secondary)]">{t('corp.events.order.paySoon.body')}</p>
          </div>
        </div>
      )}
      {order.status === 'expired' && <div data-testid="corp-order-expired"><Alert tone="info">{t('corp.events.order.expired')}</Alert></div>}
      {order.status === 'cancelled' && <div data-testid="corp-order-cancelled"><Alert tone="info">{fmt(t('corp.events.order.cancelled'), { date: eventDateTime(order.closedAt, tz, locale, event.timezoneAbbr), name: doc.createdBy?.name ?? order.createdBy?.name ?? '—' })}</Alert></div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="corp-order-summary">
        <MetricCard label={t('corp.events.col.places')} value={doc.registrations.length} />
        <MetricCard label={t('corp.events.col.total')} value={money(order.totalTzs, order.currency)} />
        <MetricCard label={t('corp.events.costCentre')} value={doc.costCentre ?? order.costCentre ?? '—'} />
        <MetricCard label={t('corp.events.reference')} value={doc.purchaserReference ?? order.purchaserReference ?? '—'} />
        <MetricCard label={t('corp.events.col.createdBy')} value={doc.createdBy?.name ?? order.createdBy?.name ?? '—'} />
        <MetricCard label={t('corp.events.teamName')} value={doc.team?.name ?? '—'} />
      </div>
      <Card><CardContent>
        <DataTable columns={columns} data={doc.registrations} keyFn={r => r.id} label={t('corp.events.participants')} dense pageSize={50} defaultSort={{ key: 'name', dir: 'asc' }} emptyState={t('organizer.reg.empty')} />
      </CardContent></Card>
      {doc.allowedActions?.includes('cancel') && (
        <div><Button variant="destructive" onClick={() => setCancelOpen(true)} data-testid="corp-order-cancel">{t('corp.events.order.cancel')}</Button></div>
      )}
      {event.shareUrl && <Link href={event.shareUrl} target="_blank" className="text-sm underline" data-testid="corp-order-public">{t('corp.events.viewPublic')}</Link>}

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('corp.events.order.cancel')} description={t('corp.events.order.cancel.body')} size="sm">
        <Field label={t('corp.events.order.cancel.reason')} required>
          <Select value={reason} onChange={e => setReason(e.target.value)} data-testid="corp-cancel-reason">
            <option value="">—</option>
            {MEMBER_CANCEL_REASONS.map(r => <option key={r} value={r}>{t(memberCancelReasonKey(r))}</option>)}
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={busy} disabled={!reason} onClick={() => void cancel()} data-testid="corp-cancel-confirm">{t('corp.events.order.cancel')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
