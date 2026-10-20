'use client';
// Add or edit a customer (S4 §4). Walk-in customers: name, phone, email, address, note. App customers
// (A-02): the name is read-only and there are no contact fields at all; only the note can change.
import { useEffect, useRef, useState } from 'react';
import { api, type VendorCustomer, type VendorCustomerInput, type VendorPhoneDuplicate } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { customerName, errorCode, isEmail, isRefusal, newClientRef, normalisePhone } from '@/lib/vendor';
import { Alert, Button, Field, Input, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { rateLimitText, useOnline } from './bits';

const NAME = { min: 2, max: 80 };
const MAX_ADDRESS = 200;
const MAX_NOTE = 500;
type FieldName = 'name' | 'phone' | 'email' | 'address' | 'note';
type Errors = Partial<Record<FieldName, string>>;
const FIELD_ERRORS: Record<string, [FieldName, MessageKey]> = {
  name_invalid: ['name', 'vendor.customers.nameRequired'],
  phone_invalid: ['phone', 'vendor.customers.phoneInvalid'],
  email_invalid: ['email', 'vendor.customers.emailInvalid'],
  address_too_long: ['address', 'vendor.customers.addressTooLong'],
  note_too_long: ['note', 'vendor.customers.noteTooLong'],
};

export function CustomerFormDialog({
  open, customer, onClose, onSaved, onReload,
}: {
  open: boolean;
  /** null = a new walk-in customer. */
  customer: VendorCustomer | null;
  onClose: () => void;
  onSaved: (customer: VendorCustomer, phoneDuplicate: VendorPhoneDuplicate) => void;
  /** 409 customer_changed: load the latest and start again. */
  onReload?: () => void;
}) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const online = useOnline();
  const app = customer?.source === 'marketplace';
  const [form, setForm] = useState<Record<FieldName, string>>({ name: '', phone: '', email: '', address: '', note: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<{ text: string; reload?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(newClientRef());

  useEffect(() => {
    if (!open) return;
    setForm({
      name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '',
      address: customer?.address ?? '', note: customer?.note ?? '',
    });
    setErrors({}); setAlert(null); setBusy(false);
    clientRef.current = newClientRef();
  }, [open, customer]);

  const set = (field: FieldName) => (value: string) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: undefined }));
    // A different body is a different customer: a fresh reference, so a retry never reuses one for other details.
    clientRef.current = newClientRef();
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!app) {
      const name = form.name.trim();
      if (name.length < NAME.min || name.length > NAME.max) e.name = t('vendor.customers.nameRequired');
      if (form.phone.trim() && !normalisePhone(form.phone)) e.phone = t('vendor.customers.phoneInvalid');
      if (form.email.trim() && !isEmail(form.email.trim())) e.email = t('vendor.customers.emailInvalid');
      if (form.address.trim().length > MAX_ADDRESS) e.address = t('vendor.customers.addressTooLong');
    }
    if (form.note.trim().length > MAX_NOTE) e.note = t('vendor.customers.noteTooLong');
    return e;
  }

  async function save() {
    if (!token) return;
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    setBusy(true); setAlert(null);
    try {
      if (!customer) {
        const body: VendorCustomerInput & { clientRef: string } = {
          clientRef: clientRef.current, name: form.name.trim(), phone: clean(form.phone),
          email: clean(form.email), address: clean(form.address), note: clean(form.note),
        };
        const res = await api.vendorCreateCustomer(token, body);
        onSaved(res.customer, res.phoneDuplicate ?? null);
      } else {
        // Only what changed, with the version we loaded (409 customer_changed when someone else saved first).
        const patch: Partial<VendorCustomerInput> = {};
        const fields: FieldName[] = app ? ['note'] : ['name', 'phone', 'email', 'address', 'note'];
        for (const f of fields) {
          const before = (customer[f] ?? '') as string;
          if (form[f].trim() !== before.trim()) patch[f] = f === 'name' ? form.name.trim() : clean(form[f]);
        }
        if (!Object.keys(patch).length) { onClose(); return; }
        const res = await api.vendorUpdateCustomer(token, customer.id, { ...patch, updatedAt: customer.updatedAt });
        onSaved(res.customer, res.phoneDuplicate ?? null);
      }
    } catch (err) {
      if (!isRefusal(err)) { setAlert({ text: t('vendor.customers.saveOffline') }); return; }
      const code = errorCode(err) ?? '';
      const field = FIELD_ERRORS[code];
      if (field && (!app || field[0] === 'note')) { setErrors({ [field[0]]: t(field[1]) }); return; }
      if (code === 'customer_changed') { setAlert({ text: t('vendor.customers.changedElsewhere'), reload: true }); return; }
      const limited = rateLimitText(err, t);
      if (limited) { setAlert({ text: limited }); return; }
      if (code === 'customer_not_found') { setAlert({ text: t('vendor.customers.notFound') }); return; }
      if (vendor.handleError(err)) { onClose(); return; }
      setAlert({ text: t('vendor.saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={t(customer ? 'vendor.customers.editTitle' : 'vendor.customers.newTitle')}
    >
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }} noValidate data-testid="customer-form">
        {alert && (
          <div className="space-y-2" data-testid="customer-form-alert">
            <Alert tone="error">{alert.text}</Alert>
            {alert.reload && onReload && (
              <Button type="button" variant="secondary" className="min-h-11" onClick={onReload} data-testid="customer-form-reload">{t('vendor.customers.reload')}</Button>
            )}
          </div>
        )}
        {app ? (
          <div className="space-y-1" data-testid="customer-form-app-name">
            <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.customers.name')}</p>
            <p className="font-semibold [overflow-wrap:anywhere]">{customerName(customer, t)}</p>
            <p className="text-xs text-[var(--color-fg-quaternary)]">{t('vendor.customers.appNameHint')}</p>
          </div>
        ) : (
          <>
            <Field label={t('vendor.customers.name')} required error={errors.name}>
              <Input value={form.name} maxLength={NAME.max} autoComplete="off" onChange={e => set('name')(e.target.value)} disabled={busy} data-testid="customer-name" />
            </Field>
            <Field label={t('vendor.customers.phone')} error={errors.phone}>
              <Input type="tel" inputMode="tel" value={form.phone} autoComplete="off" onChange={e => set('phone')(e.target.value)} disabled={busy} data-testid="customer-phone" />
            </Field>
            <Field label={t('vendor.customers.email')} error={errors.email}>
              <Input type="email" value={form.email} autoComplete="off" onChange={e => set('email')(e.target.value)} disabled={busy} data-testid="customer-email" />
            </Field>
            <Field label={t('vendor.customers.address')} error={errors.address}>
              <Input value={form.address} maxLength={MAX_ADDRESS} autoComplete="off" onChange={e => set('address')(e.target.value)} disabled={busy} data-testid="customer-address" />
            </Field>
          </>
        )}
        <Field label={t('vendor.customers.note')} error={errors.note} hint={t('vendor.customers.noteHint')}>
          <Textarea value={form.note} maxLength={MAX_NOTE} rows={3} onChange={e => set('note')(e.target.value)} disabled={busy} data-testid="customer-note" />
        </Field>
        {!app && <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="customer-consent">{t('vendor.customers.consent')}</p>}
        {!online && <Alert tone="warning">{t('vendor.customers.saveOffline')}</Alert>}
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!online} className="min-h-11" data-testid="customer-save">{t('vendor.customers.save')}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
