// Events S7 API client (spec docs/design/events-s7-hardening-and-pilot.md §3.13, §4.9, §5.7, §6.1, §8). Kept out of api.ts so the slice
// does not overlap other open api.ts changes. Every write carries an `Idempotency-Key` (8 to 100 chars). No function takes a user id.
import { qs, request } from '@/lib/api';

const ev = (eventId: string) => `/organizer/events/${encodeURIComponent(eventId)}`;
const idem = (key: string) => ({ 'Idempotency-Key': key });
const post = <T,>(token: string, path: string, body: unknown, key: string) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers: idem(key) }, token);
type Page<T> = { items: T[]; nextCursor?: string | null };

// ── Offline kit desk (§3.13) ──
export interface BibRange { prefix: string; padTo: number; start: number; end: number }
export type DeskStatus = 'active' | 'revoked' | 'expired';
export interface OfflineDevice { id: string; label: string; status: DeskStatus; issuedAt: string; expiresAt: string; bibRange: BibRange | null }
export interface OfflineLimits { sessionHours: number; maxPending: number; clockToleranceSeconds: number; syncBatch: number }
export interface PrepareDeskBody { label: string; clientKind: 'web'; deskBuild: string; bibRange?: { prefix?: string; padTo?: number; start: number; end: number } }
export interface PrepareDeskResult { device: OfflineDevice; limits: OfflineLimits; serverTime: string; warnings?: Array<{ code: string; count?: number }> }
export interface OfflineDeviceRow {
  id: string; label: string; status: DeskStatus; bibRange: BibRange | null; bibsRecorded: number; bibExceptions: number; staffFirstName: string | null;
  issuedAt: string; expiresAt: string; lastSyncAt: string | null; lastHeartbeatAt: string | null; pendingReported: number; discardedReported: number;
  snapshotRows: number; snapshotSeq: number | null; deskBuild: string | null;
}
/** A ticket-list row as the server sends it. The desk reads it through `normaliseRow` (desk-logic.ts), so a harmless shape difference degrades instead of breaking. */
export type RawSnapshotRow = Record<string, unknown>;
export interface SnapshotHeader {
  snapshotSeq: number; takenAt: string; serverTime: string; validUntil: string;
  event: { status: string; timezone: string; kitProvided: boolean };
  collectionPoints: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }>; rowCount: number;
}
export interface SnapshotPage { header: SnapshotHeader; rows: RawSnapshotRow[]; removed?: string[]; nextCursor?: string | null }
export interface HeartbeatBody { deviceId: string; pending: number; oldestPendingAt: string | null; discarded: number; deskBuild: string; clockOffsetMs: number }
export interface HeartbeatResult { serverTime: string; deviceStatus: DeskStatus; minDeskBuild?: string | number }
export type SyncMethod = 'scan' | 'manual';
export interface SyncItem {
  clientRef: string; method: SyncMethod; payload?: string; registrationId?: string; manualReason?: string; collectionPointId?: string; kitSize?: string; bibNumber?: string;
  claimedAt: string; outcomeOnDevice?: string;
}
export interface SyncBody { deviceId: string; batchId: string; snapshotSeq: number; snapshotTakenAt: string; clockOffsetMs: number; deskBuild?: string; items: SyncItem[] }
export type SyncOutcome = 'accepted' | 'duplicate' | 'revoked_after_scan' | 'event_closed' | 'after_revoke' | 'organizer_suspended'
  | 'invalid_token' | 'unknown_ticket' | 'wrong_event' | 'validation_failed' | 'deferred';
export type BibOutcome = 'assigned' | 'same_already' | 'not_applied' | 'format_invalid' | 'no_range' | 'out_of_range' | 'registration_has_other' | 'taken';
export interface SyncResult {
  clientRef: string; outcome: SyncOutcome; replayed?: boolean; registrationId?: string; collectionId?: string;
  bib?: { outcome: BibOutcome; number?: string }; warnings?: string[]; reviewId?: string; card?: ReviewCard;
}
export interface SyncResponse {
  results: SyncResult[]; summary: { accepted: number; duplicate: number; needsReview: number; bibExceptions: number; rejected: number; deferred: number };
  serverTime: string; deviceStatus: DeskStatus; minDeskBuild?: string | number;
}
export interface ReviewCard { displayName?: string; categoryName?: string | null; bibNumber?: string | null; ticketCode?: string | null }
export interface ReviewRow {
  id: string; outcome: string; /** Contract: set when an accepted scan has a bib exception. */ bibOutcome?: BibOutcome | null; bibClaimed?: string | null;
  card: ReviewCard | null; deviceLabel: string | null; deviceTime: string | null; receivedAt: string | null;
  winner?: { collectedAt: string; deviceLabel?: string | null; method?: string | null } | null; reviewStatus: 'none' | 'needs_review' | 'checked'; note?: string | null; method?: string | null; manualReason?: string | null; warnings?: string[];
}
export interface ReviewPage extends Page<ReviewRow> { counts?: { needsReview: number; checked: number } }

