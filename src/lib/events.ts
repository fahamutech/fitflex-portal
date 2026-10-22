// Marathon & Running Events, slice 2 (design spec docs/design/events-s2-organizer-and-discovery.md §2, §6, §7, §12,
// §14, §15). Pure helpers for the organizer area and the admin queue: no strings here, only i18n keys.
import {
  ApiError, type Bilingual, type EventAllowedAction, type EventCategory, type EventCollectionPoint, type EventDocument,
  type EventPatch, type EventStatus, type EventTicketType, type EventType, type OrganizerRole, type OrganizerStatus,
  type RefundPolicyPreset,
} from '@/lib/api';
import type { BadgeTone } from '@/lib/admin-utils';
import type { Locale, MessageKey } from '@/lib/i18n';

/** Fill `{name}` placeholders. */
export const fmt = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));

export type Tone = BadgeTone | 'info';

// ── Organizer status (§2), text-first badges ──
export const ORGANIZER_STATUS: Record<OrganizerStatus, { key: MessageKey; tone: Tone }> = {
  draft: { key: 'organizer.status.draft', tone: 'gray' },
  pending_review: { key: 'organizer.status.pending_review', tone: 'warning' },
  active: { key: 'organizer.status.active', tone: 'success' },
  rejected: { key: 'organizer.status.rejected', tone: 'danger' },
  suspended: { key: 'organizer.status.suspended', tone: 'danger' },
};
export const ORGANIZER_ROLES: OrganizerRole[] = ['owner', 'admin', 'ops', 'finance', 'timing'];
/** Roles a staff invitation can carry (the owner is created with the organizer). */
export const INVITABLE_ROLES: OrganizerRole[] = ['admin', 'ops', 'finance', 'timing'];
export const roleKey = (role: string) => `organizer.role.${ORGANIZER_ROLES.includes(role as OrganizerRole) ? role : 'ops'}` as MessageKey;
export const roleDescKey = (role: OrganizerRole) => `organizer.role.${role}.desc` as MessageKey;
export const STAFF_STATUS: Record<string, { key: MessageKey; tone: Tone }> = {
  invited: { key: 'organizer.staff.status.invited', tone: 'warning' },
  active: { key: 'organizer.staff.status.active', tone: 'success' },
  removed: { key: 'organizer.staff.status.removed', tone: 'gray' },
};

/** Owner and admin manage events and staff; the organizer must be verified and not suspended (§2, §7.2). */
export const MANAGING_ROLES = new Set<OrganizerRole>(['owner', 'admin']);
export const canManageEvents = (status: OrganizerStatus | null | undefined, role: OrganizerRole | null | undefined) =>
  status === 'active' && !!role && MANAGING_ROLES.has(role);
/** The events list opens for verified and suspended organizers (read-only when suspended). */
export const eventsAreaOpen = (status: OrganizerStatus | null | undefined) => status === 'active' || status === 'suspended';
export const staffAreaOpen = (status: OrganizerStatus | null | undefined, role: OrganizerRole | null | undefined) =>
  status === 'active' && !!role && MANAGING_ROLES.has(role);

// ── Event status (§7.3) ──
export const EVENT_STATUSES: EventStatus[] = ['draft', 'submitted', 'published', 'registration_closed', 'in_progress', 'completed', 'cancelled', 'archived'];
export const EVENT_STATUS: Record<EventStatus, { key: MessageKey; tone: Tone }> = {
  draft: { key: 'events.status.draft', tone: 'gray' },
  submitted: { key: 'events.status.submitted', tone: 'warning' },
  published: { key: 'events.status.published', tone: 'success' },
  registration_closed: { key: 'events.status.registration_closed', tone: 'info' },
  in_progress: { key: 'events.status.in_progress', tone: 'brand' },
  completed: { key: 'events.status.completed', tone: 'default' },
  cancelled: { key: 'events.status.cancelled', tone: 'danger' },
  archived: { key: 'events.status.archived', tone: 'gray' },
};
export const eventStatusOf = (status: string | null | undefined) => EVENT_STATUS[(status ?? 'draft') as EventStatus] ?? EVENT_STATUS.draft;
export const EVENT_TYPES: EventType[] = ['road', 'trail', 'fun', 'charity', 'virtual'];
export const typeKey = (type: string | null | undefined) => `events.type.${EVENT_TYPES.includes(type as EventType) ? type : 'road'}` as MessageKey;
/** Editable statuses: drafts autosave; published and later save explicitly (§6.2, §7.4). */
export const isEditableStatus = (status: EventStatus | null | undefined) => status === 'draft' || status === 'published';
export const isPublishedLike = (status: EventStatus | null | undefined) => status === 'published' || status === 'registration_closed' || status === 'in_progress';

// ── Reasons (§7.2) ──
export const REJECT_REASONS = ['incomplete_details', 'permit_missing', 'pricing_unclear', 'terms_unclear', 'duplicate_event', 'policy_violation', 'other'] as const;
export const rejectReasonKey = (reason: string) => `admin.events.rejectReason.${(REJECT_REASONS as readonly string[]).includes(reason) ? reason : 'other'}` as MessageKey;
export const CANCEL_REASONS = ['weather', 'permit', 'safety', 'low_turnout', 'organizer_decision', 'other'] as const;
export const cancelReasonKey = (reason: string) => `events.cancel.reason.${(CANCEL_REASONS as readonly string[]).includes(reason) ? reason : 'other'}` as MessageKey;
/** Backend audit `action` names (rows carry `events.<name>`); approve writes `published`. Unknown codes show as given. */
export const AUDIT_ACTIONS = [
  'organizer_created', 'organizer_status', 'event_created', 'event_updated', 'submitted', 'withdrawn', 'published', 'rejected', 'cancelled',
  'completed', 'archived', 'started', 'registration_closed', 'deleted', 'staff_invited', 'staff_removed', 'staff_role_changed',
] as const;
export const AUDIT_ACTION_PREFIX = 'events.';
export const auditActionName = (code: string) => code.replace(/^events\./, '');
export const auditActionLabel = (code: string, t: (k: MessageKey) => string) => {
  const name = auditActionName(code);
  return (AUDIT_ACTIONS as readonly string[]).includes(name) ? t(`admin.events.audit.action.${name}` as MessageKey) : code;
};
export const POLICY_PRESETS: RefundPolicyPreset[] = ['no_refund', 'refund_until_close', 'custom'];

