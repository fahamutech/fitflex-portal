'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, Save, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PlatformSettings, SubscriptionTierConfig, PayoutBandConfig } from '@/lib/api';
import { SubscriptionTiersEditor, missingSavedKeys, tiersSavable } from '@/components/subscription-tiers-editor';
import { fillIn, settingsTierError, tierInUse, tierSellable } from '@/lib/pass-tiers';
import type { MessageKey } from '@/lib/i18n';
import { ConfirmDialog } from '@/components/dialog';
import { Button, PageHeader, Alert, Spinner, Card, Field, Input, Select, Table, TBody, Td, Th, THead, Tr, ErrorState } from '@/components/shared';
import { whenText } from '@/lib/money-approval';
import { ManualPaymentSettingsCard } from '@/components/manual-payment-settings';

const EMPTY_BAND: PayoutBandConfig = { key: '', label: '', minVisits: 0, maxVisits: 0, payoutTiming: 'weekly', commissionPct: 10 };
const TIMING_OPTIONS: PayoutBandConfig['payoutTiming'][] = ['daily', 'weekly', 'biweekly', 'monthly'];
const PERIOD_OPTIONS: { value: number; label: MessageKey }[] = [
  { value: 1, label: 'settings.period.daily' },
  { value: 7, label: 'settings.period.weekly' },
  { value: 14, label: 'settings.period.biweekly' },
  { value: 30, label: 'settings.period.monthly' },
];
const timingKey = (v: string) => (TIMING_OPTIONS.includes(v as PayoutBandConfig['payoutTiming']) ? `settings.timing.${v}` as MessageKey : null);

