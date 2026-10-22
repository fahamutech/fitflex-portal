'use client';
import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, Ban, ChevronDown, ChevronRight, Clock, XCircle } from 'lucide-react';
import { api, type EventsOptions, type KycChecklistItem, type KycItemStatus, type MyKyc, type MyKycAgreement } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { messages } from '@/lib/i18n';
import { ITEM_STATUS, itemLabel as kycItemLabel } from '@/lib/kyc';
import { errorBody, errorCode, errorKey, eventDay, fmt, isEmail, isTzPhone } from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, Input, Select, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useOrganizer } from '@/components/organizer-context';
import { useApp } from '../../app/providers';

const has = (key: string): key is MessageKey => key in messages.en;
/** "business.tin" → the translated item label, else the reviewer's label from src/lib/kyc.ts. */
function useItemLabel() {
  const { t } = useApp();
  return (key: string) => {
    const field = key.split('.').pop() ?? key;
    const k = `organizer.kyc.item.${field}`;
    return has(k) ? t(k) : kycItemLabel(key);
  };
}
const statusKey = (s: KycItemStatus) => `organizer.kyc.itemStatus.${s}` as MessageKey;
const reasonLabel = (t: (k: MessageKey) => string, code: string | null | undefined, note: string | null | undefined) => {
  if (note) return note;
  const k = `kyc.reason.${code ?? ''}`;
  return code ? (has(k) ? t(k) : code) : t('organizer.status.noReason');
};

