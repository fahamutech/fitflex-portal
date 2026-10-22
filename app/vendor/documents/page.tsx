'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileDown, Link2, Printer, Share2 } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { errorCode, fmt } from '@/lib/vendor';
import {
  docTitleKey, documentsApi, isDocKind, mayOpenKind, pdfName, type DocKind, type DocLang, type VendorDocument,
} from '@/lib/vendor-documents';
import { Alert, Button, ErrorState, Segmented, SkeletonCard, useToast } from '@/components/shared';
import { ShareMenu, saveBlob } from '@/components/vendor/documents/share-menu';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../providers';

type State = 'loading' | 'ready' | 'notFound' | 'noAccess' | 'notReady' | 'error';

/** Where the breadcrumb goes back to: the screen the document was opened from. */
function sourceOf(kind: DocKind, id: string, customerId: string | null): { href: string; label: MessageKey } {
  const e = encodeURIComponent;
  if (kind === 'sale') return { href: `/vendor/sales/?id=${e(id)}`, label: 'vendor.sales.back' };
  if (kind === 'order') return { href: `/vendor/orders/?id=${e(id)}`, label: 'vendor.orders.back' };
  if (kind === 'statement') return { href: `/vendor/customers/?id=${e(id)}`, label: 'vendor.documents.backToCustomer' };
  return customerId
    ? { href: `/vendor/customers/?id=${e(customerId)}&tab=payments&payment=${e(id)}`, label: 'vendor.documents.backToCustomer' }
    : { href: '/vendor/customers/', label: 'vendor.customers.back' };
}

/**
 * The document view (S5 §7.1): ?type=sale|payment|statement|order&id=…(&customer=…). The server's HTML is shown in a
 * sandboxed iframe (no scripts; same origin only so Print works); it is never put into this page's DOM. The Shell
 * guards the area (tools.documents, failing closed); the kind's permission is checked here (the server decides).
 */
function DocumentInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const typeParam = params.get('type');
  const id = params.get('id') ?? '';
  const customerId = params.get('customer');
  const kind: DocKind | null = isDocKind(typeParam) ? typeParam : null;

  const [lang, setLang] = useState<DocLang>(locale);
  const [doc, setDoc] = useState<VendorDocument | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');
  const [menu, setMenu] = useState<'share' | 'links' | null>(null);
  const [activeLinks, setActiveLinks] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [frameHeight, setFrameHeight] = useState(900);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);

  const allowed = !!kind && mayOpenKind(kind, vendor.me?.permissions);

  // Missing permission: back to the dashboard with "no access" once (the server would refuse it anyway).
  const bounced = useRef(false);
  useEffect(() => {
    if (vendor.status !== 'ready' || !kind || allowed || bounced.current) return;
    bounced.current = true;
    toast.error(t('vendor.documents.noAccess'));
    router.replace('/vendor/');
  }, [vendor.status, kind, allowed, router, toast, t]);

  const load = useCallback(async () => {
    if (!token || !kind || !id || !allowed) return;
    const req = ++requestId.current;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const [json, page] = await Promise.all([documentsApi.view(token, kind, id, lang), documentsApi.html(token, kind, id, lang)]);
      if (req !== requestId.current) return;
      setDoc(json.doc); setHtml(page); setState('ready');
    } catch (err) {
      if (req !== requestId.current) return;
      const code = errorCode(err);
      if (code && /_not_found$/.test(code)) { setState('notFound'); return; }
      if (code === 'invoice_not_ready') { setState('notReady'); return; }
      if (code === 'vendor_permission_forbidden') { setState('noAccess'); return; }
      if (code === 'invalid_doc_type') { setState('notFound'); return; }
      if (vendor.handleError(err)) return;
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kind, id, lang, allowed]);
  useEffect(() => { void load(); }, [load]);

  // The active-links count for the toolbar.
  useEffect(() => {
    if (!token || !kind || !id || !allowed || state !== 'ready') return;
    let alive = true;
    documentsApi.links(token, kind, id)
      .then(r => { if (alive) setActiveLinks(r.activeCount ?? r.links.filter(l => l.active).length); })
      .catch(() => { if (alive) setActiveLinks(null); });
    return () => { alive = false; };
  }, [token, kind, id, allowed, state]);

  // Focus the title once the document is shown (after the commit, not in a timer).
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (state !== 'ready' || !doc) return;
    const key = `${kind}:${id}`;
    if (shownFor.current === key) return;
    shownFor.current = key;
    headingRef.current?.focus();
  }, [state, doc, kind, id]);

  /** Fit the frame to its document (same origin, so its height can be read; it runs no script of its own). */
  const fit = () => {
    const d = frameRef.current?.contentDocument;
    const h = d?.documentElement?.scrollHeight ?? d?.body?.scrollHeight;
    if (h && Number.isFinite(h)) setFrameHeight(Math.max(320, Math.ceil(h) + 8));
  };

  const print = () => frameRef.current?.contentWindow?.print();

  async function downloadPdf() {
    if (!token || !kind) return;
    setPdfBusy(true); setPdfFailed(false);
    try {
      const { blob, fileName } = await documentsApi.pdf(token, kind, id, lang, 'a4');
      saveBlob(blob, fileName ?? pdfName(doc));
    } catch (err) {
      if (errorCode(err) === 'vendor_permission_forbidden') setState('noAccess');
      else setPdfFailed(true);
    } finally {
      setPdfBusy(false);
    }
  }

  if (!kind || !id) {
    return <div className="space-y-4"><ErrorState title={t('vendor.documents.notFound')} /></div>;
  }
  if (!allowed) return <div aria-busy="true" />;

  const source = sourceOf(kind, id, customerId);
  const back = (
    <Link href={source.href} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline print:hidden" data-testid="document-back">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t(source.label)}
    </Link>
  );

  if (state === 'loading') return <div className="mx-auto max-w-[760px] space-y-4" aria-busy="true">{back}<SkeletonCard lines={6} /><SkeletonCard lines={4} /></div>;
  if (state === 'notFound') return <div className="mx-auto max-w-[760px] space-y-4">{back}<div data-testid="document-not-found"><ErrorState title={t('vendor.documents.notFound')} /></div></div>;
  if (state === 'noAccess') return <div className="mx-auto max-w-[760px] space-y-4">{back}<div data-testid="document-no-access"><ErrorState title={t('vendor.documents.noAccess')} /></div></div>;
  if (state === 'notReady') return <div className="mx-auto max-w-[760px] space-y-4">{back}<div data-testid="document-not-ready"><Alert tone="info">{t('vendor.documents.invoiceAfterPayment')}</Alert></div></div>;
  if (state === 'error' || !doc || html == null) {
    return <div className="mx-auto max-w-[760px] space-y-4">{back}<ErrorState title={t('vendor.documents.loadFailed')} onRetry={load} retryLabel={t('common.tryAgain')} /></div>;
  }

  const title = t(docTitleKey(doc.docType));
  const docLabel = doc.number ? `${title} ${doc.number}` : title;
  const cancelled = doc.status === 'cancelled';

  return (
    <div className="mx-auto max-w-[760px] space-y-4" data-testid="document-view">
      {back}
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-[var(--color-fg-primary)] outline-none [overflow-wrap:anywhere]" data-testid="document-heading">
        {docLabel}
      </h1>
      <div className="flex flex-wrap items-center gap-2 print:hidden" role="toolbar" aria-label={t('vendor.documents.viewTitle')} data-testid="document-toolbar">
        <div role="group" aria-label={t('vendor.documents.language')}>
          <Segmented value={lang} onChange={v => setLang(v as DocLang)} options={[['en', t('vendor.documents.langEn')], ['sw', t('vendor.documents.langSw')]]} />
        </div>
        <Button variant="secondary" className="min-h-11" onClick={print} data-testid="document-print"><Printer aria-hidden="true" className="h-4 w-4" />{t('vendor.documents.print')}</Button>
        <Button variant="secondary" className="min-h-11" onClick={downloadPdf} loading={pdfBusy} aria-label={fmt(t('vendor.documents.downloadPdfOf'), { doc: docLabel })} data-testid="document-pdf">
          {!pdfBusy && <FileDown aria-hidden="true" className="h-4 w-4" />}{pdfBusy ? t('vendor.documents.pdfPreparing') : t('vendor.documents.downloadPdf')}
        </Button>
        {!cancelled && (
          <Button className="min-h-11" onClick={() => setMenu('share')} data-testid="document-share"><Share2 aria-hidden="true" className="h-4 w-4" />{t('vendor.documents.share')}</Button>
        )}
        <Button variant="secondary" className="min-h-11" onClick={() => setMenu('links')} data-testid="document-links">
          <Link2 aria-hidden="true" className="h-4 w-4" />{fmt(t('vendor.documents.linksCount'), { n: activeLinks ?? '…' })}
        </Button>
      </div>
      {pdfFailed && (
        <div className="print:hidden" data-testid="document-pdf-error">
          <Alert tone="error">
            <span className="block">{t('vendor.documents.pdfFailed')}</span>
            <Button variant="secondary" size="sm" className="mt-2 min-h-11" onClick={downloadPdf}>{t('common.tryAgain')}</Button>
          </Alert>
        </div>
      )}
      {cancelled && <div className="print:hidden" data-testid="document-voided"><Alert tone="warning">{t('vendor.documents.voidedNote')}</Alert></div>}

      <iframe
        ref={frameRef}
        // The server's HTML has no script; the sandbox forbids scripts anyway. allow-same-origin lets this page
        // call print() on it and read its height; allow-modals lets the print dialog open.
        sandbox="allow-same-origin allow-modals"
        srcDoc={html}
        onLoad={fit}
        title={fmt(t('vendor.documents.frameTitle'), { doc: docLabel })}
        className="w-full rounded-[var(--radius-xl)] border border-[var(--color-border-canvas)] bg-[var(--color-bg-primary)]"
        style={{ height: frameHeight }}
        data-testid="document-frame"
      />

      {menu && (
        <ShareMenu
          open
          onClose={() => setMenu(null)}
          kind={kind}
          id={id}
          customerId={kind === 'statement' ? id : customerId}
          doc={doc}
          lang={lang}
          initialView={menu}
          onLinksChanged={setActiveLinks}
        />
      )}
    </div>
  );
}

/** Vendor (or staff with the document's permission), documents on: one receipt, invoice, payment receipt, statement or order invoice. */
export default function VendorDocumentPage() {
  return <Suspense fallback={null}><DocumentInner /></Suspense>;
}