export default function SettingsPage() {
  const { token, user, t, locale } = useApp();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading]   = useState(true);
  // Settings didn't load: nothing may be saved (an empty tier list would wipe the tiers).
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);

  // Editable copies
  const [tiers, setTiers]   = useState<SubscriptionTierConfig[]>([]);
  const [bands, setBands]   = useState<PayoutBandConfig[]>([]);
  const [period, setPeriod] = useState(14);
  const [model, setModel]   = useState<'commission' | 'discounted_rate'>('commission');
  const [currency, setCurrency] = useState('TZS');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [newSpecialty, setNewSpecialty] = useState('');
  const [specialtySaving, setSpecialtySaving] = useState(false);
  // Saved tiers the admin already agreed to drop (via the row's remove confirmation).
  const [agreedRemovals, setAgreedRemovals] = useState<string[]>([]);
  // Saved tiers missing from the list that still need the admin's go-ahead before saving.
  const [confirmMissing, setConfirmMissing] = useState<string[] | null>(null);

  const savedKeys = (settings?.subscriptionTiers ?? []).map(x => x.key?.trim() ?? '').filter(Boolean);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const s = await api.getSettings(token);
      setSettings(s);
      setTiers(s.subscriptionTiers);
      setBands(s.payoutBands);
      setPeriod(s.paymentPeriodDays);
      setModel(s.payoutModel);
      setCurrency(s.currency);
      setAgreedRemovals([]);
      setError(null);
      setLoadFailed(false);
      try { const sp = await api.adminGetSpecialties(token); setSpecialties(sp); } catch { /* non-fatal */ }
    } catch {
      // Keep whatever loaded before; with nothing loaded, the page shows only the error and retry.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const canSave = !!settings && !loadFailed;

  async function handleSave(confirmed = false) {
    // Never save what didn't load: that would send an empty tier list.
    if (!token || !canSave) return;
    // A tier with no visits set stops its holders checking in (fitflex-functions#189); an empty list or none on sale is refused (#206).
    if (!tiers.length || !tiers.some(tierSellable)) { setSuccess(null); setError(t('tiers.err.noneOnSale')); return; }
    if (!tiersSavable(tiers)) { setSuccess(null); setError(t('tiers.err.blocked')); return; }
    const missing = missingSavedKeys(savedKeys, tiers).filter(k => !agreedRemovals.includes(k));
    if (missing.length && !confirmed) { setConfirmMissing(missing); return; }
    setConfirmMissing(null);
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      const updated = await api.updateSettings(token, {
        subscriptionTiers: tiers,
        payoutBands: bands,
        paymentPeriodDays: period,
        payoutModel: model,
        currency,
      });
      setSettings(updated);
      setAgreedRemovals([]);
      setSuccess(t('admin.settings.saved'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      // 400 invalid_subscription_tier (fitflex-functions#189, #206): name the tier and what's wrong; nothing was saved.
      // 409 tier_in_use (#206): members still hold the tier; name it by its saved label.
      const held = tierInUse(e);
      if (held) {
        const label = settings?.subscriptionTiers.find(x => x.key === held.tier)?.label || held.tier;
        // Singular for one holder; no number when the server did not say how many.
        const key = held.holders == null ? 'tiers.err.inUseSome' : held.holders === 1 ? 'tiers.err.inUseOne' : 'tiers.err.inUse';
        setError(fillIn(t(key), { tier: label, holders: held.holders ?? '' }));
        return;
      }
      const bad = settingsTierError(e);
      if (bad) { setError(bad.tier ? fillIn(t('tiers.err.server'), { tier: bad.tier, problem: t(bad.key) }) : t(bad.key)); return; }
      setError(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function updateBand(idx: number, field: keyof PayoutBandConfig, value: string | number) {
    setBands(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  }

  async function handleAddSpecialty() {
    if (!token || !newSpecialty.trim()) return;
    setSpecialtySaving(true);
    try {
      const updated = await api.adminSaveSpecialty(token, newSpecialty.trim());
      setSpecialties(updated);
      setNewSpecialty('');
    } catch (e: any) {
      setError(t(e?.status === 409 ? 'settings.specialties.exists' : 'settings.specialties.addFailed'));
    } finally {
      setSpecialtySaving(false);
    }
  }

  async function handleDeleteSpecialty(name: string) {
    if (!token) return;
    try {
      const updated = await api.adminDeleteSpecialty(token, name);
      setSpecialties(updated);
    } catch {
      setError(t('settings.specialties.deleteFailed'));
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const header = (
    <PageHeader
      title={t('admin.settings.title')}
      description={t('admin.settings.description')}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} aria-label={t('settings.refresh')} title={t('settings.refresh')}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="primary" size="sm" onClick={() => handleSave()} disabled={saving || loading || !canSave} data-testid="settings-save">
            <Save aria-hidden="true" className="h-4 w-4" /> {saving ? t('settings.saving') : t('admin.settings.saveAll')}
          </Button>
        </div>
      }
    />
  );

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      </div>
    );
  }

  if (loadFailed) {
    // Nothing is editable or savable until the settings load (H5): no empty tier table, no Save.
    return (
      <div className="space-y-6">
        {header}
        <div data-testid="settings-load-error">
          <ErrorState title={t('settings.loadFailedTitle')} message={t('settings.loadFailedBody')} onRetry={load} retryLabel={t('common.tryAgain')} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {/* Payment Period & Model */}
      <Card>
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.settings.general')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label={t('admin.settings.paymentPeriod')} hint={t('settings.period.hint')}>
              <Select value={period} onChange={e => setPeriod(Number(e.target.value))}>
                {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </Select>
            </Field>
            <Field label={t('admin.settings.payoutModel')} hint={t('settings.model.hint')}>
              <Select value={model} onChange={e => setModel(e.target.value as typeof model)}>
                <option value="commission">{t('settings.model.commission')}</option>
                <option value="discounted_rate">{t('settings.model.discounted')}</option>
              </Select>
            </Field>
            <Field label={t('admin.settings.currency')}>
              <Input value={currency} onChange={e => setCurrency(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      {/* Subscription Tiers */}
      <Card>
        <div className="p-5">
          <SubscriptionTiersEditor
            tiers={tiers} setTiers={setTiers} currency={currency}
            savedKeys={savedKeys} onRemoveSaved={(key) => setAgreedRemovals(prev => [...prev, key])}
          />
        </div>
      </Card>

      {/* Payout Bands */}
      <Card>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.settings.payoutBands')}</h3>
            <Button variant="ghost" size="sm" onClick={() => setBands(prev => [...prev, { ...EMPTY_BAND, key: `band_${Date.now()}`, label: fillIn(t('settings.bands.newLabel'), { n: prev.length + 1 }) }])}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" /> {t('admin.settings.addBand')}
            </Button>
          </div>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('settings.bands.intro')}</p>
          <Table aria-label={t('admin.settings.payoutBands')}>
            <THead>
              <Tr>
                <Th>{t('settings.bands.col.band')}</Th>
                <Th className="!text-right">{t('settings.bands.col.min')}</Th>
                <Th className="!text-right">{t('settings.bands.col.max')}</Th>
                <Th>{t('settings.bands.col.timing')}</Th>
                <Th className="!text-right">{t('settings.bands.col.commission')}</Th>
                <Th className="w-10"><span className="sr-only">{t('settings.bands.remove')}</span></Th>
              </Tr>
            </THead>
            <TBody>
              {bands.map((b, i) => (
                <Tr key={b.key || i}>
                  <Td>
                    <Input size="sm" className="min-w-[7rem]" aria-label={t('settings.bands.col.band')} value={b.label} onChange={e => updateBand(i, 'label', e.target.value)} />
                  </Td>
                  <Td>
                    <Input size="sm" className="text-right font-mono tabular-nums" aria-label={t('settings.bands.col.min')} type="number" value={b.minVisits} onChange={e => updateBand(i, 'minVisits', Number(e.target.value))} />
                  </Td>
                  <Td>
                    <Input size="sm" className="text-right font-mono tabular-nums" aria-label={t('settings.bands.col.max')} type="number" value={b.maxVisits} onChange={e => updateBand(i, 'maxVisits', Number(e.target.value))} placeholder={t('settings.bands.noCap')} />
                  </Td>
                  <Td>
                    <Select size="sm" aria-label={t('settings.bands.col.timing')} value={b.payoutTiming} onChange={e => updateBand(i, 'payoutTiming', e.target.value)}>
                      {TIMING_OPTIONS.map(o => <option key={o} value={o}>{t(timingKey(o)!)}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    <Input size="sm" className="text-right font-mono tabular-nums" aria-label={t('settings.bands.col.commission')} type="number" value={b.commissionPct} onChange={e => updateBand(i, 'commissionPct', Number(e.target.value))} />
                  </Td>
                  <Td>
                    <Button variant="ghost" size="sm" aria-label={t('settings.bands.remove')} title={t('settings.bands.remove')} onClick={() => setBands(prev => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {bands.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-2">
              {bands.map(b => (
                <div key={b.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center min-w-[140px]">
                  <p className="text-xs font-semibold text-[var(--color-fg-primary)]">{b.label}</p>
                  <p className="text-sm text-[var(--color-fg-quaternary)]">{fillIn(t('settings.bands.visits'), { min: b.minVisits, max: b.maxVisits === -1 ? '∞' : b.maxVisits })}</p>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">{timingKey(b.payoutTiming) ? t(timingKey(b.payoutTiming)!) : b.payoutTiming} · {b.commissionPct}%</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Manual payment (Lipa Namba), slice A3: saved on its own, not by "Save all". */}
      <ManualPaymentSettingsCard initial={settings?.manualPayment} />

      {/* Trainer Specialties */}
      <Card>
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('settings.specialties.title')}</h3>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('settings.specialties.intro')}</p>
          <div className="flex flex-wrap gap-2">
            {specialties.map(sp => (
              <span key={sp} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-full)] text-xs font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]">
                {sp}
                <button type="button" onClick={() => handleDeleteSpecialty(sp)} aria-label={fillIn(t('common.remove'), { name: sp })} className="hover:text-[var(--color-error-600)] transition-colors">
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <Field label={t('settings.specialties.add')}>
              <Input
                value={newSpecialty}
                onChange={e => setNewSpecialty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSpecialty(); }}}
                placeholder={t('settings.specialties.placeholder')}
              />
            </Field>
            <Button variant="secondary" size="sm" onClick={handleAddSpecialty} disabled={specialtySaving || !newSpecialty.trim()}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" /> {t('settings.specialties.addButton')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Last updated */}
      {settings?.updatedAt && (
        <p className="text-xs text-[var(--color-fg-quaternary)] text-right">
          {fillIn(t('settings.lastUpdated'), { time: whenText(settings.updatedAt, locale) })}
        </p>
      )}

      <ConfirmDialog
        open={!!confirmMissing}
        onClose={() => setConfirmMissing(null)}
        onConfirm={() => handleSave(true)}
        title={fillIn(t('tiers.missingTitle'), { tiers: (confirmMissing ?? []).join(', ') })}
        description={t('tiers.missingBody')}
        confirmLabel={t('tiers.missingConfirm')}
        tone="danger"
        busy={saving}
      />
    </div>
  );
}
