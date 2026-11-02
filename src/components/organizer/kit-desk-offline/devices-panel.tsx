'use client';
// Events S7 offline kit desk (spec §3.3, §3.14 Desks panel, AC-O24): who holds a ticket list. Owner and admin see every desk; ops see their own; a FitFlex admin reads
// (and may remove a desk) through the admin routes. A desk is a registry entry, not a credential: removing it takes effect at its next contact.
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { adminS7Api, kitOfflineApi, type OfflineDeviceRow } from '@/lib/events-s7-api';
import { eventDateTime, fmt } from '@/lib/events';
import { Badge, Button, Card, CardContent, EmptyState, useToast } from '@/components/shared';
import { DataTable, type ColumnDef } from '@/components/data-table';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { PageError, PageLoading } from '@/components/organizer/page-states';
import { useApp } from '../../../../app/providers';

export function DevicesPanel({ eventId, timezone, mode, reloadKey = 0, canRemove, active = true }: {
  eventId: string; timezone: string; /** `organizer`: the organizer routes (ops see their own); `admin`: the FitFlex admin routes. */ mode: 'organizer' | 'admin'; reloadKey?: number; canRemove: boolean; active?: boolean;
}) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<OfflineDeviceRow[] | null>(null);
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<OfflineDeviceRow | null>(null);
  const [showBib, setShowBib] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try {
      const res = mode === 'admin' ? await adminS7Api.kitOffline(token, eventId) : await kitOfflineApi.devices(token, eventId);
      const items = res.items ?? [];
      setRows(items);
      // Ops get no bib columns: the block and counts are for owner and admin (§3.15 privacy).
      setShowBib(items.length === 0 || items.some(d => d.bibRange !== undefined && d.bibsRecorded !== undefined));
    } catch { setError(true); }
  }, [token, eventId, mode]);
  useEffect(() => { if (active) void load(); }, [load, reloadKey, active]);

  const when = (iso: string | null) => (iso ? eventDateTime(iso, timezone, locale) : '—');
  const block = (d: OfflineDeviceRow) => (d.bibRange ? `${d.bibRange.prefix ?? ''}${String(d.bibRange.start).padStart(d.bibRange.padTo || 0, '0')}–${d.bibRange.prefix ?? ''}${String(d.bibRange.end).padStart(d.bibRange.padTo || 0, '0')}` : '—');
  const columns: ColumnDef<OfflineDeviceRow>[] = [
    { key: 'label', header: t('organizer.kitOffline.devices.col.desk'), cell: d => <span className="font-medium [overflow-wrap:anywhere]">{d.label}</span> },
    { key: 'staff', header: t('organizer.kitOffline.devices.col.staff'), cell: d => d.staffFirstName ?? '—' },
    { key: 'status', header: t('organizer.kitOffline.devices.col.status'), cell: d => <Badge tone={d.status === 'active' ? 'success' : d.status === 'revoked' ? 'danger' : 'gray'}>{t(`organizer.kitOffline.devices.status.${d.status}`)}</Badge> },
    { key: 'lastSyncAt', header: t('organizer.kitOffline.devices.col.lastSent'), cell: d => when(d.lastSyncAt) },
    { key: 'pendingReported', header: t('organizer.kitOffline.devices.col.unsent'), cell: d => d.pendingReported ?? 0 },
    { key: 'snapshotRows', header: t('organizer.kitOffline.devices.col.rows'), cell: d => d.snapshotRows ?? 0 },
    ...(showBib ? [
      { key: 'bibRange', header: t('organizer.kitOffline.devices.col.bibBlock'), cell: (d: OfflineDeviceRow) => <span className="font-mono">{block(d)}</span> },
      { key: 'bibsRecorded', header: t('organizer.kitOffline.devices.col.bibsRecorded'), cell: (d: OfflineDeviceRow) => d.bibsRecorded ?? 0 },
      { key: 'bibExceptions', header: t('organizer.kitOffline.devices.col.bibExceptions'), cell: (d: OfflineDeviceRow) => d.bibExceptions ?? 0 },
    ] : []),
    { key: 'deskBuild', header: t('organizer.kitOffline.devices.col.build'), cell: d => d.deskBuild ?? '—' },
  ];

  return (
    <div className="space-y-3" data-testid="offline-devices">
      <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('organizer.kitOffline.devices.title')}</h2>
      {error ? <PageError onRetry={() => void load()} /> : !rows ? <PageLoading table /> : (
        <Card><CardContent>
          <DataTable columns={columns} data={rows} keyFn={d => d.id} label={t('organizer.kitOffline.devices.title')} dense emptyState={t('organizer.kitOffline.devices.empty')}
            actions={canRemove ? (d => d.status === 'active'
              ? <Button variant="ghost" size="sm" onClick={() => setTarget(d)} aria-label={`${t('organizer.kitOffline.devices.remove')}: ${d.label}`} data-testid={`offline-remove-${d.id}`}><Trash2 aria-hidden="true" className="h-4 w-4" />{t('organizer.kitOffline.devices.remove')}</Button>
              : null) : undefined} />
          {rows.length === 0 && <EmptyState title={t('organizer.kitOffline.devices.empty')} />}
        </CardContent></Card>
      )}
      <ReasonTypedDialog open={!!target} onClose={() => setTarget(null)} title={t('organizer.kitOffline.devices.remove')} body={target ? <span>{t('organizer.kitOffline.devices.removeBody')} <strong>{target.label}</strong></span> : undefined}
        confirmLabel={t('organizer.kitOffline.devices.remove')} testId="offline-remove-dialog" reasonLabel={t('organizer.kitOffline.devices.removeReason')} reasonSwLabel={t('admin.events.ops.reasonSw')}
        typed={target ? [target.label] : undefined} typedLabel={t('events.s7.devices.typed')}
        onConfirm={async r => {
          if (!token || !target) return;
          const body = { reason: r.reason, ...(r.reasonSw ? { reasonSw: r.reasonSw } : {}) };
          if (mode === 'admin') await adminS7Api.kitOfflineRevoke(token, eventId, target.id, body, r.key); else await kitOfflineApi.revoke(token, eventId, target.id, body, r.key);
          toast.success(fmt(t('events.s7.devices.removed'), { desk: target.label })); setTarget(null); await load();
        }} />
    </div>
  );
}