export const kitOfflineApi = {
  prepare: (token: string, eventId: string, body: PrepareDeskBody, key: string) => post<PrepareDeskResult>(token, `${ev(eventId)}/kit-offline/devices`, body, key),
  devices: (token: string, eventId: string, status?: string) => request<{ items: OfflineDeviceRow[] }>(`${ev(eventId)}/kit-offline/devices${qs({ status })}`, {}, token),
  revoke: (token: string, eventId: string, deviceId: string, body: { reason: string; reasonSw?: string }, key: string) =>
    post<{ device: OfflineDevice }>(token, `${ev(eventId)}/kit-offline/devices/${encodeURIComponent(deviceId)}/revoke`, body, key),
  snapshot: (token: string, eventId: string, q: { deviceId: string; cursor?: string | null; limit?: number; sinceSeq?: number | null; categoryId?: string | null; deskBuild?: string }) =>
    request<SnapshotPage>(`${ev(eventId)}/kit-offline/snapshot${qs(q)}`, {}, token),
  heartbeat: (token: string, eventId: string, body: HeartbeatBody) =>
    request<HeartbeatResult>(`${ev(eventId)}/kit-offline/heartbeat`, { method: 'POST', body: JSON.stringify(body) }, token),
  sync: (token: string, eventId: string, body: SyncBody) =>
    request<SyncResponse>(`${ev(eventId)}/kit-offline/sync`, { method: 'POST', body: JSON.stringify(body), headers: idem(body.batchId) }, token),
  review: (token: string, eventId: string, q: { status?: string; cursor?: string | null; limit?: number } = {}) =>
    request<ReviewPage>(`${ev(eventId)}/kit-offline/review${qs(q)}`, {}, token),
  check: (token: string, eventId: string, scanId: string, body: { note?: string }, key: string) =>
    post<{ review: ReviewRow }>(token, `${ev(eventId)}/kit-offline/review/${encodeURIComponent(scanId)}/check`, body, key),
};

// ── Waitlist (§4.9) ──
export interface WaitlistCounts { ticketTypeId: string; name: string; waiting: number; offered: number; converted: number; expired: number; left: number }
export interface OrganizerWaitlist { enabled: boolean; closedAt: string | null; byTicketType: WaitlistCounts[]; totals?: Omit<WaitlistCounts, 'ticketTypeId' | 'name'> }
export interface AdminWaitlistEntry { id: string; name?: string | null; displayName?: string | null; seq: number; status: string; joinedAt: string; ticketTypeId?: string; ticketTypeName?: string | null }

