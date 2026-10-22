'use client';
// Customer statement as plain text (S4 §7.3): preview, language toggle and Copy. Never phone, email or address.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type VendorCustomerPayment, type VendorCustomerProfile } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { t as translate, type Locale, type MessageKey } from '@/lib/i18n';
import { addDays, documentsOn, eatToday, statementText } from '@/lib/vendor';
import { documentHref } from '@/lib/vendor-documents';
import { docLinkCls } from '@/components/vendor/documents/share-menu';
import { Button, ErrorState, Segmented, SkeletonCard } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';

const STATEMENT_PAYMENT_DAYS = 90;

export function StatementDialog({ open, customer, onClose }: { open: boolean; customer: VendorCustomerProfile; onClose: () => void }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [lang, setLang] = useState<Locale>(locale);
  const [payments, setPayments] = useState<VendorCustomerPayment[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!token || !open) return;
    setFailed(false); setPayments(null);
    try {
      // Recorded payments of the last 90 EAT days (one page of up to 200 is plenty for a statement).
      const res = await api.vendorCustomerPayments(token, customer.id, { from: addDays(eatToday(), -STATEMENT_PAYMENT_DAYS), limit: 200 });
      setPayments(res.payments ?? []);
    } catch (err) {
      if (vendor.handleError(err)) { onClose(); return; }
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, open, customer.id]);
  useEffect(() => { if (open) { setLang(locale); void load(); } }, [open, load, locale]);

  const business = vendor.me?.businessName || t('vendor.shell.unnamed');
  const text = payments ? statementText(customer, payments, { business, locale: lang, t: (k: MessageKey) => translate(lang, k), money }) : '';

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success(t('vendor.statement.copied')); } catch { toast.error(t('vendor.saveFailed')); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('vendor.statement.copy')} size="lg">
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.pos.receiptLanguage')}</p>
          <Segmented value={lang} onChange={v => setLang(v as Locale)} options={[['en', 'English'], ['sw', 'Kiswahili']]} />
        </div>
        {failed ? <ErrorState title={t('vendor.statement.failed')} onRetry={load} retryLabel={t('common.tryAgain')} />
          : payments == null ? <div aria-busy="true"><SkeletonCard /></div>
          : <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-4 font-mono text-sm [overflow-wrap:anywhere]" data-testid="statement-text">{text}</pre>}
      </div>
      <DialogFooter className="flex-wrap">
        <Button variant="secondary" className="min-h-11" onClick={onClose}>{t('common.close')}</Button>
        {documentsOn(vendor.me) && (
          <Link href={documentHref('statement', customer.id)} className={docLinkCls} data-testid="statement-document">{t('vendor.documents.view')}</Link>
        )}
        <Button className="min-h-11" onClick={copy} disabled={!payments} data-testid="statement-copy">{t('vendor.statement.copy')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
