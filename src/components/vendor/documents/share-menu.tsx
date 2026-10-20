'use client';
// Share menu (S5 §7.2): WhatsApp (new tab), Copy link, Download PDF (A4, or 80mm for receipt printers), Share as
// text, and the links of this document with Turn off / Turn off all. No SMS row on desktop. A link is made lazily on
// the first WhatsApp or Copy link and reused while the menu stays open; closing it forgets the URL (only its hash
// is stored, so it can never be shown again). Every label is an i18n key.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Copy, FileDown, Link2, MessageCircle, Printer, Type } from 'lucide-react';
import { api } from '@/lib/api';
import { t as translate, type MessageKey } from '@/lib/i18n';
import {
  docTitleKey, documentsApi, documentText, linkUrlFor, pdfName, sharePath, whatsappUrl,
  type DocKind, type DocLang, type DocPaper, type DocumentLink, type DocumentShare, type VendorDocument,
} from '@/lib/vendor-documents';
import { canCustomers, eatDateTime, errorCode, fmt } from '@/lib/vendor';
import { Alert, Badge, Button, ErrorState, Segmented, SkeletonText, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { useVendor } from '@/components/vendor-context';
import { useToast } from '@/components/ui/toast';
import { rateLimitText } from '@/components/vendor/customers/bits';
import { useApp } from '../../../../app/providers';

type Busy = 'whatsapp' | 'copy' | 'a4' | '80mm' | null;
type Confirm = { kind: 'one'; link: DocumentLink } | { kind: 'all'; n: number } | null;

/** Download a blob under a file name (an <a download> click; the object URL is freed afterwards). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A link styled as a secondary button (≥44px), for "View document" / "Invoice" entry points. */
export const docLinkCls = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 text-sm font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]';

const rowCls = 'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-4 py-3 text-left text-sm font-semibold text-[var(--color-fg-primary)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50';