// ── State A: request organizer access (§4.3) ──
export function OrganizerIntro({ onCreated }: { onCreated: () => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const [options, setOptions] = useState<EventsOptions | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Africa/Dar_es_Salaam');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notAllowed, setNotAllowed] = useState(false);

  useEffect(() => { api.eventsOptions().then(setOptions).catch(() => setOptions(null)); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const next: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) next.name = fmt(t('events.validation.length'), { min: 2, max: 80 });
    if (!isTzPhone(phone)) next.phone = t('events.validation.phone');
    if (email.trim() && !isEmail(email)) next.email = t('events.validation.email');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true); setNotAllowed(false);
    try {
      await api.createOrganizer(token, { name: name.trim(), timezone, contactPhone: phone.trim(), ...(email.trim() ? { contactEmail: email.trim() } : {}) });
      toast.success(t('organizer.intro.created'));
      onCreated();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'organizer_exists') { onCreated(); return; }
      if (code === 'invalid_name') { setErrors({ name: fmt(t('events.validation.length'), { min: 2, max: 80 }) }); return; }
      if (code === 'invalid_phone') { setErrors({ phone: t('events.validation.phone') }); return; }
      if (code === 'persona_not_allowed') { setNotAllowed(true); return; }
      toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }

  const timezones = options?.timezones?.length ? options.timezones : ['Africa/Dar_es_Salaam'];
  return (
    <Card data-testid="organizer-intro">
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('organizer.intro.title')}</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.intro.body')}</p>
          <p className="text-sm text-[var(--color-fg-quaternary)]">{t('organizer.intro.needList')}</p>
          {notAllowed && <Alert tone="error">{t('organizer.intro.notAllowed')}</Alert>}
          <Field label={t('organizer.intro.name')} required error={errors.name}>
            <Input value={name} onChange={e => setName(e.target.value)} maxLength={80} data-testid="intro-name" />
          </Field>
          <Field label={t('organizer.intro.timezone')} required>
            <Select value={timezone} onChange={e => setTimezone(e.target.value)} data-testid="intro-timezone">
              {timezones.map(z => <option key={z} value={z}>{z}</option>)}
            </Select>
          </Field>
          <Field label={t('organizer.intro.phone')} required error={errors.phone}>
            <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+255…" data-testid="intro-phone" />
          </Field>
          <Field label={t('organizer.intro.email')} error={errors.email}>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="intro-email" />
          </Field>
          <Button type="submit" loading={busy} data-testid="intro-submit">{t('organizer.intro.submit')}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── States B and C: checklist over /me/kyc/* (§4.3) ──
type SectionProps = { kyc: MyKyc; items: KycChecklistItem[]; editable: (item: KycChecklistItem) => boolean; onSaved: (next: MyKyc) => void };

function SectionCard({ titleKey, items, defaultOpen, children, testId }: { titleKey: MessageKey; items: KycChecklistItem[]; defaultOpen: boolean; children: ReactNode; testId: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(defaultOpen);
  const worst: KycItemStatus = items.every(i => i.status === 'complete' || i.optional) ? 'complete'
    : items.some(i => ['rejected', 'expired', 'failed'].includes(i.status)) ? 'rejected'
    : items.some(i => i.status === 'submitted') ? 'submitted'
    : items.some(i => i.status === 'missing' && !i.optional) ? 'missing' : 'incomplete';
  return (
    <Card data-testid={testId}>
      <CardHeader className="p-0">
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex min-h-11 w-full items-center justify-between gap-3 px-6 py-4 text-left">
          <span className="flex items-center gap-2 text-base font-semibold text-[var(--color-fg-primary)]">
            {open ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
            {t(titleKey)}
          </span>
          <Badge tone={ITEM_STATUS[worst].tone}>{t(statusKey(worst))}</Badge>
        </button>
      </CardHeader>
      {open && <CardContent className="space-y-4">{children}</CardContent>}
    </Card>
  );
}

function ItemRow({ item, children }: { item: KycChecklistItem; children?: ReactNode }) {
  const { t } = useApp();
  const label = useItemLabel();
  const st = ITEM_STATUS[item.status] ?? ITEM_STATUS.missing;
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-border-secondary)] py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between" data-testid={`kyc-item-${item.key.replace(/\./g, '-')}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-fg-primary)]">
          {label(item.key)} {item.optional && <span className="text-xs font-normal text-[var(--color-fg-quaternary)]">· {t('organizer.kyc.optional')}</span>}
        </p>
        {item.requirementKey === 'event_permit' && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('organizer.kyc.eventPermitHint')}</p>}
        {item.note && <p className="text-xs text-[var(--color-warning-800)]">{item.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={st.tone}>{t(statusKey(item.status))}</Badge>
        {children}
      </div>
    </div>
  );
}

function BusinessSection({ kyc, items, editable, onSaved }: SectionProps) {
  const { t, token } = useApp();
  const toast = useToast();
  const c = kyc.case;
  const [form, setForm] = useState({
    legalName: c?.legalName ?? '', tradingName: c?.tradingName ?? '', registrationNumber: c?.registrationNumber ?? '', tin: c?.tin ?? '',
    line1: c?.registeredAddress?.line1 ?? '', city: c?.registeredAddress?.city ?? '', region: c?.registeredAddress?.region ?? '', country: c?.registeredAddress?.country ?? 'TZ',
  });
  const [busy, setBusy] = useState(false);
  const canEdit = items.some(editable);
  const field = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value })), disabled: !canEdit || busy });
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const next = await api.myKycBusiness(token, {
        legalName: form.legalName || null, tradingName: form.tradingName || null, registrationNumber: form.registrationNumber || null, tin: form.tin || null,
        registeredAddress: form.line1 || form.city ? { line1: form.line1, city: form.city, region: form.region, country: form.country } : null,
      });
      onSaved(next); toast.success(t('organizer.kyc.saved'));
    } catch (err) { toast.error(t(errorKey(err))); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      {items.map(i => <ItemRow key={i.key} item={i} />)}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('organizer.kyc.item.legalName')} required><Input {...field('legalName')} data-testid="kyc-legalName" /></Field>
        <Field label={t('organizer.kyc.item.tradingName')}><Input {...field('tradingName')} /></Field>
        <Field label={t('organizer.kyc.item.registrationNumber')}><Input {...field('registrationNumber')} /></Field>
        <Field label={t('organizer.kyc.item.tin')}><Input {...field('tin')} /></Field>
        <Field label={t('organizer.kyc.addr.line1')}><Input {...field('line1')} /></Field>
        <Field label={t('organizer.kyc.addr.city')}><Input {...field('city')} /></Field>
        <Field label={t('organizer.kyc.addr.region')}><Input {...field('region')} /></Field>
        <Field label={t('organizer.kyc.addr.country')}><Input {...field('country')} /></Field>
      </div>
      {canEdit && <Button type="submit" variant="secondary" loading={busy} data-testid="kyc-save-business">{t('organizer.kyc.save')}</Button>}
    </form>
  );
}

function RepresentativeSection({ kyc, items, editable, onSaved }: SectionProps) {
  const { t, token } = useApp();
  const toast = useToast();
  const person = kyc.people.find(p => /representative/.test(p.role)) ?? null;
  const [form, setForm] = useState({ fullName: person?.fullName ?? '', idNumber: person?.idNumber ?? '', nationality: person?.nationality ?? '', phone: person?.phone ?? '', email: person?.email ?? '', position: person?.position ?? '' });
  const [busy, setBusy] = useState(false);
  const canEdit = items.some(editable);
  const field = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value })), disabled: !canEdit || busy });
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) body[k] = v || null;
      const next = await api.myKycPerson(token, 'representative', body);
      onSaved(next); toast.success(t('organizer.kyc.saved'));
    } catch (err) { toast.error(t(errorKey(err))); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      {items.filter(i => !i.requirementKey).map(i => <ItemRow key={i.key} item={i} />)}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('organizer.kyc.item.fullName')} required><Input {...field('fullName')} data-testid="kyc-fullName" /></Field>
        <Field label={t('organizer.kyc.item.idNumber')} required><Input {...field('idNumber')} /></Field>
        <Field label={t('organizer.kyc.item.nationality')}><Input {...field('nationality')} /></Field>
        <Field label={t('organizer.kyc.item.position')}><Input {...field('position')} /></Field>
        <Field label={t('organizer.kyc.item.phone')}><Input type="tel" {...field('phone')} /></Field>
        <Field label={t('organizer.kyc.item.email')}><Input type="email" {...field('email')} /></Field>
      </div>
      {canEdit && <Button type="submit" variant="secondary" loading={busy} data-testid="kyc-save-representative">{t('organizer.kyc.save')}</Button>}
    </form>
  );
}

function DocumentRow({ item, kyc, canEdit, onSaved }: { item: KycChecklistItem; kyc: MyKyc; canEdit: boolean; onSaved: (n: MyKyc) => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const label = useItemLabel();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const key = item.requirementKey ?? item.key.split('.').pop()!;
  const doc = kyc.documents.filter(d => d.requirementKey === key && d.status !== 'superseded').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  async function onFile(file: File | undefined) {
    if (!file || !token) return;
    if (file.size > 10 * 1024 * 1024) { toast.error(t('organizer.kyc.fileRules')); return; }
    setBusy(true);
    try { onSaved(await api.myKycUploadDocument(token, key, file)); toast.success(t('organizer.kyc.uploaded')); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return (
    <ItemRow item={item}>
      {doc?.hasFile && <span className="text-xs text-[var(--color-fg-quaternary)]" title={doc.fileName ?? ''}>{doc.fileName || t('organizer.kyc.fileOnFile')}</span>}
      {canEdit && (
        <>
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="sr-only" aria-label={fmt(t('organizer.kyc.upload'), { item: label(item.key) })}
            onChange={e => void onFile(e.target.files?.[0])} data-testid={`kyc-file-${key}`} />
          <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()} aria-label={fmt(t('organizer.kyc.upload'), { item: label(item.key) })} data-testid={`kyc-upload-${key}`}>
            {doc?.hasFile ? t('organizer.kyc.replace') : fmt(t('organizer.kyc.upload'), { item: label(item.key) })}
          </Button>
        </>
      )}
    </ItemRow>
  );
}

function DocumentsSection({ kyc, items, editable, onSaved }: SectionProps) {
  const { t } = useApp();
  return (
    <div>
      {items.map(i => <DocumentRow key={i.key} item={i} kyc={kyc} canEdit={editable(i)} onSaved={onSaved} />)}
      <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">{t('organizer.kyc.fileRules')}</p>
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = { mpesa: 'M-Pesa', airtel_money: 'Airtel Money', mixx: 'Mixx by Yas', halopesa: 'HaloPesa' };
function PayoutSection({ kyc, items, editable, onSaved }: SectionProps) {
  const { t, token } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ method: 'mobile_money' as 'bank' | 'mobile_money', provider: 'mpesa', accountName: '', accountNumber: '', branch: '' });
  const [busy, setBusy] = useState(false);
  const canEdit = items.some(editable);
  const accounts = kyc.settlementAccounts.filter(a => a.status !== 'disabled');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const next = await api.myKycAddSettlementAccount(token, { method: form.method, provider: form.provider, accountName: form.accountName, accountNumber: form.accountNumber, ...(form.branch ? { branch: form.branch } : {}) });
      onSaved(next); toast.success(t('organizer.kyc.saved'));
      setForm(f => ({ ...f, accountName: '', accountNumber: '', branch: '' }));
    } catch (err) { toast.error(t(errorKey(err))); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      {items.map(i => <ItemRow key={i.key} item={i} />)}
      {accounts.length > 0 && (
        <ul className="space-y-1 text-sm text-[var(--color-fg-secondary)]" data-testid="kyc-payout-accounts">
          {accounts.map(a => <li key={a.id}>{PROVIDER_LABEL[a.provider] ?? a.provider} · •••• {a.accountNumber.replace(/\D/g, '').slice(-3)} · {a.accountName}</li>)}
        </ul>
      )}
      {canEdit && accounts.length === 0 && (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Field label={t('organizer.kyc.payout.method')} required>
            <Select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value as 'bank' | 'mobile_money', provider: e.target.value === 'bank' ? '' : 'mpesa' }))} data-testid="kyc-payout-method">
              <option value="mobile_money">{t('organizer.kyc.payout.mobileMoney')}</option>
              <option value="bank">{t('organizer.kyc.payout.bank')}</option>
            </Select>
          </Field>
          <Field label={t('organizer.kyc.payout.provider')} required>
            {form.method === 'mobile_money'
              ? <Select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>{Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              : <Input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} />}
          </Field>
          <Field label={t('organizer.kyc.payout.accountName')} required><Input value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} data-testid="kyc-payout-name" /></Field>
          <Field label={t('organizer.kyc.payout.accountNumber')} required><Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} inputMode="numeric" data-testid="kyc-payout-number" /></Field>
          {form.method === 'bank' && <Field label={t('organizer.kyc.payout.branch')}><Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></Field>}
          <div className="sm:col-span-2"><Button type="submit" variant="secondary" loading={busy} disabled={!form.accountName || !form.accountNumber || !form.provider} data-testid="kyc-save-payout">{t('organizer.kyc.payout.add')}</Button></div>
        </form>
      )}
    </div>
  );
}

function AgreementsSection({ items, editable, onSaved }: SectionProps) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const [agreements, setAgreements] = useState<MyKycAgreement[] | null>(null);
  const [reading, setReading] = useState<MyKycAgreement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { if (token) api.myKycAgreements(token, locale).then(r => setAgreements(r.agreements ?? [])).catch(() => setAgreements([])); }, [token, locale]);
  useEffect(() => { load(); }, [load]);
  const canEdit = items.some(editable);
  async function accept(a: MyKycAgreement) {
    if (!token) return;
    setBusy(a.agreementType);
    try { onSaved(await api.myKycAcceptAgreement(token, { agreementType: a.agreementType, version: a.version })); load(); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(null); }
  }
  return (
    <div className="space-y-2">
      {items.map(i => <ItemRow key={i.key} item={i} />)}
      {(agreements ?? []).map(a => (
        <div key={a.agreementType} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between" data-testid={`kyc-agreement-${a.agreementType}`}>
          <Checkbox
            label={fmt(t('organizer.kyc.agreement.accept'), { title: a.title })}
            description={a.acceptedAt ? fmt(t('organizer.kyc.agreement.accepted'), { date: eventDay(a.acceptedAt, 'Africa/Dar_es_Salaam', locale) }) : a.reference}
            checked={!!a.acceptedAt}
            disabled={!!a.acceptedAt || !canEdit || busy === a.agreementType}
            onChange={e => { if (e.target.checked) void accept(a); }}
          />
          <Button type="button" variant="link" size="sm" onClick={() => setReading(a)}>{t('organizer.kyc.agreement.read')}</Button>
        </div>
      ))}
      <Dialog open={!!reading} onClose={() => setReading(null)} title={reading?.title ?? ''} description={reading?.reference} size="lg">
        <div className="space-y-3 text-sm text-[var(--color-fg-secondary)]">
          {reading?.sections.map((s, i) => (<section key={i}><h3 className="font-semibold text-[var(--color-fg-primary)]">{s.heading}</h3><p className="mt-1 whitespace-pre-line">{s.text}</p></section>))}
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => setReading(null)}>{t('common.close')}</Button></DialogFooter>
      </Dialog>
    </div>
  );
}

const SECTION_TITLE: Record<string, MessageKey> = {
  business: 'organizer.kyc.sectionBusiness', representative: 'organizer.kyc.sectionRepresentative', documents: 'organizer.kyc.sectionDocuments',
  settlement: 'organizer.kyc.sectionPayout', agreements: 'organizer.kyc.sectionAgreements',
};

/** The checklist (state B) or the status card over a collapsed read-only checklist (state C). */
export function OrganizerChecklist() {
  const { t, token, locale } = useApp();
  const org = useOrganizer();
  const toast = useToast();
  const label = useItemLabel();
  const [kyc, setKyc] = useState<MyKyc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'submit' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);
  const [missingHint, setMissingHint] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setKyc(await api.myKyc(token)); } catch (err) { setError(t(errorKey(err))); }
  }, [token, t]);
  useEffect(() => { void load(); }, [load]);

  const organizer = org.organizer!;
  const isOwner = org.role === 'owner';
  const caseStatus = kyc?.case?.status ?? 'draft';
  const editableAll = isOwner && (!kyc?.case || caseStatus === 'draft');
  const infoRequested = isOwner && caseStatus === 'info_requested';
  const editable = (item: KycChecklistItem) => editableAll || (infoRequested && item.status !== 'complete');
  const showChecklistFirst = organizer.status === 'draft' || (organizer.status === 'pending_review' && caseStatus === 'info_requested');

  async function doSubmit() {
    if (!token) return;
    setBusy(true);
    try {
      setKyc(await api.myKycSubmit(token)); setConfirm(null); setMissingHint(null);
      toast.success(t('organizer.kyc.submitted')); await org.reload();
    } catch (err) {
      const body = errorBody<{ missing?: string[] }>(err);
      if (errorCode(err) === 'kyc_incomplete') { setMissingHint(body?.missing ?? []); setConfirm(null); await load(); return; }
      toast.error(t(errorKey(err)));
    } finally { setBusy(false); }
  }
  async function doWithdraw() {
    if (!token) return;
    setBusy(true);
    try { setKyc(await api.myKycWithdraw(token)); setConfirm(null); toast.success(t('organizer.kyc.withdrawn')); await org.reload(); }
    catch (err) { toast.error(t(errorKey(err))); }
    finally { setBusy(false); }
  }

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!kyc) return <div aria-busy="true" className="space-y-3"><Card><CardContent><div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-gray-200)]" /></CardContent></Card></div>;

  const missing = missingHint ?? kyc.checklist.missing ?? [];
  const ready = kyc.checklist.readyToSubmit && missing.length === 0;
  const reason = reasonLabel(t, kyc.case?.reasonCode, kyc.case?.reasonNote ?? organizer.statusReason);

  const statusCard = organizer.status === 'pending_review' && caseStatus !== 'info_requested' ? (
    <StatusCard icon={<Clock />} title={t('organizer.status.pendingTitle')} body={t('organizer.status.pendingBody')} testId="organizer-status-pending">
      {isOwner && caseStatus === 'submitted' && <Button variant="secondary" onClick={() => setConfirm('withdraw')} data-testid="kyc-withdraw">{t('organizer.kyc.withdraw')}</Button>}
    </StatusCard>
  ) : organizer.status === 'active' ? (
    <StatusCard icon={<BadgeCheck />} title={t('organizer.status.activeTitle')} body={t('organizer.status.activeBody')} testId="organizer-status-active">
      {(org.role === 'owner' || org.role === 'admin') && (
        <>
          <Link href="/organizer/events?event=new" className="inline-flex"><Button>{t('organizer.status.createFirst')}</Button></Link>
          <Link href="/organizer/staff" className="inline-flex"><Button variant="secondary">{t('organizer.status.inviteStaff')}</Button></Link>
        </>
      )}
    </StatusCard>
  ) : organizer.status === 'rejected' ? (
    <StatusCard icon={<XCircle />} title={t('organizer.status.rejectedTitle')} body={fmt(t('organizer.status.rejectedBody'), { reason })} testId="organizer-status-rejected">
      <a href="#organizer-help" className="inline-flex"><Button variant="secondary">{t('organizer.status.contactSupport')}</Button></a>
    </StatusCard>
  ) : organizer.status === 'suspended' ? (
    <StatusCard icon={<Ban />} title={t('organizer.status.suspendedTitle')} body={fmt(t('organizer.status.suspendedBody'), { reason })} testId="organizer-status-suspended">
      <a href="#organizer-help" className="inline-flex"><Button variant="secondary">{t('organizer.status.contactSupport')}</Button></a>
    </StatusCard>
  ) : null;

  return (
    <div className="space-y-4" data-testid="organizer-checklist">
      {statusCard}
      {!isOwner && <Alert tone="info">{t('organizer.kyc.ownerOnly')}</Alert>}
      {infoRequested && kyc.case?.reasonNote && (
        <Alert tone="warning"><span className="font-semibold">{t('organizer.kyc.reviewNote')}:</span> {kyc.case.reasonNote}</Alert>
      )}
      {kyc.checklist.sections.map(section => {
        const titleKey = SECTION_TITLE[section.key];
        if (!titleKey) return null;
        const props: SectionProps = { kyc, items: section.items, editable, onSaved: setKyc };
        return (
          <SectionCard key={section.key} titleKey={titleKey} items={section.items} defaultOpen={showChecklistFirst} testId={`kyc-section-${section.key}`}>
            {section.key === 'business' ? <BusinessSection {...props} />
              : section.key === 'representative' ? <RepresentativeSection {...props} />
              : section.key === 'documents' ? <DocumentsSection {...props} />
              : section.key === 'settlement' ? <PayoutSection {...props} />
              : <AgreementsSection {...props} />}
          </SectionCard>
        );
      })}
      {isOwner && (editableAll || infoRequested) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="kyc-missing-hint">
            {!ready && missing.length > 0 ? fmt(t('organizer.kyc.missingHint'), { items: missing.map(label).join(', ') }) : null}
          </p>
          <Button disabled={!ready} onClick={() => setConfirm('submit')} data-testid="kyc-submit">{t('organizer.kyc.submit')}</Button>
        </div>
      )}
      <ConfirmDialog open={confirm === 'submit'} onClose={() => setConfirm(null)} onConfirm={() => void doSubmit()} tone="primary" busy={busy}
        title={t('organizer.kyc.submitTitle')} description={t('organizer.kyc.submitBody')} confirmLabel={t('organizer.kyc.submit')} />
      <ConfirmDialog open={confirm === 'withdraw'} onClose={() => setConfirm(null)} onConfirm={() => void doWithdraw()} tone="primary" busy={busy}
        title={t('organizer.kyc.withdrawTitle')} confirmLabel={t('organizer.kyc.withdraw')} />
      <span className="sr-only" data-testid="kyc-locale">{locale}</span>
    </div>
  );
}

function StatusCard({ icon, title, body, children, testId }: { icon: ReactNode; title: string; body: string; children?: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-fg-brand)] [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">{body}</p>
          {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