/** `allowedActions` vocabulary (§7.2) and the i18n key of each button. */
export const ACTION_KEYS: Record<EventAllowedAction, MessageKey> = {
  submit: 'events.review.submit', withdraw: 'events.withdraw.action', cancel: 'events.cancel.action', complete: 'events.complete.action',
  archive: 'events.archive.action', delete: 'events.delete.action', edit: 'events.review.edit', approve: 'admin.events.approve', reject: 'admin.events.reject',
};
/** Lifecycle actions shown as buttons (edit and submit live in the wizard itself). */
export const LIFECYCLE_ACTIONS: EventAllowedAction[] = ['withdraw', 'cancel', 'complete', 'archive', 'delete'];

/** Fields whose change on a published event notifies participants (§7.4). Paths as in EventChange.fields. */
export const MATERIAL_FIELDS = [
  'startsAt', 'endsAt', 'timezone', 'venue.name', 'venue.address', 'venue.lat', 'venue.lng', 'routeUrl', 'routeImageUrl',
  'categories.distanceM', 'categories.startsAt', 'categories.ticketTypes.priceTzs', 'registrationClosesAt', 'refundPolicy',
] as const;

// ── Error codes surfaced to people (§14.6) ──
export const EVENTS_ERRORS: Record<string, MessageKey> = {
  feature_disabled: 'events.unavailable.title',
  event_not_found: 'events.error.event_not_found',
  not_your_organizer: 'events.error.not_your_organizer',
  organizer_not_active: 'events.error.organizer_not_active',
  organizer_suspended: 'events.error.organizer_suspended',
  forbidden_role: 'organizer.forbidden.body',
  invalid_transition: 'events.error.invalid_transition',
  version_conflict: 'events.wizard.conflict',
  event_invalid: 'events.error.event_invalid',
  change_note_required: 'events.material.title',
  has_registrations: 'events.cancel.hasRegistrations',
  organizer_exists: 'events.error.organizer_exists',
  persona_not_allowed: 'organizer.intro.notAllowed',
  already_staff: 'organizer.staff.alreadyStaff',
  invalid_contact: 'organizer.staff.invalidContact',
  cannot_invite_self: 'organizer.staff.cannotInviteSelf',
  cannot_remove_owner: 'events.error.cannot_remove_owner',
  kyc_incomplete: 'events.error.kyc_incomplete',
  rate_limited: 'events.error.rate_limited',
  invalid_role: 'events.error.invalid_role',
  staff_not_found: 'events.error.staff_not_found',
  cannot_remove_self: 'events.error.cannot_remove_self',
  invalid_email: 'events.validation.email',
  invalid_timezone: 'events.error.invalid_timezone',
};
export const errorCode = (err: unknown): string | null =>
  err instanceof ApiError ? ((err.body as { error?: string } | null)?.error ?? null) : null;
export const errorBody = <T = Record<string, unknown>>(err: unknown): (T & { error?: string }) | null =>
  err instanceof ApiError ? ((err.body as (T & { error?: string }) | null) ?? null) : null;
/** The i18n key for a refusal, else the generic one. */
export const errorKey = (err: unknown): MessageKey => EVENTS_ERRORS[errorCode(err) ?? ''] ?? 'common.somethingWrong';
export const isForbidden = (err: unknown) => {
  const code = errorCode(err);
  return err instanceof ApiError && (err.status === 403 || code === 'not_your_organizer' || code === 'forbidden' || code === 'forbidden_role' || code === 'acl_forbidden');
};
export const isFeatureOff = (err: unknown) => errorCode(err) === 'feature_disabled';
export const isNoOrganizer = (err: unknown) => errorCode(err) === 'no_organizer';

// ── Dates in the event's timezone (§12) ──
const intlLocale = (locale: Locale) => (locale === 'sw' ? 'sw-TZ' : 'en-GB');
const safeTz = (tz: string | null | undefined) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined }); return tz || 'Africa/Dar_es_Salaam'; } catch { return 'Africa/Dar_es_Salaam'; }
};
/** "EAT" from the zone when the payload has no abbreviation. */
export function tzAbbr(tz: string | null | undefined, at: Date = new Date(), given?: string | null) {
  if (given) return given;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(tz), timeZoneName: 'short' }).formatToParts(at);
  return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
}
/** "Sat 14 Mar 2027, 06:30 EAT" / "Jumamosi 14 Mac 2027, 06:30 EAT". */
export function eventDateTime(iso: string | null | undefined, tz: string | null | undefined, locale: Locale, abbr?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const zone = safeTz(tz);
  // "Sat 14 Mar 2027" (no comma after the weekday, as the spec writes it).
  const day = d.toLocaleDateString(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }).replace(/^([^\d,]+),\s*/, '$1 ');
  const time = d.toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone });
  return `${day}, ${time} ${tzAbbr(zone, d, abbr)}`.trim();
}
/** "06:30" in the event's zone, for the "= 06:30 EAT" hint next to a local-time field. */
export function eventTime(iso: string | null | undefined, tz: string | null | undefined, locale: Locale) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: safeTz(tz) });
}
export function eventDay(iso: string | null | undefined, tz: string | null | undefined, locale: Locale) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: safeTz(tz) });
}
/** "2 h ago" style, via Intl.RelativeTimeFormat. */
export function relativeTime(iso: string | null | undefined, locale: Locale, now = Date.now()) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '—';
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
  return rtf.format(Math.round(diff / (86_400 * 30)), 'month');
}
export const clockTime = (d: Date, locale: Locale) => d.toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hour12: false });
/** "5K 10K 21K" from metres. */
export const distanceLabel = (m: number) => {
  const km = m / 1000;
  const n = Number.isInteger(km) ? String(km) : km.toFixed(1).replace(/\.0$/, '');
  return `${n}K`;
};

