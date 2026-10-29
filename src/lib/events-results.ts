// Events S6 (design spec docs/design/events-s6-runs-results-medals-rewards.md §3, §6, §7, §8, §9): types and pure helpers for
// the organizer Results tab, the medal panel and the admin reward desk. No strings here, only i18n keys.
import type { EventsOptions, OrganizerRole } from '@/lib/api';
import { messages, type MessageKey } from '@/lib/i18n';
import { errorBody, errorCode, errorKey } from '@/lib/events';

// ── Availability (§13.1): the server says what is on; the portal never infers it from the build flag alone ──
export type ResultsFlags = { enabled: boolean; runs: boolean; public: boolean; rewards: boolean; medalArt: boolean };
/** EVENTS_REWARDS needs EVENTS_RESULTS and EVENTS_MEDAL_ART needs EVENTS_REWARDS (§13.1): a lone flag shows nothing. */
export function resultsOf(options: EventsOptions | null | undefined): ResultsFlags {
  const r = options?.results;
  const enabled = !!options?.registration && !!r?.enabled;
  const rewards = enabled && !!r?.rewards;
  return { enabled, runs: enabled && !!r?.runs, public: enabled && !!r?.public, rewards, medalArt: rewards && !!r?.medalArt };
}

// ── Roles (§2) ──
export const RESULTS_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'timing']);
export const RESULTS_WRITE_ROLES = new Set<OrganizerRole>(['owner', 'admin']);
export const canVerifyResults = (role: OrganizerRole | null | undefined) => role === 'owner' || role === 'admin';
export const canEnterResults = (role: OrganizerRole | null | undefined) => role === 'owner' || role === 'admin' || role === 'timing';
/** §9.1: the tab shows from the day the event starts. */
export const RESULTS_EVENT_STATUSES = ['in_progress', 'completed', 'archived'];
export const resultsOpenFor = (status: string | null | undefined) => RESULTS_EVENT_STATUSES.includes(status ?? '');

// ── Sections (§9.2) ──
export const RESULT_SECTIONS = ['overview', 'import', 'results', 'disputes', 'medals', 'settings'] as const;
export type ResultSection = (typeof RESULT_SECTIONS)[number];
export const isResultSection = (v: string | null | undefined): v is ResultSection => !!v && (RESULT_SECTIONS as readonly string[]).includes(v);
export function sectionsFor(role: OrganizerRole | null | undefined, rewardsOn: boolean): ResultSection[] {
  return RESULT_SECTIONS.filter(s => (s !== 'medals' || rewardsOn) && (s !== 'settings' || role !== 'timing'));
}