export const waitlistApi = {
  organizer: (token: string, eventId: string) => request<OrganizerWaitlist>(`${ev(eventId)}/waitlist`, {}, token),
  setEnabled: (token: string, eventId: string, enabled: boolean, key: string) =>
    request<OrganizerWaitlist | { enabled: boolean }>(`${ev(eventId)}/waitlist`, { method: 'PATCH', body: JSON.stringify({ enabled }), headers: idem(key) }, token),
  close: (token: string, eventId: string, key: string) => post<Record<string, unknown>>(token, `${ev(eventId)}/waitlist/close`, {}, key),
  adminList: (token: string, eventId: string, q: { ticketTypeId?: string; status?: string; cursor?: string | null; limit?: number } = {}) =>
    request<Page<AdminWaitlistEntry>>(`/admin/events/${encodeURIComponent(eventId)}/waitlist${qs(q)}`, {}, token),
  adminRemove: (token: string, eventId: string, entryId: string, body: { reason: string; reasonSw?: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/waitlist/${encodeURIComponent(entryId)}/remove`, body, key),
};

// ── Admin: health, operations, disputes, redemptions (§5.7, §6.1, §6.3, §6.4) ──
/** `GET /admin/events/health` (docs/marathon/s7-contract.md §C). A group the server could not read arrives as `{ error }` in its own slot. */
export type HealthGroup<T> = T | { error: string };
export interface AgedCount { count: number; oldestAgeHours?: number | null; oldestAgeDays?: number | null; targetHours?: number | null; targetDays?: number | null }
export interface HealthResponse {
  generatedAt: string; rolledUpAt?: string | null; periodDays?: number; eventId?: string | null;
  setup?: { flags?: Record<string, boolean>; payment?: string; retentionConfigured?: boolean; alertsConfigured?: boolean; consentTextVersion?: string | null };
  funnel?: Array<{ name: string; count: number; ratioToPrevious?: number | null }> | { error: string };
  payments?: HealthGroup<{ manualWaiting?: AgedCount; rejected?: number; lateCases?: number; reconciliationRequired?: AgedCount }>;
  refunds?: HealthGroup<{ requestedNotPaid?: AgedCount; batchesStuck?: number }>;
  webhooks?: HealthGroup<{ pending?: number; oldestPendingAgeMinutes?: number | null; failedLast24h?: number; failedByClass?: Array<{ class: string; count: number }>; gaveUp?: number; endpointsAutoDisabled?: number }>;
  kit?: HealthGroup<{ confirmed?: number; collected?: number; exceptions?: number; offlineDesksActive?: number; unsentScansReported?: number; scansToCheck?: number }>;
  results?: HealthGroup<{ waitingForVerification?: AgedCount; openDisputes?: AgedCount; releasesInPeriod?: number }>;
  rewards?: HealthGroup<{ awardTasksFailed?: number; oldestAwardTaskAgeMinutes?: number | null; redemptionsWaiting?: number; duplicatePreventionIncidents?: number }>;
  waitlist?: HealthGroup<{ waiting?: number; offersOpen?: number; converted?: number; expired?: number; promoterLastRunAt?: string | null; promoterLastStatus?: string | null }>;
  jobs?: Array<{ name: string; schedule?: string | null; lastRunAt: string | null; outcome: string | null; lastSuccessAt?: string | null; flagOn?: boolean; late?: boolean }>;
  errors?: Array<{ group: string; class?: string; count: number }>;
  alerts?: Array<{ rule: string; subject?: string | null; severity?: string | null; runbook?: string | null; counts?: Record<string, number> | null }>;
}
export interface OrganizerIntegrationRow {
  id: string; name: string; status: string; apiAccessEnabled: boolean; activeClients: number; activeEndpoints: number; lastFailureAt?: string | null; apiRatePerMinute?: number | null;
}
export interface ApiClientRow { id: string; name?: string | null; label?: string | null; ratePerMinute?: number | null; status?: string }
export interface DisputeListRow {
  id: string; eventId: string; eventTitle: string; organizerName: string; openedAt: string; ageDays: number; status: string; adminMayResolve: boolean;
}
export interface RedemptionRow { id: string; rewardTitle?: { en?: string; sw?: string } | string | null; person?: string | null; status?: string; codeState?: string | null; claimedAt?: string | null; redeemedAt?: string | null }
export interface CorrectionPreview { rankBefore: number | null; rankAfter: number | null; othersShifted: number; medalsAffected: number; revision?: number | null }

export const adminS7Api = {
  health: (token: string, q: { days: 1 | 7 | 30; eventId?: string }) => request<HealthResponse>(`/admin/events/health${qs(q)}`, {}, token),
  organizers: (token: string, q: { q?: string; apiAccess?: string; cursor?: string | null } = {}) => request<Page<OrganizerIntegrationRow>>(`/admin/events/organizers${qs(q)}`, {}, token),
  setApiAccess: (token: string, organizerId: string, body: { enabled: boolean; reason: string; reasonSw?: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/organizers/${encodeURIComponent(organizerId)}/api-access`, body, key),
  revokeAllClients: (token: string, organizerId: string, body: { reason: string; reasonSw?: string }, key: string) =>
    post<{ revoked?: number } & Record<string, unknown>>(token, `/admin/events/organizers/${encodeURIComponent(organizerId)}/api-clients/revoke-all`, body, key),
  disableAllWebhooks: (token: string, organizerId: string, body: { reason: string; reasonSw?: string }, key: string) =>
    post<{ disabled?: number } & Record<string, unknown>>(token, `/admin/events/organizers/${encodeURIComponent(organizerId)}/webhook-endpoints/disable-all`, body, key),
  setClientRate: (token: string, clientId: string, body: { ratePerMinute: number; reason: string; reasonSw?: string }, key: string) =>
    request<Record<string, unknown>>(`/admin/events/api-clients/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: JSON.stringify(body), headers: idem(key) }, token),
  integrations: (token: string, eventId: string) => request<Record<string, unknown>>(`/admin/events/${encodeURIComponent(eventId)}/integrations`, {}, token),
  registrationState: (token: string, eventId: string, body: { state: 'closed' | 'open'; reason: string; reasonSw?: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/registration-state`, body, key),
  rewardsEligible: (token: string, eventId: string, body: { eligible: boolean; reason: string; reasonSw?: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/rewards-eligible`, body, key),
  disputes: (token: string, q: { status?: string; olderThanDays?: number; organizerStatus?: string; cursor?: string | null; limit?: number } = {}) =>
    request<Page<DisputeListRow> & { counts?: Record<string, number> }>(`/admin/events/results/disputes${qs(q)}`, {}, token),
  redemptions: (token: string, q: { status?: string; cursor?: string | null; limit?: number } = {}) =>
    request<Page<RedemptionRow>>(`/admin/reward-redemptions${qs(q)}`, {}, token),
  kitOffline: (token: string, eventId: string) => request<{ items?: OfflineDeviceRow[]; counts?: { needsReview: number; checked: number } }>(`/admin/events/${encodeURIComponent(eventId)}/kit-offline`, {}, token),
  kitOfflineRevoke: (token: string, eventId: string, deviceId: string, body: { reason: string; reasonSw?: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/kit-offline/devices/${encodeURIComponent(deviceId)}/revoke`, body, key),
};

export const correctionPreviewApi = {
  preview: (token: string, eventId: string, resultId: string, body: Record<string, unknown>) =>
    request<CorrectionPreview>(`${ev(eventId)}/results/${encodeURIComponent(resultId)}/correct/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
};
