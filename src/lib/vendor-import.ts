// Vendor Smart Import (portal wizard). Contract: fitflex-functions #326 (functions/vendor-imports.mjs,
// docs/design/vendor-import-v1.md). The server parses, matches columns and checks rows; this file only uploads
// (multipart), reads the answers and drives the apply loop. No strings here: every label is an i18n key, except the
// server's own {en, sw} messages, which are shown as given.
import { ApiError, qs, request, requestBlob, requestForm, type VendorTools } from '@/lib/api';
import type { Locale, MessageKey } from '@/lib/i18n';
import { fmt } from '@/lib/vendor';

export type ImportEntity = 'products' | 'inventory' | 'profile';
export const IMPORT_ENTITIES: readonly ImportEntity[] = ['products', 'inventory', 'profile'];
export const isImportEntity = (v: unknown): v is ImportEntity => IMPORT_ENTITIES.includes(v as ImportEntity);
export type BatchStatus = 'mapping_required' | 'ready' | 'applying' | 'applied' | 'partial' | 'discarded';
export type RowStatus = 'valid' | 'needs_review' | 'invalid';
export type ApplyState = 'pending' | 'applied' | 'failed' | 'skipped';
export type Match = 'exact' | 'synonym' | 'fuzzy' | 'none';

export type LocalText = { en: string; sw: string };
export interface ImportCounts { total: number; valid: number; needs_review: number; invalid: number; pending: number; applied: number; failed: number; skipped: number }
export interface ImportBatch {
  id: string;
  entity: ImportEntity;
  status: BatchStatus;
  filename: string;
  sizeBytes: number;
  templateVersion: string | null;
  delimiter: string;
  counts: ImportCounts | null;
  createdBy: string;
  /** null until the first apply; then fixed for the batch's whole life. */
  includeNeedsReview: boolean | null;
  needsConfirmation: boolean;
  missingRequired: string[];
  createdAt: string;
  updatedAt: string;
  applyStartedAt: string | null;
  finishedAt: string | null;
}
export interface ImportColumn { source: string; field: string | null; match: Match; confirmed: boolean; sample: string[] }
export interface ImportIssue { code: string; field: string | null; severity: 'error' | 'warning' | 'info'; params?: Record<string, unknown>; message?: LocalText | null }
export interface ImportRow {
  id: string;
  rowNo: number;
  status: RowStatus;
  applyState: ApplyState;
  issues: ImportIssue[];
  values: Record<string, unknown>;
  resultId: string | null;
  lastError: { code: string; message: LocalText | null } | null;
  attempts: number;
}

/** The fields a file column can feed, per entity (mirrors the server's ENTITY_FIELDS; `image` is accepted and ignored). */
export const ENTITY_FIELDS: Record<ImportEntity, readonly string[]> = {
  products: ['name', 'price_tzs', 'stock', 'category', 'description', 'brand', 'sku', 'discount_price_tzs', 'cost_tzs', 'reorder_level', 'image'],
  inventory: ['sku', 'quantity', 'variant'],
  profile: ['businessName', 'description', 'businessCategory', 'contactNumber', 'email', 'address', 'businessHours'],
};
/** Must be matched before rows can be checked. */
export const REQUIRED_FIELDS: Record<ImportEntity, readonly string[]> = { products: ['name', 'price_tzs'], inventory: ['sku', 'quantity'], profile: [] };
/** Not an exact header match → the vendor confirms it. */
export const CRITICAL_FIELDS: Record<ImportEntity, readonly string[]> = { products: ['name', 'price_tzs', 'stock'], inventory: ['sku', 'quantity'], profile: [] };
export const MONEY_FIELDS = new Set(['price_tzs', 'discount_price_tzs', 'cost_tzs']);
export const FALLBACK_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 2000 };
/** The vendor account holder; staff never import the business profile (server: 403 profile_import_owner_only). */
export const isAccountHolder = (me: { userType?: string } | null | undefined) => me?.userType === 'vendor';

/** The tool is on (fails closed: missing = off) and the person has `import`. */
export const importOpen = (me: { permissions?: string[]; tools?: VendorTools } | null | undefined) =>
  !!me && me.tools?.import === true && !!me.permissions?.includes('import');
export function limitsOf(tools: VendorTools | null | undefined) {
  const l = tools?.importLimits;
  return {
    maxBytes: typeof l?.maxBytes === 'number' && l.maxBytes > 0 ? l.maxBytes : FALLBACK_LIMITS.maxBytes,
    maxRows: typeof l?.maxRows === 'number' && l.maxRows > 0 ? l.maxRows : FALLBACK_LIMITS.maxRows,
  };
}
export const megabytes = (bytes: number) => String(Math.round((bytes / (1024 * 1024)) * 10) / 10);

