'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, Save, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../../providers';
import { api, PlatformSettings, SubscriptionTierConfig, PayoutBandConfig } from '@/lib/api';
import { Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { money } from '@/lib/admin-utils';

const EMPTY_TIER: SubscriptionTierConfig = { key: '', label: '', monthlyPrice: 0, visits: 0, gymAccess: 'standard' };
const EMPTY_BAND: PayoutBandConfig = { key: '', label: '', minVisits: 0, maxVisits: 0, payoutTiming: 'weekly', commissionPct: 10 };
const GYM_ACCESS_OPTIONS = ['standard', 'midtier', 'premium', 'luxury_executive'];
const TIMING_OPTIONS: PayoutBandConfig['payoutTiming'][] = ['daily', 'weekly', 'biweekly', 'monthly'];
const PERIOD_OPTIONS = [
  { value: 1, label: 'Daily' },
  { value: 7, label: 'Weekly (7 days)' },
  { value: 14, label: 'Bi-weekly (14 days)' },
  { value: 30, label: 'Monthly (30 days)' },
];

export default function SettingsPage() {
  const { token, user } = useApp();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading]   = useState(true);
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
      setError(null);
      try { const sp = await api.adminGetSpecialties(token); setSpecialties(sp); } catch { /* non-fatal */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setSuccess(null);
    try {
      const updated = await api.updateSettings(token, {
        subscriptionTiers: tiers,
        payoutBands: bands,
        paymentPeriodDays: period,
        payoutModel: model,
        currency,
      });
      setSettings(updated);
      setSuccess('Settings saved successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function updateTier(idx: number, field: keyof SubscriptionTierConfig, value: string | number) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
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
      if (e?.status === 409) setError('Specialty already exists');
      else setError(e instanceof Error ? e.message : 'Failed to add specialty');
    } finally {
      setSpecialtySaving(false);
    }
  }

  async function handleDeleteSpecialty(name: string) {
    if (!token) return;
    try {
      const updated = await api.adminDeleteSpecialty(token, name);
      setSpecialties(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete specialty');
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform Settings" description="Configure subscription tiers, payout bands, and payment periods." />
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Settings"
        description="Configure subscription pricing, payout bands, payment periods, and commission model."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save all'}
            </Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {/* Payment Period & Model */}
      <Card>
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">General</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Payment Period" hint="How often invoices are generated for gym payouts.">
              <select className="ui-input" value={period} onChange={e => setPeriod(Number(e.target.value))}>
                {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Payout Model" hint="How gym partners are compensated.">
              <select className="ui-input" value={model} onChange={e => setModel(e.target.value as typeof model)}>
                <option value="commission">Commission (% deduction)</option>
                <option value="discounted_rate">Discounted Rate (margin from spread)</option>
              </select>
            </Field>
            <Field label="Currency">
              <input className="ui-input" value={currency} onChange={e => setCurrency(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      {/* Subscription Tiers */}
      <Card>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">Subscription Tiers</h3>
            <Button variant="ghost" size="sm" onClick={() => setTiers(prev => [...prev, { ...EMPTY_TIER, key: `tier_${Date.now()}`, label: 'New Tier' }])}>
              <Plus className="h-3.5 w-3.5" /> Add tier
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="ui-table min-w-full">
              <thead>
                <tr>
                  <th>Tier Key</th>
                  <th>Label</th>
                  <th className="text-right">Monthly Price ({currency})</th>
                  <th className="text-right">Visits / Month</th>
                  <th>Gym Access Level</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={t.key || i}>
                    <td>
                      <input className="ui-input !py-1 !text-xs font-mono" value={t.key} onChange={e => updateTier(i, 'key', e.target.value)} />
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs" value={t.label} onChange={e => updateTier(i, 'label', e.target.value)} />
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs text-right font-mono tabular-nums" type="number" value={t.monthlyPrice} onChange={e => updateTier(i, 'monthlyPrice', Number(e.target.value))} />
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs text-right font-mono tabular-nums" type="number" value={t.visits} onChange={e => updateTier(i, 'visits', Number(e.target.value))} placeholder="-1 = unlimited" />
                    </td>
                    <td>
                      <select className="ui-input !py-1 !text-xs" value={t.gymAccess} onChange={e => updateTier(i, 'gymAccess', e.target.value)}>
                        {GYM_ACCESS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setTiers(prev => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tiers.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-2">
              {tiers.map(t => (
                <div key={t.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center min-w-[120px]">
                  <p className="text-xs text-[var(--color-fg-quaternary)]">{t.label}</p>
                  <p className="text-lg font-bold tabular-nums">{money(t.monthlyPrice)}</p>
                  <p className="text-xs text-[var(--color-fg-quaternary)]">{t.visits === -1 ? 'Unlimited' : `${t.visits} visits`}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Payout Bands */}
      <Card>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">Payout Bands</h3>
            <Button variant="ghost" size="sm" onClick={() => setBands(prev => [...prev, { ...EMPTY_BAND, key: `band_${Date.now()}`, label: `Band ${prev.length + 1}` }])}>
              <Plus className="h-3.5 w-3.5" /> Add band
            </Button>
          </div>
          <p className="text-xs text-[var(--color-fg-quaternary)]">
            Payout timing and commission are determined by the number of unique FitFlex visits the gym receives per month.
          </p>
          <div className="overflow-x-auto">
            <table className="ui-table min-w-full">
              <thead>
                <tr>
                  <th>Band</th>
                  <th className="text-right">Min Visits</th>
                  <th className="text-right">Max Visits</th>
                  <th>Payout Timing</th>
                  <th className="text-right">Commission %</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b, i) => (
                  <tr key={b.key || i}>
                    <td>
                      <input className="ui-input !py-1 !text-xs" value={b.label} onChange={e => updateBand(i, 'label', e.target.value)} />
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs text-right font-mono tabular-nums" type="number" value={b.minVisits} onChange={e => updateBand(i, 'minVisits', Number(e.target.value))} />
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs text-right font-mono tabular-nums" type="number" value={b.maxVisits} onChange={e => updateBand(i, 'maxVisits', Number(e.target.value))} placeholder="-1 = no cap" />
                    </td>
                    <td>
                      <select className="ui-input !py-1 !text-xs" value={b.payoutTiming} onChange={e => updateBand(i, 'payoutTiming', e.target.value)}>
                        {TIMING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="ui-input !py-1 !text-xs text-right font-mono tabular-nums" type="number" value={b.commissionPct} onChange={e => updateBand(i, 'commissionPct', Number(e.target.value))} />
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setBands(prev => prev.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bands.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-2">
              {bands.map(b => (
                <div key={b.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center min-w-[140px]">
                  <p className="text-xs font-semibold text-[var(--color-fg-primary)]">{b.label}</p>
                  <p className="text-sm text-[var(--color-fg-quaternary)]">{b.minVisits}–{b.maxVisits === -1 ? '∞' : b.maxVisits} visits</p>
                  <p className="text-xs text-[var(--color-fg-quaternary)] capitalize">{b.payoutTiming} · {b.commissionPct}%</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Trainer Specialties */}
      <Card>
        <div className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">Trainer Specialties</h3>
          <p className="text-xs text-[var(--color-fg-quaternary)]">These specialties appear as selectable chips when creating or editing a trainer profile.</p>
          <div className="flex flex-wrap gap-2">
            {specialties.map(sp => (
              <span key={sp} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-full)] text-xs font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]">
                {sp}
                <button type="button" onClick={() => handleDeleteSpecialty(sp)} className="hover:text-[var(--color-error-600)] transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <Field label="Add specialty">
              <input
                className="ui-input"
                value={newSpecialty}
                onChange={e => setNewSpecialty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSpecialty(); }}}
                placeholder="e.g. Pilates, HIIT"
              />
            </Field>
            <Button variant="secondary" size="sm" onClick={handleAddSpecialty} disabled={specialtySaving || !newSpecialty.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      </Card>

      {/* Last updated */}
      {settings?.updatedAt && (
        <p className="text-xs text-[var(--color-fg-quaternary)] text-right">
          Last updated: {new Date(settings.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