// ── Wire types (§8.1). Every field not in the spec is optional so a shape difference degrades instead of breaking ──
export type ReleaseStage = 'none' | 'provisional' | 'official';
export type ResultStage = ReleaseStage | 'corrected' | 'disputed' | 'disqualified' | 'rejected';
export type FinishStatus = 'finished' | 'dnf' | 'dns' | 'dq';
export type VerificationStatus = 'pending_verification' | 'verified' | 'rejected' | 'corrected' | 'disqualified';
export type SourceType = 'timing_provider' | 'organizer_verified' | 'fitflex_gps' | 'manual_unverified';
export type TimeBasis = 'net' | 'gun';
export interface ResultsSettings { timeBasis?: TimeBasis; cutoffMinutes?: number | null; disputeWindowHours?: number; publicNames?: 'initial' | 'bib_only' }
export interface CategoryResultsSummary {
  categoryId: string; name: string; distanceMeters?: number | null; confirmed: number; finished: number; dnf: number; dns: number; dq: number;
  pending: number; rejected: number; noResult: number; flagged: number;
  release?: { stage: ReleaseStage; releasedAt?: string | null; releasedBy?: { name?: string | null } | null };
  disputesOpen?: number;
}
export interface ResultsSummary { perCategory: CategoryResultsSummary[]; disputesOpen?: number; importsCount?: number; settings?: ResultsSettings }
export interface ResultRow {
  registrationId: string; displayName?: string | null; bibNumber?: string | null; categoryId?: string | null; categoryName?: string | null;
  resultId?: string | null; revision?: number | null; finishStatus?: FinishStatus | null; verificationStatus?: VerificationStatus | null; stage?: ResultStage | null;
  sourceType?: SourceType | null; sourceLabel?: string | null; netElapsedMs?: number | null; gunElapsedMs?: number | null; elapsedMs?: number | null;
  overallRank?: number | null; categoryRank?: number | null; withinCutoff?: boolean | null; flags?: string[]; disputeOpen?: boolean; updatedAt?: string | null;
}
export interface ResultsPage { items: ResultRow[]; nextCursor?: string | null; counts?: Record<string, number> }
export interface ResultRevision { revision: number; finishStatus?: FinishStatus | null; verificationStatus?: VerificationStatus | null; netElapsedMs?: number | null; gunElapsedMs?: number | null; sourceType?: SourceType | null; reasonCode?: string | null; by?: { name?: string | null } | null; at?: string | null }
export interface DisputeRow {
  id: string; registrationId?: string; resultId?: string; bibNumber?: string | null; displayName?: string | null; reasonCode: string; note?: string | null;
  status: 'open' | 'upheld' | 'rejected' | 'withdrawn'; createdAt?: string | null; windowEndsAt?: string | null; resolutionNote?: string | null; resolvedAt?: string | null;
}
export interface ResultDetail extends ResultRow {
  revisions?: ResultRevision[]; linkedRun?: { distanceMeters?: number | null; elapsedMs?: number | null; checks?: Record<string, number | string | null>; flags?: string[] } | null;
  disputes?: DisputeRow[]; note?: string | null; correctionNote?: string | null;
}
export interface ImportProblem { line: number; bib?: string | null; code: string; message?: string }
export interface ImportPreview {
  previewHash: string; rows?: { total?: number; ok?: number; warnings?: number; problems?: number };
  willCreate?: number; willRevise?: number; unchanged?: number; byStatus?: Partial<Record<FinishStatus, number>>;
  unmatchedRegistrations?: number | unknown[]; problems?: ImportProblem[]; warnings?: ImportProblem[]; problemsTotal?: number;
}
export interface ImportRecord { id: string; fileName?: string | null; sourceType?: SourceType; sourceLabel?: string | null; rowCount?: number; createdCount?: number; revisedCount?: number; unchangedCount?: number; createdBy?: { name?: string | null } | null; createdAt?: string | null }
export interface ReleasePreview { previewHash: string; finished?: number; dnf?: number; dns?: number; dq?: number; noResult?: number; unsettled?: number | unknown[]; willMarkDns?: number }
export interface BulkPreview { previewHash: string; count: number; excludedFlagged?: number }