// ── Steps ──
export const IMPORT_STEPS = ['choose', 'upload', 'columns', 'check', 'confirm', 'result'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];
export const stepKey = (s: ImportStep) => `vendor.import.step.${s}` as MessageKey;

/** Rows were already applied or failed: the batch is being worked through (mapping edits are refused by the server). */
export const hasProgress = (b: ImportBatch) => (b.counts?.applied ?? 0) + (b.counts?.failed ?? 0) > 0;

/** Which step a batch sits at, from its status; for `ready` the vendor moves between check / confirm / columns themselves. */
export function stepOfBatch(batch: ImportBatch, view: 'columns' | 'check' | 'confirm' | null): ImportStep {
  switch (batch.status) {
    case 'mapping_required': return 'columns';
    case 'ready': return hasProgress(batch) ? 'confirm' : (view ?? 'check');
    case 'applying': return 'confirm';
    default: return 'result';
  }
}

// ── Words ──
export const statusKey = (s: string) => (['mapping_required', 'ready', 'applying', 'applied', 'partial', 'discarded'].includes(s) ? `vendor.import.status.${s}` : 'vendor.import.status.unknown') as MessageKey;
export const statusTone = (s: string): 'success' | 'warning' | 'gray' | 'brand' | 'info' =>
  s === 'applied' ? 'success' : s === 'partial' || s === 'mapping_required' ? 'warning' : s === 'discarded' ? 'gray' : s === 'applying' ? 'brand' : 'info';
export const entityKey = (e: string) => (isImportEntity(e) ? `vendor.import.entity.${e}` : 'vendor.import.entity.unknown') as MessageKey;
export const matchKey = (m: string) => (['exact', 'synonym', 'fuzzy', 'none'].includes(m) ? `vendor.import.match.${m}` : 'vendor.import.match.none') as MessageKey;
export const matchTone = (m: string): 'success' | 'info' | 'warning' | 'gray' => (m === 'exact' ? 'success' : m === 'synonym' ? 'info' : m === 'fuzzy' ? 'warning' : 'gray');
export const fieldKey = (f: string) => `vendor.import.field.${f}` as MessageKey;
export const severityTone = (s: string): 'danger' | 'warning' | 'gray' => (s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'gray');
export const rowStatusKey = (s: string) => `vendor.import.rowStatus.${s}` as MessageKey;
export const rowStatusTone = (s: string): 'success' | 'warning' | 'danger' => (s === 'valid' ? 'success' : s === 'needs_review' ? 'warning' : 'danger');

/** The labels of messages the portal holds itself (fallback when the server sends no text). */
type Translate = (k: MessageKey) => string;
type HasKey = (k: string) => k is MessageKey;

/** An issue in the active language: the server's {en, sw} text, else the portal's own wording for its code. */
export function issueText(issue: ImportIssue, locale: Locale, t: Translate, has: HasKey): string {
  const server = issue.message?.[locale];
  if (server) return server;
  const key = `vendor.import.issue.${issue.code}`;
  if (!has(key)) return t('vendor.import.issue.unknown');
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(issue.params ?? {})) if (typeof v === 'string' || typeof v === 'number') params[k] = v;
  const field = issue.params?.field ?? issue.field;
  params.field = typeof field === 'string' && has(fieldKey(field)) ? t(fieldKey(field)) : '';
  return fmt(t(key), params);
}
/** Why a row did not apply (lastError), in the active language. */
export const rowErrorText = (row: ImportRow, locale: Locale, t: Translate) =>
  row.lastError ? (row.lastError.message?.[locale] || t('vendor.import.rowError.generic')) : null;

/** What a refusal says: the server's text (with its reason) in the active language; else a calm generic line. */
export function errorText(err: unknown, locale: Locale, t: Translate): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: LocalText; reasonMessage?: LocalText } | null;
    const main = body?.message?.[locale];
    const why = body?.reasonMessage?.[locale];
    if (main) return why && why !== main ? `${main} ${why}` : main;
    if (err.status === 429) return t('vendor.import.err.rateLimited');
    if (err.status === 413) return t('vendor.import.err.tooLarge');
    if (err.status === 499 || (err.body as { error?: string } | null)?.error === 'request_aborted') return t('vendor.import.err.aborted');
    if (err.status >= 500) return t('vendor.import.err.server');
  }
  return err instanceof ApiError ? t('vendor.import.err.generic') : t('vendor.import.err.network');
}
export const apiCode = (err: unknown): string | null => (err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? null) : null);
export const apiBody = <T = Record<string, unknown>>(err: unknown): (T & { error?: string }) | null => (err instanceof ApiError ? ((err.body as (T & { error?: string }) | null) ?? null) : null);

