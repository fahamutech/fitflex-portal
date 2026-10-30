// Events S6 API client (spec events-s6-runs-results-medals-rewards §6, §7.7, §8.1, §8.2). Kept out of api.ts so the slice does not
// overlap other open api.ts changes. Every write carries an `Idempotency-Key` (8 to 100 chars, §8.1) and never a user id.
import { API_BASE, ApiError, IDENTITY_V2_CLIENT, notifyUnauthorized, qs, request } from '@/lib/api';
import { flattenDetail } from '@/lib/events-results';
import type {
  AdminMedalArt, ArtTakedownReason, AwardTask, BulkPreview, DisputeRow, ImportPreview, ImportRecord, LedgerRow, MedalTemplate, RedemptionHit, ReleasePreview,
  ArtConfirmation, ResultDetail, ResultDetailWire, ResultsPage, ResultsSettings, ResultsSummary, RewardDefinition, RewardSummaryRow, SourceType, TimeBasis,
} from '@/lib/events-results';

const ev = (eventId: string) => `/organizer/events/${encodeURIComponent(eventId)}`;
const idem = (key: string) => ({ 'Idempotency-Key': key });
const post = <T,>(token: string, path: string, body: unknown, key: string) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers: idem(key) }, token);
type Page<T> = { items: T[]; nextCursor?: string | null };

/** The text and version of the organizer's rights confirmation (§7.7, status draft pending counsel). */
export const MEDAL_ART_CONFIRMATION_VERSION = '2026-10-29.s6draft1';

