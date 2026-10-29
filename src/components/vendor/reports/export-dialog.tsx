'use client';
// Export (§10): Summary (PDF) and one CSV per permitted section, in the portal's language. The server leaves out
// cost and payout columns the person may not see; this list only offers the sections they may open.
import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { errorCode, fmt } from '@/lib/vendor';
import { periodWords, reportsApi, viewKey, type ReportQuery, type ReportView } from '@/lib/vendor-reports';
import { Alert, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { saveBlob } from '@/components/vendor/documents/share-menu';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '../../../../app/providers';

const rowCls = 'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-4 py-3 text-left text-sm font-semibold text-[var(--color-fg-primary)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50';

export function ExportDialog({ open, onClose, views, query }: { open: boolean; onClose: () => void; views: ReportView[]; query: ReportQuery }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [busy, setBusy] = useState<ReportView | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const period = query.from && query.to ? periodWords(query.from, query.to, locale) : '';
  const language = t(locale === 'sw' ? 'vendor.documents.langSw' : 'vendor.documents.langEn');

  const run = async (view: ReportView) => {
    if (!token) return;
    setBusy(view); setTooLarge(false);
    try {
      const { blob, fileName } = await reportsApi.file(token, view, query, locale, vendor.me?.businessName);
      saveBlob(blob, fileName);
      toast.success(t('vendor.reports.exported'));
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'export_too_large') setTooLarge(true);
      else if (code === 'cost_not_allowed' || code === 'payout_not_allowed') { toast.error(t('vendor.reports.noAccess')); void vendor.refresh(); }
      else if (!vendor.handleError(err)) toast.error(t(err instanceof TypeError ? 'vendor.reports.network' : 'vendor.reports.exportFailed'));
    } finally { setBusy(null); }
  };

  const label = (view: ReportView) => (view === 'overview' ? t('vendor.reports.exportPdf') : fmt(t('vendor.reports.exportCsv'), { section: t(viewKey(view)) }));
  const spoken = (view: ReportView) => fmt(t('vendor.reports.a11y.exportRow'), {
    section: view === 'overview' ? t('vendor.reports.exportPdfSection') : t(viewKey(view)),
    format: view === 'overview' ? 'PDF' : 'CSV',
    period: view === 'stock' ? t('vendor.reports.today') : period,
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('vendor.reports.export')} description={fmt(t('vendor.reports.exportLang'), { language })} size="sm">
      <div className="space-y-2" data-testid="report-export-dialog">
        {tooLarge && <Alert tone="warning">{t('vendor.reports.exportTooLarge')}</Alert>}
        <p className="sr-only" aria-live="polite">{busy ? t('vendor.reports.preparing') : ''}</p>
        {views.map(view => (
          <button
            key={view} type="button" className={rowCls} disabled={!!busy} aria-busy={busy === view} aria-label={spoken(view)}
            onClick={() => run(view)} data-testid={`export-${view}`}
          >
            {busy === view ? <Spinner className="h-4 w-4" /> : <FileDown aria-hidden="true" className="h-4 w-4" />}
            <span>{busy === view ? t('vendor.reports.preparing') : label(view)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

