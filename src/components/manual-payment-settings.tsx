'use client';
// Slice A3: the Lipa Namba members pay manually (PUT /admin/settings `manualPayment`).
// Saved on its own so "Save all" on the settings page never touches it.
import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ApiError, ManualPaymentSettings, PaymentOptions } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';
import type { MessageKey } from '@/lib/i18n';

/** Network brand names: stored and shown as they are in both languages. */
export const MANUAL_PAY_NETWORKS = ['M-Pesa', 'Airtel Money', 'Mixx by Yas', 'HaloPesa'] as const;
const OTHER = '__other__';

type FieldName = 'lipaNamba' | 'accountName' | 'network' | 'instructions.en' | 'instructions.sw';
type Form = { lipaNamba: string; accountName: string; network: string; otherNetwork: string; en: string; sw: string };

const EMPTY: Form = { lipaNamba: '', accountName: '', network: '', otherNetwork: '', en: '', sw: '' };

function toForm(s: ManualPaymentSettings | null | undefined): Form {
  if (!s) return EMPTY;
  const net = s.network || '';
  const known = (MANUAL_PAY_NETWORKS as readonly string[]).includes(net);
  return {
    lipaNamba: s.lipaNamba || '',
    accountName: s.accountName || '',
    network: !net ? '' : known ? net : OTHER,
    otherNetwork: known ? '' : net,
    en: s.instructions?.en || '',
    sw: s.instructions?.sw || '',
  };
}

const FIELD_ERROR: Record<FieldName, MessageKey> = {
  lipaNamba: 'manualPay.err.lipaNamba',
  accountName: 'manualPay.err.accountName',
  network: 'manualPay.err.network',
  'instructions.en': 'manualPay.err.instructions',
  'instructions.sw': 'manualPay.err.instructions',
};

type LiveState = 'live' | 'flagOff' | 'notConfigured' | 'unknown' | null;

export function ManualPaymentSettingsCard({ initial }: { initial: ManualPaymentSettings | null | undefined }) {
  const { token, t } = useApp();
  const [saved, setSaved] = useState<ManualPaymentSettings | null>(initial ?? null);
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<FieldName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [live, setLive] = useState<LiveState>(null);

  // Only when the saved details really change (not on every settings reload / "Save all").
  const initialKey = JSON.stringify(initial ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSaved(initial ?? null); setForm(toForm(initial)); }, [initialKey]);

  const checkLive = async () => {
    if (!token) return;
    try {
      const opts: PaymentOptions = await api.paymentOptions(token);
      setLive(!opts?.manual ? 'flagOff' : opts.manual.enabled ? 'live' : 'notConfigured');
    } catch {
      setLive('unknown');
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkLive(); }, [token]);

  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setFieldError(null); setError(null); };

  async function write(value: ManualPaymentSettings | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setFieldError(null);
    setNotice(null);
    try {
      const updated = await api.updateSettings(token, { manualPayment: value });
      const next = updated?.manualPayment ?? null;
      setSaved(next);
      setForm(toForm(next));
      setNotice(t(value ? 'manualPay.saved' : 'manualPay.cleared'));
      await checkLive();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; field?: string } | null) : null;
      if (body?.error === 'manual_payment_invalid') {
        const f = body.field as FieldName | undefined;
        if (f && f in FIELD_ERROR) setFieldError(f);
        else setError(t('manualPay.err.generic'));
      } else {
        setError(t('manualPay.err.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    if (!form.lipaNamba.trim() || !form.accountName.trim()) { setError(t('manualPay.required')); return; }
    const network = form.network === OTHER ? form.otherNetwork.trim() : form.network;
    const en = form.en.trim();
    const sw = form.sw.trim();
    write({
      lipaNamba: form.lipaNamba.trim(),
      accountName: form.accountName.trim(),
      network: network || null,
      instructions: en || sw ? { en, sw } : null,
    });
  }

  const err = (f: FieldName) => (fieldError === f ? t(FIELD_ERROR[f]) : undefined);
  const liveTone = live === 'live' ? 'success' : live === 'unknown' ? 'warning' : 'info';

  return (
    <Card data-testid="manual-payment-settings">
      <div className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('manualPay.title')}</h3>
        <p className="text-xs text-[var(--color-fg-quaternary)]">{t('manualPay.intro')}</p>
        {/* One message: after a save, "saved" and whether it is live for members share the same alert. */}
        {(live || notice) && (
          <div data-testid="manual-pay-live">
            <Alert tone={live ? liveTone : 'success'} className="text-xs">
              {notice && <span data-testid="manual-pay-notice">{notice} </span>}
              {live && t(`manualPay.status.${live}` as MessageKey)}
            </Alert>
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {!saved && <p className="text-xs text-[var(--color-fg-tertiary)]">{t('manualPay.notSaved')}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('manualPay.lipaNamba')} hint={t('manualPay.lipaNambaHint')} error={err('lipaNamba')} required>
            <Input className="font-mono" inputMode="numeric" value={form.lipaNamba} onChange={e => set({ lipaNamba: e.target.value })} />
          </Field>
          <Field label={t('manualPay.accountName')} hint={t('manualPay.accountNameHint')} error={err('accountName')} required>
            <Input value={form.accountName} onChange={e => set({ accountName: e.target.value })} />
          </Field>
          <Field label={t('manualPay.network')} error={form.network === OTHER ? undefined : err('network')}>
            <Select value={form.network} onChange={e => set({ network: e.target.value })}>
              <option value="">{t('manualPay.networkNone')}</option>
              {MANUAL_PAY_NETWORKS.map(n => <option key={n} value={n}>{n}</option>)}
              <option value={OTHER}>{t('manualPay.networkOther')}</option>
            </Select>
          </Field>
        </div>
        {form.network === OTHER && (
          <Field label={t('manualPay.networkOtherLabel')} error={err('network')}>
            <Input value={form.otherNetwork} maxLength={60} onChange={e => set({ otherNetwork: e.target.value })} />
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('manualPay.instructionsEn')} hint={t('manualPay.instructionsHint')} error={err('instructions.en')}>
            <Textarea lang="en" value={form.en} onChange={e => set({ en: e.target.value })} />
          </Field>
          <Field label={t('manualPay.instructionsSw')} hint={t('manualPay.instructionsHint')} error={err('instructions.sw')}>
            <Textarea lang="sw" value={form.sw} onChange={e => set({ sw: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {saved && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmClear(true)} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> {t('manualPay.clear')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleSave} disabled={busy}>
            <Save className="h-3.5 w-3.5" /> {busy ? t('manualPay.saving') : t('manualPay.save')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => { setConfirmClear(false); await write(null); }}
        title={t('manualPay.clearTitle')}
        description={t('manualPay.clearBody')}
        confirmLabel={t('manualPay.clear')}
        busy={busy}
      />
    </Card>
  );
}