// ── Money (D4): whole shillings ──
/** "25,000" / "25000" → 25000; blank → null; anything else (decimals, letters) → NaN. */
export function parseShillings(text: string): number | null {
  const s = text.trim().replace(/,/g, '').replace(/\s/g, '');
  if (!s) return null;
  if (!/^\d+$/.test(s)) return Number.NaN;
  return Number(s);
}
export const formatShillings = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '' : new Intl.NumberFormat('en-US').format(n));

// ── Contacts ──
/** "+255 7•• ••• 123" / "a•••@example.com" when the server did not mask already. */
export function maskContact(value: string | null | undefined) {
  if (!value) return '—';
  if (value.includes('•')) return value;
  if (value.includes('@')) { const [u, d] = value.split('@'); return `${u.slice(0, 1)}•••@${d}`; }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 9) return `+${digits.slice(0, 3)} ${digits.slice(3, 4)}•• ••• ${digits.slice(-3)}`;
  return value;
}
export const TZ_PHONE = /^(\+?255|0)[67]\d{8}$/;
export const normalisePhoneInput = (raw: string) => raw.trim().replace(/[\s\-().]/g, '');
export const isTzPhone = (raw: string) => TZ_PHONE.test(normalisePhoneInput(raw));
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 254;
export const isHttps = (v: string) => /^https:\/\/\S+$/i.test(v.trim());

