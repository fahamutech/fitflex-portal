import { request } from './api';

/** GET /admin/audit-log (functions docs/audit-log-api.md). Scope `audit`; keyset pagination; before/after arrive already redacted. */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

export interface AuditFilters { actor: string; action: string; target: string; from: string; to: string }
export const NO_AUDIT_FILTERS: AuditFilters = { actor: '', action: '', target: '', from: '', to: '' };

/** The server's page cap is 200; the default is 50. */
export const AUDIT_PAGE = 50;

/** A datetime-local value (browser local time) as an ISO instant; '' when empty or not a date. */
export function isoOf(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function auditQuery(f: AuditFilters, cursor?: string | null): string {
  const q = new URLSearchParams();
  q.set('limit', String(AUDIT_PAGE));
  if (f.actor.trim()) q.set('actor', f.actor.trim());
  if (f.action.trim()) q.set('action', f.action.trim());
  if (f.target.trim()) q.set('target', f.target.trim());
  const from = isoOf(f.from); if (from) q.set('from', from);
  const to = isoOf(f.to); if (to) q.set('to', to);
  if (cursor) q.set('cursor', cursor);
  return q.toString();
}

export const auditApi = {
  list: (token: string, f: AuditFilters, cursor?: string | null) =>
    request<{ items: AuditEntry[]; nextCursor: string | null }>(`/admin/audit-log?${auditQuery(f, cursor)}`, {}, token),
};

/** A before/after value as indented text. Plain text only: the caller renders it as a React text node. */
export function auditText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
