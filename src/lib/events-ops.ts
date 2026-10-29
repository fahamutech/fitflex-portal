// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md): pure helpers for the kit desk, bibs, export and
// the integrations page. No strings here, only i18n keys.
import type { ApiScope, EventsOptions, KitCard, KitLookupItem, OrganizerRole, PayoutSchedule } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { errorBody, errorCode } from '@/lib/events';

/** §11.1 / §8.1: the server says what is on; the portal never infers it from the build flag alone. */
export function opsOf(options: EventsOptions | null | undefined): { kit: boolean; api: boolean; webhooks: boolean } {
  return { kit: !!options?.registration && !!options.ops?.kit, api: !!options?.registration && !!options.ops?.api, webhooks: !!options?.registration && !!options.ops?.webhooks };
}

/** §2 / §8.1 role gating of the three new event tabs and of the writes inside them. */
export const KIT_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'ops']);
export const BIB_VIEW_ROLES = new Set<OrganizerRole>(['owner', 'admin', 'ops', 'timing']);
export const EXPORT_ROLES = new Set<OrganizerRole>(['owner', 'admin']);
export const INTEGRATION_ROLES = new Set<OrganizerRole>(['owner', 'admin']);
export const canOverrideKit = (role: OrganizerRole | null | undefined) => role === 'owner' || role === 'admin';
export const hasRole = (set: Set<OrganizerRole>, role: OrganizerRole | null | undefined) => !!role && set.has(role);

/** One key per confirm attempt; the same key is reused when that attempt is retried (§6). 8 to 100 chars. */
export function newIdempotencyKey(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'randomUUID' in c) return `portal-${c.randomUUID()}`;
  return `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const PAYOUT_SCHEDULES: PayoutSchedule[] = ['biweekly', 'monthly'];
export const payoutKey = (schedule: PayoutSchedule): MessageKey => `events.payout.${schedule}` as MessageKey;

/** §4.1: the QR the server issues starts with this; a gym pass never does (§4.7). */
export const EVENT_TICKET_PREFIX = 'FFEV1:';
export const isEventTicketPayload = (text: string) => text.trim().startsWith(EVENT_TICKET_PREFIX);

/** A lookup hit is the masked card, at the top level or under `card`; the registration id may sit on either. */
export function lookupCard(item: KitLookupItem): { registrationId: string | null; card: KitCard | null } {
  const card = (item.card ?? (item.displayName ? (item as KitCard) : null)) as KitCard | null;
  return { registrationId: item.registrationId ?? null, card };
}

/** `Retry-After` for a 429 (`retryAfterSeconds` in the body). */
export const retryAfterSeconds = (err: unknown): number | null => {
  const n = errorBody<{ retryAfterSeconds?: number }>(err)?.retryAfterSeconds;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.round(n)) : null;
};
export const isRateLimited = (err: unknown) => errorCode(err) === 'rate_limited';

// ── Integrations (§5.1, §7.1) ──
export type ScopeRisk = 'read' | 'write' | 'high';
export const API_SCOPES: Array<{ scope: ApiScope; risk: ScopeRisk; ownerOnly?: boolean; comingSoon?: boolean }> = [
  { scope: 'registrations:read', risk: 'read' },
  { scope: 'registrations:demographics', risk: 'read' },
  { scope: 'kit:write', risk: 'write' },
  { scope: 'bibs:write', risk: 'write' },
  { scope: 'webhooks:manage', risk: 'high', ownerOnly: true },
  { scope: 'results:write', risk: 'write', comingSoon: true },
];
export const scopeKey = (scope: ApiScope) => `integrations.scope.${scope}` as MessageKey;
export const riskKey = (risk: ScopeRisk) => `integrations.risk.${risk}` as MessageKey;
/** Scopes that need `registrations:read` to be useful (§5.1: kit:write needs read to look people up). */
export const EXPIRY_DAYS = [30, 90, 180, 365] as const;
export const GRACE_HOURS = [24, 0, 72] as const;
export const EXPIRING_SOON_DAYS = 14;

/** The closed allowlist `WEBHOOK_EVENT_TYPES` (§7.1): explicit selection, no wildcard, payment and reserved events are not offered. */
export const WEBHOOK_EVENT_GROUPS: Array<{ key: MessageKey; types: string[] }> = [
  { key: 'integrations.webhooks.group.registrations', types: ['registration.created', 'registration.paid', 'registration.cancelled', 'registration.updated'] },
  { key: 'integrations.webhooks.group.kit', types: ['kit.collected', 'bib.assigned'] },
  { key: 'integrations.webhooks.group.event', types: ['event.updated', 'event.cancelled', 'refund.updated'] },
];
export const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENT_GROUPS.flatMap(g => g.types);

export const HEALTH_TONE = { healthy: 'success', degraded: 'warning', failing: 'danger', disabled: 'gray', unverified: 'info' } as const;
export const healthKey = (h: string) => `integrations.health.${h}` as MessageKey;

/** §7.2 `invalid_url { reason }` to a plain-language key. */
export function urlErrorKey(err: unknown): MessageKey | null {
  if (errorCode(err) !== 'invalid_url') return null;
  const reason = errorBody<{ reason?: string }>(err)?.reason;
  const key = `integrations.url.error.${reason}`;
  return (['not_https', 'blocked_address', 'unresolvable', 'bad_port', 'credentials_in_url', 'ip_literal', 'blocked_host', 'too_long'].includes(reason ?? '') ? key : 'integrations.url.error.generic') as MessageKey;
}

export const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** The columns of the fixed CSV export (§4.5): technical names, not translated. */
export const EXPORT_COLUMNS = ['registrationId', 'ticketCode', 'firstName', 'lastName', 'categoryName', 'ticketTypeName', 'status', 'bibNumber', 'kitStatus', 'kitCollectedAt', 'kitSize', 'teamName', 'groupLabel', 'claimed'] as const;
export const BIB_SAMPLE_CSV = 'registrationId,bibNumber\nereg_example1,5K-001\nereg_example2,5K-002\n';
export const BIB_CSV_MAX_BYTES = 512 * 1024;
/** 1 to 12 of A-Z 0-9 and dashes, not starting with a dash (the backend answers 422 bib_invalid otherwise). */
export const BIB_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,11}$/;

/** Saves a Blob through a temporary link (the bearer rides the fetch, a plain link could not carry it). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const exportFilename = (slug: string, now = new Date()) =>
  `${slug || 'event'}-participants-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.csv`;