// ── Medals and art (§7.1, §7.7) ──
export const MEDAL_TIERS = ['finisher', 'gold', 'silver', 'bronze', 'time', 'other'] as const;
export type MedalTier = (typeof MEDAL_TIERS)[number];
export const BUILTIN_ART = ['finisher_green', 'finisher_gold', 'podium_gold', 'podium_silver', 'podium_bronze', 'time_blue', 'charity_red', 'virtual_teal'] as const;
export type BuiltinArt = (typeof BUILTIN_ART)[number];
export const isBuiltinArt = (v: unknown): v is BuiltinArt => typeof v === 'string' && (BUILTIN_ART as readonly string[]).includes(v);
/** §7.7: the default design by tier; a virtual event defaults to the teal one. */
export function defaultArtKey(tier: string | null | undefined, virtual = false): BuiltinArt {
  if (virtual) return 'virtual_teal';
  return tier === 'finisher' ? 'finisher_green' : tier === 'gold' ? 'podium_gold' : tier === 'silver' ? 'podium_silver' : tier === 'bronze' ? 'podium_bronze' : tier === 'time' ? 'time_blue' : 'finisher_gold';
}
export type MedalRule = { type: 'finish' } | { type: 'placing'; scope: 'category' | 'overall'; top: number } | { type: 'time_under'; maxElapsedMs: number };
export interface MedalArtInfo { source?: 'custom' | 'builtin'; artId?: string | null; revision?: number | null; artKey?: string | null; altText?: { en?: string; sw?: string } | null; status?: string | null; takedownReason?: string | null }
export interface MedalTemplate {
  id: string; name: { en?: string; sw?: string }; description?: { en?: string; sw?: string } | null; tier: MedalTier; categoryId?: string | null; rule: MedalRule;
  status?: 'active' | 'inactive'; locked?: boolean; sortOrder?: number; awardedCount?: number; art?: MedalArtInfo | null;
}
export const ART_TAKEDOWN_REASONS = ['inappropriate', 'rights', 'other_brand', 'person_request', 'quality', 'other'] as const;
export type ArtTakedownReason = (typeof ART_TAKEDOWN_REASONS)[number];
export interface AdminMedalArt {
  id: string; templateId?: string; eventId?: string; eventTitle?: string | null; organizerId?: string; organizerName?: string | null; categoryName?: string | null; tier?: MedalTier | null;
  status: 'live' | 'replaced' | 'removed' | 'taken_down'; reviewState: 'to_review' | 'reviewed'; altText?: { en?: string; sw?: string } | null; confirmedAt?: string | null;
  confirmedByName?: string | null; takedownReason?: string | null; takedownsLast30Days?: number | null; createdAt?: string | null; revision?: number | null;
}
export const ART_MAX_BYTES = 2 * 1024 * 1024;
export const ART_MIN_SIDE = 512;
export const ART_OUTPUT_SIDE = 1024;
export const ART_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// ── Reward desk (§7.4, §8.2, §9.4) ──
export type RewardTrigger = 'event_finish' | 'medal' | 'achievement';
export type RewardStatus = 'draft' | 'active' | 'paused' | 'ended';
export interface RewardDefinition {
  id: string; title: { en?: string; sw?: string }; terms?: { en?: string; sw?: string }; triggerType: RewardTrigger; triggerEventId?: string | null; triggerRef?: string | null;
  redeemMode: 'certificate' | 'perk'; reversalPolicy?: 'revoke_unredeemed' | 'revoke_all'; capTotal?: number | null; capPerUser?: number | null; capUsed?: number | null;
  startsAt?: string | null; endsAt?: string | null; expiryDays?: number | null; fundingNote?: string | null; valueTzs?: number | null; status: RewardStatus; issuer?: string;
}
export interface RewardSummaryRow { definitionId: string; title?: { en?: string; sw?: string }; earned?: number; redeemed?: number; expired?: number; reversed?: number; capUsed?: number; needsReview?: number }
export interface LedgerRow { id: string; entryType: string; rewardDefinitionId?: string; titleOf?: { en?: string; sw?: string } | string | null; units?: number; sourceType?: string | null; displayName?: string | null; userId?: string | null; occurredAt?: string | null; reversesEntryId?: string | null }
export interface RedemptionHit { id: string; rewardTitle?: { en?: string; sw?: string }; displayName?: string | null; status: string; expiresAt?: string | null; redeemedAt?: string | null; needsReview?: boolean }
export interface AwardTask { id: string; eventId?: string; reason?: string; state: string; attempts?: number; lastError?: string | null; createdAt?: string | null }
export const REWARD_TRIGGERS: RewardTrigger[] = ['event_finish', 'medal', 'achievement'];
export const ACHIEVEMENT_KEYS = ['first_event_finish', 'first_10k_finish', 'half_marathon_finish', 'marathon_finish', 'three_events_year'] as const;

