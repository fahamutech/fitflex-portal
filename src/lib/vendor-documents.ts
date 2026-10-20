// Vendor documents and VAT (vendor business tools S5): share links, the logged-in document view (JSON / HTML /
// PDF), link lists and revoking, the vendor tax profile, VAT codes, admin tax rates (maker ≠ checker) and the
// KYC reviewer's VAT decision. Contract: fitflex-functions #229 (functions/vendor-documents.mjs, vendor-tax.mjs).
// No strings here: every label is an i18n key.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, qs, request } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { fmt, receiptDateTime, receiptDay, saleMethodLabel } from '@/lib/vendor';

// ── Documents ──

/** The document kinds the routes take (`/vendor/documents/:docType/:docId`, link lists). */
export type DocKind = 'sale' | 'payment' | 'statement' | 'order';
export const DOC_KINDS: readonly DocKind[] = ['sale', 'payment', 'statement', 'order'];
export const isDocKind = (v: string | null | undefined): v is DocKind => !!v && (DOC_KINDS as readonly string[]).includes(v);
export type DocLang = 'en' | 'sw';
export type DocPaper = 'a4' | '80mm';

/** What the document JSON calls itself. */
export type DocType = 'receipt' | 'invoice' | 'payment_receipt' | 'statement' | 'order_invoice' | 'credit_note';

/** GET /vendor/documents/:docType/:docId?format=json → { doc }. Never phone, email, address, cost, commission or payout. */
export interface VendorDocument {
  docType: DocType;
  number: string | null;
  saleRef?: string | null;
  orderShortRef?: string | null;
  status: 'paid' | 'pay_later' | 'paid_in_full' | 'cancelled' | null;
  issuedAt: string;
  lang: DocLang;
  seller: { businessName: string; logoUrl: string | null; address: string | null; contactNumber: string | null; tin?: string | null; vrn?: string | null };
  soldVia?: string | null;
  customer?: { name: string | null } | null;
  servedBy?: { firstName: string | null } | null;
  dueDate?: string | null;
  lines: Array<{ name: string; variant: string | null; qty: number; unitPriceTzs: number; discountTzs: number; amountTzs: number; vatCode?: string | null }>;
  subtotalTzs: number;
  discountsTzs: number;
  totalTzs: number;
  vatIncludedTzs: number;
  vatSummary: Array<{ code: string; ratePct: number | null; netTzs: number; vatTzs: number }>;
  payments: Array<{ method: string; reference?: string | null; amountTzs: number }>;
  changeTzs: number;
  paidNowTzs?: number;
  liveStatus?: { asOf: string; balanceTzs: number; paidInFullAt?: string | null; paidWith: string[] } | null;
  paidTowards?: Array<{ number: string; amountTzs: number }>;
  stillOwedTzs?: number | null;
  receivedOn?: string | null;
  paymentMethod?: string | null;
  statement?: {
    asOf: string;
    openSales: Array<{ number: string; soldAt: string; dueDate: string | null; totalTzs: number; balanceTzs: number; daysOverdue: number }>;
    recentPayments: Array<{ number: string; receivedOn: string; method: string; amountTzs: number }>;
    totalOwedTzs: number;
    aging: Record<string, number>;
  } | null;
  cancelledAt?: string | null;
}

/** POST …/share → the link. `url` is shown once (only its hash is stored); `texts` are ready to send in both languages. */
export interface DocumentShare {
  linkId: string;
  url: string;
  lang: DocLang;
  docType: DocType;
  docId: string;
  number: string | null;
  texts: Record<DocLang, { whatsapp: string; sms: string }>;
  whatsappText: string;
  smsText: string;
}

/** A link of one document (GET /vendor/document-links). Never its URL. */
export interface DocumentLink {
  id: string;
  n: number;
  docType: DocType;
  docId: string;
  lang: DocLang;
  createdAt: string;
  createdBy: { id: string; firstName: string | null } | null;
  lastOpenedAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

/** The share route of a document. A payment receipt is shared under its customer. */
export function sharePath(kind: DocKind, id: string, customerId?: string | null) {
  const e = encodeURIComponent;
  if (kind === 'sale') return `/vendor/sales/${e(id)}/share`;
  if (kind === 'order') return `/vendor/orders/${e(id)}/share`;
  if (kind === 'statement') return `/vendor/customers/${e(id)}/statement/share`;
  return customerId ? `/vendor/customers/${e(customerId)}/payments/${e(id)}/share` : null;
}

/** An authenticated non-JSON answer (the HTML page for the iframe, the PDF). Errors carry the JSON body. */
async function raw(path: string, token: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, body);
  }
  return res;
}

