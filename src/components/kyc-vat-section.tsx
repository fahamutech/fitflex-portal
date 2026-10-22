'use client';
// VAT registration on a vendor's KYC case (S5 §7.4): VRN, TIN (with a mismatch warning), the certificate, and the
// reviewer's Verify / Not accepted. It never changes the case decision: VAT is optional for vendors. Hidden while
// the server has VAT off (404 feature_disabled) or the vendor never submitted a tax profile. Scope `kyc`.
import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, Landmark, X } from 'lucide-react';
import { ApiError, type KycDocument } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { errorCode, fmt, receiptDay } from '@/lib/vendor';
import { adminTaxApi, VAT_REJECT_REASONS, type AdminVendorVat, type VatRejectReason } from '@/lib/vendor-documents';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Select, Textarea, useToast } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { useApp } from '../../app/providers';

const NOTE_MAX = 300;

export function KycVatSection({ vendorId, documents, onView }: {
  vendorId: string;
  /** The case's documents (the certificate is one of them; the existing viewer opens it). */
  documents: KycDocument[];
  onView: (doc: KycDocument) => void;
}) {
  const { token, t, locale } = useApp();
  const toast = useToast();
  const [vat, setVat] = useState<AdminVendorVat | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setVat(await adminTaxApi.vendorVat(token, vendorId)); setState('ready');
    } catch (err) {
      // Any 404 is "VAT off": feature_disabled, or an older backend without the route (contract check).
      setState(err instanceof ApiError && err.status === 404 ? 'off' : 'error');
    }
  }, [token, vendorId]);
  useEffect(() => { void load(); }, [load]);

  /** The decision's refusal → message (and a reload where the state moved on). */
  function refusal(err: unknown) {
    const code = errorCode(err);
    if (code === 'certificate_not_current') { void load(); return t('admin.kyc.vatCertNotCurrent'); }
    if (code === 'nothing_to_review') { void load(); return t('admin.kyc.vatNothingToReview'); }
    if (code === 'note_required') return t('admin.kyc.vatNoteRequired');
    return t('vendor.saveFailed');
  }

  async function verify() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      setVat(await adminTaxApi.verifyVat(token, vendorId));
      toast.success(t('admin.kyc.vatVerified'));
    } catch (err) {
      setError(refusal(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'off' || state === 'loading') return null;
  if (state === 'error' || !vat) {
    return (
      <Card data-testid="kyc-vat">
        <CardContent><Alert tone="error"><span className="block">{t('admin.kyc.vatLoadFailed')}</span>
          <Button variant="secondary" size="sm" className="mt-2 min-h-11" onClick={load}>{t('common.tryAgain')}</Button></Alert></CardContent>
      </Card>
    );
  }
  const p = vat.taxProfile;
  // Shown once the vendor has submitted a tax profile (status beyond "none").
  if (p.status === 'none' && !p.vatRegistered && !p.pending) return null;

  const shownVrn = p.pending?.vrn ?? p.vrn;
  const shownTin = p.pending?.tin ?? p.tin;
  const statusKey: MessageKey = p.changePending ? 'admin.kyc.vatStatus.changePending' : (`admin.kyc.vatStatus.${p.status}` as MessageKey);
  const tone = p.status === 'verified' && !p.changePending ? 'success' : p.status === 'rejected' ? 'danger' : p.status === 'pending' ? 'warning' : 'gray';
  const certDoc: KycDocument | null = vat.certificate
    ? documents.find(d => d.id === vat.certificate!.id) ?? {
      id: vat.certificate.id, requirementKey: 'vat_certificate', docType: 'vat_certificate', status: (vat.certificate.status as KycDocument['status']) ?? 'pending',
      hasFile: true, fileName: vat.certificate.fileName, mimeType: vat.certificate.mimeType, sizeBytes: null, documentNumber: null, issuer: null,
      issuedOn: null, expiresOn: null, details: {}, reviewNote: null, reviewedAt: null, supersedesId: null, round: 1, createdAt: vat.certificate.uploadedAt ?? '',
    }
    : null;
  const certStatusKey = vat.certificate ? (`admin.kyc.vatCertStatus.${vat.certificate.status}` as MessageKey) : null;
  const row = 'flex flex-wrap justify-between gap-2';

  return (
    <Card data-testid="kyc-vat">
      <CardHeader>
        <h2 className="flex flex-wrap items-center gap-2 font-semibold">
          <Landmark aria-hidden="true" className="h-4 w-4" />{t('admin.kyc.vatSection')}
          <Badge tone={tone}>{t(statusKey)}</Badge>
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-[var(--color-fg-tertiary)]">{t('admin.kyc.vatOptional')}</p>
        {error && <div data-testid="kyc-vat-error"><Alert tone="error">{error}</Alert></div>}
        <dl className="space-y-1">
          <div className={row}><dt>{t('vendor.tax.vrn')}</dt><dd className="font-mono [overflow-wrap:anywhere]" data-testid="kyc-vat-vrn">{shownVrn || '—'}</dd></div>
          <div className={row}><dt>{t('vendor.tax.tin')}</dt><dd className="font-mono" data-testid="kyc-vat-tin">{shownTin || '—'}</dd></div>
          {p.pending?.submittedAt && <div className={row}><dt className="sr-only">{t('admin.kyc.vatSection')}</dt><dd>{fmt(t('admin.kyc.vatSubmitted'), { date: receiptDay(p.pending.submittedAt, locale) })}</dd></div>}
          {p.verifiedAt && <div className={row}><dt className="sr-only">{t('admin.kyc.vatSection')}</dt><dd>{fmt(t('admin.kyc.vatVerifiedOn'), { date: receiptDay(p.verifiedAt, locale) })}{p.verified?.vrn && p.changePending ? ` · ${p.verified.vrn}` : ''}</dd></div>}
        </dl>
        {vat.tinMismatch && (
          <div data-testid="kyc-vat-tin-mismatch">
            <Alert tone="warning">
              <span className="block">{t('admin.kyc.vatTinMismatch')}</span>
              {vat.kycTin && <span className="block font-mono">{fmt(t('admin.kyc.vatKycTin'), { tin: vat.kycTin })}</span>}
            </Alert>
          </div>
        )}
        {p.status === 'rejected' && p.rejectReason && (
          <p data-testid="kyc-vat-rejected">
            {fmt(t('vendor.tax.statusRejected'), { reason: t(`vendor.tax.reason.${p.rejectReason}` as MessageKey) })}{p.rejectNote ? ` (${p.rejectNote})` : ''}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-secondary)] pt-3">
          <div className="min-w-0">
            <p className="font-medium">{t('admin.kyc.vatCert')}</p>
            {vat.certificate
              ? <p className="text-xs text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]" data-testid="kyc-vat-cert">{[vat.certificate.fileName, certStatusKey ? (t(certStatusKey) as string | undefined) || vat.certificate.status : null].filter(Boolean).join(' · ')}</p>
              : <p className="text-xs text-[var(--color-fg-tertiary)]">{t('admin.kyc.vatCertNone')}</p>}
          </div>
          {certDoc && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onView(certDoc)} data-testid="kyc-vat-view"><Eye aria-hidden="true" className="h-4 w-4" />{t('admin.kyc.vatView')}</Button>}
        </div>
        {p.status === 'pending' && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="min-h-11" onClick={verify} loading={busy} data-testid="kyc-vat-verify"><Check aria-hidden="true" className="h-4 w-4" />{t('admin.kyc.vatVerify')}</Button>
            <Button variant="secondary" className="min-h-11 text-[var(--color-error-700)]" disabled={busy} onClick={() => { setError(null); setRejectOpen(true); }} data-testid="kyc-vat-reject">
              <X aria-hidden="true" className="h-4 w-4" />{t('admin.kyc.vatReject')}
            </Button>
          </div>
        )}
      </CardContent>
      {rejectOpen && (
        <RejectVatDialog vendorId={vendorId} onClose={() => setRejectOpen(false)} refusal={refusal}
          onDone={next => { setVat(next); setRejectOpen(false); toast.success(t('admin.kyc.vatRejected')); }} />
      )}
    </Card>
  );
}