// ── API ──
export const importApi = {
  list: (token: string, q: { status?: string; limit?: number; cursor?: string | null } = {}) =>
    request<{ batches: ImportBatch[]; nextCursor: string | null }>(`/vendor/imports${qs({ status: q.status, limit: q.limit ?? 50, cursor: q.cursor })}`, {}, token),
  get: (token: string, id: string) =>
    request<{ batch: ImportBatch; columns: ImportColumn[] }>(`/vendor/imports/${encodeURIComponent(id)}`, {}, token),
  upload: (token: string, entity: ImportEntity, file: File) => {
    const form = new FormData();
    form.append('entity', entity); // fields first: the server reads them before the file
    form.append('file', file, file.name);
    return requestForm<{ batch: ImportBatch }>('/vendor/imports', form, token);
  },
  putMapping: (token: string, id: string, mapping: Record<string, string | null>) =>
    request<{ batch: ImportBatch }>(`/vendor/imports/${encodeURIComponent(id)}/mapping`, { method: 'PUT', body: JSON.stringify({ mapping, confirm: true }) }, token),
  preview: (token: string, id: string, q: { status?: string; applyState?: string; limit?: number; cursor?: string | null } = {}) =>
    request<{ batch: ImportBatch; counts: ImportCounts; rows: ImportRow[]; nextCursor: string | null }>(
      `/vendor/imports/${encodeURIComponent(id)}/preview${qs({ status: q.status, applyState: q.applyState, limit: q.limit ?? 50, cursor: q.cursor })}`, {}, token),
  apply: (token: string, id: string, includeNeedsReview: boolean) =>
    request<{ batch: ImportBatch; processed: number; remaining: number }>(`/vendor/imports/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ includeNeedsReview }) }, token),
  retry: (token: string, id: string) =>
    request<{ batch: ImportBatch; processed: number; remaining: number }>(`/vendor/imports/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }, token),
  discard: (token: string, id: string) =>
    request<{ batch: ImportBatch }>(`/vendor/imports/${encodeURIComponent(id)}/discard`, { method: 'POST', body: '{}' }, token),
  errorsCsv: (token: string, id: string) => requestBlob(`/vendor/imports/${encodeURIComponent(id)}/errors.csv`, token, `import-${id}-errors.csv`),
  template: (token: string, entity: ImportEntity, lang: 'en' | 'sw', example: boolean) =>
    requestBlob(`/vendor/imports/template${qs({ entity, lang, example: example ? 1 : 0 })}`, token, `fitflex-import-${entity}-${lang}.csv`),
};

// ── Mapping ──
export type ColumnDraft = { source: string; initialField: string | null; field: string | null; match: Match; confirmed: boolean; sample: string[]; ticked: boolean };
export const draftsOf = (columns: ImportColumn[]): ColumnDraft[] =>
  columns.map(c => ({ source: c.source, initialField: c.field, field: c.field, match: c.match, confirmed: c.confirmed, sample: c.sample, ticked: false }));
/** A suggested match the vendor must confirm: a critical field that is not an exact header match, or any fuzzy match. */
export function needsTick(entity: ImportEntity, c: ColumnDraft): boolean {
  if (!c.field || c.field !== c.initialField || c.confirmed) return false; // picking a field by hand is the confirmation
  return (CRITICAL_FIELDS[entity].includes(c.field) && c.match !== 'exact') || c.match === 'fuzzy';
}
export type MappingProblem = { kind: 'missing'; fields: string[] } | { kind: 'duplicate'; field: string } | { kind: 'none' } | { kind: 'confirm'; sources: string[] } | null;
/** What still blocks "Continue" (checked in this order). */
export function mappingProblem(entity: ImportEntity, drafts: ColumnDraft[]): MappingProblem {
  const mapped = drafts.filter(d => d.field);
  const seen = new Set<string>();
  for (const d of mapped) {
    if (d.field === 'image') continue;
    if (seen.has(d.field as string)) return { kind: 'duplicate', field: d.field as string };
    seen.add(d.field as string);
  }
  const missing = REQUIRED_FIELDS[entity].filter(f => !mapped.some(d => d.field === f));
  if (missing.length) return { kind: 'missing', fields: missing };
  if (!mapped.some(d => d.field && d.field !== 'image')) return { kind: 'none' };
  const pending = drafts.filter(d => needsTick(entity, d) && !d.ticked).map(d => d.source);
  return pending.length ? { kind: 'confirm', sources: pending } : null;
}
/** Every column, explicitly: { "<header>": field | null }. */
export const mappingBody = (drafts: ColumnDraft[]): Record<string, string | null> => Object.fromEntries(drafts.map(d => [d.source, d.field]));

// ── Apply loop ──
export const isTerminal = (status: string | undefined) => status === 'applied' || status === 'partial' || status === 'discarded';
/** Rows this batch will try: valid rows, plus needs-review rows when the batch includes them. */
export const eligibleCount = (counts: ImportCounts | null, includeNeedsReview: boolean) => (counts ? counts.valid + (includeNeedsReview ? counts.needs_review : 0) : 0);

