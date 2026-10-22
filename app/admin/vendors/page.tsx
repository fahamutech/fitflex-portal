'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CheckCircle2, MapPin, Percent, RefreshCw, UserRoundCheck, UserRoundX, XCircle } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, GeoArea, VendorAreasPatch, VendorSummary } from '@/lib/api';
import { CASE_STATUS } from '@/lib/kyc';
import { Alert, Badge, Button, Card, Field, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { ColumnDef, DataTable } from '@/components/data-table';
import { VendorAreaPicker } from '@/components/vendor-area-picker';
import { areaLabel, deliveryIds, freeTextRegions, hasNoArea, indexAreas, regionOf, suggestAreas, usableAreas } from '@/lib/vendor-areas';

type T = ReturnType<typeof useApp>['t'];
type AreaFilter = 'all' | 'none' | 'backfill';

/** Area names for a list of ids; the country reads "Nationwide". */
function areaNames(ids: string[], byId: Map<string, GeoArea>, t: T): string[] {
  return ids.map(id => (byId.get(id)?.level === 'country' ? t('vendors.areas.nationwide') : areaLabel(id, byId)));
}

/** "Delivers to: A, B (+2)" */
function deliversSummary(ids: string[], byId: Map<string, GeoArea>, t: T): string {
  const names = areaNames(ids, byId, t);
  const shown = names.slice(0, 2).join(', ');
  return t('vendors.areas.deliversRow').replace('{areas}', names.length > 2 ? `${shown} ${t('vendors.areas.deliversMore').replace('{n}', String(names.length - 2))}` : shown);
}

function basedInName(profile: VendorSummary['vendorProfile'], byId: Map<string, GeoArea>): string | null {
  if (profile?.cityId) return areaLabel(profile.cityId, byId);
  if (profile?.regionId) return areaLabel(profile.regionId, byId);
  return null;
}

/** "Based in" / "Delivers to" in the vendors table. */
function VendorAreasCell({ vendor, byId, t }: { vendor: VendorSummary; byId: Map<string, GeoArea>; t: T }) {
  const p = vendor.vendorProfile;
  if (hasNoArea(p)) return <Badge tone="warning">{t('vendors.areas.noArea')}</Badge>;
  const based = basedInName(p, byId);
  const ids = deliveryIds(p);
  return <div className="space-y-0.5 text-xs" data-testid={`vendor-areas-${vendor.id}`}>
    <p className={based ? '' : 'text-[var(--color-fg-quaternary)]'}>{based ? t('vendors.areas.basedInRow').replace('{area}', based) : t('vendors.areas.basedInNotSet')}</p>
    <p className={ids.length ? '' : 'text-[var(--color-fg-quaternary)]'}>{ids.length ? deliversSummary(ids, byId, t) : t('vendors.areas.deliversNone')}</p>
    {p?.areasSource === 'backfill' && <Badge tone="info">{t('vendors.areas.guessed')}</Badge>}
  </div>;
}

/** Message for a 400 invalid_area from PUT /admin/vendors/:id. */
function invalidAreaMessage(err: unknown, byId: Map<string, GeoArea>, t: T): string {
  const body = err instanceof ApiError ? err.body as { error?: string; reason?: string; ids?: string[] } | null : null;
  if (body?.error !== 'invalid_area') return t('vendors.areas.saveFailed');
  const names = (body.ids ?? []).map(id => byId.get(id)?.name ?? id).join(', ');
  const key = body.reason === 'too_many' ? 'tooMany'
    : body.reason === 'wrong_level' ? 'wrongLevel'
    : body.reason === 'not_in_region' ? 'notInRegion'
    : body.reason === 'unknown' || body.reason === 'inactive' ? 'gone'
    : 'other';
  return t(`vendors.areas.invalid.${key}`).replace('{areas}', names);
}

/** A vendor is "verified" by their KYC case; existing vendors predate KYC. */
function KycBadge({ vendor, t }: { vendor: VendorSummary; t: ReturnType<typeof useApp>['t'] }) {
  if (vendor.kycStatus) {
    const s = CASE_STATUS[vendor.kycStatus];
    return <Badge tone={s.tone}>{t('vendors.kyc')}: {s.label}</Badge>;
  }
  return <Badge tone={vendor.kycExempt ? 'gray' : 'warning'}>{t(vendor.kycExempt ? 'vendors.kycExisting' : 'vendors.kycNotStarted')}</Badge>;
}

function approvalTone(status: VendorSummary['approvalStatus']) {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected') return 'danger' as const;
  return 'warning' as const;
}

export default function VendorsPage() {
  const { token, user, t } = useApp();
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Changing the commission FitFlex takes on a vendor's sales.
  const [rateTarget, setRateTarget] = useState<VendorSummary | null>(null);
  const [rate, setRate] = useState('');
  const [rateError, setRateError] = useState<string | null>(null);
  // Shop areas ("Popular near you"): where a vendor is based and delivers to.
  const [areas, setAreas] = useState<GeoArea[]>([]);
  const [areasState, setAreasState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all');
  const [areaTarget, setAreaTarget] = useState<VendorSummary | null>(null);
  const [basedIn, setBasedIn] = useState<string | null>(null);
  const [delivers, setDelivers] = useState<string[]>([]);
  const [areaError, setAreaError] = useState<string | null>(null);
  const byId = useMemo(() => indexAreas(areas), [areas]);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setVendors(await api.adminVendors(token));
      setError(null);
    } catch {
      setError(t('vendors.error'));
    } finally {
      setLoading(false);
    }
  }

  // GET /admin/geo-areas needs a promotions scope; /shop/areas works for any signed-in admin while SHOP_NEAR_YOU is on.
  async function loadAreas() {
    if (!token) return;
    setAreasState('loading');
    try {
      setAreas(usableAreas((await api.geoAreas(token)).areas ?? []));
      setAreasState('ready');
    } catch {
      try {
        setAreas((await api.shopAreas(token)).areas ?? []);
        setAreasState('ready');
      } catch {
        setAreasState('failed');
      }
    }
  }

  useEffect(() => { void load(); void loadAreas(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAreas(vendor: VendorSummary) {
    setAreaTarget(vendor);
    setBasedIn(vendor.vendorProfile?.cityId ?? null);
    setDelivers(deliveryIds(vendor.vendorProfile));
    setAreaError(null);
  }

  async function saveAreas() {
    if (!token || !areaTarget) return;
    const vendor = areaTarget;
    const patch: VendorAreasPatch = { deliveryAreaIds: delivers };
    // Send "Based in" only when it changed, so a stored region-only value is kept.
    if (basedIn !== (vendor.vendorProfile?.cityId ?? null)) {
      patch.cityId = basedIn;
      patch.regionId = basedIn ? regionOf(basedIn, byId) : null;
    }
    setBusyId(vendor.id);
    setAreaError(null);
    setSuccess(null);
    try {
      const updated = await api.updateAdminVendor(token, vendor.id, patch);
      // The API returns the vendor's account with the stored profile (the server fills regionId).
      const profile = updated?.vendorProfile ?? { ...(vendor.vendorProfile ?? {}), ...patch, areasSource: 'admin' as const };
      setVendors(current => current.map(row => row.id === vendor.id ? { ...row, vendorProfile: profile } : row));
      setAreaTarget(null);
      setSuccess(t('vendors.updated'));
    } catch (err) {
      setAreaError(invalidAreaMessage(err, byId, t));
    } finally {
      setBusyId(null);
    }
  }

  async function update(vendor: VendorSummary, patch: Parameters<typeof api.updateAdminVendor>[2]) {
    if (!token) return;
    setBusyId(vendor.id);
    setSuccess(null);
    try {
      const updated = await api.updateAdminVendor(token, vendor.id, patch);
      // The API returns the vendor's account; the rate we just set comes from the patch.
      setVendors((current) => current.map((row) => row.id === vendor.id ? { ...row, ...updated, ...(patch.commissionPct != null ? { commissionPct: patch.commissionPct } : {}) } : row));
      setError(null);
      setSuccess(t('vendors.updated'));
    } catch {
      setError(t('vendors.error'));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRate() {
    if (!rateTarget) return;
    const pct = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 30) {
      setRateError(t('vendors.commissionInvalid'));
      return;
    }
    await update(rateTarget, { commissionPct: pct });
    setRateTarget(null);
  }

  if (!token || user?.userType !== 'admin') return null;

  // Hidden until areas exist, so the page reads as before without them.
  const showAreas = areasState === 'ready' && areas.length > 0;
  const noAreaCount = vendors.filter(v => hasNoArea(v.vendorProfile)).length;
  const guessedCount = vendors.filter(v => v.vendorProfile?.areasSource === 'backfill').length;
  const shown = !showAreas || areaFilter === 'all' ? vendors
    : areaFilter === 'none' ? vendors.filter(v => hasNoArea(v.vendorProfile))
    : vendors.filter(v => v.vendorProfile?.areasSource === 'backfill');
  const writtenRegions = freeTextRegions(areaTarget?.vendorProfile);
  const suggestions = suggestAreas(writtenRegions, areas).filter(a => !delivers.includes(a.id));

  const columns: ColumnDef<VendorSummary>[] = [
    {
      key: 'displayName', header: t('vendors.business'), sortable: true,
      cell: (vendor) => <div>
        <p className="font-medium text-[var(--color-fg-primary)]">{vendor.vendorProfile?.businessName || vendor.displayName || vendor.id}</p>
        <p className="text-xs text-[var(--color-fg-quaternary)]">{vendor.vendorProfile?.businessCategory || vendor.vendorProfile?.address || vendor.id}</p>
      </div>,
    },
    {
      key: 'email', header: t('vendors.contact'), sortable: true,
      cell: (vendor) => <div className="text-xs"><p>{vendor.email || '—'}</p><p className="text-[var(--color-fg-quaternary)]">{vendor.phone || '—'}</p></div>,
    },
    {
      key: 'approvalStatus', header: t('vendors.approval'), sortable: true,
      cell: (vendor) => <div className="flex flex-wrap gap-1">
        <Badge tone={approvalTone(vendor.approvalStatus)}>{t(`vendors.${vendor.approvalStatus === 'pending_approval' ? 'pending' : vendor.approvalStatus}`)}</Badge>
        <KycBadge vendor={vendor} t={t} />
      </div>,
    },
    {
      key: 'accountStatus', header: t('vendors.account'), sortable: true,
      cell: (vendor) => <Badge tone={vendor.accountStatus === 'active' ? 'success' : 'danger'}>{t(vendor.accountStatus === 'active' ? 'vendors.active' : 'vendors.suspended')}</Badge>,
    },
    ...(showAreas ? [{
      key: 'areas', header: t('vendors.areas.title'),
      cell: (vendor: VendorSummary) => <VendorAreasCell vendor={vendor} byId={byId} t={t} />,
    }] : []),
    {
      key: 'commissionPct', header: t('vendors.commission'), sortable: true, align: 'right',
      cell: (vendor) => <span className="tabular-nums" data-testid={`vendor-commission-${vendor.id}`}>{vendor.commissionPct ?? 10}%</span>,
    },
    {
      key: 'productCount', header: t('vendors.products'), sortable: true,
      cell: (vendor) => <div className="text-xs"><p>{vendor.productCount}</p><p className="text-[var(--color-fg-quaternary)]">{t('vendors.pendingProducts').replace('{count}', String(vendor.pendingProductCount))}</p></div>,
    },
  ];

  return <div className="space-y-6">
    <PageHeader
      title={t('vendors.title')}
      description={t('vendors.description')}
      actions={<Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('admin.action.refresh')}</Button>}
    />
    {error && <Alert tone="error">{error}</Alert>}
    {areasState === 'failed' && <Alert tone="warning"><div className="flex flex-wrap items-center justify-between gap-2">
      <span>{t('vendors.areas.failed')}</span>
      <Button variant="secondary" size="sm" onClick={loadAreas} data-testid="vendor-areas-retry">{t('vendors.areas.retry')}</Button>
    </div></Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    {loading && vendors.length === 0 ? <div className="flex justify-center py-16"><Spinner /></div> : <Card><div className="p-5">
      <DataTable
        columns={columns}
        data={shown}
        keyFn={(vendor) => vendor.id}
        filterPlaceholder={t('vendors.title')}
        emptyState={areaFilter === 'all' ? t('vendors.empty') : t('vendors.areas.filterEmpty')}
        extraFilters={showAreas ? <Segmented value={areaFilter} onChange={(v) => setAreaFilter(v as AreaFilter)} options={[
          ['all', t('vendors.areas.filterAll')],
          ['none', `${t('vendors.areas.noArea')} (${noAreaCount})`],
          ['backfill', `${t('vendors.areas.guessed')} (${guessedCount})`],
        ]} /> : undefined}
        actions={(vendor) => <div className="flex flex-wrap justify-end gap-1">
          {/* New vendors are approved through their KYC case. */}
          {!vendor.kycExempt && <Link href="/admin/kyc" title={t('vendors.kycReview')} className="inline-flex items-center rounded-md px-2 py-1 text-[var(--color-brand-700)] hover:bg-[var(--color-bg-secondary)]"><BadgeCheck className="h-4 w-4" /></Link>}
          {vendor.kycExempt && vendor.approvalStatus !== 'approved' && <Button variant="ghost" size="sm" title={t('vendors.approve')} disabled={busyId === vendor.id} onClick={() => update(vendor, { approvalStatus: 'approved' })}><CheckCircle2 className="h-4 w-4 text-[var(--color-success-600)]" /></Button>}
          {vendor.kycExempt && vendor.approvalStatus !== 'rejected' && <Button variant="ghost" size="sm" title={t('vendors.reject')} disabled={busyId === vendor.id} onClick={() => update(vendor, { approvalStatus: 'rejected' })}><XCircle className="h-4 w-4 text-[var(--color-error-600)]" /></Button>}
          {showAreas && <Button variant="ghost" size="sm" title={t('vendors.areas.edit')} aria-label={t('vendors.areas.edit')} disabled={busyId === vendor.id} data-testid={`vendor-areas-edit-${vendor.id}`} onClick={() => openAreas(vendor)}><MapPin className="h-4 w-4" /></Button>}
          <Button variant="ghost" size="sm" title={t('vendors.commissionEdit')} disabled={busyId === vendor.id} data-testid={`vendor-commission-edit-${vendor.id}`}
            onClick={() => { setRateTarget(vendor); setRate(String(vendor.commissionPct ?? 10)); setRateError(null); }}><Percent className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" title={t(vendor.accountStatus === 'active' ? 'vendors.suspend' : 'vendors.reactivate')} disabled={busyId === vendor.id} onClick={() => update(vendor, { accountStatus: vendor.accountStatus === 'active' ? 'suspended' : 'active' })}>{vendor.accountStatus === 'active' ? <UserRoundX className="h-4 w-4" /> : <UserRoundCheck className="h-4 w-4" />}</Button>
        </div>}
      />
    </div></Card>}

    <Dialog open={!!areaTarget} onClose={() => setAreaTarget(null)} title={t('vendors.areas.edit')} description={areaTarget?.vendorProfile?.businessName || areaTarget?.displayName || ''} size="lg">
      <div className="space-y-5">
        {areaError && <Alert tone="error">{areaError}</Alert>}
        {/* What the seller typed, so the admin can map it to areas. */}
        <section className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="vendor-areas-written">
          <p className="font-medium text-[var(--color-fg-primary)]">{t('vendors.areas.written')}</p>
          <p><span className="text-[var(--color-fg-tertiary)]">{t('vendors.areas.writtenAddress')}: </span>{areaTarget?.vendorProfile?.address || '—'}</p>
          <p><span className="text-[var(--color-fg-tertiary)]">{t('vendors.areas.writtenRegions')}: </span>{writtenRegions.length ? writtenRegions.join(', ') : '—'}</p>
          {suggestions.length > 0 && <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-fg-tertiary)]">{t('vendors.areas.suggested')}</span>
            {suggestions.map(a => <Button key={a.id} variant="secondary" size="sm" onClick={() => setDelivers(d => [...d, a.id])} data-testid={`vendor-areas-suggest-${a.id}`}>
              {t('vendors.areas.addSuggestion').replace('{area}', a.level === 'country' ? t('vendors.areas.nationwide') : a.name)}
            </Button>)}
          </div>}
        </section>
        <Field label={t('vendors.areas.basedIn')} hint={t('vendors.areas.basedInHint')}>
          <VendorAreaPicker mode="single" areas={areas} value={basedIn} onChange={setBasedIn} label={t('vendors.areas.basedIn')} testId="vendor-based-in" />
        </Field>
        {!basedIn && areaTarget?.vendorProfile?.regionId && !areaTarget.vendorProfile.cityId && <p className="text-xs text-[var(--color-fg-tertiary)]">
          {t('vendors.areas.regionOnly').replace('{area}', areaLabel(areaTarget.vendorProfile.regionId, byId))}
        </p>}
        <Field label={t('vendors.areas.deliversTo')} hint={t('vendors.areas.deliversHint')}>
          <VendorAreaPicker mode="multi" areas={areas} value={delivers} onChange={setDelivers} label={t('vendors.areas.deliversTo')} testId="vendor-delivers-to" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="md" onClick={() => setAreaTarget(null)}>{t('vendors.cancel')}</Button>
        <Button variant="primary" size="md" onClick={saveAreas} loading={busyId === areaTarget?.id} data-testid="vendor-areas-save">{t('vendors.save')}</Button>
      </DialogFooter>
    </Dialog>

    <Dialog open={!!rateTarget} onClose={() => setRateTarget(null)} title={t('vendors.commissionEdit')} description={rateTarget?.vendorProfile?.businessName || rateTarget?.displayName || ''} size="sm">
      <div className="space-y-4">
        {rateError && <Alert tone="error">{rateError}</Alert>}
        <Field label={`${t('vendors.commission')} (%)`} hint={t('vendors.commissionHint')}>
          <input className="ui-input" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="vendor-commission-input" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="md" onClick={() => setRateTarget(null)}>{t('vendors.cancel')}</Button>
        <Button variant="primary" size="md" onClick={saveRate} disabled={busyId === rateTarget?.id} data-testid="vendor-commission-save">{t('vendors.save')}</Button>
      </DialogFooter>
    </Dialog>
  </div>;
}