function RejectVatDialog({ vendorId, onClose, onDone, refusal }: { vendorId: string; onClose: () => void; onDone: (v: AdminVendorVat) => void; refusal: (err: unknown) => string }) {
  const { token, t } = useApp();
  const [reason, setReason] = useState<VatRejectReason>('unreadable');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const n = note.trim();
    if (reason === 'other' && !n) { setNoteError(t('admin.kyc.vatNoteRequired')); return; }
    setBusy(true); setError(null);
    try {
      onDone(await adminTaxApi.rejectVat(token, vendorId, { reason, ...(n ? { note: n } : {}) }));
    } catch (err) {
      setError(refusal(err));
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={t('admin.kyc.vatReject')} description={t('admin.kyc.vatSection')} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="kyc-vat-reject-dialog" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('admin.kyc.vatReasonLabel')} required>
          <Select value={reason} onChange={e => { setReason(e.target.value as VatRejectReason); setNoteError(null); }} data-testid="kyc-vat-reason">
            {VAT_REJECT_REASONS.map(r => <option key={r} value={r}>{t(`vendor.tax.reason.${r}` as MessageKey)}</option>)}
          </Select>
        </Field>
        <Field label={t('admin.kyc.vatNote')} required={reason === 'other'} error={noteError ?? undefined} hint={`${note.length}/${NOTE_MAX}`}>
          <Textarea rows={3} maxLength={NOTE_MAX} value={note} onChange={e => { setNote(e.target.value); setNoteError(null); }} data-testid="kyc-vat-note" />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" className="min-h-11" loading={busy} data-testid="kyc-vat-reject-submit">{t('admin.kyc.vatReject')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