// ── Reason codes (§6.3, §6.6, §6.7) ──
export const REJECT_REASONS = ['not_a_valid_run', 'data_error', 'duplicate', 'other'] as const;
export const CORRECT_REASONS = ['timing_error', 'wrong_bib', 'late_data', 'other'] as const;
export const DISPUTE_REASONS = ['time_wrong', 'not_my_result', 'wrong_category', 'missing_split', 'dq_challenge', 'other'] as const;
export const RESULT_FLAGS = ['implausible_pace', 'many_dropped_points', 'long_gap', 'duplicate_route'] as const;
export const flagKey = (f: string): MessageKey => ((RESULT_FLAGS as readonly string[]).includes(f) ? `organizer.results.flag.${f}` : 'organizer.results.flag.other') as MessageKey;
export const sourceKey = (s: string | null | undefined): MessageKey => `organizer.results.source.${s && ['timing_provider', 'organizer_verified', 'fitflex_gps', 'manual_unverified'].includes(s) ? s : 'organizer_verified'}` as MessageKey;
export const stageKey = (s: string | null | undefined): MessageKey => `organizer.results.stage.${s && ['none', 'provisional', 'official', 'corrected', 'disputed', 'disqualified', 'rejected'].includes(s) ? s : 'none'}` as MessageKey;
export const STAGE_TONE: Record<string, 'gray' | 'warning' | 'success' | 'info' | 'danger'> = { none: 'gray', provisional: 'warning', official: 'success', corrected: 'info', disputed: 'warning', disqualified: 'danger', rejected: 'danger' };

/** Row label (text, never colour only): what a person looking at the table must read first (§9.2). */
export type RowStatus = 'pending' | 'finished' | 'dnf' | 'dns' | 'dq' | 'rejected' | 'noResult';
export function rowStatus(r: Pick<ResultRow, 'resultId' | 'finishStatus' | 'verificationStatus'>): RowStatus {
  if (!r.resultId && !r.finishStatus && !r.verificationStatus) return 'noResult';
  if (r.verificationStatus === 'pending_verification') return 'pending';
  if (r.verificationStatus === 'rejected') return 'rejected';
  if (r.verificationStatus === 'disqualified' || r.finishStatus === 'dq') return 'dq';
  if (r.finishStatus === 'dnf') return 'dnf';
  if (r.finishStatus === 'dns') return 'dns';
  return 'finished';
}
export const STATUS_TONE: Record<RowStatus, 'gray' | 'warning' | 'success' | 'danger' | 'info'> = { pending: 'warning', finished: 'success', dnf: 'gray', dns: 'gray', dq: 'danger', rejected: 'danger', noResult: 'gray' };
export const statusKey = (s: RowStatus): MessageKey => `organizer.results.status.${s}` as MessageKey;
/** The row the number is shown for: the ranking time (`elapsedMs`), else net, else gun. */
export const rowTime = (r: Pick<ResultRow, 'elapsedMs' | 'netElapsedMs' | 'gunElapsedMs'>) => r.elapsedMs ?? r.netElapsedMs ?? r.gunElapsedMs ?? null;

// ── Times (§6.2: H:MM:SS, HH:MM:SS.mmm, MM:SS; zero or over 24 h is out of range) ──
export function formatElapsed(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export type ParsedTime = { ok: true; ms: number; text: string } | { ok: false; reason: 'invalid' | 'range' };
export function parseTime(raw: string): ParsedTime {
  const v = raw.trim();
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(v);
  if (!m) return { ok: false, reason: 'invalid' };
  const h = m[1] ? Number(m[1]) : 0; const min = Number(m[2]); const sec = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  if (sec > 59 || (m[1] && min > 59)) return { ok: false, reason: 'invalid' };
  const total = ((h * 60 + min) * 60 + sec) * 1000 + ms;
  if (total <= 0 || total > 24 * 3600 * 1000) return { ok: false, reason: 'range' };
  const text = `${Math.floor(total / 3_600_000)}:${String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0')}:${String(Math.floor((total % 60_000) / 1000)).padStart(2, '0')}${ms ? `.${String(ms).padStart(3, '0')}` : ''}`;
  return { ok: true, ms: total, text };
}

export const RESULTS_SAMPLE_CSV = 'bib,status,net_time,gun_time,category,note\n101,finished,1:42:10,1:42:30,21K,\n102,finished,1:55:03,1:55:20,21K,\n103,dnf,,,21K,\n104,dns,,,10K,\n';
export const RESULTS_CSV_MAX_BYTES = 1024 * 1024;
export const IMPORT_COLUMNS = ['bib', 'registrationId', 'status', 'net_time', 'gun_time', 'category', 'note'] as const;
export const DISPUTE_WINDOW_DAYS = [1, 3, 7, 14, 30] as const;

/** Count for a preview field that may come as a number or a list (the spec does not fix which). */
export const countOf = (v: number | unknown[] | null | undefined): number => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0);