const docPath = (kind: DocKind, id: string) => `/vendor/documents/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;

export const documentsApi = {
  view: (token: string, kind: DocKind, id: string, lang: DocLang) =>
    request<{ doc: VendorDocument }>(`${docPath(kind, id)}${qs({ format: 'json', lang })}`, {}, token),
  /** The server's HTML (no script) for a sandboxed iframe. Never put into the page's own DOM. */
  html: async (token: string, kind: DocKind, id: string, lang: DocLang) =>
    (await raw(`${docPath(kind, id)}${qs({ format: 'html', lang })}`, token)).text(),
  pdf: async (token: string, kind: DocKind, id: string, lang: DocLang, paper: DocPaper) => {
    const res = await raw(`${docPath(kind, id)}${qs({ format: 'pdf', lang, paper })}`, token);
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
    return { blob: await res.blob(), fileName: name };
  },
  share: (token: string, path: string, lang: DocLang) =>
    request<DocumentShare>(path, { method: 'POST', body: JSON.stringify({ lang }) }, token),
  links: (token: string, kind: DocKind, id: string) =>
    request<{ links: DocumentLink[]; activeCount: number }>(`/vendor/document-links${qs({ docType: kind, docId: id })}`, {}, token),
  revoke: (token: string, linkId: string) =>
    request<{ link: DocumentLink }>(`/vendor/documents/${encodeURIComponent(linkId)}/revoke`, { method: 'POST', body: '{}' }, token),
  revokeAll: (token: string, kind: DocKind, id: string) =>
    request<{ links: DocumentLink[]; revokedCount: number }>('/vendor/document-links/revoke', { method: 'POST', body: JSON.stringify({ docType: kind, docId: id }) }, token),
};

/** The vendor permissions that open a kind (§0.3; the server checks the exact one per document). */
export const KIND_PERMISSIONS: Record<DocKind, readonly string[]> = {
  sale: ['sales', 'customers'], payment: ['customers'], statement: ['customers'], order: ['orders'],
};
export const mayOpenKind = (kind: DocKind, permissions: readonly string[] | null | undefined) =>
  KIND_PERMISSIONS[kind].some(p => (permissions ?? []).includes(p));

/** The document view's address (static export: query strings only). */
export function documentHref(kind: DocKind, id: string, customerId?: string | null) {
  return `/vendor/documents/${qs({ type: kind, id, customer: customerId ?? undefined })}`;
}

/** The link in the other language, without making a new link (§2.2): the server's own rule for `?lang=`. */
export function linkUrlFor(share: Pick<DocumentShare, 'url' | 'lang'>, lang: DocLang) {
  const plain = share.url.replace(/\?.*$/, '');
  if (lang === 'sw') return `${plain}?lang=sw`;
  return share.lang === 'en' ? plain : `${plain}?lang=en`;
}

/** wa.me with the walk-in customer's phone as digits (no "+"), or the chat picker when there is none. */
export function whatsappUrl(text: string, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const docTitleKey = (docType: DocType | string) => {
  const known: Record<string, MessageKey> = {
    receipt: 'vendor.documents.type.receipt', invoice: 'vendor.documents.type.invoice', payment_receipt: 'vendor.documents.type.payment_receipt',
    statement: 'vendor.documents.type.statement', order_invoice: 'vendor.documents.type.order_invoice', credit_note: 'vendor.documents.type.credit_note',
  };
  return known[docType] ?? 'vendor.documents.viewTitle';
};

const amountOnly = (n: number) => new Intl.NumberFormat('en-US').format(Number(n || 0));
const tsh = (n: number) => `TSh ${amountOnly(n)}`;

/**
 * "Share as text" from the document JSON, in `t`'s language (the S3/S4 text layout). Customer name only; never
 * phone, email or address (the JSON has none). `url` adds the "View: {url}" line when a link exists.
 */
export function documentText(doc: VendorDocument, opts: { locale: Locale; t: (k: MessageKey) => string; url?: string | null }) {
  const { t, locale } = opts;
  const rule = '-'.repeat(20);
  const title = t(docTitleKey(doc.docType));
  const out: string[] = [doc.seller.businessName, doc.number ? `${title} ${doc.number}` : title];
  if (doc.statement) out.push(fmt(t('vendor.customers.asOf'), { date: receiptDay(doc.statement.asOf, locale) }));
  else out.push(receiptDateTime(doc.issuedAt, locale));
  if (doc.saleRef) out.push(fmt(t('vendor.documents.saleRef'), { number: doc.saleRef }));
  if (doc.orderShortRef) out.push(fmt(t('vendor.orders.ref'), { ref: doc.orderShortRef }));
  if (doc.customer?.name) out.push(fmt(t('vendor.receipt.customer'), { name: doc.customer.name }));
  out.push(rule);
  for (const l of doc.lines) {
    out.push(`${l.qty} x ${l.name}${l.variant ? ` (${l.variant})` : ''}  ${amountOnly(l.amountTzs)}${l.vatCode ? ` ${l.vatCode}` : ''}`);
  }
  if (doc.lines.length) {
    out.push(rule, `${t('vendor.pos.subtotal')}  ${amountOnly(doc.subtotalTzs)}`);
    if (doc.discountsTzs > 0) out.push(`${t('vendor.pos.discounts')}  -${amountOnly(doc.discountsTzs)}`);
    out.push(`${t('vendor.pos.total')}  ${tsh(doc.totalTzs)}`);
    if (doc.vatIncludedTzs > 0) out.push(fmt(t('vendor.documents.includesVat'), { amount: tsh(doc.vatIncludedTzs) }));
  }
  for (const p of doc.payments) out.push(`${saleMethodLabel(p.method, t)}${p.reference ? ` (${p.reference})` : ''}  ${amountOnly(p.amountTzs)}`);
  if (doc.changeTzs > 0) out.push(`${t('vendor.pos.change')}  ${amountOnly(doc.changeTzs)}`);
  if (doc.paidTowards?.length) {
    out.push(`${t('vendor.pay.paidTowards')}:`);
    for (const a of doc.paidTowards) out.push(`${a.number}  ${amountOnly(a.amountTzs)}`);
  }
  if (typeof doc.stillOwedTzs === 'number') out.push(`${t('vendor.pay.stillOwed')}  ${tsh(doc.stillOwedTzs)}`);
  if (doc.liveStatus) out.push(`${t('vendor.receipt.balanceDue')}  ${tsh(doc.liveStatus.balanceTzs)}`);
  if (doc.statement) {
    for (const s of doc.statement.openSales) out.push(`${s.number}  ${amountOnly(s.balanceTzs)}`);
    out.push(`${t('vendor.statement.totalOwed')}  ${tsh(doc.statement.totalOwedTzs)}`);
  }
  out.push(rule, t('vendor.pos.notFiscal'));
  if (opts.url) out.push(fmt(t('vendor.documents.textLinkLine'), { url: opts.url }));
  return out.join('\n');
}

const slug = (text: string | null | undefined) => (String(text || 'document').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase()
  .replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'document');
/**
 * The PDF's file name when the server's Content-Disposition can't be read (cross-origin, not exposed): the server's
 * own rule (§8.1) — {number}_{business-slug}.pdf; statement_{customer-initials}_{YYYY-MM-DD}.pdf (no full name).
 */
export function pdfName(doc: Pick<VendorDocument, 'number' | 'docType' | 'seller' | 'customer' | 'statement' | 'issuedAt'> | null) {
  if (!doc) return 'document.pdf';
  if (doc.docType === 'statement') {
    const initials = String(doc.customer?.name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'X';
    const asOf = doc.statement?.asOf || new Date(Date.parse(doc.issuedAt) + 3 * 3_600_000).toISOString().slice(0, 10);
    return `statement_${initials}_${String(asOf).slice(0, 10)}.pdf`;
  }
  return `${String(doc.number || 'document').replace(/[^A-Za-z0-9._-]/g, '_')}_${slug(doc.seller?.businessName)}.pdf`;
}

// ── Vendor tax profile and VAT codes ──

export type TaxStatus = 'none' | 'pending' | 'verified' | 'rejected';
export const VAT_REJECT_REASONS = ['unreadable', 'number_mismatch', 'name_mismatch', 'not_vat_certificate', 'other'] as const;
export type VatRejectReason = (typeof VAT_REJECT_REASONS)[number];

export interface TaxProfile {
  vatRegistered: boolean;
  tin: string | null;
  tinFromKyc: boolean;
  vrn: string | null;
  certificateDocumentId: string | null;
  pricesIncludeVat: true;
  status: TaxStatus;
  rejectReason: VatRejectReason | null;
  rejectNote: string | null;
  verifiedAt: string | null;
  inForce: boolean;
  changePending: boolean;
  verified: { tin: string | null; vrn: string | null; certificateDocumentId: string | null; verifiedAt: string; certificateStands: boolean } | null;
  pending: { tin: string | null; vrn: string | null; certificateDocumentId: string | null; submittedAt: string | null } | null;
  updatedAt: string | null;
}

export interface TaxProfileInput {
  vatRegistered: boolean;
  tin?: string;
  vrn?: string;
  certificateDocumentId?: string;
  updatedAt?: string;
}

/** A KYC document row as GET /me/kyc and the upload return it (the file stays private: hasFile only). */
export interface OwnKycDocument { id: string; requirementKey: string; status: string; hasFile: boolean; fileName: string | null; mimeType: string | null; createdAt: string }

export const VAT_CERT_KEY = 'vat_certificate';
/** The vendor's current VAT certificate in a KYC overview (newest, not superseded). */
export function currentVatCertificate(docs: OwnKycDocument[] | null | undefined) {
  return [...(docs ?? [])].filter(d => d.requirementKey === VAT_CERT_KEY && d.status !== 'superseded')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

/** The TIN as the server stores it: digits only (dashes and spaces removed). 9 digits. */
export const cleanTin = (raw: string) => raw.replace(/[\s-]/g, '');
export const isTin = (v: string) => /^\d{9}$/.test(v);
/** The VRN: 8–15 letters or digits after dashes and spaces are removed (format to confirm, Q-12). */
export const cleanVrn = (raw: string) => raw.trim();
export const isVrn = (v: string) => /^[A-Za-z0-9]{8,15}$/.test(v.replace(/[\s-]/g, ''));

export const taxApi = {
  profile: (token: string) => request<{ taxProfile: TaxProfile }>('/vendor/tax-profile', {}, token),
  save: (token: string, body: TaxProfileInput) =>
    request<{ taxProfile: TaxProfile }>('/vendor/tax-profile', { method: 'PUT', body: JSON.stringify(body) }, token),
  myKyc: (token: string) => request<{ documents?: OwnKycDocument[] }>('/me/kyc', {}, token),
  /** multipart/form-data, field "file" (PDF, JPEG, PNG or WebP, up to 10 MB) → the KYC overview. */
  uploadCertificate: async (token: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${API_BASE}/me/kyc/documents/${VAT_CERT_KEY}/file`, {
      method: 'POST', body: form, headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    return body as { documents?: OwnKycDocument[] };
  },
  certificateFile: async (token: string, documentId: string) =>
    (await raw(`/me/kyc/documents/${encodeURIComponent(documentId)}/file`, token)).blob(),
};

