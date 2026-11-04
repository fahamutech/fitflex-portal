'use client';
// Add or edit a supplier (S9 §4.6, §5.4). Only changed fields are sent on edit; an emptied optional field is null.
import { useEffect, useState } from 'react';
import type { MessageKey } from '@/lib/i18n';
import { errorBody, errorCode, fmt, isRefusal } from '@/lib/vendor';
import { purchasesApi, type Supplier, type SupplierInput } from '@/lib/vendor-purchases';
import { Alert, Button, Field, Input, Textarea } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';
import { rateLimitText, useOnline } from '../customers/bits';
import { linkCls } from './bits';

type FieldName = 'name' | 'phone' | 'contactPerson' | 'email' | 'address' | 'tin' | 'note';
const FIELDS: FieldName[] = ['name', 'phone', 'contactPerson', 'email', 'address', 'tin', 'note'];
const MAX: Record<FieldName, number> = { name: 120, phone: 20, contactPerson: 120, email: 254, address: 300, tin: 20, note: 500 };
const LABEL: Record<FieldName, MessageKey> = {
  name: 'vendor.suppliers.name', phone: 'vendor.suppliers.phone', contactPerson: 'vendor.suppliers.contactPerson', email: 'vendor.suppliers.email',
  address: 'vendor.suppliers.address', tin: 'vendor.suppliers.tin', note: 'vendor.suppliers.note',
};
const empty = (): Record<FieldName, string> => ({ name: '', phone: '', contactPerson: '', email: '', address: '', tin: '', note: '' });

export function SupplierFormDialog({
  open, supplier, initialName = '', onClose, onSaved, onOpenSupplier,
}: {
  open: boolean;
  /** null = a new supplier. */
  supplier: Supplier | null;
  initialName?: string;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
  /** 409 duplicate_supplier: open the one that already has the name. */
  onOpenSupplier?: (id: string) => void;
}) {
  const { token, t } = useApp();
  const vendor = useVendor();
  const online = useOnline();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const f = empty();
    if (supplier) for (const k of FIELDS) f[k] = (supplier[k] ?? '') as string;
    else f.name = initialName;
    setForm(f); setErrors({}); setDuplicate(null); setAlert(null); setBusy(false);
  }, [open, supplier, initialName]);

  const set = (k: FieldName, v: string) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); if (k === 'name') setDuplicate(null); };

  function validate() {
    const e: Partial<Record<FieldName, string>> = {};
    const name = form.name.trim();
    if (name.length < 2 || name.length > 120) e.name = t('vendor.suppliers.nameRequired');
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = t('vendor.suppliers.emailInvalid');
    if (form.phone.trim() && !/^\+?\d{7,15}$/.test(form.phone.trim().replace(/[\s\-().]/g, ''))) e.phone = t('vendor.suppliers.phoneInvalid');
    for (const k of FIELDS) if (!e[k] && form[k].trim().length > MAX[k]) e[k] = fmt(t('vendor.suppliers.tooLong'), { max: MAX[k] });
    return e;
  }

  async function save() {
    if (!token) return;
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    const body: SupplierInput = {};
    for (const k of FIELDS) {
      const now = k === 'name' ? form.name.trim() : clean(form[k]);
      if (!supplier || (supplier[k] ?? null) !== now) (body as Record<string, unknown>)[k] = now;
    }
    if (supplier && !Object.keys(body).length) { onClose(); return; }
    setBusy(true); setAlert(null); setDuplicate(null);
    try {
      const res = supplier ? await purchasesApi.updateSupplier(token, supplier.id, body) : await purchasesApi.createSupplier(token, body);
      onSaved(res.supplier);
    } catch (err) {
      if (!isRefusal(err)) { setAlert(t('vendor.purchases.err.server')); return; }
      const code = errorCode(err);
      const b = errorBody<{ supplierId?: string; field?: string; max?: number }>(err);
      if (code === 'duplicate_supplier') {
        setErrors({ name: fmt(t('vendor.purchases.err.duplicateSupplier'), { name: form.name.trim() }) });
        if (b?.supplierId) setDuplicate({ id: b.supplierId, name: form.name.trim() });
      } else if (code === 'name_required' || code === 'name_too_long') setErrors({ name: t('vendor.suppliers.nameRequired') });
      else if (code === 'invalid_phone') setErrors({ phone: t('vendor.suppliers.phoneInvalid') });
      else if (code === 'invalid_email') setErrors({ email: t('vendor.suppliers.emailInvalid') });
      else if (code === 'field_too_long' && b?.field && FIELDS.includes(b.field as FieldName)) setErrors({ [b.field]: fmt(t('vendor.suppliers.tooLong'), { max: b.max ?? MAX[b.field as FieldName] }) });
      else if (code === 'supplier_not_found') setAlert(t('vendor.suppliers.notFound'));
      else {
        const limited = rateLimitText(err, t);
        if (limited) setAlert(limited);
        else if (vendor.handleError(err)) onClose();
        else setAlert(t('vendor.purchases.err.server'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t(supplier ? 'vendor.suppliers.edit' : 'vendor.suppliers.add')} sheetOnMobile testId="supplier-form-dialog">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }} noValidate data-testid="supplier-form">
        {alert && <Alert tone="error">{alert}</Alert>}
        {FIELDS.map(k => (
          <div key={k} className="space-y-1">
            <Field label={t(LABEL[k])} required={k === 'name'} error={errors[k]} hint={k === 'phone' ? t('vendor.suppliers.phoneHint') : undefined}>
              {k === 'note' || k === 'address'
                ? <Textarea value={form[k]} rows={2} maxLength={MAX[k]} onChange={e => set(k, e.target.value)} disabled={busy} data-testid={`supplier-${k}`} />
                : <Input value={form[k]} maxLength={MAX[k]} autoComplete="off" type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
                    inputMode={k === 'phone' ? 'tel' : undefined} onChange={e => set(k, e.target.value)} disabled={busy} data-testid={`supplier-${k}`} />}
            </Field>
            {k === 'name' && duplicate && onOpenSupplier && (
              <button type="button" className={linkCls} onClick={() => onOpenSupplier(duplicate.id)} data-testid="supplier-open-duplicate">
                {fmt(t('vendor.suppliers.openDuplicate'), { name: duplicate.name })}
              </button>
            )}
          </div>
        ))}
        {!online && <Alert tone="warning">{t('vendor.purchases.offlineAction')}</Alert>}
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="min-h-11">{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!online} className="min-h-11" data-testid="supplier-save">{t('vendor.suppliers.save')}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