// ── Errors (§8 "Errors added by this slice", §6.2 problem codes, §7.7 upload codes): every code has a sentence ──
const E = (code: string): MessageKey => `organizer.results.error.${code}` as MessageKey;
const ERROR_CODES = [
  'invalid_request', 'invalid_cursor', 'csv_invalid', 'idempotency_key_required', 'idempotency_key_reused', 'request_in_progress', 'forbidden_role', 'organizer_suspended',
  'event_not_found', 'registration_not_found', 'result_not_found', 'not_found', 'preview_stale', 'result_changed', 'already_released', 'template_locked', 'settings_locked',
  'dispute_open', 'dispute_window_closed', 'dispute_not_found', 'run_already_linked', 'activity_already_linked', 'already_claimed', 'reward_unavailable', 'not_enough_units', 'organizer_owner',
  'payload_too_large', 'validation_failed', 'event_not_open_for_results', 'value_not_allowed_yet', 'source_not_allowed', 'rate_limited', 'feature_disabled',
  'scope_not_available', 'insufficient_scope', 'confirmation_outdated', 'file_not_allowed', 'svg_not_allowed', 'unsupported_file_type', 'animated_not_allowed', 'corrupt_image',
  'image_too_small', 'not_square', 'busy', 'acl_forbidden', 'invalid_transition', 'art_not_found', 'template_not_found', 'definition_not_found', 'redemption_not_found', 'code_not_found',
  'already_redeemed', 'already_taken_down', 'task_not_found',
] as const;
export const RESULTS_ERRORS: Record<string, MessageKey> = Object.fromEntries(ERROR_CODES.map(c => [c, E(c)]));
/** The sentence for a refusal: the S6 map first, then the shared events map, else the generic one. */
export function resultsErrorKey(err: unknown): MessageKey {
  const code = errorCode(err);
  return (code && RESULTS_ERRORS[code]) || errorKey(err);
}
/** Import problem code to key (§6.2); unknown codes get a generic sentence, never a raw code. */
export const PROBLEM_CODES = ['bib_not_found', 'bib_duplicate_in_file', 'registration_not_confirmed', 'category_mismatch', 'time_missing_for_finisher', 'time_invalid', 'time_out_of_range', 'status_invalid', 'already_official', 'event_not_open_for_results'] as const;
export const WARNING_CODES = ['rank_ignored', 'kit_not_collected', 'over_cutoff', 'time_basis_missing'] as const;
export const problemKey = (code: string): MessageKey => ((PROBLEM_CODES as readonly string[]).includes(code) ? `organizer.results.problem.${code}` : 'organizer.results.problem.other') as MessageKey;
export const warningKey = (code: string): MessageKey => ((WARNING_CODES as readonly string[]).includes(code) ? `organizer.results.warn.${code}` : 'organizer.results.warn.other') as MessageKey;
export const artErrorKey = (err: unknown): MessageKey => {
  const code = errorCode(err);
  return (code && ['svg_not_allowed', 'unsupported_file_type', 'animated_not_allowed', 'corrupt_image', 'payload_too_large', 'image_too_small', 'not_square', 'file_not_allowed', 'rate_limited', 'busy'].includes(code)
    ? `organizer.results.art.error.${code}` : resultsErrorKey(err)) as MessageKey;
};
export const retryAfterOf = (err: unknown): number | null => {
  const n = errorBody<{ retryAfterSeconds?: number }>(err)?.retryAfterSeconds;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.round(n)) : null;
};
/** Plain text of a bilingual field in the viewer's language, else the other one, else a dash. */
export const bi = (b: { en?: string; sw?: string } | string | null | undefined, locale: 'en' | 'sw'): string =>
  typeof b === 'string' ? b : (locale === 'sw' ? (b?.sw || b?.en) : (b?.en || b?.sw)) || '—';

/** A key built from a server value: the key if it has a sentence, else the fallback (never a raw code on screen). */
export const knownKey = (key: string, fallback: MessageKey): MessageKey => (key in messages.en ? key : fallback) as MessageKey;