export const resultsApi = {
  // ── Organizer results (§8.1) ──
  summary: (token: string, eventId: string) => request<ResultsSummary>(`${ev(eventId)}/results/summary`, {}, token),
  results: (token: string, eventId: string, q: { categoryId?: string; status?: string; q?: string; flag?: string; cursor?: string | null; limit?: number } = {}) =>
    request<ResultsPage>(`${ev(eventId)}/results${qs(q)}`, {}, token),
  /** The server answers `{ result, revisions, linkedRun, disputes }`; the page works with the flattened view. */
  detail: async (token: string, eventId: string, registrationId: string): Promise<ResultDetail> =>
    flattenDetail(await request<ResultDetailWire>(`${ev(eventId)}/results/${encodeURIComponent(registrationId)}`, {}, token)),
  previewImport: (token: string, eventId: string, body: { csv: string; sourceType: SourceType; sourceLabel?: string; timeBasis?: TimeBasis }) =>
    request<ImportPreview>(`${ev(eventId)}/results/imports/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  applyImport: (token: string, eventId: string, body: { csv: string; previewHash: string; sourceType: SourceType; sourceLabel?: string; timeBasis?: TimeBasis; fileName?: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/imports`, body, key),
  imports: (token: string, eventId: string, cursor?: string | null) => request<Page<ImportRecord>>(`${ev(eventId)}/results/imports${qs({ cursor })}`, {}, token),
  enterResult: (token: string, eventId: string, registrationId: string, body: { finishStatus: string; netTime?: string; gunTime?: string; sourceLabel?: string; reason?: string }, key: string) =>
    request<ResultDetail>(`${ev(eventId)}/results/${encodeURIComponent(registrationId)}`, { method: 'PUT', body: JSON.stringify(body), headers: idem(key) }, token),
  verify: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; reasonCode?: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/${encodeURIComponent(resultId)}/verify`, body, key),
  reject: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; reasonCode: string; note?: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/${encodeURIComponent(resultId)}/reject`, body, key),
  correct: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; netTime?: string; gunTime?: string; finishStatus?: string; reasonCode: string; note: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/${encodeURIComponent(resultId)}/correct`, body, key),
  disqualify: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; reasonCode: string; note?: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/${encodeURIComponent(resultId)}/disqualify`, body, key),
  previewBulk: (token: string, eventId: string, body: { categoryId?: string; filter: 'pending_clean' }) =>
    request<BulkPreview>(`${ev(eventId)}/results/verify-bulk/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  applyBulk: (token: string, eventId: string, body: { categoryId?: string; filter: 'pending_clean'; previewHash: string }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/verify-bulk`, body, key),
  previewRelease: (token: string, eventId: string, body: { categoryId: string | null; stage: 'provisional' | 'official' }) =>
    request<ReleasePreview>(`${ev(eventId)}/results/release/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  release: (token: string, eventId: string, body: { categoryId: string | null; stage: 'provisional' | 'official'; previewHash: string; markRemainingDns: boolean; leaveUnsettledOut: boolean }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/release`, body, key),
  withdrawRelease: (token: string, eventId: string, body: { categoryId?: string | null }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/release/withdraw`, body, key),
  disputes: (token: string, eventId: string, status?: string) => request<Page<DisputeRow>>(`${ev(eventId)}/results/disputes${qs({ status })}`, {}, token),
  resolveDispute: (token: string, eventId: string, disputeId: string, body: { outcome: 'upheld' | 'rejected'; note: string; correction?: Record<string, unknown> }, key: string) =>
    post<Record<string, unknown>>(token, `${ev(eventId)}/results/disputes/${encodeURIComponent(disputeId)}/resolve`, body, key),
  saveSettings: (token: string, eventId: string, body: ResultsSettings, key: string) =>
    request<unknown>(`${ev(eventId)}/results-settings`, { method: 'PATCH', body: JSON.stringify(body), headers: idem(key) }, token),

  // ── Medal templates (§7.1) ──
  medalTemplates: (token: string, eventId: string) => request<Page<MedalTemplate> & { artConfirmation?: ArtConfirmation; builtInArt?: string[] }>(`${ev(eventId)}/medal-templates`, {}, token),
  createMedalTemplate: (token: string, eventId: string, body: Record<string, unknown>, key: string) =>
    post<MedalTemplate>(token, `${ev(eventId)}/medal-templates`, body, key),
  updateMedalTemplate: (token: string, eventId: string, templateId: string, body: Record<string, unknown>, key: string) =>
    request<MedalTemplate>(`${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: JSON.stringify(body), headers: idem(key) }, token),
  previewMedalTemplate: (token: string, eventId: string, templateId: string) =>
    request<{ wouldReceive?: number; count?: number }>(`${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}/preview`, {}, token),

  // ── Medal art (§7.7). The body is the raw image; the rights confirmation travels as a query parameter ──
  uploadArt: async (token: string, eventId: string, templateId: string, file: Blob, opts: { key: string; confirmationVersion: string; altEn?: string; altSw?: string; signal?: AbortSignal }): Promise<{ art: AdminMedalArt }> => {
    const res = await fetch(`${API_BASE}${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}/art${qs({ confirmationVersion: opts.confirmationVersion, altEn: opts.altEn, altSw: opts.altSw })}`, {
      method: 'POST', body: file, signal: opts.signal, cache: 'no-store',
      headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT, 'content-type': file.type || 'application/octet-stream', ...idem(opts.key) },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      throw new ApiError(res.status, body);
    }
    return body as { art: AdminMedalArt };
  },
  setArtAlt: (token: string, eventId: string, templateId: string, altText: { en?: string; sw?: string }, key: string) =>
    request<unknown>(`${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}/art`, { method: 'PATCH', body: JSON.stringify({ altText }), headers: idem(key) }, token),
  removeArt: (token: string, eventId: string, templateId: string, key: string) =>
    request<unknown>(`${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}/art`, { method: 'DELETE', headers: idem(key) }, token),
  /** Organizer staff preview (stored 240 or 480 WebP), fetched with the bearer and shown from a blob URL. */
  artPreviewPath: (eventId: string, templateId: string, w: 240 | 480) => `${ev(eventId)}/medal-templates/${encodeURIComponent(templateId)}/art/preview?w=${w}`,
  /** Member-serving route; staff and admins may fetch it too. Variants m512, m256, m128; the master is never served. */
  artFilePath: (artId: string, variant: 'm512' | 'm256' | 'm128') => `/events/medal-art/${encodeURIComponent(artId)}/file?variant=${variant}`,

  // ── FitFlex admin (§8.2) ──
  adminSummary: (token: string, eventId: string) => request<ResultsSummary>(`/admin/events/${encodeURIComponent(eventId)}/results/summary`, {}, token),
  adminResults: (token: string, eventId: string, q: { categoryId?: string; status?: string; q?: string; cursor?: string | null; limit?: number } = {}) =>
    request<ResultsPage>(`/admin/events/${encodeURIComponent(eventId)}/results${qs(q)}`, {}, token),
  adminCorrect: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; netTime?: string; gunTime?: string; finishStatus?: string; reasonCode: string; note: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/results/${encodeURIComponent(resultId)}/correct`, body, key),
  adminDisqualify: (token: string, eventId: string, resultId: string, body: { expectedRevision: number; reasonCode: string; note: string }, key: string) =>
    post<Record<string, unknown>>(token, `/admin/events/${encodeURIComponent(eventId)}/results/${encodeURIComponent(resultId)}/disqualify`, body, key),
  medalArtQueue: (token: string, q: { reviewState?: string; status?: string; cursor?: string | null } = {}) =>
    request<Page<AdminMedalArt> & { toReview?: number }>(`/admin/medal-art${qs(q)}`, {}, token),
  medalArtPreviewPath: (id: string, w: 240 | 480) => `/admin/medal-art/${encodeURIComponent(id)}/preview?w=${w}`,
  medalArtReviewed: (token: string, id: string, key: string) => post<unknown>(token, `/admin/medal-art/${encodeURIComponent(id)}/reviewed`, {}, key),
  medalArtTakeDown: (token: string, id: string, body: { reason: ArtTakedownReason; note?: string }, key: string) =>
    post<unknown>(token, `/admin/medal-art/${encodeURIComponent(id)}/take-down`, body, key),
  rewardDefinitions: (token: string) => request<Page<RewardDefinition>>('/admin/reward-definitions', {}, token),
  createRewardDefinition: (token: string, body: Record<string, unknown>, key: string) => post<RewardDefinition>(token, '/admin/reward-definitions', body, key),
  updateRewardDefinition: (token: string, id: string, body: Record<string, unknown>, key: string) =>
    request<RewardDefinition>(`/admin/reward-definitions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body), headers: idem(key) }, token),
  rewardAction: (token: string, id: string, action: 'activate' | 'pause' | 'end', key: string) => post<unknown>(token, `/admin/reward-definitions/${encodeURIComponent(id)}/${action}`, {}, key),
  rewardLedger: (token: string, q: { userId?: string; definitionId?: string; entryType?: string; cursor?: string | null } = {}) => request<Page<LedgerRow>>(`/admin/reward-ledger${qs(q)}`, {}, token),
  rewardSummary: (token: string) => request<{ items?: RewardSummaryRow[]; mostEarnedThisWeek?: Array<{ userId: string; count: number }> }>('/admin/reward-summary', {}, token),
  lookupRedemption: (token: string, code: string) => post<{ redemption: RedemptionHit }>(token, '/admin/reward-redemptions/lookup', { code }, `lookup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
  redeem: (token: string, id: string, note: string | undefined, key: string) => post<unknown>(token, `/admin/reward-redemptions/${encodeURIComponent(id)}/redeem`, note ? { note } : {}, key),
  cancelRedemption: (token: string, id: string, key: string) => post<unknown>(token, `/admin/reward-redemptions/${encodeURIComponent(id)}/cancel`, {}, key),
  awardTasks: (token: string, state = 'failed') => request<Page<AwardTask>>(`/admin/event-award-tasks${qs({ state })}`, {}, token),
  retryAwardTask: (token: string, id: string, key: string) => post<unknown>(token, `/admin/event-award-tasks/${encodeURIComponent(id)}/retry`, {}, key),
};

/** Authenticated image bytes -> Blob (a plain <img src> cannot carry the bearer). 404 means "show the built-in design". */
export async function fetchAuthedBlob(token: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-fitflex-client': IDENTITY_V2_CLIENT }, cache: 'no-store', signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(res.status, body);
  }
  return res.blob();
}