export type ApplyOutcome =
  | { kind: 'done'; batch: ImportBatch }
  | { kind: 'paused'; reason: 'busy' | 'rate' | 'network'; batch: ImportBatch | null }
  | { kind: 'failed'; error: unknown };

export interface DriveOptions {
  token: string;
  id: string;
  includeNeedsReview: boolean;
  /** 'retry' for the failed rows of a partly imported batch; later calls continue with apply (the server keeps the choice). */
  first: 'apply' | 'retry';
  onProgress: (batch: ImportBatch, remaining: number) => void;
  /** Called between calls: true stops the loop (the page was left). */
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** How many waits in a row before the calm "still busy" message. */
  maxWaits?: number;
  baseDelayMs?: number;
}
/**
 * A refused call may mean the batch finished meanwhile. For a retry, a terminal `partial` read is NOT proof: it may be the
 * state from before the retry (failed rows still waiting), so it counts as finished only when nothing failed.
 */
const finishedFor = (call: 'apply' | 'retry', b: ImportBatch) => isTerminal(b.status) && (call === 'apply' || (b.counts?.failed ?? 0) === 0);
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Repeats POST /apply (or /retry first) until the batch is applied or partial. 409 apply_in_progress, 503 import_busy,
 * 429 rate_limited and a dropped connection are waited out with backoff (Retry-After honoured), then end in a calm
 * `paused` result; the vendor can continue. Any other refusal ends as `failed`.
 */
export async function driveApply(o: DriveOptions): Promise<ApplyOutcome> {
  const sleep = o.sleep ?? wait;
  const maxWaits = o.maxWaits ?? 5;
  const base = o.baseDelayMs ?? 1500;
  let call: 'apply' | 'retry' = o.first;
  let waits = 0;
  let last: ImportBatch | null = null;
  for (;;) {
    if (o.shouldStop?.()) return { kind: 'paused', reason: 'busy', batch: last };
    const attempted = call;
    try {
      const res = call === 'retry' ? await importApi.retry(o.token, o.id) : await importApi.apply(o.token, o.id, o.includeNeedsReview);
      call = 'apply';
      waits = 0;
      last = res.batch;
      o.onProgress(res.batch, res.remaining);
      if (res.remaining <= 0 || isTerminal(res.batch.status)) {
        if (isTerminal(res.batch.status)) return { kind: 'done', batch: res.batch };
        // remaining 0 but the status has not moved: read it once more.
        const fresh = await importApi.get(o.token, o.id).catch(() => null);
        if (fresh && isTerminal(fresh.batch.status)) return { kind: 'done', batch: fresh.batch };
        return { kind: 'done', batch: fresh?.batch ?? res.batch };
      }
    } catch (err) {
      const code = apiCode(err);
      const transient = !(err instanceof ApiError) || code === 'apply_in_progress' || code === 'import_busy' || code === 'rate_limited';
      if (!transient) {
        // Someone (an earlier request of ours) may have finished the batch already.
        if (code === 'not_ready') {
          const fresh = await importApi.get(o.token, o.id).catch(() => null);
          if (fresh && finishedFor(attempted, fresh.batch)) return { kind: 'done', batch: fresh.batch };
        }
        return { kind: 'failed', error: err };
      }
      const reason = !(err instanceof ApiError) ? 'network' : code === 'rate_limited' ? 'rate' : 'busy';
      if (code === 'apply_in_progress') {
        // Our own earlier request may still be running, or has just finished.
        const fresh = await importApi.get(o.token, o.id).catch(() => null);
        if (fresh) { last = fresh.batch; if (finishedFor(attempted, fresh.batch)) return { kind: 'done', batch: fresh.batch }; }
      }
      if (waits >= maxWaits) return { kind: 'paused', reason, batch: last };
      const retryAfter = Number(apiBody<{ retryAfterSeconds?: number }>(err)?.retryAfterSeconds);
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(base * 2 ** waits, 12_000);
      waits += 1;
      await sleep(delay);
    }
  }
}

/** "TSh 1,500" (English digits grouping in both languages, as elsewhere in the vendor area). */
export const tshText = (n: number) => `TSh ${new Intl.NumberFormat('en-US').format(Number(n || 0))}`;
/** A checked value for the row list: money as TSh, text as is, empty as null. */
export function valueText(field: string, value: unknown, t?: Translate): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return tshText(value);
  if (typeof value === 'boolean') return t ? t(value ? 'vendor.import.yes' : 'vendor.import.no') : null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

import { messages } from '@/lib/i18n';
/** Whether the portal holds its own wording for a key (used for the fallback text of server codes). */
export const hasMessageKey = (k: string): k is MessageKey => k in messages.en;