// ── Wizard (§6.2) ──
export const WIZARD_STEPS = ['basics', 'venue', 'categories', 'tickets', 'kit', 'terms', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const stepKey = (step: WizardStep) => `events.wizard.step.${step}` as MessageKey;

let uidN = 0;
export const uid = () => `u${Date.now().toString(36)}${(uidN++).toString(36)}`;

export type TicketForm = { id?: string; uid: string; name: string; priceText: string; capacity: string; noLimit: boolean; saleOpensAt: string; saleClosesAt: string; minPerOrder: string; maxPerOrder: string };
export type CategoryForm = { id?: string; uid: string; name: string; distanceKm: string; startsAt: string; capacity: string; noLimit: boolean; eligibilityEn: string; eligibilitySw: string; minAge: string; ticketTypes: TicketForm[] };
export type PointForm = { id?: string; uid: string; name: string; address: string; lat: number | null; lng: number | null; windows: Array<{ opensAt: string; closesAt: string }>; instructionsEn: string; instructionsSw: string };
export type SponsorForm = { id?: string; uid: string; name: string; logoUrl: string; url: string };
export type ScheduleForm = { id?: string; uid: string; at: string; labelEn: string; labelSw: string };
export type EventForm = {
  title: string; type: EventType | ''; descriptionEn: string; descriptionSw: string; timezone: string;
  startsAt: string; endsAt: string; registrationOpensAt: string; registrationClosesAt: string; heroImageUrl: string; heroThumbUrl: string; coverAlt: string;
  venueName: string; venueAddress: string; venueCity: string; venueRegion: string; lat: number | null; lng: number | null; outsideTz: boolean;
  routeUrl: string; routeImageUrl: string; routeImageAlt: string; accessEn: string; accessSw: string;
  categories: CategoryForm[];
  hasKit: boolean; collectionPoints: PointForm[]; inclusionsEn: string; inclusionsSw: string;
  termsEn: string; termsSw: string; policyPreset: RefundPolicyPreset | ''; policyEn: string; policySw: string;
  contactEmail: string; contactPhone: string; contactWhatsapp: string; sponsors: SponsorForm[]; schedule: ScheduleForm[];
};

export const newTicket = (): TicketForm => ({ uid: uid(), name: '', priceText: '', capacity: '', noLimit: true, saleOpensAt: '', saleClosesAt: '', minPerOrder: '1', maxPerOrder: '10' });
export const newCategory = (): CategoryForm => ({ uid: uid(), name: '', distanceKm: '', startsAt: '', capacity: '', noLimit: true, eligibilityEn: '', eligibilitySw: '', minAge: '', ticketTypes: [newTicket()] });
export const newPoint = (): PointForm => ({ uid: uid(), name: '', address: '', lat: null, lng: null, windows: [{ opensAt: '', closesAt: '' }], instructionsEn: '', instructionsSw: '' });
export const newSponsor = (): SponsorForm => ({ uid: uid(), name: '', logoUrl: '', url: '' });
export const newScheduleItem = (): ScheduleForm => ({ uid: uid(), at: '', labelEn: '', labelSw: '' });

export function emptyForm(timezone = 'Africa/Dar_es_Salaam'): EventForm {
  return {
    title: '', type: '', descriptionEn: '', descriptionSw: '', timezone, startsAt: '', endsAt: '', registrationOpensAt: '', registrationClosesAt: '',
    heroImageUrl: '', heroThumbUrl: '', coverAlt: '', venueName: '', venueAddress: '', venueCity: '', venueRegion: '', lat: null, lng: null, outsideTz: false,
    routeUrl: '', routeImageUrl: '', routeImageAlt: '', accessEn: '', accessSw: '', categories: [], hasKit: false, collectionPoints: [],
    inclusionsEn: '', inclusionsSw: '', termsEn: '', termsSw: '', policyPreset: '', policyEn: '', policySw: '', contactEmail: '', contactPhone: '',
    contactWhatsapp: '', sponsors: [], schedule: [],
  };
}

const s = (v: unknown) => (v == null ? '' : String(v));
const kmText = (m: number | null | undefined) => (m == null ? '' : String(Math.round(m / 100) / 10));
/** The server document as the form edits it. */
export function formFromDoc(doc: EventDocument): EventForm {
  const hasKit = typeof doc.kitProvided === 'boolean' ? doc.kitProvided : doc.collectionPoints.length > 0 || !!(doc.inclusions?.en || doc.inclusions?.sw);
  return {
    title: s(doc.title), type: doc.type ?? '', descriptionEn: s(doc.description?.en), descriptionSw: s(doc.description?.sw), timezone: doc.timezone || 'Africa/Dar_es_Salaam',
    startsAt: s(doc.startsAt), endsAt: s(doc.endsAt), registrationOpensAt: s(doc.registrationOpensAt), registrationClosesAt: s(doc.registrationClosesAt),
    heroImageUrl: s(doc.heroImageUrl), heroThumbUrl: s(doc.heroThumbUrl), coverAlt: s(doc.coverAlt),
    venueName: s(doc.venue?.name), venueAddress: s(doc.venue?.address), venueCity: s(doc.venue?.city), venueRegion: s(doc.venue?.region),
    lat: doc.venue?.lat ?? null, lng: doc.venue?.lng ?? null, outsideTz: doc.venue?.lat != null && !inTanzania(doc.venue.lat, doc.venue.lng ?? 0),
    routeUrl: s(doc.routeUrl), routeImageUrl: s(doc.routeImageUrl), routeImageAlt: s(doc.routeImageAlt), accessEn: s(doc.accessibility?.en), accessSw: s(doc.accessibility?.sw),
    categories: (doc.categories ?? []).map(c => ({
      id: c.id, uid: c.id ?? uid(), name: s(c.name), distanceKm: kmText(c.distanceM), startsAt: s(c.startsAt), capacity: c.capacity == null ? '' : String(c.capacity), noLimit: c.capacity == null,
      eligibilityEn: s(c.eligibility?.en), eligibilitySw: s(c.eligibility?.sw), minAge: c.minAge == null ? '' : String(c.minAge),
      ticketTypes: (c.ticketTypes ?? []).map(tt => ({
        id: tt.id, uid: tt.id ?? uid(), name: s(tt.name), priceText: formatShillings(tt.priceTzs), capacity: tt.capacity == null ? '' : String(tt.capacity), noLimit: tt.capacity == null,
        saleOpensAt: s(tt.saleOpensAt), saleClosesAt: s(tt.saleClosesAt), minPerOrder: String(tt.minPerOrder ?? 1), maxPerOrder: String(tt.maxPerOrder ?? 10),
      })),
    })),
    hasKit, collectionPoints: (doc.collectionPoints ?? []).map(p => ({
      id: p.id, uid: p.id ?? uid(), name: s(p.name), address: s(p.address), lat: p.lat ?? null, lng: p.lng ?? null,
      windows: p.windows?.length ? p.windows.map(w => ({ opensAt: s(w.opensAt), closesAt: s(w.closesAt) })) : [{ opensAt: '', closesAt: '' }],
      instructionsEn: s(p.instructions?.en), instructionsSw: s(p.instructions?.sw),
    })),
    inclusionsEn: s(doc.inclusions?.en), inclusionsSw: s(doc.inclusions?.sw),
    termsEn: s(doc.terms?.en), termsSw: s(doc.terms?.sw), policyPreset: doc.refundPolicy?.preset ?? '', policyEn: s(doc.refundPolicy?.text?.en), policySw: s(doc.refundPolicy?.text?.sw),
    contactEmail: s(doc.contact?.email), contactPhone: s(doc.contact?.phone), contactWhatsapp: s(doc.contact?.whatsapp),
    sponsors: (doc.sponsors ?? []).map(sp => ({ id: sp.id, uid: sp.id ?? uid(), name: s(sp.name), logoUrl: s(sp.logoUrl), url: s(sp.url) })),
    schedule: (doc.schedule ?? []).map(it => ({ id: it.id, uid: it.id ?? uid(), at: s(it.at), labelEn: s(it.label?.en), labelSw: s(it.label?.sw) })),
  };
}

export const inTanzania = (lat: number, lng: number) => lat >= -12 && lat <= -0.9 && lng >= 29 && lng <= 41;
const nul = (v: string) => (v.trim() ? v.trim() : null);
const bi = (en: string, sw: string): Bilingual | null => (en.trim() || sw.trim() ? { en: en.trim(), sw: sw.trim() } : null);
const int = (v: string) => { const n = Number(v.trim()); return v.trim() && Number.isInteger(n) ? n : null; };

/** The fields of one step, as PATCH /organizer/events/:id takes them (nested rows keep their ids for upsert). */
export function stepPayload(form: EventForm, step: WizardStep): Omit<EventPatch, 'version'> {
  switch (step) {
    case 'basics':
      return {
        title: form.title.trim(), type: form.type || undefined, description: { en: form.descriptionEn, sw: form.descriptionSw }, timezone: form.timezone,
        startsAt: nul(form.startsAt) as string, endsAt: nul(form.endsAt) as string, registrationOpensAt: nul(form.registrationOpensAt), registrationClosesAt: nul(form.registrationClosesAt),
        heroImageUrl: nul(form.heroImageUrl), coverAlt: nul(form.coverAlt),
      };
    case 'venue':
      return {
        venue: { name: nul(form.venueName), address: nul(form.venueAddress), city: nul(form.venueCity), region: nul(form.venueRegion), lat: form.lat, lng: form.lng },
        routeUrl: nul(form.routeUrl), routeImageUrl: nul(form.routeImageUrl), routeImageAlt: nul(form.routeImageAlt), accessibility: bi(form.accessEn, form.accessSw),
      };
    case 'categories':
    case 'tickets':
      return { categories: form.categories.map(categoryPayload) };
    case 'kit':
      return {
        kitProvided: form.hasKit,
        collectionPoints: form.hasKit ? form.collectionPoints.map(p => ({
          id: p.id, name: p.name.trim(), address: p.address.trim(), lat: p.lat, lng: p.lng,
          windows: p.windows.filter(w => w.opensAt && w.closesAt), instructions: { en: p.instructionsEn.trim(), sw: p.instructionsSw.trim() },
        })) : [],
        inclusions: form.hasKit ? bi(form.inclusionsEn, form.inclusionsSw) : null,
      };
    case 'terms':
      return {
        terms: { en: form.termsEn, sw: form.termsSw },
        refundPolicy: { preset: form.policyPreset || null, text: form.policyPreset === 'custom' ? bi(form.policyEn, form.policySw) : null },
        contact: { email: nul(form.contactEmail), phone: nul(form.contactPhone), whatsapp: nul(form.contactWhatsapp) },
        sponsors: form.sponsors.map(sp => ({ id: sp.id, name: sp.name.trim(), logoUrl: nul(sp.logoUrl), url: nul(sp.url) })),
        schedule: form.schedule.map(it => ({ id: it.id, at: it.at, label: { en: it.labelEn.trim(), sw: it.labelSw.trim() } })),
      };
    default:
      return {};
  }
}
function categoryPayload(c: CategoryForm): EventCategory {
  const km = Number(c.distanceKm);
  return {
    id: c.id, name: c.name.trim(), distanceM: Number.isFinite(km) ? Math.round(km * 1000) : 0, startsAt: nul(c.startsAt), capacity: c.noLimit ? null : int(c.capacity),
    eligibility: bi(c.eligibilityEn, c.eligibilitySw), minAge: int(c.minAge),
    ticketTypes: c.ticketTypes.map(tt => ({
      id: tt.id, name: tt.name.trim(), priceTzs: parseShillings(tt.priceText) ?? 0, currency: 'TZS', capacity: tt.noLimit ? null : int(tt.capacity),
      saleOpensAt: nul(tt.saleOpensAt), saleClosesAt: nul(tt.saleClosesAt), minPerOrder: int(tt.minPerOrder) ?? 1, maxPerOrder: int(tt.maxPerOrder) ?? 10,
    } satisfies EventTicketType)),
  };
}
/** Every step's fields together (explicit saves on a published event, and the review summary). */
export function fullPayload(form: EventForm): Omit<EventPatch, 'version'> {
  return { ...stepPayload(form, 'basics'), ...stepPayload(form, 'venue'), ...stepPayload(form, 'categories'), ...stepPayload(form, 'kit'), ...stepPayload(form, 'terms') };
}
/** A document-shaped view of the form for the read-only summary (step 7). */
export function docFromForm(form: EventForm, base: Partial<EventDocument> = {}): EventDocument {
  const p = fullPayload(form);
  return {
    id: base.id ?? '', slug: base.slug ?? '', title: form.title, type: (form.type || 'road') as EventType, status: base.status ?? 'draft',
    startsAt: form.startsAt, endsAt: form.endsAt, timezone: form.timezone, utcOffsetMinutes: base.utcOffsetMinutes ?? 0, timezoneAbbr: base.timezoneAbbr ?? '',
    registrationOpensAt: nul(form.registrationOpensAt), registrationClosesAt: nul(form.registrationClosesAt), availability: null,
    venue: p.venue!, heroThumbUrl: form.heroThumbUrl || null, heroImageAlt: nul(form.coverAlt), distancesM: form.categories.map(c => Math.round(Number(c.distanceKm) * 1000)).filter(Number.isFinite),
    fromPriceTzs: minPrice(form), currency: 'TZS', organizer: base.organizer ?? { id: '', name: '', verified: false }, updatedAt: base.updatedAt ?? '',
    description: p.description!, heroImageUrl: nul(form.heroImageUrl), coverAlt: nul(form.coverAlt), routeUrl: p.routeUrl ?? null, routeImageUrl: p.routeImageUrl ?? null,
    routeImageAlt: p.routeImageAlt ?? null, accessibility: p.accessibility ?? null, inclusions: p.inclusions ?? null, kitProvided: form.hasKit, categories: p.categories ?? [],
    collectionPoints: p.collectionPoints ?? [], schedule: p.schedule ?? [], sponsors: p.sponsors ?? [], contact: p.contact!, terms: p.terms!,
    refundPolicy: p.refundPolicy!, cancellation: base.cancellation ?? null, shareUrl: base.shareUrl ?? null, publishedAt: base.publishedAt ?? null,
    version: base.version ?? 0, allowedActions: base.allowedActions ?? [], submittedAt: base.submittedAt ?? null, rejection: base.rejection ?? null, changeLogCount: base.changeLogCount ?? 0,
  };
}
export function minPrice(form: EventForm): number | null {
  const prices = form.categories.flatMap(c => c.ticketTypes.map(tt => parseShillings(tt.priceText))).filter((n): n is number => n != null && !Number.isNaN(n));
  return prices.length ? Math.min(...prices) : null;
}

// ── Validation (§6.2; the server is the authority, §14.3 returns the same codes) ──
export type FieldError = { key: MessageKey; vars?: Record<string, string | number> };
export type Errors = Record<string, FieldError>;
const STEP_OF_PATH: Array<[RegExp, WizardStep]> = [
  [/^(title|type|descriptionEn|descriptionSw|description|timezone|startsAt|endsAt|registrationOpensAt|registrationClosesAt|heroImageUrl|coverAlt)$/, 'basics'],
  [/^(venueName|venueAddress|venueCity|venueRegion|venue|pin|routeUrl|routeImageUrl|routeImageAlt|accessEn|accessSw|accessibility)/, 'venue'],
  [/^categories(\.\d+\.(?!ticketTypes).*)?$/, 'categories'],
  [/^categories\.\d+\.ticketTypes/, 'tickets'],
  [/^(collectionPoints|inclusions|hasKit)/, 'kit'],
  [/^(termsEn|termsSw|terms|policyPreset|policyEn|policySw|refundPolicy|contactEmail|contactPhone|contactWhatsapp|contact|sponsors|schedule)/, 'terms'],
];
export const stepOfPath = (path: string): WizardStep => STEP_OF_PATH.find(([re]) => re.test(path))?.[1] ?? 'basics';
const ms = (iso: string) => Date.parse(iso);
const len = (v: string, min: number, max: number) => { const n = v.trim().length; return n >= min && n <= max; };

/** Client mirror of the server rules. `forSubmit` adds the rules a draft may still break (start ≥ now + 24 h). */
export function validateEvent(form: EventForm, opts: { forSubmit?: boolean; now?: number } = {}): Errors {
  const e: Errors = {};
  const req = (path: string, ok: boolean) => { if (!ok) e[path] = { key: 'events.validation.required' }; };
  const length = (path: string, v: string, min: number, max: number, required: boolean) => {
    if (!v.trim()) { if (required) e[path] = { key: 'events.validation.required' }; return; }
    if (!len(v, min, max)) e[path] = { key: 'events.validation.length', vars: { min, max } };
  };
  const both = (pathEn: string, en: string, pathSw: string, sw: string, max: number) => {
    if (!!en.trim() !== !!sw.trim()) e[en.trim() ? pathSw : pathEn] = { key: 'events.validation.bothLanguages' };
    if (en.trim().length > max) e[pathEn] = { key: 'events.validation.length', vars: { min: 0, max } };
    if (sw.trim().length > max) e[pathSw] = { key: 'events.validation.length', vars: { min: 0, max } };
  };
  const now = opts.now ?? Date.now();
  // 1 Basics
  length('title', form.title, 3, 80, true);
  req('type', !!form.type);
  length('descriptionEn', form.descriptionEn, 40, 4000, true);
  length('descriptionSw', form.descriptionSw, 40, 4000, true);
  req('timezone', !!form.timezone);
  req('startsAt', !!form.startsAt);
  req('endsAt', !!form.endsAt);
  req('registrationClosesAt', !!form.registrationClosesAt);
  const starts = ms(form.startsAt); const ends = ms(form.endsAt);
  if (form.startsAt && opts.forSubmit && starts < now + 24 * 3_600_000) e.startsAt = { key: 'events.validation.startsTooSoon' };
  if (form.startsAt && form.endsAt && !e.endsAt) {
    if (ends <= starts) e.endsAt = { key: 'events.validation.endAfterStart' };
    else if (ends > starts + 7 * 86_400_000) e.endsAt = { key: 'events.validation.tooLong' };
  }
  if (form.registrationClosesAt && !e.registrationClosesAt) {
    const closes = ms(form.registrationClosesAt);
    if (form.startsAt && closes > starts) e.registrationClosesAt = { key: 'events.validation.closeBeforeStart' };
    else if (form.registrationOpensAt && closes <= ms(form.registrationOpensAt)) e.registrationClosesAt = { key: 'events.validation.endAfterStart' };
  }
  if (form.heroImageUrl) length('coverAlt', form.coverAlt, 1, 120, true);
  if (form.heroImageUrl && !form.coverAlt.trim()) e.coverAlt = { key: 'events.validation.altRequired' };
  // 2 Venue
  const virtual = form.type === 'virtual';
  if (!virtual) {
    length('venueName', form.venueName, 1, 120, true);
    length('venueAddress', form.venueAddress, 1, 200, true);
    req('venueRegion', !!form.venueRegion.trim());
    if (form.lat == null || form.lng == null) e.pin = { key: 'events.validation.pinRequired' };
    else if (!form.outsideTz && !inTanzania(form.lat, form.lng)) e.pin = { key: 'events.validation.pinRequired' };
  } else if (form.venueAddress.trim().length > 200) e.venueAddress = { key: 'events.validation.length', vars: { min: 0, max: 200 } };
  if (form.routeUrl.trim() && !isHttps(form.routeUrl)) e.routeUrl = { key: 'events.validation.httpsOnly' };
  if (form.routeImageUrl && !form.routeImageAlt.trim()) e.routeImageAlt = { key: 'events.validation.altRequired' };
  both('accessEn', form.accessEn, 'accessSw', form.accessSw, 1000);
  // 3 Categories, 4 Tickets
  if (form.categories.length < 1) e.categories = { key: 'events.validation.minCategory' };
  if (form.categories.length > 12) e.categories = { key: 'events.validation.range', vars: { min: 1, max: 12 } };
  const names = new Set<string>();
  form.categories.forEach((c, i) => {
    const p = `categories.${i}`;
    length(`${p}.name`, c.name, 1, 60, true);
    const key = c.name.trim().toLowerCase();
    if (key && names.has(key)) e[`${p}.name`] = { key: 'events.validation.unique' }; names.add(key);
    const km = Number(c.distanceKm);
    if (!c.distanceKm.trim()) e[`${p}.distanceKm`] = { key: 'events.validation.required' };
    else if (!Number.isFinite(km) || km < 0.5 || km > 250 || !/^\d+(\.\d)?$/.test(c.distanceKm.trim())) e[`${p}.distanceKm`] = { key: 'events.validation.range', vars: { min: 0.5, max: 250 } };
    if (c.startsAt) {
      const t = ms(c.startsAt);
      if ((form.startsAt && t < starts) || (form.endsAt && t > ends)) e[`${p}.startsAt`] = { key: 'events.validation.withinEvent' };
    }
    if (!c.noLimit) { const n = int(c.capacity); if (n == null || n < 1 || n > 100_000) e[`${p}.capacity`] = { key: 'events.validation.range', vars: { min: 1, max: 100000 } }; }
    both(`${p}.eligibilityEn`, c.eligibilityEn, `${p}.eligibilitySw`, c.eligibilitySw, 500);
    if (c.minAge.trim()) { const n = int(c.minAge); if (n == null || n < 5 || n > 99) e[`${p}.minAge`] = { key: 'events.validation.range', vars: { min: 5, max: 99 } }; }
    if (c.ticketTypes.length < 1) e[`${p}.ticketTypes`] = { key: 'events.validation.minTicket' };
    if (c.ticketTypes.length > 6) e[`${p}.ticketTypes`] = { key: 'events.validation.range', vars: { min: 1, max: 6 } };
    const tnames = new Set<string>();
    c.ticketTypes.forEach((tt, j) => {
      const q = `${p}.ticketTypes.${j}`;
      length(`${q}.name`, tt.name, 1, 40, true);
      const tk = tt.name.trim().toLowerCase();
      if (tk && tnames.has(tk)) e[`${q}.name`] = { key: 'events.validation.unique' }; tnames.add(tk);
      const price = parseShillings(tt.priceText);
      if (price == null) e[`${q}.priceText`] = { key: 'events.validation.required' };
      else if (Number.isNaN(price)) e[`${q}.priceText`] = { key: 'events.validation.wholeShillings' };
      if (!tt.noLimit) { const n = int(tt.capacity); if (n == null || n < 1 || n > 100_000) e[`${q}.capacity`] = { key: 'events.validation.range', vars: { min: 1, max: 100000 } }; }
      const regOpen = form.registrationOpensAt ? ms(form.registrationOpensAt) : null; const regClose = form.registrationClosesAt ? ms(form.registrationClosesAt) : null;
      const within = (iso: string) => { const t = ms(iso); return (regOpen == null || t >= regOpen) && (regClose == null || t <= regClose); };
      if (tt.saleOpensAt && !within(tt.saleOpensAt)) e[`${q}.saleOpensAt`] = { key: 'events.validation.withinRegistration' };
      if (tt.saleClosesAt && !within(tt.saleClosesAt)) e[`${q}.saleClosesAt`] = { key: 'events.validation.withinRegistration' };
      if (tt.saleOpensAt && tt.saleClosesAt && ms(tt.saleClosesAt) <= ms(tt.saleOpensAt)) e[`${q}.saleClosesAt`] = { key: 'events.validation.endAfterStart' };
      const min = int(tt.minPerOrder); const max = int(tt.maxPerOrder);
      if (min == null || min < 1 || min > 50) e[`${q}.minPerOrder`] = { key: 'events.validation.range', vars: { min: 1, max: 50 } };
      if (max == null || max < 1 || max > 50) e[`${q}.maxPerOrder`] = { key: 'events.validation.range', vars: { min: 1, max: 50 } };
      else if (min != null && max < min) e[`${q}.maxPerOrder`] = { key: 'events.validation.maxGteMin' };
    });
  });
  // 5 Kit
  if (form.hasKit) {
    if (form.collectionPoints.length < 1 || form.collectionPoints.length > 10) e.collectionPoints = { key: 'events.validation.range', vars: { min: 1, max: 10 } };
    form.collectionPoints.forEach((pt, i) => {
      const p = `collectionPoints.${i}`;
      length(`${p}.name`, pt.name, 1, 60, true);
      length(`${p}.address`, pt.address, 1, 200, true);
      const windows = pt.windows.filter(w => w.opensAt || w.closesAt);
      if (windows.length < 1 || windows.length > 5) e[`${p}.windows`] = { key: 'events.validation.range', vars: { min: 1, max: 5 } };
      windows.forEach((w, k) => {
        if (!w.opensAt || !w.closesAt) e[`${p}.windows.${k}`] = { key: 'events.validation.required' };
        else if (ms(w.closesAt) <= ms(w.opensAt)) e[`${p}.windows.${k}`] = { key: 'events.validation.endAfterStart' };
        else if (form.startsAt && ms(w.closesAt) >= starts) e[`${p}.windows.${k}`] = { key: 'events.validation.beforeEvent' };
      });
      length(`${p}.instructionsEn`, pt.instructionsEn, 1, 600, true);
      length(`${p}.instructionsSw`, pt.instructionsSw, 1, 600, true);
    });
    both('inclusionsEn', form.inclusionsEn, 'inclusionsSw', form.inclusionsSw, 600);
  }
  // 6 Terms
  length('termsEn', form.termsEn, 100, 20_000, true);
  length('termsSw', form.termsSw, 100, 20_000, true);
  req('policyPreset', !!form.policyPreset);
  if (form.policyPreset === 'custom') { length('policyEn', form.policyEn, 50, 5000, true); length('policySw', form.policySw, 50, 5000, true); }
  if (!form.contactEmail.trim()) e.contactEmail = { key: 'events.validation.required' };
  else if (!isEmail(form.contactEmail)) e.contactEmail = { key: 'events.validation.email' };
  if (form.contactPhone.trim() && !isTzPhone(form.contactPhone)) e.contactPhone = { key: 'events.validation.phone' };
  if (form.sponsors.length > 10) e.sponsors = { key: 'events.validation.range', vars: { min: 0, max: 10 } };
  form.sponsors.forEach((sp, i) => {
    length(`sponsors.${i}.name`, sp.name, 1, 60, true);
    if (sp.url.trim() && !isHttps(sp.url)) e[`sponsors.${i}.url`] = { key: 'events.validation.httpsOnly' };
  });
  if (form.schedule.length > 20) e.schedule = { key: 'events.validation.range', vars: { min: 0, max: 20 } };
  form.schedule.forEach((it, i) => {
    const p = `schedule.${i}`;
    if (!it.at) e[`${p}.at`] = { key: 'events.validation.required' };
    else if ((form.startsAt && ms(it.at) < starts) || (form.endsAt && ms(it.at) > ends)) e[`${p}.at`] = { key: 'events.validation.withinEvent' };
    length(`${p}.labelEn`, it.labelEn, 1, 80, true);
    length(`${p}.labelSw`, it.labelSw, 1, 80, true);
  });
  return e;
}
/** Errors per step, for the stepper badge and `maxReached`. */
export function errorsByStep(errors: Errors): Record<WizardStep, number> {
  const out = Object.fromEntries(WIZARD_STEPS.map(sk => [sk, 0])) as Record<WizardStep, number>;
  for (const path of Object.keys(errors)) out[stepOfPath(path)] += 1;
  return out;
}
/** Server 422 `event_invalid { fields: [{path, code}] }` (§14.3) merged onto the same paths. */
const SERVER_PATHS: Array<[RegExp, string]> = [
  [/^description\.en$/, 'descriptionEn'], [/^description\.sw$/, 'descriptionSw'], [/^heroImageAlt$/, 'coverAlt'], [/^coverAlt$/, 'coverAlt'],
  [/^venue\.name$/, 'venueName'], [/^venue\.address$/, 'venueAddress'], [/^venue\.city$/, 'venueCity'], [/^venue\.region$/, 'venueRegion'], [/^venue\.(lat|lng)$/, 'pin'],
  [/^accessibility\.en$/, 'accessEn'], [/^accessibility\.sw$/, 'accessSw'], [/^inclusions\.en$/, 'inclusionsEn'], [/^inclusions\.sw$/, 'inclusionsSw'],
  [/^terms\.en$/, 'termsEn'], [/^terms\.sw$/, 'termsSw'], [/^refundPolicy\.preset$/, 'policyPreset'], [/^refundPolicy\.text\.en$/, 'policyEn'], [/^refundPolicy\.text\.sw$/, 'policySw'],
  [/^contact\.email$/, 'contactEmail'], [/^contact\.phone$/, 'contactPhone'], [/^contact\.whatsapp$/, 'contactWhatsapp'],
  [/^(categories\.\d+)\.distanceM$/, '$1.distanceKm'], [/^(categories\.\d+)\.eligibility\.en$/, '$1.eligibilityEn'], [/^(categories\.\d+)\.eligibility\.sw$/, '$1.eligibilitySw'],
  [/^(categories\.\d+\.ticketTypes\.\d+)\.priceTzs$/, '$1.priceText'],
  [/^(collectionPoints\.\d+)\.instructions\.en$/, '$1.instructionsEn'], [/^(collectionPoints\.\d+)\.instructions\.sw$/, '$1.instructionsSw'],
  [/^(collectionPoints\.\d+)\.(lat|lng)$/, '$1.pin'], [/^(collectionPoints\.\d+\.windows\.\d+)\.(opensAt|closesAt)$/, '$1'],
  [/^(schedule\.\d+)\.label\.en$/, '$1.labelEn'], [/^(schedule\.\d+)\.label\.sw$/, '$1.labelSw'],
];
/** A backend field path ("categories[0].ticketTypes[1].priceTzs") as the form names it ("categories.0.ticketTypes.1.priceText"). */
export function normaliseServerPath(path: string): string {
  let p = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  for (const [re, to] of SERVER_PATHS) { if (re.test(p)) { p = p.replace(re, to); break; } }
  return p;
}
// Backend code → the portal's own message key where the wording already exists (`too_long` keeps its own generic text).
const CODE_ALIASES: Record<string, string> = { invalid_url: 'httpsOnly', invalid_email: 'email', invalid_phone: 'phone' };
/** Server 422 `event_invalid { fields: [{path, code}] }` (§14.3) merged onto the form's own paths. */
export function serverErrors(fields: Array<{ path: string; code: string }> | undefined): Errors {
  const out: Errors = {};
  for (const f of fields ?? []) {
    const raw = f.code.replace(/^events\.validation\./, '');
    const code = CODE_ALIASES[raw] ?? raw;
    out[normaliseServerPath(f.path)] = { key: `events.validation.${code}` as MessageKey };
  }
  return out;
}
/** A stable DOM id for a field path, so the review step can focus it. */
export const fieldId = (path: string) => `ev-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;

// ── Material changes on a published event (§7.4) ──
export type Diff = { path: string; before: unknown; after: unknown };
const flat = (value: unknown, prefix: string, out: Record<string, unknown>) => {
  if (Array.isArray(value)) value.forEach((v, i) => flat(v, `${prefix}.${i}`, out));
  else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k, out));
  else out[prefix] = value ?? null;
};
const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
/** Which material fields differ between the saved document and the payload about to be sent. */
export function materialDiff(doc: EventDocument, payload: Omit<EventPatch, 'version'>): Diff[] {
  const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  const scope: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) scope[k] = (doc as unknown as Record<string, unknown>)[k];
  flat(scope, '', before); flat(payload, '', after);
  const generic = (p: string) => p.replace(/\.\d+\./g, '.').replace(/\.\d+$/, '');
  const out: Diff[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const g = generic(path);
    const material = (MATERIAL_FIELDS as readonly string[]).some(mf => g === mf || g.startsWith(`${mf}.`));
    if (!material) continue;
    if (sameValue(before[path], after[path])) continue;
    // A row's id is not a change in itself.
    if (/\.id$/.test(path)) continue;
    out.push({ path, before: before[path] ?? null, after: after[path] ?? null });
  }
  return out;
}

// ── Analytics (§15): no client pipeline exists in the portal; named no-ops so S7 can connect them. ──
export type EventsAnalyticsName = 'organizer_event_submitted';
export function trackEventsAnalytics(_name: EventsAnalyticsName, _payload: Record<string, string | number | boolean>) {
  // Intentionally empty (reuse map: no portal analytics hook). No personal data may ever be put in `_payload`.
}
