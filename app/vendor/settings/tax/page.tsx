'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Upload } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { errorCode, fmt, receiptDay } from '@/lib/vendor';
import {
  cleanTin, cleanVrn, currentVatCertificate, isTin, isVrn, taxApi, VAT_REJECT_REASONS,
  type OwnKycDocument, type TaxProfile, type TaxProfileInput,
} from '@/lib/vendor-documents';
import { Alert, Button, Card, CardContent, Checkbox, ErrorState, Field, Input, PageHeader, SkeletonCard, Spinner, useToast } from '@/components/shared';
import { ConfirmDialog, Dialog } from '@/components/dialog';
import { useOnline } from '@/components/vendor/customers/bits';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../providers';

type FieldErrors = Partial<Record<'tin' | 'vrn' | 'cert', MessageKey>>;
const rejectKey = (r: string | null) => ((VAT_REJECT_REASONS as readonly string[]).includes(r ?? '') ? `vendor.tax.reason.${r}` : 'vendor.tax.reason.other') as MessageKey;

/**
 * Tax details (S5 §6): the vendor tells FitFlex they are VAT-registered and proves it, so VAT, TIN and VRN appear
 * on their documents once a KYC reviewer verifies the certificate. Only the vendor account edits (Q-16); staff with
 * `payments` see it read-only. The Shell guards the area (tools.vat and `payments`, both failing closed).
 */
