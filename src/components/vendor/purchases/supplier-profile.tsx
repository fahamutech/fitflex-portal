'use client';
// One supplier (S9 §4.7, §5.4): contact details, what you owe (aging), open instalments, their deliveries; Receive
// stock from them, Edit, Archive (refused while owed) / Restore.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, Truck } from 'lucide-react';
import { money } from '@/lib/admin-utils';
import { errorBody, errorCode, fmt, receiptDay } from '@/lib/vendor';
import { plural, purchasesApi, type PurchaseRow, type SupplierProfile as Profile } from '@/lib/vendor-purchases';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, ErrorState, SkeletonCard, Spinner, useToast } from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useApp } from '../../../../app/providers';
import { AgingTiles, MoneyTile, rateLimitText, TILE_GRID, useOnline } from '../customers/bits';
import { linkCls, Meta } from './bits';
import { PurchaseRows } from './purchases-view';
import { SupplierFormDialog } from './supplier-form-dialog';

const btnLink = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border px-4 text-sm font-semibold';

export function SupplierProfile({ id, onBack, onOpenPurchase, onOpenSupplier }: {
  id: string; onBack: () => void; onOpenPurchase: (id: string) => void; onOpenSupplier: (id: string) => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const focus = useFocusAfterRender();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'missing'>('loading');
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ text: string; duplicateId?: string; duplicateName?: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setState('loading');
    try {
      const res = await purchasesApi.supplier(token, id);
      setProfile(res); setState('ready');
    } catch (err) {
      if (errorCode(err) === 'supplier_not_found') { setState('missing'); return; }
      if (!vendor.handleError(err) || !quiet) setState('failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  const loadRows = useCallback(async () => {
    if (!token) return;
    setRows(null); setRowsFailed(false);
    try {
      const res = await purchasesApi.purchases(token, { supplierId: id, limit: 20 });
      setRows(res.purchases ?? []); setNext(res.nextCursor ?? null);
    } catch (err) { if (!vendor.handleError(err)) setRowsFailed(true); setRows([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  useEffect(() => { void load(); void loadRows(); }, [load, loadRows]);
  useEffect(() => { if (state === 'ready') focus(() => headingRef.current); }, [state, focus]);

  async function more() {
    if (!token || !next) return;
    setMoreBusy(true);
    try {
      const res = await purchasesApi.purchases(token, { supplierId: id, limit: 20, cursor: next });
      setRows(cur => [...(cur ?? []), ...res.purchases.filter(r => !(cur ?? []).some(c => c.id === r.id))]); setNext(res.nextCursor ?? null);
    } catch (err) { if (!vendor.handleError(err)) setRowsFailed(true); } finally { setMoreBusy(false); }
  }

  async function setArchived(archived: boolean) {
    if (!token) return;
    setBusy(true); setAlert(null);
    try {
      await purchasesApi.updateSupplier(token, id, { archived });
      toast.success(t(archived ? 'vendor.suppliers.archivedDone' : 'vendor.suppliers.restoredDone'));
      setArchiveOpen(false);
      await load(true);
    } catch (err) {
      setArchiveOpen(false);
      const code = errorCode(err);
      const b = errorBody<{ owedTzs?: number; supplierId?: string; existing?: { id?: string; name?: string } }>(err);
      if (code === 'supplier_has_balance') { setAlert({ text: fmt(t('vendor.suppliers.archiveOwes'), { amount: money(b?.owedTzs ?? profile?.owedTzs ?? 0) }) }); void load(true); }
      else if (code === 'duplicate_supplier') {
        // UAT L-4: name and link from the existing supplier (409 existing { id, name }); else this one's name and supplierId.
        const name = b?.existing?.name?.trim() || profile?.supplier.name || '';
        setAlert({ text: fmt(t('vendor.purchases.err.duplicateSupplier'), { name }), duplicateId: b?.existing?.id || b?.supplierId, duplicateName: name });
      }
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert({ text: limited });
        else if (!vendor.handleError(err)) setAlert({ text: t('vendor.purchases.err.server') });
      }
    } finally { setBusy(false); }
  }

  if (state === 'loading') return <div aria-busy="true" aria-label={t('vendor.suppliers.loading')} className="space-y-4"><SkeletonCard /><SkeletonCard /></div>;
  if (state === 'missing') return (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-11" onClick={onBack}><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.suppliers.backToList')}</Button>
      <ErrorState title={t('vendor.suppliers.notFound')} />
    </div>
  );
  if (state === 'failed' || !profile) return <ErrorState title={t('vendor.suppliers.failed')} onRetry={() => load()} retryLabel={t('common.tryAgain')} />;

  const s = profile.supplier;
  const archived = !!s.archivedAt || s.archived === true;
  const owes = profile.owedTzs > 0;
  const suspended = vendor.me?.accountStatus === 'suspended';

  return (
    <div className="space-y-4" data-testid="supplier-profile">
      <Button variant="ghost" className="min-h-11" onClick={onBack} data-testid="supplier-back"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.suppliers.backToList')}</Button>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none [overflow-wrap:anywhere]" data-testid="supplier-heading">{s.name}</h1>
          {archived && <Badge tone="gray">{t('vendor.suppliers.archivedBadge')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!archived && (
            <Link href={`/vendor/purchases/receive/?supplier=${encodeURIComponent(s.id)}`} className={`${btnLink} border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)]`} data-testid="supplier-receive">
              <Truck aria-hidden="true" className="h-4 w-4" />{fmt(t('vendor.purchases.receiveFrom'), { name: s.name })}
            </Link>
          )}
          <Button variant="secondary" className="min-h-11" onClick={() => setEditOpen(true)} disabled={!online || suspended} data-testid="supplier-edit">{t('vendor.suppliers.editShort')}</Button>
          {archived
            ? <Button variant="secondary" className="min-h-11" onClick={() => setArchived(false)} loading={busy} disabled={!online || suspended} data-testid="supplier-restore">{t('vendor.suppliers.restore')}</Button>
            : <Button variant="secondary" className="min-h-11" onClick={() => setArchiveOpen(true)} disabled={!online || suspended || owes} aria-describedby={owes ? 'supplier-archive-owes' : undefined} data-testid="supplier-archive">{t('vendor.suppliers.archive')}</Button>}
        </div>
      </div>
      {!archived && owes && <p id="supplier-archive-owes" className="text-sm text-[var(--color-fg-tertiary)]" data-testid="supplier-archive-owes">{fmt(t('vendor.suppliers.archiveOwes'), { amount: money(profile.owedTzs) })}</p>}
      {archived && <div data-testid="supplier-archived-banner"><Alert tone="info">{t('vendor.suppliers.archived')}</Alert></div>}
      {alert && (
        <div className="space-y-2" data-testid="supplier-alert">
          <Alert tone="error">{alert.text}</Alert>
          {alert.duplicateId && <button type="button" className={linkCls} onClick={() => onOpenSupplier(alert.duplicateId!)}>{fmt(t('vendor.suppliers.openDuplicate'), { name: alert.duplicateName || s.name })}</button>}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.contactPerson && <Meta label={t('vendor.suppliers.label.contact')}>{s.contactPerson}</Meta>}
            {s.phone && (
              <Meta label={t('vendor.suppliers.label.phone')}>
                <a href={`tel:${s.phone}`} className={linkCls} aria-label={fmt(t('vendor.suppliers.call'), { name: s.name })} data-testid="supplier-call"><Phone aria-hidden="true" className="mr-1 h-4 w-4" />{s.phone}</a>
              </Meta>
            )}
            {s.email && <Meta label={t('vendor.suppliers.label.email')}>{s.email}</Meta>}
            {s.address && <Meta label={t('vendor.suppliers.label.address')}>{s.address}</Meta>}
            {s.tin && <Meta label={t('vendor.suppliers.label.tin')}>{s.tin}</Meta>}
            {s.note && <Meta label={t('vendor.suppliers.label.note')}>{s.note}</Meta>}
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="supplier-owed" className="space-y-2">
        <h2 id="supplier-owed" className="font-semibold">{t('vendor.payables.title')}</h2>
        <div className={TILE_GRID}>
          <MoneyTile label={t('vendor.purchases.left')} value={money(profile.owedTzs)} testId="supplier-owed" />
          <MoneyTile label={t('vendor.payables.overdue')} value={money(profile.overdueTzs)} testId="supplier-overdue" />
        </div>
        <AgingTiles aging={profile.aging} testId="supplier-aging" />
        <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('vendor.customers.asOf'), { date: receiptDay(profile.asOf, locale) })}</p>
      </section>

      <Card>
        <CardHeader><h2 className="font-semibold">{t('vendor.suppliers.openInstalments')}</h2></CardHeader>
        <CardContent className="p-0">
          {profile.openInstalments.length === 0 ? <p className="px-5 py-4 text-sm text-[var(--color-fg-tertiary)]">{t('vendor.suppliers.nothingToPay')}</p> : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="supplier-open-instalments">
              {profile.openInstalments.map(i => (
                <li key={`${i.purchaseId}-${i.seq}`}>
                  <button type="button" onClick={() => onOpenPurchase(i.purchaseId)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left text-sm hover:bg-[var(--color-bg-secondary)]">
                    <span><span className="font-mono font-semibold">{i.number}</span> · {fmt(t('vendor.purchases.instalmentN'), { n: i.seq })} · {receiptDay(i.dueDate, locale)}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums font-semibold">{money(i.openTzs)}</span>
                      {i.daysOverdue > 0 && <Badge tone="warning">{fmt(plural(t, 'vendor.suppliers.daysOverdue', i.daysOverdue), { n: i.daysOverdue })}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="supplier-purchases" className="space-y-2">
        <h2 id="supplier-purchases" className="font-semibold">{t('vendor.purchases.segPurchases')}</h2>
        <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="supplier-bought">
          {fmt(plural(t, 'vendor.suppliers.bought', profile.totals.purchaseCount), { amount: money(profile.totals.purchasedTzs), n: profile.totals.purchaseCount, paid: money(profile.totals.paidTzs) })}
        </p>
        {rows == null ? <SkeletonCard /> : rowsFailed ? <ErrorState title={t('vendor.purchases.failed')} onRetry={loadRows} retryLabel={t('common.tryAgain')} />
          : rows.length === 0 ? <EmptyState icon={<Truck />} title={t('vendor.purchases.empty')} />
          : <PurchaseRows rows={rows} onOpen={onOpenPurchase} showSupplier={false} />}
        {next && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={more} disabled={moreBusy} className="min-h-11">{moreBusy && <Spinner className="h-4 w-4" />}{t('vendor.stock.loadMore')}</Button>
          </div>
        )}
      </section>

      <SupplierFormDialog open={editOpen} supplier={s} onClose={() => setEditOpen(false)} onOpenSupplier={sid => { setEditOpen(false); onOpenSupplier(sid); }}
        onSaved={() => { setEditOpen(false); toast.success(t('vendor.suppliers.saved')); void load(true); }} />
      <ConfirmDialog open={archiveOpen} onClose={() => { if (!busy) setArchiveOpen(false); }} onConfirm={() => setArchived(true)} busy={busy}
        title={fmt(t('vendor.suppliers.archiveTitle'), { name: s.name })} description={t('vendor.suppliers.archiveBody')} confirmLabel={t('vendor.suppliers.archive')} />
    </div>
  );
}
