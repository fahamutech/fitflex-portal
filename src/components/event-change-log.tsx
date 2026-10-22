'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, type EventChange, type EventDocument } from '@/lib/api';
import { errorKey, eventDateTime } from '@/lib/events';
import { Badge, Button, PageHeader, SkeletonTable } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { PageError } from '@/components/organizer/page-states';
import { useApp } from '../../app/providers';

/** `?event=<id>&view=changes` (spec §7.5): every save on a published event, material or minor, with before/after. */
export function EventChangeLog({ doc, onBack }: { doc: EventDocument; onBack: () => void }) {
  const { t, token, locale } = useApp();
  const [rows, setRows] = useState<EventChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const out: EventChange[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await api.organizerEventChanges(token, doc.id, cursor);
        out.push(...(page.items ?? []));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setRows(out);
    } catch (err) { setError(t(errorKey(err))); }
  }, [token, doc.id, t]);
  useEffect(() => { void load(); }, [load]);

  const columns: ColumnDef<EventChange>[] = [
    { key: 'at', header: t('events.changes.when'), sortable: true, cell: r => eventDateTime(r.at, doc.timezone, locale, doc.timezoneAbbr) },
    { key: 'actor', header: t('events.changes.who'), cell: r => `${r.actor?.name ?? '—'} · ${r.actor?.role ?? ''}` },
    { key: 'fields', header: t('events.changes.fields'), cell: r => <span className="flex flex-wrap gap-1">{r.fields.map(f => <Badge key={f} tone="gray">{f}</Badge>)}</span> },
    { key: 'material', header: t('events.changes.material'), cell: r => <Badge tone={r.material ? 'warning' : 'gray'}>{t(r.material ? 'events.changes.material' : 'events.changes.minor')}</Badge> },
    { key: 'note', header: t('events.changes.note'), cell: r => (
      <div>
        <p>{r.note ? (locale === 'sw' ? r.note.sw || r.note.en : r.note.en) : '—'}</p>
        <Button variant="link" size="sm" onClick={() => setOpen(o => (o === r.id ? null : r.id))} aria-expanded={open === r.id}>{t('events.changes.details')}</Button>
        {open === r.id && (
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <div><dt className="font-semibold">{t('events.changes.before')}</dt><dd><pre className="whitespace-pre-wrap">{JSON.stringify(r.before ?? {}, null, 1)}</pre></dd></div>
            <div><dt className="font-semibold">{t('events.changes.after')}</dt><dd><pre className="whitespace-pre-wrap">{JSON.stringify(r.after ?? {}, null, 1)}</pre></dd></div>
          </dl>
        )}
      </div>
    ) },
  ];
  return (
    <div className="space-y-4" data-testid="event-change-log">
      <PageHeader title={`${doc.title} · ${t('events.changes.link')}`} actions={<Button variant="ghost" onClick={onBack}>{t('events.common.back')}</Button>} />
      {error ? <PageError onRetry={() => void load()} /> : !rows ? <div aria-busy="true"><SkeletonTable /></div> : (
        <DataTable columns={columns} data={rows} keyFn={r => r.id} label={t('events.changes.link')} defaultSort={{ key: 'at', dir: 'desc' }} emptyState={t('events.changes.empty')} />
      )}
    </div>
  );
}