export default function VendorTaxPage() {
  const { token, t, locale, user } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const online = useOnline();
  const owner = user?.userType === 'vendor';
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [registered, setRegistered] = useState(false);
  const [tin, setTin] = useState('');
  const [vrn, setVrn] = useState('');
  const [certId, setCertId] = useState<string | null>(null);
  const [cert, setCert] = useState<OwnKycDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const vrnRef = useRef<HTMLInputElement>(null);

  /** The form shows what is waiting (or was refused), else what is in force. */
  const fill = useCallback((p: TaxProfile) => {
    setProfile(p);
    setRegistered(p.vatRegistered);
    setTin(p.tin ?? '');
    setVrn(p.vrn ?? '');
    setCertId(p.certificateDocumentId);
    setErrors({});
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await taxApi.profile(token);
      fill(res.taxProfile); setState('ready');
    } catch (err) {
      if (vendor.handleError(err)) return;
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, fill]);
  useEffect(() => { void load(); }, [load]);

  // The owner's certificate file name for the profile's certificate (the KYC case is theirs; staff can't read it).
  // Only when the saved profile changes: a fresh upload already brought its own row (never overwritten here).
  const savedCertId = profile?.certificateDocumentId ?? null;
  useEffect(() => {
    if (!token || !owner || state !== 'ready') return;
    let alive = true;
    taxApi.myKyc(token).then(o => {
      if (!alive) return;
      const docs = o.documents ?? [];
      const found = savedCertId ? docs.find(d => d.id === savedCertId) ?? null : null;
      setCert(prev => (prev && prev.id !== savedCertId ? prev : found));
    }).catch(() => { /* the name is a nicety; the id is what is saved */ });
    return () => { alive = false; };
  }, [token, owner, state, savedCertId]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function upload(file: File) {
    if (!token) return;
    setUploading(true); setUploadFailed(false);
    try {
      const overview = await taxApi.uploadCertificate(token, file);
      const doc = currentVatCertificate(overview.documents);
      if (!doc) throw new Error('no certificate in the answer');
      setCert(doc); setCertId(doc.id);
      setErrors(e => ({ ...e, cert: undefined }));
    } catch (err) {
      if (!vendor.handleError(err)) setUploadFailed(true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function view() {
    if (!token || !certId) return;
    try {
      const blob = await taxApi.certificateFile(token, certId);
      setPreview({ url: URL.createObjectURL(blob), mime: blob.type || cert?.mimeType || null });
    } catch (err) {
      if (!vendor.handleError(err)) toast.error(t('vendor.tax.uploadFailed'));
    }
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!registered) return next;
    if (!profile?.tinFromKyc && !isTin(cleanTin(tin))) next.tin = 'vendor.tax.tinInvalid';
    if (!isVrn(vrn)) next.vrn = 'vendor.tax.vrnInvalid';
    if (!certId) next.cert = 'vendor.tax.certRequired';
    return next;
  }

  async function save(confirmedStop = false) {
    if (!token || !profile) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(found.tin ? 'tax-tin' : found.vrn ? 'tax-vrn' : 'tax-cert-add')?.focus();
      return;
    }
    // Turning VAT off on a profile that shows VAT now: confirm first (applies to new sales at once).
    if (!registered && profile.vatRegistered && profile.inForce && !confirmedStop) { setStopOpen(true); return; }
    const body: TaxProfileInput = registered
      ? { vatRegistered: true, vrn: cleanVrn(vrn), ...(profile.tinFromKyc ? {} : { tin: cleanTin(tin) }), ...(certId ? { certificateDocumentId: certId } : {}) }
      : { vatRegistered: false };
    if (profile.updatedAt) body.updatedAt = profile.updatedAt;
    setSaving(true);
    try {
      const res = await taxApi.save(token, body);
      fill(res.taxProfile);
      setStopOpen(false);
      toast.success(t(registered ? 'vendor.tax.saved' : 'vendor.tax.savedOff'));
    } catch (err) {
      setStopOpen(false);
      const code = errorCode(err);
      if (code === 'vrn_invalid') setErrors({ vrn: 'vendor.tax.vrnInvalid' });
      else if (code === 'tin_invalid' || code === 'tin_required' || code === 'kyc_tin_invalid') setErrors({ tin: 'vendor.tax.tinInvalid' });
      else if (code === 'certificate_required') setErrors({ cert: 'vendor.tax.certRequired' });
      else if (code === 'tax_profile_changed') { toast.info(t('vendor.tax.changedElsewhere')); void load(); }
      else if (code === 'owner_only') { toast.error(t('vendor.tax.ownerOnly')); void load(); }
      else if (!vendor.handleError(err)) toast.error(t('vendor.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const header = <PageHeader title={t('vendor.tax.title')} />;
  if (state === 'loading') return <div className="mx-auto max-w-[640px]" aria-busy="true">{header}<SkeletonCard lines={5} /></div>;
  if (state === 'error' || !profile) {
    return <div className="mx-auto max-w-[640px]">{header}<ErrorState title={t('vendor.tax.loadFailed')} onRetry={load} retryLabel={t('common.tryAgain')} /></div>;
  }

  const p = profile;
  const readOnly = !owner;
  const disabled = readOnly || saving;
  const certLost = p.status === 'verified' && p.verified && !p.verified.certificateStands;

  let status: { tone: 'info' | 'success' | 'warning'; text: string; again?: boolean };
  if (!p.vatRegistered || p.status === 'none') status = { tone: 'info', text: t('vendor.tax.statusNone') };
  else if (p.changePending) status = { tone: 'info', text: t('vendor.tax.changePending') };
  else if (p.status === 'pending') status = { tone: 'info', text: t('vendor.tax.statusPending') };
  else if (p.status === 'rejected') {
    const reason = t(rejectKey(p.rejectReason)) + (p.rejectNote ? ` (${p.rejectNote})` : '');
    status = { tone: 'warning', text: fmt(t('vendor.tax.statusRejected'), { reason }), again: true };
  } else if (certLost) status = { tone: 'warning', text: t('vendor.tax.certNotStanding'), again: true };
  else status = { tone: 'success', text: fmt(t('vendor.tax.statusVerified'), { date: receiptDay(p.verifiedAt, locale) }) };

  return (
    <div className="mx-auto max-w-[640px] space-y-4" data-testid="tax-page">
      {header}
      <div aria-live="polite" data-testid="tax-status">
        <Alert tone={status.tone}>
          <span className="block">{status.text}</span>
          {status.again && owner && (
            <Button variant="secondary" size="sm" className="mt-2 min-h-11" onClick={() => { setRegistered(true); vrnRef.current?.focus(); }} data-testid="tax-send-again">
              {t('vendor.tax.sendAgain')}
            </Button>
          )}
        </Alert>
      </div>
      {readOnly && <div data-testid="tax-owner-only"><Alert tone="info">{t('vendor.tax.ownerOnly')}</Alert></div>}

      <Card>
        <CardContent className="space-y-4">
          <Checkbox label={t('vendor.tax.registered')} checked={registered} disabled={disabled}
            onChange={e => { setRegistered(e.target.checked); setErrors({}); }} data-testid="tax-registered" />
          {registered && (
            <>
              <Field label={t('vendor.tax.tin')} hint={p.tinFromKyc ? t('vendor.tax.tinFromKyc') : t('vendor.tax.tinHint')} error={errors.tin ? t(errors.tin) : undefined} required={!p.tinFromKyc}>
                <Input id="tax-tin" value={tin} inputMode="numeric" autoComplete="off" readOnly={p.tinFromKyc} disabled={disabled}
                  onChange={e => { setTin(e.target.value); setErrors(x => ({ ...x, tin: undefined })); }} data-testid="tax-tin" />
              </Field>
              <Field label={t('vendor.tax.vrn')} error={errors.vrn ? t(errors.vrn) : undefined} required>
                <Input id="tax-vrn" ref={vrnRef} value={vrn} autoComplete="off" disabled={disabled} maxLength={40}
                  onChange={e => { setVrn(e.target.value); setErrors(x => ({ ...x, vrn: undefined })); }} data-testid="tax-vrn" />
              </Field>
              <div className="space-y-2" data-testid="tax-cert">
                <p className="text-sm font-medium text-[var(--color-fg-secondary)]">
                  {t('vendor.tax.cert')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span>
                </p>
                {certId
                  ? <p className="text-sm [overflow-wrap:anywhere]" data-testid="tax-cert-name">{cert?.fileName || t('vendor.tax.certOnFile')}</p>
                  : null}
                <p className="text-xs text-[var(--color-fg-quaternary)]" id="tax-cert-hint">{t('vendor.tax.certHint')}</p>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <input ref={fileRef} type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} data-testid="tax-cert-input" />
                    <Button id="tax-cert-add" variant="secondary" className="min-h-11" disabled={disabled || uploading || !online}
                      aria-describedby={errors.cert ? 'tax-cert-error' : 'tax-cert-hint'} onClick={() => fileRef.current?.click()} data-testid="tax-cert-add">
                      {uploading ? <Spinner className="h-4 w-4" /> : <Upload aria-hidden="true" className="h-4 w-4" />}
                      {uploading ? t('vendor.tax.certUploading') : certId ? t('vendor.tax.certReplace') : t('vendor.tax.certAdd')}
                    </Button>
                    {certId && (
                      <Button variant="secondary" className="min-h-11" onClick={view} data-testid="tax-cert-view"><Eye aria-hidden="true" className="h-4 w-4" />{t('vendor.tax.certView')}</Button>
                    )}
                  </div>
                )}
                {errors.cert && <p id="tax-cert-error" className="text-xs text-[var(--color-error-700)]">{t(errors.cert)}</p>}
                {uploadFailed && <div data-testid="tax-upload-failed"><Alert tone="error">{t('vendor.tax.uploadFailed')}</Alert></div>}
              </div>
            </>
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-fg-tertiary)]">
            <li>{t('vendor.tax.howItWorks')}</li>
            <li>{t('vendor.tax.pastUnchanged')}</li>
            <li>{t('vendor.tax.appUnchanged')}</li>
            <li>{t('vendor.tax.pricesInclude')}</li>
          </ul>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="sticky bottom-0 flex justify-end bg-[var(--color-bg-canvas)] py-3">
          <Button className="min-h-11" onClick={() => save()} loading={saving} disabled={!online || uploading} data-testid="tax-save">{t('vendor.tax.save')}</Button>
        </div>
      )}

      <ConfirmDialog open={stopOpen} onClose={() => { if (!saving) setStopOpen(false); }} onConfirm={() => save(true)} busy={saving}
        title={t('vendor.tax.stop')} description={t('vendor.tax.stopConfirm')} confirmLabel={t('vendor.tax.stop')} />

      {preview && (
        <Dialog open onClose={() => setPreview(null)} title={t('vendor.tax.cert')} description={cert?.fileName ?? undefined} size="xl">
          {preview.mime === 'application/pdf'
            ? <iframe src={preview.url} title={t('vendor.tax.cert')} className="h-[70vh] w-full rounded-[var(--radius-md)] border border-[var(--color-border-secondary)]" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={preview.url} alt={t('vendor.tax.cert')} className="mx-auto max-h-[70vh] rounded-[var(--radius-md)]" />}
        </Dialog>
      )}
    </div>
  );
}
