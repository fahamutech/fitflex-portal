'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Flag, MoreHorizontal, Plus } from 'lucide-react';
import { api, type Bilingual, type OrganizerEventRow } from '@/lib/api';
import { EVENT_STATUSES, EVENT_TYPES, canManageEvents, distanceLabel, errorKey, eventDateTime, eventStatusOf, fmt, relativeTime, typeKey } from '@/lib/events';
import { Badge, Button, Card, CardContent, EmptyState, PageHeader, Select, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { Dialog } from '@/components/dialog';
import { useOrganizer } from '@/components/organizer-context';
import { OrganizerPage, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { EventWizard } from '@/components/event-wizard';
import { LifecycleButtons, LifecycleDialogs, lifecycleActions, type LifecycleAction } from '@/components/event-lifecycle';
import { useApp } from '../../providers';

/** The organizer's events (spec §6.1): list with status/type filters; `?event=` opens the wizard. */
function EventsList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { t, token, locale } = useApp();
  const org = useOrganizer();
  const toast = useToast();
  const [rows, setRows] = useState<OrganizerEventRow[] | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [menuFor, setMenuFor] = useState<OrganizerEventRow | null>(null);
  const [lifecycle, setLifecycle] = useState<{ row: OrganizerEventRow; action: LifecycleAction } | null>(null);
  useDocumentTitle(t('events.list.title'));
  const canManage = canManageEvents(org.organizer?.status, org.role);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try {
      const out: OrganizerEventRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await api.organizerEvents(token, { cursor, limit: 50 });
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch { setError(true); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: LifecycleAction, body?: { reason?: string; note?: Bilingual }) {
    if (!token || !lifecycle) return;
    if (action === 'delete') await api.deleteOrganizerEvent(token, lifecycle.row.id);
    else await api.organizerEventAction(token, lifecycle.row.id, action, body);
    toast.success(t('events.action.done'));
    await load();
  }

  if (error) return <PageError onRetry={() => void load()} />;
  if (!rows) return <PageLoading table />;

  // Archived events leave the default list (§7.2); the status filter still finds them.
  const shown = rows.filter(r => (status ? r.status === status : r.status !== 'archived') && (!type || r.type === type));
  const columns: ColumnDef<OrganizerEventRow>[] = [
    { key: 'title', header: t('events.list.col.title'), sortable: true, cell: r => <div className="min-w-[200px]"><p className="line-clamp-2 font-medium text-[var(--color-fg-primary)]">{r.title}</p><p className="text-xs text-[var(--color-fg-quaternary)]">{r.slug}</p></div> },
    { key: 'startsAt', header: t('events.list.col.starts'), sortable: true, cell: r => eventDateTime(r.startsAt, r.timezone, locale, r.timezoneAbbr) },
    { key: 'type', header: t('events.list.col.type'), sortable: true, cell: r => t(typeKey(r.type)) },
    { key: 'status', header: t('events.list.col.status'), sortable: true, cell: r => { const s = eventStatusOf(r.status); return <Badge tone={s.tone}>{t(s.key)}</Badge>; } },
    { key: 'categoriesCount', header: t('events.list.col.categories'), sortable: true, cell: r => `${r.categoriesCount ?? r.distancesM?.length ?? 0} · ${(r.distancesM ?? []).map(distanceLabel).join(' ')}` },
    { key: 'updatedAt', header: t('events.list.col.updated'), sortable: true, cell: r => <span title={eventDateTime(r.updatedAt, r.timezone, locale, r.timezoneAbbr)}>{relativeTime(r.updatedAt, locale)}</span> },
  ];
  const filters = (
    <>
      <Select size="sm" aria-label={t('events.list.filterStatus')} value={status} onChange={e => setStatus(e.target.value)} data-testid="events-filter-status">
        <option value="">{t('events.list.allStatuses')}</option>
        {EVENT_STATUSES.map(s => <option key={s} value={s}>{t(eventStatusOf(s).key)}</option>)}
      </Select>
      <Select size="sm" aria-label={t('events.list.filterType')} value={type} onChange={e => setType(e.target.value)} data-testid="events-filter-type">
        <option value="">{t('events.list.allTypes')}</option>
        {EVENT_TYPES.map(ty => <option key={ty} value={ty}>{t(typeKey(ty))}</option>)}
      </Select>
    </>
  );
  return (
    <div className="space-y-4" data-testid="events-list">
      <PageHeader title={t('events.list.title')} actions={canManage ? <Button onClick={onNew} data-testid="events-new"><Plus aria-hidden="true" className="h-4 w-4" />{t('events.list.new')}</Button> : undefined} />
      {rows.length === 0 ? (
        <EmptyState icon={<Flag />} title={t('events.list.empty.title')} body={t('events.list.empty.body')} action={canManage ? <Button onClick={onNew}>{t('events.list.new')}</Button> : undefined} />
      ) : (
        <Card><CardContent>
          <DataTable
            columns={columns} data={shown} keyFn={r => r.id} label={t('events.list.tableLabel')} stickyActions extraFilters={filters}
            defaultSort={{ key: 'startsAt', dir: 'desc' }} onRowClick={r => onOpen(r.id)} emptyState={t('events.list.empty.body')}
            actions={r => (
              <>
                <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onOpen(r.id); }} data-testid={`events-open-${r.id}`}>{t('events.list.open')}</Button>
                {lifecycleActions(r.allowedActions, canManage).length > 0 && (
                  <Button variant="ghost" size="sm" aria-label={fmt(t('events.list.moreActions'), { title: r.title })} onClick={e => { e.stopPropagation(); setMenuFor(r); }} data-testid={`events-more-${r.id}`}>
                    <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          />
        </CardContent></Card>
      )}
      <Dialog open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.title ?? ''} size="sm">
        <div className="flex flex-col items-stretch gap-1">
          {menuFor && <LifecycleButtons size="md" actions={lifecycleActions(menuFor.allowedActions, canManage)} onPick={a => { setLifecycle({ row: menuFor, action: a }); setMenuFor(null); }} testPrefix="row-action" />}
        </div>
      </Dialog>
      <LifecycleDialogs action={lifecycle?.action ?? null} onClose={() => setLifecycle(null)} run={run} />
    </div>
  );
}

function EventsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const event = params.get('event');
  const step = params.get('step');
  const view = params.get('view');
  const open = (id: string | null, extra: Record<string, string | null> = {}) => {
    const q = new URLSearchParams();
    if (id) q.set('event', id);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  if (event) {
    return <EventWizard eventId={event} initialStep={step} view={view} onBack={() => open(null)} onView={(id, v) => open(id, { view: v })} />;
  }
  return <EventsList onOpen={id => open(id)} onNew={() => open('new')} />;
}

export default function OrganizerEventsPage() {
  return <OrganizerPage area="events"><Suspense fallback={null}><EventsInner /></Suspense></OrganizerPage>;
}