export function ShareMenu({
  open, onClose, kind, id, customerId = null, doc, lang: initialLang, initialView = 'share', onLinksChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: DocKind;
  /** The sale, payment, customer (statement) or order id. */
  id: string;
  /** The customer of a sale, payment or statement (a payment's share route needs it; a walk-in phone fills WhatsApp). */
  customerId?: string | null;
  doc: VendorDocument;
  lang: DocLang;
  initialView?: 'share' | 'links';
  onLinksChanged?: (activeCount: number) => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const toast = useToast();
  const [view, setView] = useState<'share' | 'links'>(initialView);
  const [lang, setLang] = useState<DocLang>(initialLang);
  const [share, setShare] = useState<DocumentShare | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<DocPaper | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [cancelled, setCancelled] = useState(doc.status === 'cancelled');
  const [notReady, setNotReady] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [links, setLinks] = useState<DocumentLink[] | null>(null);
  const [linksFailed, setLinksFailed] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [revoking, setRevoking] = useState(false);
  const [live, setLive] = useState('');
  const focusAfter = useRef<string | null>(null);

  const title = t(docTitleKey(doc.docType));
  const docLabel = doc.number ? `${title} ${doc.number}` : title;
  const creating = busy === 'whatsapp' || busy === 'copy';

  // Opening starts afresh: the URL of an earlier session is gone for good.
  useEffect(() => {
    if (!open) return;
    setView(initialView); setLang(initialLang); setShare(null); setBusy(null); setError(null); setPdfError(null);
    setUnavailable(false); setCancelled(doc.status === 'cancelled'); setNotReady(false); setConfirm(null); setLive('');
  }, [open, initialView, initialLang, doc.status]);

  const loadLinks = useCallback(async () => {
    if (!token) return;
    setLinksFailed(false);
    try {
      const res = await documentsApi.links(token, kind, id);
      setLinks(res.links ?? []);
      onLinksChanged?.(res.activeCount ?? (res.links ?? []).filter(l => l.active).length);
    } catch (err) {
      if (errorCode(err) === 'vendor_permission_forbidden') { toast.error(t('vendor.documents.noAccess')); onClose(); return; }
      if (vendor.handleError(err)) { onClose(); return; }
      setLinksFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kind, id]);
  useEffect(() => { if (open) { setLinks(null); void loadLinks(); } }, [open, loadLinks]);

  // A walk-in customer's phone (vendor-owned data) fills WhatsApp; app customers have none (chat picker).
  useEffect(() => {
    setPhone(null);
    if (!open || !token || !customerId || kind === 'order' || !canCustomers(vendor.me)) return;
    let alive = true;
    api.vendorCustomer(token, customerId)
      .then(res => { if (alive && res.customer.source === 'manual' && res.customer.phone) setPhone(res.customer.phone); })
      .catch(() => { /* WhatsApp still opens, without a number */ });
    return () => { alive = false; };
  }, [open, token, customerId, kind, vendor.me]);

  // After a revoke, focus goes to that row's status.
  useEffect(() => {
    if (!focusAfter.current || !links) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [links]);

  const close = () => { if (!creating) onClose(); };

  async function ensureLink(): Promise<DocumentShare | null> {
    if (share) return share;
    if (!token) return null;
    const path = sharePath(kind, id, customerId);
    if (!path) { setError(t('vendor.documents.createFailed')); return null; }
    setError(null); setLive(t('vendor.documents.creating'));
    try {
      const made = await documentsApi.share(token, path, lang);
      setShare(made);
      void loadLinks();
      return made;
    } catch (err) {
      setLive('');
      const code = errorCode(err);
      if (code === 'public_url_not_configured') { setUnavailable(true); return null; }
      if (code === 'document_cancelled') { setCancelled(true); return null; }
      if (code === 'invoice_not_ready') { setNotReady(true); return null; }
      if (code === 'vendor_permission_forbidden') { toast.error(t('vendor.documents.noAccess')); onClose(); return null; }
      const limited = rateLimitText(err, t);
      if (limited) { setError(limited); return null; }
      if (code !== 'invalid_lang' && vendor.handleError(err)) { onClose(); return null; }
      setError(t('vendor.documents.createFailed'));
      return null;
    }
  }

  async function onWhatsApp() {
    // A tab opened now (inside the click) is not blocked; it gets the address once the link exists.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setBusy('whatsapp');
    const made = await ensureLink();
    setBusy(null);
    if (!made) { tab?.close(); return; }
    const url = whatsappUrl(made.texts[lang].whatsapp, phone);
    if (tab) tab.location.href = url;
    setLive(t('vendor.documents.linkReady'));
    toast.success(t('vendor.documents.linkReady'));
  }

  async function onCopy() {
    setBusy('copy');
    const made = await ensureLink();
    setBusy(null);
    if (!made) return;
    try {
      await navigator.clipboard.writeText(linkUrlFor(made, lang));
      setLive(t('vendor.documents.copied'));
      toast.success(t('vendor.documents.copied'));
    } catch {
      toast.error(t('vendor.saveFailed'));
    }
  }

  async function onPdf(paper: DocPaper) {
    if (!token) return;
    setBusy(paper); setPdfError(null);
    try {
      const { blob, fileName } = await documentsApi.pdf(token, kind, id, lang, paper);
      saveBlob(blob, fileName ?? pdfName(doc));
    } catch (err) {
      if (errorCode(err) === 'vendor_permission_forbidden') { toast.error(t('vendor.documents.noAccess')); onClose(); return; }
      setPdfError(paper);
    } finally {
      setBusy(null);
    }
  }

  async function onText() {
    const tl = (k: MessageKey) => translate(lang, k);
    const text = documentText(doc, { locale: lang, t: tl, url: share ? linkUrlFor(share, lang) : null });
    try { await navigator.clipboard.writeText(text); toast.success(t('vendor.documents.textCopied')); } catch { toast.error(t('vendor.saveFailed')); }
  }

  async function doRevoke() {
    if (!token || !confirm) return;
    setRevoking(true);
    try {
      if (confirm.kind === 'one') {
        const res = await documentsApi.revoke(token, confirm.link.id);
        focusAfter.current = `doc-link-status-${res.link.id}`;
        const next = (links ?? []).map(l => (l.id === res.link.id ? res.link : l));
        setLinks(next);
        onLinksChanged?.(next.filter(l => l.active).length);
        toast.success(t('vendor.documents.revoked'));
      } else {
        const res = await documentsApi.revokeAll(token, kind, id);
        setLinks(res.links ?? []);
        onLinksChanged?.((res.links ?? []).filter(l => l.active).length);
        toast.success(fmt(t('vendor.documents.revokedAll'), { n: res.revokedCount }));
        focusAfter.current = 'doc-links-heading';
      }
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      if (errorCode(err) === 'vendor_permission_forbidden') { toast.error(t('vendor.documents.noAccess')); onClose(); return; }
      if (!vendor.handleError(err)) toast.error(t('vendor.saveFailed'));
    } finally {
      setRevoking(false);
    }
  }

  const activeLinks = (links ?? []).filter(l => l.active);
  const linkRowsOff = cancelled || unavailable || notReady || creating;
  const busyIcon = (b: Busy, icon: React.ReactNode) => (busy === b ? <Spinner className="h-5 w-5" /> : icon);

  const shareView = (
    <div className="space-y-4" data-testid="share-menu">
      <div>
        <p className="mb-1 text-sm font-medium text-[var(--color-fg-secondary)]" id="doc-share-lang">{t('vendor.documents.language')}</p>
        <div role="group" aria-labelledby="doc-share-lang">
          <Segmented value={lang} onChange={v => setLang(v as DocLang)} options={[['en', t('vendor.documents.langEn')], ['sw', t('vendor.documents.langSw')]]} />
        </div>
      </div>
      <p className="text-sm text-[var(--color-fg-tertiary)]">{t('vendor.documents.privacyNote')}</p>

      {cancelled && <Alert tone="warning">{t('vendor.documents.voidedNote')}</Alert>}
      {unavailable && <div data-testid="share-unavailable"><Alert tone="info">{t('vendor.documents.unavailable')}</Alert></div>}
      {notReady && <Alert tone="info">{t('vendor.documents.invoiceAfterPayment')}</Alert>}
      {error && (
        <div data-testid="share-error">
          <Alert tone="error">
            <span className="block">{error}</span>
          </Alert>
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        <li>
          {share && !linkRowsOff ? (
            <a href={whatsappUrl(share.texts[lang].whatsapp, phone)} target="_blank" rel="noopener noreferrer" className={rowCls}
              aria-label={fmt(t('vendor.documents.whatsappFor'), { doc: docLabel })} data-testid="share-whatsapp">
              <MessageCircle aria-hidden="true" className="h-5 w-5 shrink-0" /><span className="flex-1">{t('vendor.documents.whatsapp')}</span>
            </a>
          ) : (
            <button type="button" className={rowCls} onClick={onWhatsApp} disabled={linkRowsOff || busy !== null}
              aria-label={fmt(t('vendor.documents.whatsappFor'), { doc: docLabel })} data-testid="share-whatsapp">
              {busyIcon('whatsapp', <MessageCircle aria-hidden="true" className="h-5 w-5 shrink-0" />)}<span className="flex-1">{t('vendor.documents.whatsapp')}</span>
            </button>
          )}
        </li>
        <li>
          <button type="button" className={rowCls} onClick={onCopy} disabled={linkRowsOff || busy !== null}
            aria-label={fmt(t('vendor.documents.copyLinkFor'), { doc: docLabel })} data-testid="share-copy">
            {busyIcon('copy', <Link2 aria-hidden="true" className="h-5 w-5 shrink-0" />)}<span className="flex-1">{t('vendor.documents.copyLink')}</span>
          </button>
        </li>
        <li>
          <button type="button" className={rowCls} onClick={() => onPdf('a4')} disabled={busy !== null}
            aria-label={fmt(t('vendor.documents.downloadPdfOf'), { doc: docLabel })} data-testid="share-pdf">
            {busyIcon('a4', <FileDown aria-hidden="true" className="h-5 w-5 shrink-0" />)}<span className="flex-1">{busy === 'a4' ? t('vendor.documents.pdfPreparing') : t('vendor.documents.downloadPdf')}</span>
          </button>
        </li>
        <li>
          <button type="button" className={rowCls} onClick={onText} disabled={creating} data-testid="share-text">
            <Type aria-hidden="true" className="h-5 w-5 shrink-0" /><span className="flex-1">{t('vendor.documents.shareText')}</span>
          </button>
        </li>
      </ul>
      {pdfError && (
        <div data-testid="share-pdf-error">
          <Alert tone="error">
            <span className="block">{t('vendor.documents.pdfFailed')}</span>
            <Button variant="secondary" size="sm" className="mt-2 min-h-11" onClick={() => onPdf(pdfError)}>{t('common.tryAgain')}</Button>
          </Alert>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.documents.more')}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          <li>
            <button type="button" className={rowCls} onClick={() => onPdf('80mm')} disabled={busy !== null} data-testid="share-pdf-80mm">
              {busyIcon('80mm', <Printer aria-hidden="true" className="h-5 w-5 shrink-0" />)}<span className="flex-1">{busy === '80mm' ? t('vendor.documents.pdfPreparing') : t('vendor.documents.pdfThermal')}</span>
            </button>
          </li>
          <li>
            <button type="button" className={rowCls} onClick={() => setView('links')} disabled={creating} data-testid="share-links">
              <Copy aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="flex-1">{fmt(t('vendor.documents.linksCount'), { n: links ? activeLinks.length : '…' })}</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  );

  const linksView = (
    <div className="space-y-4" data-testid="links-view">
      {initialView === 'share' && (
        <Button variant="link" className="min-h-11 h-auto px-0 text-sm font-semibold" onClick={() => { setConfirm(null); setView('share'); }} data-testid="links-back">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />{t('vendor.documents.backToShare')}
        </Button>
      )}
      <h3 id="doc-links-heading" tabIndex={-1} className="font-semibold outline-none">{t('vendor.documents.linksTitle')}</h3>
      {cancelled && <Alert tone="warning">{t('vendor.documents.voidedNote')}</Alert>}
      {confirm ? (
        <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-error-200)] p-4" data-testid="links-confirm">
          <p className="text-sm">{confirm.kind === 'one' ? t('vendor.documents.revokeConfirm') : fmt(t('vendor.documents.revokeAllConfirm'), { n: confirm.n })}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirm(null)} disabled={revoking} data-autofocus>{t('common.cancel')}</Button>
            <Button variant="destructive" className="min-h-11" onClick={doRevoke} loading={revoking} data-testid="links-confirm-yes">
              {confirm.kind === 'one' ? t('vendor.documents.revoke') : t('vendor.documents.revokeAll')}
            </Button>
          </div>
        </div>
      ) : null}
      {linksFailed ? <ErrorState title={t('vendor.documents.linksFailed')} onRetry={loadLinks} retryLabel={t('common.tryAgain')} />
        : links == null ? <div aria-busy="true"><SkeletonText lines={3} /></div>
        : links.length === 0 ? <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="links-empty">{t('vendor.documents.noLinks')}</p>
        : (
          <ul className="space-y-2" aria-labelledby="doc-links-heading">
            {links.map(l => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-sm" data-testid={`doc-link-${l.id}`}>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {fmt(t('vendor.documents.linkN'), { n: l.n })}
                    <span id={`doc-link-status-${l.id}`} tabIndex={-1} className="outline-none">
                      {l.active
                        ? <Badge tone="success">{t('vendor.documents.active')}</Badge>
                        : <Badge tone="gray">{fmt(t('vendor.documents.turnedOff'), { date: eatDateTime(l.revokedAt, locale) })}</Badge>}
                    </span>
                    <Badge tone="default">{t(l.lang === 'sw' ? 'vendor.documents.langTagSw' : 'vendor.documents.langTagEn')}</Badge>
                  </p>
                  <p className="text-[var(--color-fg-tertiary)]">{fmt(t('vendor.documents.createdBy'), { date: eatDateTime(l.createdAt, locale), name: l.createdBy?.firstName || '—' })}</p>
                  <p className="text-[var(--color-fg-tertiary)]">{l.lastOpenedAt ? fmt(t('vendor.documents.lastOpened'), { date: eatDateTime(l.lastOpenedAt, locale) }) : t('vendor.documents.neverOpened')}</p>
                </div>
                {l.active && (
                  <Button variant="ghost" className="min-h-11 text-[var(--color-error-700)]" disabled={!!confirm}
                    aria-label={fmt(t('vendor.documents.revokeN'), { n: l.n })} onClick={() => setConfirm({ kind: 'one', link: l })} data-testid={`doc-link-revoke-${l.id}`}>
                    {t('vendor.documents.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      {activeLinks.length >= 2 && !confirm && (
        <div className="flex justify-end">
          <Button variant="secondary" className="min-h-11 text-[var(--color-error-700)]" onClick={() => setConfirm({ kind: 'all', n: activeLinks.length })} data-testid="links-revoke-all">
            {t('vendor.documents.revokeAll')}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onClose={close} title={fmt(t('vendor.documents.shareTitle'), { title, number: doc.number ?? '' }).trim()} size="lg">
      {view === 'share' ? shareView : linksView}
      <p className="sr-only" aria-live="polite" data-testid="share-live">{live}</p>
    </Dialog>
  );
}

