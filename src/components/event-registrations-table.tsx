'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { api, type EventRegistrationRow, type EventRegistrationsSummary, type EventsPage } from '@/lib/api';
import { REGISTRATION_STATUSES, eventDateTime, fmt, registrationStatusOf } from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Input, MetricCard, Select, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { PageError } from '@/components/organizer/page-states';
import { useApp } from '../../app/providers';

/** Who reads the table (S3 §3.13, §6.3, §6.5): the server masks reserved names for organizers; admins get full names. */
export type RegistrationsFieldPolicy = 'organizer' | 'admin';
const BANNER_KEY = 'events.reg.privacyBannerDismissed';

/**
 * Registrations of one event (§6.3 / §6.5). Never shows phone, email, DOB, gender or an emergency contact: the rows
 * do not carry them (P-O-1). Filters go to the server; paging is client-side over the pages fetched (≤ 500 rows).
 */
export function EventRegistrationsTable({ eventId, timezone, timezoneAbbr, fieldPolicy, published }: {
  eventId: string; timezone: string | null | undefined; timezoneAbbr?: string | null; fieldPolicy: RegistrationsFieldPolicy; published: boolean;
}) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<EventRegistrationRow[] | null>(null);
  const [summary, setSummary] = useState<EventRegistrationsSummary | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [banner, setBanner] = useState(() => fieldPolicy === 'organizer' && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(BANNER_KEY) !== '1');

  useEffect(() => { const h = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(h); }, [search]);

  const load = useCallback(async () => {
    if (!token || !published) { setRows([]); return; }
    setError(false);
    try {
      const out: EventRegistrationRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const query = { status: status || undefined, categoryId: categoryId || undefined, q: q || undefined, cursor, limit: 50 };
        const page: EventsPage<EventRegistrationRow> = fieldPolicy === 'admin'
          ? await api.adminEventRegistrations(token, eventId, query)
          : await api.organizerEventRegistrations(token, eventId, query);
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch { setError(true); }
  }, [token, eventId, status, categoryId, q, fieldPolicy, published]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token || !published || fieldPolicy !== 'organizer') return;
    api.organizerEventRegistrationsSummary(token, eventId).then(setSummary).catch(() => setSummary(null));
  }, [token, eventId, published, fieldPolicy, rows]);

  const anyGroup = useMemo(() => (rows ?? []).some(r => !!r.groupLabel), [rows]);
  const dismiss = () => { setBanner(false); try { sessionStorage.setItem(BANNER_KEY, '1'); } catch { /* private mode */ } };

  if (!published) return <div data-testid="reg-not-published"><EmptyState title={t('organizer.reg.notPublished')} /></div>;
  if (error) return <PageError onRetry={() => void load()} />;
  if (!rows) return <div aria-busy="true"><SkeletonTable /></div>;

  const columns: ColumnDef<EventRegistrationRow>[] = [
    { key: 'name', header: t('organizer.reg.col.name'), sortable: true, cell: r => (
      r.status === 'reserved' && fieldPolicy === 'organizer'
        ? <span title={t('organizer.reg.masked')} className="font-medium text-[var(--color-fg-secondary)]" data-testid="reg-name-masked">{r.participant?.name ?? '—'}</span>
        : <span className="font-medium text-[var(--color-fg-primary)]">{r.participant?.name ?? '—'}</span>
    ) },
    { key: 'categoryName', header: t('organizer.reg.col.category'), sortable: true, cell: r => r.categoryName ?? '—' },
    { key: 'ticketTypeName', header: t('organizer.reg.col.ticket'), cell: r => r.ticketTypeName ?? '—' },
    { key: 'status', header: t('organizer.reg.col.status'), sortable: true, cell: r => { const s = registrationStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'orderReference', header: t('organizer.reg.col.order'), cell: r => <span className="font-mono text-xs">{r.orderReference}</span> },
    { key: 'teamName', header: t('organizer.reg.col.team'), cell: r => r.teamName ?? '—' },
    ...(anyGroup ? [{ key: 'groupLabel', header: t('corp.events.col.group'), cell: (r: EventRegistrationRow) => r.groupLabel ?? '—' }] : []),
    { key: 'kitSize', header: t('organizer.reg.col.kit'), cell: r => (r.status === 'confirmed' && r.kitSize ? r.kitSize.toUpperCase() : '—') },
    { key: 'claimed', header: t('organizer.reg.col.claimed'), cell: r => (r.claimed ? <span className="inline-flex items-center gap-1 text-[var(--color-success-700)]"><Check aria-hidden="true" className="h-4 w-4" /><span className="sr-only">{t('corp.events.order.claimed')}</span></span> : <span aria-label={t('common.no')}>—</span>) },
    { key: 'createdAt', header: t('organizer.reg.col.created'), sortable: true, cell: r => eventDateTime(r.createdAt, timezone, locale, timezoneAbbr) },
  ];
  const filters = (
    <>
      <Select size="sm" aria-label={t('organizer.reg.col.status')} value={status} onChange={e => setStatus(e.target.value)} data-testid="reg-filter-status">
        <option value="">{t('events.list.allStatuses')}</option>
        {REGISTRATION_STATUSES.map(s => <option key={s} value={s}>{t(registrationStatusOf(s).key)}</option>)}
      </Select>
      {summary && summary.byCategory.length > 0 && (
        <Select size="sm" aria-label={t('organizer.reg.col.category')} value={categoryId} onChange={e => setCategoryId(e.target.value)} data-testid="reg-filter-category">
          <option value="">{t('corp.events.allCategories')}</option>
          {summary.byCategory.map(c => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
        </Select>
      )}
      <Input size="sm" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('organizer.reg.search')} aria-label={t('organizer.reg.search')} title={t('organizer.reg.searchHint')} data-testid="reg-search" />
    </>
  );
  return (
    <div className="space-y-4" data-testid={`${fieldPolicy}-registrations`}>
      {banner && (
        <div data-testid="reg-privacy-banner">
          <Alert tone="info">
            <span className="flex flex-wrap items-center gap-2">{t('organizer.reg.privacy')}<Button variant="link" size="sm" onClick={dismiss}>{t('common.dismiss')}</Button></span>
          </Alert>
        </div>
      )}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="reg-summary">
          <MetricCard label={t('organizer.reg.confirmed')} value={summary.byStatus.confirmed} />
          <MetricCard label={t('organizer.reg.reserved')} value={summary.byStatus.reserved} />
          <MetricCard label={t('organizer.reg.cancelled')} value={summary.byStatus.cancelled} />
          <MetricCard label={t('organizer.reg.col.category')} wrapLabel value={
            <ul className="space-y-0.5 text-sm font-normal" data-testid="reg-by-category">
              {summary.byCategory.map(c => <li key={c.categoryId}><span className="font-medium">{c.name}</span>: {fmt(t('organizer.reg.capacity'), { sold: c.sold, capacity: c.capacity == null ? '∞' : c.capacity })}{c.held > 0 ? ` · ${fmt(t('organizer.reg.held'), { n: c.held })}` : ''}</li>)}
            </ul>
          } />
        </div>
      )}
      <Card><CardContent>
        <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('organizer.events.view.registrations')} dense pageSize={25} extraFilters={filters}
          defaultSort={{ key: 'createdAt', dir: 'desc' }} emptyState={t('organizer.reg.empty')} />
      </CardContent></Card>
    </div>
  );
}
