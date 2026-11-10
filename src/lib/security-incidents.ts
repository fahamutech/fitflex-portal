// Security reports (S4b): a member says a web check-in was not theirs, and staff work the report.
// Contract: fitflex-functions docs/security-incident-report-api.md (functions/security-activity.mjs,
// src/services/security-incident-service.mjs). Scope `security_incidents`. While the server's
// SECURITY_INCIDENT_REPORTS is off every route answers 404 { error: "feature_disabled" }.
// Resolving never voids the check-in or changes visits, payouts or settlement.
import { ApiError, qs, request } from './api';
import type { Locale, MessageKey } from './i18n';
import { clock } from './events';

export type SecurityIncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type SecurityIncidentOutcome = 'unauthorised_confirmed' | 'authorised_by_member' | 'inconclusive';

/** What the member's event looked like when it was reported. No IP, user agent or session is ever stored. */
export interface SecurityIncidentSnapshot {
  kind?: string | null;
  eventId?: string | null;
  gymId?: string | null;
  gymName?: string | null;
  occurredAt?: string | null;
  channel?: string | null;
}

/** The protection record as stored on the incident (staff see the raw record, including `failed`). */
export interface SecurityIncidentProtection {
  requested?: boolean;
  applied?: boolean;
  limited?: boolean;
  sessionsEnded?: boolean;
  pinResetRequired?: boolean | 'not_applicable';
  failed?: boolean;
  failure?: string;
}

export interface SecurityIncident {
  id: string;
  userId: string;
  eventId: string;
  status: SecurityIncidentStatus;
  outcome: SecurityIncidentOutcome | null;
  snapshot: SecurityIncidentSnapshot | null;
  protection: SecurityIncidentProtection | null;
  opsExceptionId: string | null;
  reportedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
}

export interface SecurityIncidentEvent {
  id: string;
  kind: string;
  actor: string | null;
  detail: Record<string, unknown> | null;
  at: string | null;
}

export interface SecurityIncidentDetail { incident: SecurityIncident; events: SecurityIncidentEvent[] }

export const SECURITY_INCIDENT_STATUSES: SecurityIncidentStatus[] = ['open', 'acknowledged', 'resolved'];
export const SECURITY_INCIDENT_OUTCOMES: SecurityIncidentOutcome[] = ['unauthorised_confirmed', 'authorised_by_member', 'inconclusive'];
/** Same limits as the server (REASON_MIN / REASON_MAX), counted on the trimmed text. */
export const SECURITY_REASON_MIN = 10;
export const SECURITY_REASON_MAX = 500;

/** Incident ids are letters, digits and underscores (sin_…). Anything else in ?id= never reaches the API. */
export const isSecurityIncidentId = (id: string | null | undefined): id is string => !!id && /^[A-Za-z0-9_]+$/.test(id);

const base = '/admin/security-incidents';
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

export const securityIncidentsApi = {
  /** Newest first. `next` is opaque: pass it back as `before` for the following page. */
  list: (token: string, status: SecurityIncidentStatus, before?: string) =>
    request<{ incidents: SecurityIncident[]; next?: string }>(`${base}${qs({ status, before })}`, {}, token),
  get: (token: string, id: string) => request<SecurityIncidentDetail>(one(id), {}, token),
  acknowledge: (token: string, id: string) => request<SecurityIncidentDetail>(`${one(id)}/acknowledge`, { method: 'POST' }, token),
  resolve: (token: string, id: string, body: { outcome: SecurityIncidentOutcome; reason: string }) =>
    request<SecurityIncidentDetail>(`${one(id)}/resolve`, { method: 'POST', body: JSON.stringify(body) }, token),
};

export const SECURITY_STATUS_TONE: Record<SecurityIncidentStatus, 'warning' | 'info' | 'success'> = {
  open: 'warning', acknowledged: 'info', resolved: 'success',
};

/** What happened to the "secure my account" request, as staff should read it. */
export type ProtectionState = 'not_requested' | 'applied' | 'limited' | 'failed' | 'pending';
export function protectionState(p: SecurityIncidentProtection | null | undefined): ProtectionState {
  if (!p?.requested) return 'not_requested';
  if (p.failed) return 'failed';
  if (p.limited) return 'limited';
  if (p.applied || p.sessionsEnded) return 'applied';
  return 'pending';
}
export const PROTECTION_TONE: Record<ProtectionState, 'gray' | 'success' | 'warning' | 'danger'> = {
  not_requested: 'gray', applied: 'success', limited: 'warning', failed: 'danger', pending: 'warning',
};

/** Trail kinds the server writes; anything else is shown with a general label. */
const TRAIL_KINDS = ['reported', 'protection', 'acknowledged', 'resolved'];
export const trailKey = (kind: string): MessageKey =>
  (TRAIL_KINDS.includes(kind) ? `secInc.trail.${kind}` : 'secInc.trail.other') as MessageKey;

/**
 * Always Dar es Salaam time, whatever the staff member's own clock is; the caller labels it EAT.
 * English "9 Nov 2026, 08:30"; Swahili keeps the date and uses the portal's 12-hour clock with the part of the day.
 */
export function eatTime(iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString(locale === 'sw' ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium', timeZone: EAT_ZONE });
  return `${date}, ${clock(d, EAT_ZONE, locale)}`;
}

const EAT_ZONE = 'Africa/Dar_es_Salaam';

export type SecurityFailure = 'off' | 'forbidden' | 'not_found' | 'conflict' | 'invalid_reason' | 'invalid_outcome' | 'error';

/**
 * How a refused request should be shown. A 404 means the feature is not there yet (flag off, or a backend without
 * the routes), except 404 `not_found` on one report. Only an ACL refusal reads as "ask for the permission"; other
 * 403s (e.g. account_suspended) are a general error.
 */
export function securityFailure(err: unknown, list = false): SecurityFailure {
  if (!(err instanceof ApiError)) return 'error';
  const code = (err.body as { error?: string } | null)?.error ?? '';
  if (err.status === 404) return code === 'not_found' && !list ? 'not_found' : 'off';
  if (err.status === 403) return code === 'acl_forbidden' || code === 'forbidden' ? 'forbidden' : 'error';
  if (err.status === 409) return 'conflict';
  if (err.status === 400 && code === 'invalid_reason') return 'invalid_reason';
  if (err.status === 400 && code === 'invalid_outcome') return 'invalid_outcome';
  return 'error';
}