// ── Admin: tax rates (scope `payments`, maker ≠ checker) and the KYC VAT section (scope `kyc`) ──

export type TaxRateStatus = 'active' | 'scheduled' | 'ended' | 'pending' | 'rejected' | 'withdrawn';
export interface TaxRate {
  id: string;
  code: string;
  nameEn: string | null;
  nameSw: string | null;
  ratePct: number | null;
  exempt: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: TaxRateStatus;
  reason: string | null;
  proposedBy: string;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  history: Array<{ action: string; actor: string; at: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
}
export interface TaxCode { code: string; nameEn: string; nameSw: string; exempt: boolean; inUse: boolean; status: 'active' | 'no_rate' | 'unused' }
export interface TaxRatesPage { asOf: string; codes: TaxCode[]; rates: TaxRate[] }
export interface TaxRateProposal { code: string; ratePct?: number; exempt?: true; effectiveFrom: string; reason: string }

export interface AdminVendorVat {
  vendorId: string;
  taxProfile: TaxProfile;
  kycCaseId: string | null;
  kycTin: string | null;
  tinMismatch: boolean;
  certificate: { id: string; status: string; fileName: string | null; mimeType: string | null; uploadedAt: string | null } | null;
}

export const adminTaxApi = {
  rates: (token: string) => request<TaxRatesPage>('/admin/tax-rates', {}, token),
  propose: (token: string, body: TaxRateProposal) =>
    request<{ rate: TaxRate }>('/admin/tax-rates', { method: 'POST', body: JSON.stringify(body) }, token),
  decide: (token: string, id: string, action: 'approve' | 'reject' | 'withdraw', reason?: string) =>
    request<{ rate: TaxRate }>(`/admin/tax-rates/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }, token),
  vendorVat: (token: string, vendorId: string) => request<AdminVendorVat>(`/admin/kyc/vendors/${encodeURIComponent(vendorId)}/vat`, {}, token),
  verifyVat: (token: string, vendorId: string) =>
    request<AdminVendorVat>(`/admin/kyc/vendors/${encodeURIComponent(vendorId)}/vat/verify`, { method: 'POST', body: '{}' }, token),
  rejectVat: (token: string, vendorId: string, body: { reason: VatRejectReason; note?: string }) =>
    request<AdminVendorVat>(`/admin/kyc/vendors/${encodeURIComponent(vendorId)}/vat/reject`, { method: 'POST', body: JSON.stringify(body) }, token),
};

/** Tomorrow on the EAT calendar, "YYYY-MM-DD" (the earliest a rate may start). */
export const eatTomorrow = (now = new Date()) => new Date(now.getTime() + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
