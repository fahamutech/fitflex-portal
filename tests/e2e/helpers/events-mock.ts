// A mock of the events S2 API (design spec events-s2-organizer-and-discovery §14) for the portal specs: every route the
// organizer area and the admin queue call is answered from fixtures shaped like §14, nothing reaches a real backend, and
// every call is recorded so a spec can assert the exact request a form sends. Same style as b2b-mock.ts.
import { expect, Page } from '@playwright/test';
import { makeS5, type S5Opts, type S5State } from './events-s5-mock';
import { makeS6, type S6Opts, type S6State } from './events-s6-mock';

export const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Call = { method: string; path: string; query: Record<string, string>; body: Json | null; headers?: Record<string, string>; /** Size of the raw request body in bytes (an image upload is not JSON). */ bytes?: number };
type Reply = Json | { status: number; json: Json } | { status: 204 } | { status: 200 | 201; body: string; headers?: Record<string, string> };
type Handler = (c: Call, m: RegExpMatchArray) => Reply | undefined;

// ── Sessions ──
export const OWNER = { id: 'usr_owner', userType: 'event_organizer', displayName: 'Neema Organizer', email: 'neema@runs.test' };
export const STAFF_ADMIN = { id: 'usr_sadmin', userType: 'organizer_staff', displayName: 'Juma Admin' };
export const STAFF_OPS = { id: 'usr_sops', userType: 'organizer_staff', displayName: 'Asha Ops' };
export const GYM_OWNER = { id: 'usr_gym', userType: 'gym_operator', gymId: 'gym_1', displayName: 'Baraka Gym' };
export const SUPER_ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@fitflex.test' };
export const EVENTS_STAFF = { id: 'admin-2', userType: 'admin', portalUser: true, aclPermissions: ['events'] };
export const EVENTS_KYC_STAFF = { id: 'admin-3', userType: 'admin', portalUser: true, aclPermissions: ['events', 'kyc'] };
export const OTHER_STAFF = { id: 'admin-4', userType: 'admin', portalUser: true, aclPermissions: ['gyms'] };

// ── Fixtures (§14.3, §14.4, §13) ──
export const OPTIONS = {
  discovery: true, favourites: false, registration: false, currency: 'TZS', closingSoonHours: 72,
  regions: [{ code: 'dar', name: { en: 'Dar es Salaam', sw: 'Dar es Salaam' } }, { code: 'arusha', name: { en: 'Arusha', sw: 'Arusha' } }],
  timezones: ['Africa/Dar_es_Salaam', 'Africa/Nairobi'],
};
export const organizerMe = (status = 'active', role = 'owner', extra: Json = {}) => ({
  organizer: { id: 'org_1', name: 'Dar Runners', status, timezone: 'Africa/Dar_es_Salaam', kycCaseId: 'kyc_1', kycStatus: status === 'active' ? 'approved' : status === 'pending_review' ? 'submitted' : status === 'draft' ? 'draft' : status, statusReason: status === 'suspended' || status === 'rejected' ? 'Duplicate partner' : null, ...extra },
  role, permissions: role === 'owner' || role === 'admin' ? ['events', 'staff'] : [],
});
/** The sentence members read, built by the server in both languages (the mock plays the server; the portal never words a policy). */
export function serverPolicyLine(p: Json): { en: string; sw: string } | null {
  const d = (n: number, l: 'en' | 'sw') => (l === 'en' ? (n === 1 ? '1 day' : `${n} days`) : `siku ${n}`);
  if (p.preset === 'no_refund') return { en: 'No refunds.', sw: 'Hakuna marejesho.' };
  if (p.preset === 'refund_until_close') return { en: 'Full refund until registration closes. No refund after that.', sw: 'Marejesho kamili hadi usajili ufungwe. Hakuna marejesho baada ya hapo.' };
  if (p.preset === 'full_until_days') return { en: `Full refund until ${d(p.days, 'en')} before the event. No refund after that.`, sw: `Marejesho kamili hadi ${d(p.days, 'sw')} kabla ya tukio. Hakuna marejesho baada ya hapo.` };
  if (p.preset === 'tiered') return {
    en: `${p.tiers.map((t: Json) => `${t.percent}% refund until ${d(t.daysBefore, 'en')} before the event.`).join(' ')} No refund after that.`,
    sw: `${p.tiers.map((t: Json) => `Marejesho ya ${t.percent}% hadi ${d(t.daysBefore, 'sw')} kabla ya tukio.`).join(' ')} Hakuna marejesho baada ya hapo.`,
  };
  return null;
}
const T0 = '2027-03-14T03:30:00.000Z'; // 06:30 EAT
const summary = (over: Json = {}) => ({
  id: 'evt_1', slug: 'dar-half-marathon-2027', title: 'Dar Half Marathon 2027', type: 'road', status: 'draft',
  startsAt: T0, endsAt: '2027-03-14T09:00:00.000Z', timezone: 'Africa/Dar_es_Salaam', utcOffsetMinutes: 180, timezoneAbbr: 'EAT',
  registrationOpensAt: null, registrationClosesAt: '2027-03-12T20:59:00.000Z', availability: null,
  venue: { name: 'Coco Beach', city: 'Dar es Salaam', region: 'dar' }, heroThumbUrl: null, heroImageAlt: null, distancesM: [5000, 10000, 21100], fromPriceTzs: 25000, currency: 'TZS',
  organizer: { id: 'org_1', name: 'Dar Runners', verified: true }, updatedAt: '2026-10-20T08:00:00.000Z', categoriesCount: 3, allowedActions: ['edit', 'submit', 'delete'], ...over,
});
export const ROWS = [
  summary(),
  summary({ id: 'evt_pub', slug: 'arusha-trail-10k', title: 'Arusha Trail 10K', type: 'trail', status: 'published', startsAt: '2027-05-02T04:00:00.000Z', endsAt: '2027-05-02T08:00:00.000Z', distancesM: [10000], categoriesCount: 1, allowedActions: ['edit', 'cancel'] }),
  summary({ id: 'evt_arch', slug: 'old-fun-run', title: 'Old Fun Run', type: 'fun', status: 'archived', startsAt: '2026-01-10T04:00:00.000Z', endsAt: '2026-01-10T08:00:00.000Z', distancesM: [5000], categoriesCount: 1, allowedActions: [] }),
];
const LONG = 'This is a long enough description for the half marathon event, with everything a runner needs to know.';
export const DOC = (over: Json = {}) => ({
  ...summary(), description: { en: LONG, sw: 'Haya ni maelezo marefu ya kutosha kuhusu mbio za nusu marathoni, yenye kila kitu mkimbiaji anachohitaji kujua.' },
  heroImageUrl: null, coverAlt: null, routeUrl: null, routeImageUrl: null, routeImageAlt: null,
  venue: { name: 'Coco Beach', address: 'Toure Drive', city: 'Dar es Salaam', region: 'dar', lat: -6.75, lng: 39.27 },
  accessibility: null, inclusions: null, kitProvided: false,
  categories: [
    { id: 'cat_1', name: '21K Half Marathon', distanceM: 21100, startsAt: T0, capacity: 500, eligibility: null, minAge: 16, ticketTypes: [{ id: 'tt_1', name: 'Early bird', priceTzs: 25000, currency: 'TZS', capacity: null, saleOpensAt: null, saleClosesAt: null, minPerOrder: 1, maxPerOrder: 10 }] },
    { id: 'cat_2', name: '10K', distanceM: 10000, startsAt: null, capacity: null, eligibility: null, minAge: null, ticketTypes: [{ id: 'tt_2', name: 'Standard', priceTzs: 0, currency: 'TZS', capacity: null, saleOpensAt: null, saleClosesAt: null, minPerOrder: 1, maxPerOrder: 10 }] },
  ],
  collectionPoints: [], schedule: [], sponsors: [], contact: { email: 'race@runs.test', phone: null, whatsapp: null },
  terms: { en: 'T'.repeat(120), sw: 'M'.repeat(120) }, refundPolicy: { preset: 'no_refund', text: null, generated: { en: 'No refunds.', sw: 'Hakuna marejesho.' } }, cancellation: null, shareUrl: null, publishedAt: null,
  version: 3, allowedActions: ['edit', 'submit', 'delete'], submittedAt: null, rejection: null, changeLogCount: 0, ...over,
});
export const PUBLISHED = DOC({ id: 'evt_pub', slug: 'arusha-trail-10k', title: 'Arusha Trail 10K', type: 'trail', status: 'published', publishedAt: '2026-10-19T08:00:00.000Z', allowedActions: ['edit', 'cancel'], changeLogCount: 1, version: 7 });
export const SUBMITTED = DOC({ id: 'evt_sub', slug: 'moshi-marathon', title: 'Moshi Marathon', status: 'submitted', submittedAt: '2026-10-21T08:00:00.000Z', allowedActions: ['withdraw'] });
export const SUMMARY = { eventsTotal: 3, publishedTotal: 1, registrationsTotal: 0, awaitingPaymentTotal: 0, confirmedTotal: 0, nextEvents: ROWS.slice(0, 2) };
export const CHANGES = [{ id: 'chg_1', at: '2026-10-20T08:00:00.000Z', actor: { name: 'Neema Organizer', role: 'owner' }, fields: ['startsAt'], material: true, note: { en: 'Start moved', sw: 'Kuanza kumesogezwa' }, before: { startsAt: '2027-05-02T03:00:00.000Z' }, after: { startsAt: '2027-05-02T04:00:00.000Z' } }];
export const STAFF = [
  { id: 'st_owner', userId: 'usr_owner', displayName: 'Neema Organizer', maskedContact: '+255 7•• ••• 123', role: 'owner', status: 'active', addedAt: '2026-10-01T08:00:00.000Z' },
  { id: 'st_admin', userId: 'usr_sadmin', displayName: 'Juma Admin', maskedContact: 'j•••@example.com', role: 'admin', status: 'active', addedAt: '2026-10-02T08:00:00.000Z' },
  { id: 'st_ops', userId: null, displayName: null, maskedContact: '+255 6•• ••• 456', role: 'ops', status: 'invited', addedAt: '2026-10-03T08:00:00.000Z' },
];
const item = (key: string, status: string, extra: Json = {}) => ({ key, by: 'partner', status, ...extra });
export const KYC_DRAFT = {
  partnerType: 'event_organizer',
  case: { id: 'kyc_1', partnerType: 'event_organizer', userId: 'usr_owner', corporateId: null, status: 'draft', tier: 3, round: 1, legalName: 'Dar Runners Ltd', tradingName: null, entityType: null, registrationNumber: null, registrationAuthority: null, incorporatedOn: null, registeredAddress: null, businessActivity: null, tin: null, submittedAt: null, reviewerId: null, decidedAt: null, decidedBy: null, reasonCode: null, reasonNote: null, reverifyAt: null, updatedAt: '2026-10-20T08:00:00.000Z' },
  people: [], documents: [], settlementAccounts: [],
  checklist: {
    partnerType: 'event_organizer', tier: 3,
    sections: [
      { key: 'business', items: [item('business.legalName', 'complete'), item('business.tradingName', 'missing', { optional: true }), item('business.registrationNumber', 'missing'), item('business.tin', 'missing'), item('business.registeredAddress', 'missing')] },
      { key: 'representative', items: [item('representative.fullName', 'missing'), item('representative.idNumber', 'missing'), item('representative.phone', 'missing'), item('representative.email', 'missing', { optional: true }), item('representative.position', 'missing')] },
      { key: 'documents', items: [item('documents.business_registration', 'missing', { requirementKey: 'business_registration' }), item('documents.tin_certificate', 'missing', { requirementKey: 'tin_certificate' }), item('documents.business_licence', 'missing', { requirementKey: 'business_licence', optional: true }), item('documents.representative_id', 'missing', { requirementKey: 'representative_id' }), item('documents.event_permit', 'missing', { requirementKey: 'event_permit', optional: true })] },
      { key: 'settlement', items: [item('settlement.payout_account', 'missing')] },
      { key: 'agreements', items: [item('agreements.partner_terms', 'missing'), item('agreements.kyc_consent', 'missing')] },
    ],
    missing: ['business.registrationNumber', 'business.tin', 'business.registeredAddress', 'representative.fullName', 'representative.idNumber', 'representative.phone', 'representative.position', 'documents.business_registration', 'documents.tin_certificate', 'documents.representative_id', 'settlement.payout_account', 'agreements.partner_terms', 'agreements.kyc_consent'],
    awaitingReview: [], readyToSubmit: false, complete: false,
  },
};
export const KYC_READY = { ...KYC_DRAFT, checklist: { ...KYC_DRAFT.checklist, sections: KYC_DRAFT.checklist.sections.map(s => ({ ...s, items: s.items.map(i => ({ ...i, status: 'complete' })) })), missing: [], readyToSubmit: true, complete: true } };
export const KYC_SUBMITTED = { ...KYC_READY, case: { ...KYC_DRAFT.case, status: 'submitted', submittedAt: '2026-10-21T08:00:00.000Z' } };
export const KYC_INFO = { ...KYC_DRAFT, case: { ...KYC_DRAFT.case, status: 'info_requested', reasonCode: 'document_unreadable', reasonNote: 'Please re-upload the TIN certificate.' } };
export const KYC_REJECTED = { ...KYC_READY, case: { ...KYC_DRAFT.case, status: 'rejected', reasonCode: 'duplicate_partner', reasonNote: null } };
export const AGREEMENTS = { agreements: [
  { agreementType: 'partner_agreement', version: '2026-09-29', reference: 'FFA-ORG-001', title: 'Organizer partner terms', lang: 'en', sections: [{ heading: 'Scope', text: 'These terms cover events you organize on FitFlex.' }], acceptedAt: null },
  { agreementType: 'kyc_consent', version: '2026-09-29', reference: 'FFA-KYC-CON-001 v1.0', title: 'Consent to verification', lang: 'en', sections: [{ heading: 'What this covers', text: 'Verification of your details.' }], acceptedAt: null },
] };
const adminRow = (d: Json, over: Json = {}) => ({ ...summary(), ...d, organizer: { id: 'org_1', name: 'Dar Runners', verified: true, status: 'active', kycCaseId: 'kyc_1' }, permitOnFile: false, submittedAt: d.submittedAt ?? null, ...over });
export const ADMIN_ROWS = [adminRow(SUBMITTED), adminRow(PUBLISHED, { permitOnFile: true }), adminRow(ROWS[0])];
export const ADMIN_DOC = (d: Json = SUBMITTED, over: Json = {}) => ({ ...d, organizer: { id: 'org_1', name: 'Dar Runners', verified: true, status: 'active', kycCaseId: 'kyc_1' }, permitOnFile: false, allowedActions: d.status === 'submitted' ? ['approve', 'reject'] : d.status === 'published' ? ['cancel'] : [], ...over });
export const AUDIT = [{ id: 'aud_1', at: '2026-10-21T09:00:00.000Z', actor: { id: 'admin-1', name: 'Admin One' }, action: 'events.submitted', target: 'evt_sub', reason: null, note: null }];

const empty = { items: [], total: 0, nextCursor: null };
export const pageOf = <T,>(items: T[]) => ({ items, total: items.length, nextCursor: null });


// ── Events S3 fixtures (spec events-s3-registration-and-orders §3.1, §3.10, §3.13) ──
export const OPTIONS_S3 = { ...OPTIONS, registration: true, holdTtlMinutes: 30, maxParticipantsPerOrder: 10, payment: 'none', teams: true, corporate: true, claim: { smsCodes: true, emailCodes: false }, consentTextVersion: '2026-10-draft' };
export const STAFF_FINANCE = { id: 'usr_sfin', userType: 'organizer_staff', displayName: 'Fatma Finance' };
/** An organisation user (B2B): `roles` are the session's organizationRoles; `permissions` answer GET /b2b/organizations/:id. */
export const orgUser = (roles: string[]) => ({ id: 'org-user-1', userType: 'member', email: 'people@safari.test', displayName: 'Neema People', organizationUser: true, organizationRoles: roles });
export const HR_USER = { id: 'hr-1', userType: 'corporate_hr', email: 'hr@mwenge.test', displayName: 'Juma HR' };
export const ORG = { id: 'org-1', organizationType: 'club', legalName: 'Safari Cover Ltd', tradingName: 'Safari Cover', status: 'active', email: 'ops@safari.test', phone: '+255700000000' };
export const PERMS_PEOPLE = ['beneficiaries.read', 'beneficiaries.manage', 'analytics.read'];
export const PERMS_BILLING = [...PERMS_PEOPLE, 'billing.read', 'billing.pay'];
export const PUBLIC_EVENTS = [
  { ...PUBLISHED, availability: 'open', categories: undefined },
  { ...DOC({ id: 'evt_pub2', slug: 'moshi-fun-run', title: 'Moshi Fun Run', type: 'fun', status: 'published', startsAt: '2027-06-05T04:00:00.000Z', endsAt: '2027-06-05T07:00:00.000Z' }), availability: 'open', categories: undefined },
];
export const PUBLIC_DETAIL = { ...PUBLISHED, availability: 'open', shareUrl: 'https://fitflex.test/e/arusha-trail-10k', participantFields: { phone: 'required', email: 'optional', dateOfBirth: 'required', gender: 'off', emergencyContact: 'optional', kitSize: 'off' }, duplicatePolicy: 'one_per_category',
  categories: PUBLISHED.categories.map((c: Json) => ({ ...c, availability: 'open', remaining: null, ticketTypes: c.ticketTypes.map((tt: Json) => ({ ...tt, availability: 'open' })) })) };
const CONSENT = { version: '2026-10-draft', versionLabel: '2026-10', organisation: { en: 'We confirm our organisation has each listed person\'s permission to register them for this event and to share their details with FitFlex and the organizer.', sw: 'Tunathibitisha shirika letu lina ruhusa ya kila mtu aliyeorodheshwa kumsajili kwenye tukio hili na kushirikisha taarifa zake na FitFlex na mwandaaji.' } };
const participant = (first: string, last: string, phone: string, email: string | null, ticketTypeId: string, extra: Json = {}) => ({ ticketTypeId, firstName: first, lastName: last, phone, email, dateOfBirth: '1990-01-01', gender: null, emergencyContact: null, kitSize: null, groupLabel: null, consentBasis: 'organisation', ...extra });
const quoteFor = (lines: Array<{ ticketTypeId: string; quantity: number }>, discountPct = 0) => {
  const price: Record<string, [string, string, string, number]> = { tt_1: ['Early bird', 'cat_1', '21K Half Marathon', 25000], tt_2: ['Standard', 'cat_2', '10K', 0] };
  const ql = lines.map(l => { const [name, categoryId, categoryName, unit] = price[l.ticketTypeId]; const sub = unit * l.quantity; const disc = Math.round(sub * discountPct / 100); return { ticketTypeId: l.ticketTypeId, ticketTypeName: name, categoryId, categoryName, quantity: l.quantity, unitPriceTzs: unit, discountTzs: disc, feesTzs: 0, lineTotalTzs: sub - disc }; });
  const subtotalTzs = ql.reduce((a, l) => a + l.unitPriceTzs * l.quantity, 0); const discountTzs = ql.reduce((a, l) => a + l.discountTzs, 0);
  return { currency: 'TZS', lines: ql, subtotalTzs, discountTzs, feesTzs: 0, totalTzs: subtotalTzs - discountTzs, feeLabel: null };
};
/** Parses the posted CSV the way the service does (header aliases, DD/MM/YYYY) far enough for the specs: name, phone, email, category. */
function parseRoster(rawText: string) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const idx = (names: string[]) => header.findIndex(h => names.includes(h));
  const iFirst = idx(['first name', 'given name']); const iLast = idx(['last name', 'surname']); const iName = idx(['name']); const iPhone = idx(['phone', 'mobile', 'mobile number']);
  const iEmail = idx(['email']); const iCat = idx(['category', 'distance', 'race']); const iDob = idx(['date of birth', 'dob']); const iGroup = idx(['group', 'department']);
  return lines.slice(1).map((line, index) => {
    const c = line.split(',').map(v => v.trim());
    let first = iFirst >= 0 ? c[iFirst] ?? '' : ''; let last = iLast >= 0 ? c[iLast] ?? '' : '';
    if (iName >= 0 && !first) { const parts = (c[iName] ?? '').split(/\s+/); first = parts.slice(0, -1).join(' '); last = parts.slice(-1)[0] ?? ''; if (parts.length < 2) { first = parts[0] ?? ''; last = ''; } }
    return { index, first, last, phone: iPhone >= 0 ? c[iPhone] ?? '' : '', email: iEmail >= 0 ? c[iEmail] ?? '' : '', category: iCat >= 0 ? c[iCat] ?? '' : '', dob: iDob >= 0 ? c[iDob] ?? '' : '', group: iGroup >= 0 ? c[iGroup] ?? '' : '' };
  });
}
/** The roster dry run (§3.10): per-row problems, duplicates, lines and a quote for the ok rows. */
export function validateRoster(rawText: string, opts: { capacityShort?: Json[]; alreadyRegistered?: string[]; discountPct?: number; warnFirst?: boolean } = {}) {
  const parsed = parseRoster(rawText);
  const seen = new Map<string, number>();
  const duplicates: Json[] = [];
  const rows = parsed.map(p => {
    const problems: Json[] = [];
    if (!p.first || !p.last) problems.push({ field: 'name', code: 'name_incomplete' });
    const digits = p.phone.replace(/\D/g, '');
    if (!p.phone && !p.email) problems.push({ field: 'phone', code: 'contact_required' });
    else if (p.phone && !/^(255|0)[67]\d{8}$/.test(digits)) problems.push({ field: 'phone', code: 'phone_invalid' });
    const cat = /21/.test(p.category) ? 'cat_1' : /10/.test(p.category) ? 'cat_2' : null;
    if (!cat) problems.push({ field: 'category', code: 'category_unknown' });
    if (cat === 'cat_1' && !p.dob) problems.push({ field: 'dateOfBirth', code: 'dob_required' });
    const key = digits || p.email.toLowerCase();
    if (key && seen.has(key)) duplicates.push({ index: p.index, kind: 'in_list', otherIndex: seen.get(key) }); else if (key) seen.set(key, p.index);
    if (opts.alreadyRegistered?.includes(digits)) { duplicates.push({ index: p.index, kind: 'already_registered', registrationStatus: 'confirmed' }); problems.push({ field: 'phone', code: 'duplicate_participant' }); }
    const ticketTypeId = cat === 'cat_1' ? 'tt_1' : cat === 'cat_2' ? 'tt_2' : null;
    // Real shape (events-roster-service rowOut): ids sit on the row, never on `participant`; warnings are their own array.
    const { ticketTypeId: _omit, ...wire } = participant(p.first, p.last, p.phone || null, p.email || null, '', { dateOfBirth: p.dob || null, groupLabel: p.group || null });
    void _omit;
    return { index: p.index, line: p.index + 1, ok: problems.length === 0, participant: wire, categoryId: cat, ticketTypeId, problems, ...(problems.length === 0 && opts.warnFirst && p.index === 0 ? { warnings: [{ field: 'emergencyContact', code: 'not_collected' }] } : {}) };
  });
  const dupIdx = new Set(duplicates.map(d => d.index));
  const okRows = rows.filter(r => r.ok && !dupIdx.has(r.index));
  const lines = Object.entries(okRows.reduce<Record<string, number>>((acc, r) => { acc[r.ticketTypeId!] = (acc[r.ticketTypeId!] ?? 0) + 1; return acc; }, {})).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
  const availability: Json = { tt_1: { availability: 'open', remaining: 8 }, tt_2: { availability: 'open', remaining: null } };
  return {
    rows, duplicates, summary: { total: rows.length, ok: okRows.length, problems: rows.filter(r => !r.ok).length, duplicates: duplicates.length },
    lines, quote: okRows.length ? quoteFor(lines, opts.discountPct ?? 0) : null, availability, fields: PUBLIC_DETAIL.participantFields, consentText: CONSENT,
    refundPolicy: { preset: 'no_refund', text: null }, capacityShort: opts.capacityShort ?? [],
  };
}
const ORDER_EVENT = { id: 'evt_pub', slug: 'arusha-trail-10k', title: 'Arusha Trail 10K', startsAt: '2027-05-02T04:00:00.000Z', timezone: 'Africa/Dar_es_Salaam', utcOffsetMinutes: 180, timezoneAbbr: 'EAT', heroThumbUrl: null };
export const ORDER_ROW = (over: Json = {}) => ({ id: 'ord_1', reference: 'EV-2026-0001', status: 'awaiting_payment', event: ORDER_EVENT, placesCount: 3, totalTzs: 50000, currency: 'TZS', holdExpiresAt: new Date(Date.now() + 27 * 60_000).toISOString(), createdAt: '2026-10-22T08:00:00.000Z', closedAt: null, closeReason: null, createdBy: { name: 'Neema People' }, costCentre: 'CC-12', purchaserReference: 'PO-77', ...over });
export const ORDER_DETAIL = (over: Json = {}, regsOver: Json[] = []) => {
  const row = ORDER_ROW(over);
  const regs = [
    { id: 'reg_1', ticketTypeId: 'tt_1', categoryId: 'cat_1', categoryName: '21K Half Marathon', ticketTypeName: 'Early bird', firstName: 'Asha', lastName: 'Mollel', status: row.status === 'awaiting_payment' ? 'reserved' : row.status === 'confirmed' ? 'confirmed' : 'cancelled', consentBasis: 'organisation', isSelf: false, claimState: 'claimed', phone: '0712345678', email: 'asha@example.co.tz', groupLabel: 'Finance', kitSize: null },
    { id: 'reg_2', ticketTypeId: 'tt_1', categoryId: 'cat_1', categoryName: '21K Half Marathon', ticketTypeName: 'Early bird', firstName: 'Juma', lastName: 'Omari', status: row.status === 'awaiting_payment' ? 'reserved' : row.status === 'confirmed' ? 'confirmed' : 'cancelled', consentBasis: 'organisation', isSelf: false, claimState: 'unclaimed', phone: '0755000111', email: null, groupLabel: 'Operations', kitSize: null },
    { id: 'reg_3', ticketTypeId: 'tt_2', categoryId: 'cat_2', categoryName: '10K', ticketTypeName: 'Standard', firstName: 'Zawadi', lastName: 'Kim', status: row.status === 'awaiting_payment' ? 'reserved' : row.status === 'confirmed' ? 'confirmed' : 'cancelled', consentBasis: 'organisation', isSelf: false, claimState: 'unclaimed', phone: '0788000222', email: 'z@example.co.tz', groupLabel: null, kitSize: null },
  ].map((r, i) => ({ ...r, ...(regsOver[i] ?? {}) }));
  return {
    order: { id: row.id, reference: row.reference, eventId: 'evt_pub', status: row.status, currency: 'TZS', subtotalTzs: 50000, discountTzs: 0, feesTzs: 0, totalTzs: row.totalTzs, holdExpiresAt: row.holdExpiresAt, holdCycle: 1, createdAt: row.createdAt, teamId: 'team_1', closedAt: row.closedAt, closeReason: row.closeReason, organizationId: 'org-1', costCentre: row.costCentre, purchaserReference: row.purchaserReference, termsAcceptedAt: row.createdAt, consentTextVersion: '2026-10-draft' },
    lines: quoteFor([{ ticketTypeId: 'tt_1', quantity: 2 }, { ticketTypeId: 'tt_2', quantity: 1 }]).lines, registrations: regs,
    event: { ...PUBLISHED, shareUrl: 'https://fitflex.test/e/arusha-trail-10k' }, team: { id: 'team_1', name: 'Safari Cover', teamType: 'corporate', memberCount: 3 },
    next: { payment: 'none', instructions: null }, allowedActions: row.status === 'awaiting_payment' ? ['cancel'] : [], createdBy: row.createdBy, costCentre: row.costCentre, purchaserReference: row.purchaserReference,
  };
};
/** Organizer roster rows (§3.13): the server masks reserved names and never returns contact fields. */
export const REG_ROWS = [
  { id: 'reg_6', participant: { name: 'Z***** K**' }, categoryName: '10K', ticketTypeName: 'Standard', status: 'cancelled', orderReference: 'EV-2026-0004', teamName: null, kitSize: null, createdAt: '2026-10-19T08:00:00.000Z', claimed: false },
  { id: 'reg_1', participant: { name: 'A*** M*****' }, categoryName: '21K Half Marathon', ticketTypeName: 'Early bird', status: 'reserved', orderReference: 'EV-2026-0001', teamName: 'Safari Cover', kitSize: null, createdAt: '2026-10-22T08:00:00.000Z', claimed: true },
  { id: 'reg_4', participant: { name: 'Baraka Mushi' }, categoryName: '10K', ticketTypeName: 'Standard', status: 'confirmed', orderReference: 'EV-2026-0002', teamName: null, kitSize: 'l', createdAt: '2026-10-21T08:00:00.000Z', claimed: true },
  { id: 'reg_5', participant: { name: 'Neema Ally' }, categoryName: '10K', ticketTypeName: 'Standard', status: 'cancelled', orderReference: 'EV-2026-0003', teamName: null, kitSize: null, createdAt: '2026-10-20T08:00:00.000Z', claimed: false },
];
export const REG_ROWS_ADMIN = REG_ROWS.map(r => (r.id === 'reg_1' ? { ...r, participant: { name: 'Asha Mollel' } } : r));
export const REG_SUMMARY = { byStatus: { reserved: 1, confirmed: 1, cancelled: 1 }, byCategory: [{ categoryId: 'cat_1', name: '21K Half Marathon', capacity: 500, sold: 0, held: 1 }, { categoryId: 'cat_2', name: '10K', capacity: null, sold: 1, held: 0 }] };
export const ORG_ORDER_ROWS = [
  { id: 'ord_1', reference: 'EV-2026-0001', status: 'awaiting_payment', purchaser: { type: 'organization', label: 'Safari Cover' }, placesCount: 3, totalTzs: 50000, feesTzs: 0, currency: 'TZS', createdAt: '2026-10-22T08:00:00.000Z', holdExpiresAt: '2026-10-22T08:30:00.000Z', closedAt: null, closeReason: null },
  { id: 'ord_2', reference: 'EV-2026-0002', status: 'confirmed', purchaser: { type: 'member', label: 'B***** M****' }, placesCount: 1, totalTzs: 0, feesTzs: 0, currency: 'TZS', createdAt: '2026-10-21T08:00:00.000Z', holdExpiresAt: null, closedAt: '2026-10-21T08:10:00.000Z', closeReason: null },
];
export const ORG_ORDER_ROWS_ADMIN = ORG_ORDER_ROWS.map(r => (r.id === 'ord_2' ? { ...r, purchaser: { type: 'member', label: 'Baraka Mushi' } } : r));
export const ADMIN_ORDER_DETAIL = (id = 'ord_1') => {
  // Real shape (adminGetOrder): { order, lines, registrations, event, team, next, allowedActions, purchaser, createdBy }; no contact fields.
  const d = ORDER_DETAIL({ id }); const row = ORG_ORDER_ROWS_ADMIN.find(r => r.id === id) ?? ORG_ORDER_ROWS_ADMIN[0];
  return {
    order: { ...d.order, status: row.status, closedAt: row.closedAt, closeReason: row.closeReason }, lines: d.lines,
    registrations: d.registrations.map((r: Json) => { const { phone, email, dateOfBirth, gender, emergencyContact, ...rest } = r; void phone; void email; void dateOfBirth; void gender; void emergencyContact; return rest; }),
    event: d.event, team: d.team, next: d.next, allowedActions: row.status === 'awaiting_payment' ? ['cancel'] : [],
    purchaser: { ...row.purchaser, id: 'org-1' }, createdBy: { id: 'usr_x', name: 'Neema People' },
  };
};


// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Events S4 mock (spec docs/design/events-s4-payments-and-tickets.md §3, §6): payments, refunds, finance and the corporate
// payment routes. Strict about the REAL shapes of the spec: it refuses what the backend would refuse (a missing amount
// received, a wrong role, a client-sent amount, a missing Idempotency-Key, a stale expected total) so a portal that
// guesses a shape fails the spec instead of passing against a lenient mock. Statuses move as writes are accepted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export type S4Opts = {
  payment?: 'none' | 'manual' | 'provider';
  /** MONEY_SECOND_APPROVER on: payment and refund rows carry secondApproverRequired and a stage. */
  secondApprover?: boolean;
  /** `bare` (default): the cancel answers `{ status }` only and the portal asks the batch route; `batch` includes the batch. */
  cancelResponse?: 'batch' | 'bare' | 'batch_error';
  financeEmpty?: boolean;
  /** Trap: the finance answer carries payer fields; the portal must never render them. */
  financeLeak?: boolean;
  noOrgInstructions?: boolean;
  /** `batch_error`: the cancel answers 200 with `batch.error` (the event is cancelled, raising refunds failed). */
  failOneInBatch?: boolean;
};
export type S4State = {
  requests: Json[]; refunds: Json[]; adminOrders: Record<string, Json>; corp: Record<string, Json>;
  batchRemaining: number; liveRefundable: number; resendCount: Record<string, number>; idem: Record<string, { body: string; payment: Json }>;
};
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const evOrder = (over: Json = {}) => ({
  orderId: 'ord_1', reference: 'EV-2026-0001', status: 'awaiting_payment', eventId: 'evt_pub', eventTitle: 'Arusha Trail 10K', placesCount: 2, holdExpiresAt: hoursFromNow(20),
  totalTzs: 50000, expectedTzs: 50000, organizationName: null, lateOutcome: 'none', ...over,
});
export const EVENT_PAYMENT_REQUEST = (over: Json = {}, eo: Json = {}) => ({
  id: 'pr_ev1', memberId: 'mem_1', subscriptionId: null, orderId: null, eventOrderId: eo.orderId ?? 'ord_1', productType: 'EVENT_ORDER', currency: 'TZS', tier: null, amountTzs: 50000,
  status: 'pending', provider: 'admin_approved', reference: null, memberReference: 'QGH7XK2L9P', payerPhone: '+255712345678', note: 'event_order:EV-2026-0001',
  requestedAt: '2026-10-27T08:00:00.000Z', decidedAt: null, member: { displayName: 'Asha Mollel', phone: '+255712345678', email: null }, eventOrder: evOrder(eo), ...over,
});
const REFUND = (over: Json = {}) => ({
  id: 'rf_1', memberId: 'mem_1', kind: 'event_order', subscriptionId: null, bookingId: null, orderId: null, paymentRequestId: 'pr_x', amountTzs: 25000, currency: 'TZS', reasonCode: 'member_cancelled',
  note: null, status: 'requested', requestedBy: 'mem_1', requestedRole: 'member', decidedBy: null, decidedAt: null, decisionNote: null, paidAt: null, paymentReference: null, paidTo: null,
  createdAt: '2026-10-27T09:00:00.000Z', member: { id: 'mem_1', displayName: 'Asha Mollel', phone: '+255712345678', email: null }, event: { id: 'evt_pub', title: 'Arusha Trail 10K' },
  orderReference: 'EV-2026-0001', scope: 'registration', batchId: null, policySnapshot: { preset: 'tiered', percent: 50, deadlineAt: '2027-04-18T04:00:00.000Z', evaluatedAt: '2026-10-27T09:00:00.000Z' },
  payerPhone: '+255712345678', organizationName: null, ...over,
});
const ORG_INSTRUCTIONS = (ref: string, amount: number) => ({ kind: 'organisation', bankName: 'CRDB Bank', accountName: 'FitFlex Africa Ltd', accountNumber: '0150123456700', branch: 'Samora Avenue', lipaNamba: '5123456', lipaNambaName: 'FITFLEX AFRICA', notes: null, reference: ref, amountTzs: amount });
const PAYMENT_VIEW = (over: Json = {}) => ({
  id: 'evp_1', state: 'submitted', method: 'manual', amountTzs: 50000, currency: 'TZS', reference: 'CRDB-TRF-00917', payerPhoneMasked: null, submittedAt: '2026-10-27T10:00:00.000Z', decidedAt: null,
  confirmTargetAt: hoursFromNow(24), rejectCode: null, memberNote: null, late: false, canRetry: false, refundId: null, payerMethod: 'bank_transfer', paidOn: '2026-10-27', ...over,
});
const PAYMENT_BODY_KEYS = ['method', 'reference', 'paidOn', 'note'];
const eatToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

function makeS4(user: Json, me: Json | null, orgRole: string, o: S4Opts, setup: { orgStatus?: string }) {
  const payment = o.payment ?? 'manual';
  const options = { ...OPTIONS_S3, payment, ...(payment !== 'none' ? { manualConfirmHours: 24, refundDays: 5, hold: { manualExtendHours: 24, manualMaxHours: 48, providerExtendMinutes: 10, lateGraceHours: 24 }, tickets: { qr: true, scanning: false } } : {}) };
  const two = !!o.secondApprover;
  const scopes: string[] | null = user.portalUser ? (user.aclPermissions ?? []) : null; // null = super admin
  const hasScope = (scope: string) => scopes === null || scopes.includes(scope);
  const forbidden = () => ({ status: 403, json: { error: 'acl_forbidden' } });
  const twoRow = (r: Json): Json => {
    if (!two) return r;
    if (r.status !== 'pending') return { ...r, secondApproverRequired: true };
    const stage = r.verifiedBy ? 'awaiting_second_approval' : 'awaiting_verification';
    return { ...r, secondApproverRequired: true, approvalStage: stage, ...(r.verifiedBy ? { approveNotBy: r.verifiedBy } : {}) };
  };
  const state: S4State = {
    requests: [
      EVENT_PAYMENT_REQUEST(),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_rehold', memberReference: 'LATE000001', note: 'event_order:EV-2026-0002' }, { orderId: 'ord_late1', reference: 'EV-2026-0002', status: 'expired', lateOutcome: 'would_rehold', holdExpiresAt: hoursFromNow(-3) }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_refund', memberReference: 'LATE000002', note: 'event_order:EV-2026-0003' }, { orderId: 'ord_late2', reference: 'EV-2026-0003', status: 'expired', lateOutcome: 'would_refund', holdExpiresAt: hoursFromNow(-5) }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_org', memberReference: 'CRDB-TRF-00917', payerPhone: null, member: { displayName: 'Neema People', phone: null, email: 'people@safari.test' }, note: 'event_order:EV-2026-0004' }, { orderId: 'ord_org', reference: 'EV-2026-0004', organizationName: 'Safari Cover Ltd' }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_cancelled_event', memberReference: 'CANC000001', note: 'event_order:EV-2026-0008' }, { orderId: 'ord_cev', reference: 'EV-2026-0008', eventStatus: 'cancelled' }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_repair', status: 'approved', decidedAt: '2026-10-27T11:00:00.000Z', reference: 'QGH7XK2L9P', memberReference: 'QGH7XK2L9P', note: 'event_order:EV-2026-0005' }, { orderId: 'ord_rep', reference: 'EV-2026-0005', repairable: true }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_attn', status: 'approved', decidedAt: '2026-10-27T11:00:00.000Z', reference: 'ATTN000001', memberReference: 'ATTN000001', note: 'event_order:EV-2026-0006' }, { orderId: 'ord_attn', reference: 'EV-2026-0006', status: 'expired', paymentStatus: 'reconciliation_required', failureReason: 'capacity_unavailable', refundId: 'rf_unf' }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_rej', status: 'rejected', decidedAt: '2026-10-27T11:00:00.000Z', memberReference: 'REJ0000001', note: 'event_order:EV-2026-0017' }, { orderId: 'ord_rej', reference: 'EV-2026-0017' }),
      EVENT_PAYMENT_REQUEST({ id: 'pr_ev_canc', status: 'cancelled', decidedAt: '2026-10-27T11:00:00.000Z', memberReference: 'CAN0000001', note: 'event_order:EV-2026-0018' }, { orderId: 'ord_canc', reference: 'EV-2026-0018' }),
      { id: 'pr_pass', memberId: 'mem_2', subscriptionId: 'sub_1', orderId: null, tier: 'pro', plan: 'monthly', currency: 'TZS', amountTzs: 90000, status: 'approved', provider: 'admin_approved', reference: 'PASS000001', memberReference: 'PASS000001', requestedAt: '2026-10-20T08:00:00.000Z', decidedAt: '2026-10-20T09:00:00.000Z', member: { displayName: 'Baraka Mushi', phone: '+255755000111', email: null }, subscription: { type: 'platform_pass', status: 'active' } },
    ],
    refunds: [
      REFUND({ id: 'rf_review', amountTzs: 25000, orderReference: 'EV-2026-0007', policySnapshot: { preset: 'custom', percent: null, deadlineAt: null, evaluatedAt: null }, note: 'I cannot attend' }),
      REFUND({ id: 'rf_tier', amountTzs: 40000, orderReference: 'EV-2026-0016', requestedBy: 'admin-3', requestedRole: 'admin' }),
      REFUND({ id: 'rf_policy', status: 'approved', decidedBy: 'policy', decidedAt: '2026-10-27T09:00:01.000Z', amountTzs: 12500, scope: 'order', orderReference: 'EV-2026-0001', requestedRole: 'member' }),
      REFUND({ id: 'rf_b1', batchId: 'evb_1', scope: 'event_cancelled', amountTzs: 25000, requestedBy: 'admin-1', requestedRole: 'admin', reasonCode: 'cancelled_by_fitflex', orderReference: 'EV-2026-0010', policySnapshot: null, member: { id: 'mem_3', displayName: 'Zawadi Kim', phone: '+255788000222', email: null }, payerPhone: '+255788000222' }),
      REFUND({ id: 'rf_b2', batchId: 'evb_1', scope: 'event_cancelled', amountTzs: 25000, requestedBy: 'admin-1', requestedRole: 'admin', reasonCode: 'cancelled_by_fitflex', orderReference: 'EV-2026-0011', policySnapshot: null, member: { id: 'mem_4', displayName: 'Juma Omari', phone: '+255755000111', email: null }, payerPhone: '+255755000111' }),
      REFUND({ id: 'rf_b3', batchId: 'evb_1', scope: 'event_cancelled', status: 'approved', amountTzs: 50000, requestedBy: 'admin-1', requestedRole: 'admin', decidedBy: 'admin-2', decidedAt: '2026-10-27T12:00:00.000Z', reasonCode: 'cancelled_by_fitflex', orderReference: 'EV-2026-0012', policySnapshot: null, organizationName: 'Safari Cover Ltd', payerPhone: null, member: { id: 'mem_5', displayName: 'Neema People', phone: null, email: 'people@safari.test' } }),
      REFUND({ id: 'rf_unf', status: 'approved', decidedBy: 'policy', scope: 'unfulfilled_payment', amountTzs: 50000, orderReference: 'EV-2026-0006', requestedBy: 'system', requestedRole: 'system', reasonCode: 'payment_error', policySnapshot: null }),
      REFUND({ id: 'rf_paid', status: 'paid', decidedBy: 'admin-2', paidAt: '2026-10-26T10:00:00.000Z', paymentReference: 'MPESA QX12AB34', paidTo: '+255712345678', scope: 'registration', orderReference: 'EV-2026-0013' }),
    ],
    adminOrders: {}, corp: {}, batchRemaining: 1, liveRefundable: 350000, resendCount: {}, idem: {},
  };
  const refundOut = (r: Json): Json => {
    if (!two) return r;
    const stage = r.status === 'requested' ? 'awaiting_approval' : r.status === 'approved' ? 'awaiting_payment' : null;
    return { ...r, secondApproverRequired: true, approvalStage: stage, ...(r.status === 'requested' && r.requestedRole === 'admin' ? { approveNotBy: r.requestedBy } : {}), ...(r.status === 'approved' ? { payNotBy: r.decidedBy === 'policy' ? 'admin-1' : r.decidedBy } : {}) };
  };

  // ── admin event orders (§6.4) ──
  const refundViews = (orderRef: string) => state.refunds.filter(r => r.orderReference === orderRef).map(r => ({ id: r.id, status: r.status, scope: r.scope, amountTzs: r.amountTzs, currency: 'TZS', requestedAt: r.createdAt, decidedAt: r.decidedAt, paidAt: r.paidAt, paidTo: null, paymentReference: r.paymentReference, rejectionNote: r.decisionNote }));
  const adminOrder = (id: string): Json | null => {
    const base: Record<string, Json> = {
      ord_1: { ref: 'EV-2026-0001', status: 'awaiting_payment', total: 50000, pay: { state: 'submitted', method: 'manual', amountTzs: 50000, expectedTzs: 50000, reference: 'QGH7XK2L9P', payerPhone: '+255712345678', submittedAt: '2026-10-27T08:00:00.000Z', holdHistory: [{ at: '2026-10-27T08:00:00.000Z', holdExpiresAt: hoursFromNow(20) }] }, tickets: null },
      ord_2: { ref: 'EV-2026-0014', status: 'confirmed', total: 75000, pay: { state: 'confirmed', method: 'manual', amountTzs: 75000, expectedTzs: 75000, reference: 'DONE000001', payerPhone: '+255712345678', submittedAt: '2026-10-26T08:00:00.000Z', verifiedAt: '2026-10-26T09:00:00.000Z', verifiedByName: 'Grace Finance', decidedAt: '2026-10-26T10:00:00.000Z', decidedByName: 'Admin One', ticketsIssuedAt: '2026-10-26T10:00:01.000Z' }, tickets: { issued: 3, cancelled: 0 } },
      ord_rep: { ref: 'EV-2026-0005', status: 'awaiting_payment', total: 50000, pay: { state: 'confirmed', method: 'manual', amountTzs: 50000, expectedTzs: 50000, reference: 'QGH7XK2L9P', payerPhone: '+255712345678', submittedAt: '2026-10-27T08:00:00.000Z', decidedAt: '2026-10-27T11:00:00.000Z', decidedByName: 'Admin One', repairable: true }, tickets: null },
      ord_attn: { ref: 'EV-2026-0006', status: 'expired', total: 50000, pay: { id: 'evp_attn', state: 'needs_attention', method: 'manual', amountTzs: 50000, expectedTzs: 50000, reference: 'ATTN000001', payerPhone: '+255712345678', submittedAt: '2026-10-27T08:00:00.000Z', failureReason: 'capacity_unavailable', refundId: 'rf_unf' }, tickets: null },
      ord_cust: { ref: 'EV-2026-0019', status: 'confirmed', total: 60000, pay: { state: 'confirmed', method: 'manual', amountTzs: 60000, expectedTzs: 60000, reference: 'CUST000001', payerPhone: '+255712345678', submittedAt: '2026-10-26T08:00:00.000Z', decidedAt: '2026-10-26T10:00:00.000Z', decidedByName: 'Admin One' }, tickets: { issued: 2, cancelled: 0 } },
      ord_attn3: { ref: 'EV-2026-0020', status: 'confirmed', total: 50000, pay: { id: 'evp_attn3', state: 'needs_attention', method: 'manual', amountTzs: 50000, expectedTzs: 50000, reference: 'ATTN000003', payerPhone: '+255712345678', submittedAt: '2026-10-27T09:00:00.000Z', failureReason: 'order_already_paid' }, tickets: null },
      ord_attn2: { ref: 'EV-2026-0015', status: 'expired', total: 50000, pay: { id: 'evp_attn2', state: 'needs_attention', method: 'manual', amountTzs: 50000, expectedTzs: 50000, reference: 'ATTN000002', payerPhone: '+255712345678', submittedAt: '2026-10-27T08:00:00.000Z', failureReason: 'order_cancelled' }, tickets: null },
    };
    const b = base[id]; if (!b) return null;
    const st = state.adminOrders[id]?.status ?? b.status;
    const pay = { ...b.pay, ...(state.adminOrders[id]?.pay ?? {}) };
    // The server masks the payer's number and hides the transaction ID without the `payments` scope.
    const masked = hasScope('payments') ? pay : { ...pay, payerPhone: '+255 7•• ••• 678', reference: null };
    // Real shape (backend #270): staff data is `paymentPanel.payments[]` with the EventPayment `status`, not `payment.state`.
    const { state: memberState, ...rest } = masked;
    const epStatus: Record<string, string> = { submitted: 'pending', confirmed: 'succeeded', needs_attention: 'reconciliation_required' };
    const panelPay = { ...rest, status: epStatus[memberState as string] ?? memberState };
    const d = ADMIN_ORDER_DETAIL('ord_1');
    return {
      ...d, order: { ...d.order, id, reference: b.ref, status: st, totalTzs: b.total, subtotalTzs: b.total, closedAt: st === 'expired' || st === 'cancelled' ? '2026-10-27T10:00:00.000Z' : null, closeReason: st === 'expired' ? 'expired' : null },
      purchaser: { type: 'member', id: 'mem_1', label: 'Asha Mollel' }, allowedActions: st === 'awaiting_payment' || st === 'confirmed' ? ['cancel'] : [],
      paymentPanel: { payments: [panelPay], tickets: b.tickets, refunds: refundViews(b.ref) }, refunds: refundViews(b.ref),
    };
  };
  const orderRows = ['ord_1', 'ord_2', 'ord_rep', 'ord_attn', 'ord_attn2', 'ord_cust', 'ord_attn3'].map(id => { const d = adminOrder(id)!; return { id, reference: d.order.reference, status: d.order.status, purchaser: { type: 'member', label: 'Asha Mollel' }, placesCount: 2, totalTzs: d.order.totalTzs, feesTzs: 0, currency: 'TZS', createdAt: '2026-10-26T08:00:00.000Z', holdExpiresAt: d.order.status === 'awaiting_payment' ? hoursFromNow(20) : null, closedAt: d.order.closedAt, closeReason: d.order.closeReason }; });

  // ── corporate orders (§6.8) ──
  const regs = (status: string, invited: boolean) => ORDER_DETAIL({}, []).registrations.map((r: Json, i: number) => ({
    ...r, status, claimState: i === 0 ? 'claimed' : 'unclaimed', ...(i === 2 ? { phone: null, email: null } : {}),
    // Real shape (backend S4): flat claimInvitedAt / claimInviteCount alongside the nested invitation.
    claimInvitedAt: invited && i === 1 ? '2026-10-27T12:00:00.000Z' : null, claimInviteCount: invited && i === 1 ? 1 : 0,
    invitation: { sentAt: invited && i === 1 ? '2026-10-27T12:00:00.000Z' : null, count: invited && i === 1 ? 1 : 0, hasContact: i !== 2 },
  }));
  const corpDoc = (id: string, ref: string, st: string, extra: Json = {}, regStatus = st === 'confirmed' ? 'confirmed' : st === 'awaiting_payment' ? 'reserved' : 'cancelled'): Json => {
    const d = ORDER_DETAIL({ id, reference: ref, status: st, holdExpiresAt: st === 'awaiting_payment' ? hoursFromNow(20) : null, closedAt: st === 'expired' ? hoursFromNow(-2) : st === 'cancelled' ? hoursFromNow(-1) : null, closeReason: st === 'expired' ? 'expired' : st === 'cancelled' ? 'cancelled' : null });
    return {
      ...d, registrations: regs(regStatus, st === 'confirmed'), order: { ...d.order, id, reference: ref, status: st, holdExpiresAt: st === 'awaiting_payment' ? hoursFromNow(20) : null, closedAt: d.order.closedAt },
      next: { payment: st === 'awaiting_payment' ? payment : 'none', instructions: st === 'awaiting_payment' && !o.noOrgInstructions ? ORG_INSTRUCTIONS(ref, 50000) : null },
      allowedActions: [], payment: null, refunds: [], ...extra,
    };
  };
  state.corp = {
    ord_c_new: corpDoc('ord_c_new', 'EV-2026-0021', 'awaiting_payment', { allowedActions: ['cancel'], payment: { ...PAYMENT_VIEW({ state: 'none', reference: null, submittedAt: null, confirmTargetAt: null }), id: null } }),
    ord_c_rej: corpDoc('ord_c_rej', 'EV-2026-0022', 'awaiting_payment', { allowedActions: ['cancel'], payment: PAYMENT_VIEW({ state: 'rejected', rejectCode: 'reference_not_found', memberNote: 'No such transfer on the statement', canRetry: true, decidedAt: '2026-10-27T11:00:00.000Z' }) }),
    ord_c_sub: corpDoc('ord_c_sub', 'EV-2026-0023', 'awaiting_payment', { payment: PAYMENT_VIEW() }),
    ord_c_exp: corpDoc('ord_c_exp', 'EV-2026-0024', 'expired', { next: { payment: 'manual', instructions: o.noOrgInstructions ? null : ORG_INSTRUCTIONS('EV-2026-0024', 50000) } }),
    ord_c_expsub: corpDoc('ord_c_expsub', 'EV-2026-0025', 'expired', { payment: PAYMENT_VIEW() }),
    ord_c_conf: corpDoc('ord_c_conf', 'EV-2026-0026', 'confirmed', { allowedActions: ['cancel_refund'], payment: PAYMENT_VIEW({ state: 'confirmed', decidedAt: '2026-10-27T11:00:00.000Z' }) }),
    ord_c_ref: corpDoc('ord_c_ref', 'EV-2026-0027', 'refund_pending', { payment: PAYMENT_VIEW({ state: 'confirmed' }), refunds: [{ id: 'rf_c1', status: 'approved', scope: 'order', amountTzs: 25000, currency: 'TZS', requestedAt: '2026-10-27T12:00:00.000Z', decidedAt: '2026-10-27T12:30:00.000Z', paidAt: null, paidTo: null, paymentReference: null, rejectionNote: null }] }, 'cancelled'),
  };
  const corpPreview = { eligible: true, mode: 'auto', percent: 50, paidTzs: 50000, refundTzs: 25000, currency: 'TZS', deadlineAt: '2027-04-18T04:00:00.000Z', policy: { preset: 'tiered', text: { en: 'Full refund until 30 days before, 50% until 14 days before.', sw: 'Marejesho kamili hadi siku 30 kabla, 50% hadi siku 14 kabla.' } }, releaseInventory: true, blocked: null };
  const billing = ['owner', 'admin', 'finance'].includes(orgRole);

  const routes: Array<[string, RegExp, Handler]> = [
    // ── admin payments (§3.7) ──
    ['GET', /^\/admin\/payment-requests$/, c => (!hasScope('payments') ? forbidden() : (state.requests.filter(r => !c.query.productType || r.productType === c.query.productType).map(twoRow) as unknown as Json))],
    ['POST', /^\/admin\/payment-requests\/([^/]+)\/verify$/, (c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.requests.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      if (r.verifiedBy) return { status: 409, json: { error: 'already_verified' } };
      r.verifiedBy = user.id; r.verifiedAt = '2026-10-28T08:00:00.000Z'; if (c.body?.reference) r.reference = c.body.reference;
      return twoRow(r);
    }],
    ['POST', /^\/admin\/payment-requests\/([^/]+)\/decision$/, (c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.requests.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      const b = c.body ?? {};
      if (r.status !== 'pending') return { status: 409, json: { error: 'already_decided' } };
      if (!['approve', 'reject'].includes(b.decision)) return { status: 400, json: { error: 'invalid_decision' } };
      if (b.decision === 'approve') {
        // Strict (§3.7.3): approval-only fields; the amount received is mandatory and must equal the order.
        if ('reasonCode' in b || 'memberNote' in b) return { status: 400, json: { error: 'invalid_body' } };
        if (typeof b.amountTzs !== 'number' && b.amountTzs !== undefined) return { status: 400, json: { error: 'amount_required' } };
        if (b.amountTzs === undefined || b.amountTzs === null) return { status: 400, json: { error: 'amount_required' } };
        if (!Number.isInteger(b.amountTzs) || b.amountTzs <= 0) return { status: 400, json: { error: 'amount_required' } };
        if (two) {
          if (!r.verifiedBy) return { status: 409, json: { error: 'verification_required' } };
          if (r.verifiedBy === user.id) return { status: 403, json: { error: 'cannot_approve_own_verification' } };
        }
        if (b.amountTzs !== r.eventOrder.expectedTzs) return { status: 409, json: { error: 'amount_mismatch', expectedTzs: r.eventOrder.expectedTzs } };
        const outcome = r.eventOrder.lateOutcome === 'would_rehold' ? 'reheld' : r.eventOrder.lateOutcome === 'would_refund' ? 'refund_raised' : 'confirmed';
        r.status = 'approved'; r.decidedAt = '2026-10-28T08:00:00.000Z'; r.decidedBy = user.id; if (b.reference) r.reference = b.reference;
        if (outcome === 'refund_raised') state.refunds.push(REFUND({ id: 'rf_new', status: 'approved', decidedBy: 'policy', scope: 'unfulfilled_payment', amountTzs: r.amountTzs, orderReference: r.eventOrder.reference, requestedBy: 'system', requestedRole: 'system', reasonCode: 'payment_error', policySnapshot: null }));
        return { paymentRequest: twoRow(r), event: { outcome, ...(outcome === 'refund_raised' ? { reason: 'capacity_unavailable', refundId: 'rf_new' } : {}) } };
      }
      if ('amountTzs' in b) return { status: 400, json: { error: 'invalid_body' } };
      if (!['reference_not_found', 'amount_mismatch', 'wrong_account', 'duplicate_reference', 'other'].includes(b.reasonCode)) return { status: 400, json: { error: 'reason_code_required', allowed: ['reference_not_found', 'amount_mismatch', 'wrong_account', 'duplicate_reference', 'other'] } };
      if (b.reasonCode === 'other' && !String(b.memberNote ?? '').trim()) return { status: 400, json: { error: 'note_required' } };
      if (String(b.memberNote ?? '').length > 140) return { status: 400, json: { error: 'invalid_body' } };
      r.status = 'rejected'; r.decidedAt = '2026-10-28T08:00:00.000Z'; r.rejectCode = b.reasonCode;
      return { paymentRequest: r, event: { outcome: 'rejected' } };
    }],
    ['POST', /^\/admin\/payment-requests\/([^/]+)\/change-request$/, (c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.requests.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      // Real rule (backend S4 review 7): an event payment can only go rejected -> approved by a change request.
      if (r.eventOrderId && !(r.status === 'rejected' && c.body?.status === 'approved')) return { status: 409, json: { error: 'event_payment_change_not_allowed' } };
      r.changeRequestedStatus = c.body?.status; r.changeRequestedBy = user.id; r.changeRequestReason = c.body?.reason;
      return twoRow(r);
    }],
    ['POST', /^\/admin\/payment-requests\/([^/]+)$/, (c, m) => {
      const r = state.requests.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      if (c.body?.status === 'approved' && r.eventOrderId) return { status: 400, json: { error: 'amount_required' } };
      if (c.body?.status) r.status = c.body.status;
      return r;
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)\/repair-payment$/, (_c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.requests.find(x => x.eventOrder?.orderId === m[2]);
      if (!r?.eventOrder?.repairable && !(state.adminOrders[m[2]] ? false : adminOrder(m[2])?.payment?.repairable)) return { status: 409, json: { error: 'nothing_to_repair' } };
      if (r) { r.eventOrder.repairable = false; r.eventOrder.status = 'confirmed'; }
      state.adminOrders[m[2]] = { status: 'confirmed', pay: { repairable: false } };
      return { ok: true };
    }],
    // ── admin refunds (§3.12) ──
    ['GET', /^\/admin\/refunds$/, () => (!hasScope('payments') ? forbidden() : { refunds: state.refunds.map(refundOut) })],
    ['POST', /^\/admin\/refunds\/batch-decision$/, c => {
      if (!hasScope('payments')) return forbidden();
      const b = c.body ?? {};
      const rows = state.refunds.filter(r => r.batchId === b.batchId && r.status === 'requested');
      if (b.decision !== 'approve' || !b.batchId || typeof b.expectedTotalTzs !== 'number' || typeof b.expectedCount !== 'number') return { status: 400, json: { error: 'invalid_body' } };
      // Real shapes (backend #270): expected totals are required; a stale pair is 409 batch_changed with the live totals; rows can fail one by one.
      if (b.expectedTotalTzs == null || b.expectedCount == null) return { status: 400, json: { error: 'expected_totals_required' } };
      const live = rows.reduce((n, r) => n + r.amountTzs, 0);
      if (b.expectedCount !== rows.length || b.expectedTotalTzs !== live) return { status: 409, json: { error: 'batch_changed', totalTzs: live, count: rows.length } };
      if (two && rows.every(r => r.requestedBy === user.id)) return { status: 403, json: { error: 'cannot_approve_own_request' } };
      const results = rows.map(r => {
        if (two && r.requestedBy === user.id) return { refundId: r.id, ok: false, error: 'cannot_approve_own_request' };
        if (o.failOneInBatch && r.id === 'rf_b2') return { refundId: r.id, ok: false, error: 'refund_recipient_missing' };
        r.status = 'approved'; r.decidedBy = user.id; r.decidedAt = '2026-10-28T08:00:00.000Z'; return { refundId: r.id, ok: true };
      });
      return { approved: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, results };
    }],
    ['POST', /^\/admin\/refunds\/batch-paid$/, c => {
      if (!hasScope('payments')) return forbidden();
      const b = c.body ?? {};
      if (!b.batchId || !Array.isArray(b.items) || b.items.length > 200) return { status: 400, json: { error: 'invalid_body' } };
      return {
        results: b.items.map((it: Json) => {
          const r = state.refunds.find(x => x.id === it.refundId && x.batchId === b.batchId);
          if (!r) return { refundId: it.refundId, ok: false, error: 'not_found' };
          if (!String(it.paymentReference ?? '').trim()) return { refundId: it.refundId, ok: false, error: 'payment_reference_required' };
          if (r.status !== 'approved') return { refundId: it.refundId, ok: false, error: 'refund_not_approved' };
          if (two && r.decidedBy === user.id) return { refundId: it.refundId, ok: false, error: 'cannot_pay_own_approval' };
          r.status = 'paid'; r.paymentReference = it.paymentReference; r.paidTo = it.paidTo ?? null; r.paidAt = '2026-10-28T09:00:00.000Z';
          return { refundId: it.refundId, ok: true };
        }),
      };
    }],
    ['POST', /^\/admin\/refunds\/([^/]+)\/decision$/, (c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.refunds.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      if (r.status !== 'requested') return { status: 409, json: { error: 'already_decided' } };
      if (two && r.requestedRole === 'admin' && r.requestedBy === user.id) return { status: 403, json: { error: 'cannot_approve_own_request' } };
      if (c.body?.decision === 'approve') {
        if (!Number.isInteger(c.body.amountTzs) || c.body.amountTzs <= 0 || c.body.amountTzs > r.amountTzs) return { status: 400, json: { error: 'invalid_amount' } };
        r.status = 'approved'; r.amountTzs = c.body.amountTzs; r.decidedBy = user.id;
      } else if (c.body?.decision === 'reject') {
        if (!String(c.body.note ?? '').trim()) return { status: 400, json: { error: 'note_required' } };
        r.status = 'rejected'; r.decisionNote = c.body.note;
      } else return { status: 400, json: { error: 'invalid_decision' } };
      return { refund: r };
    }],
    ['POST', /^\/admin\/refunds\/([^/]+)\/paid$/, (c, m) => {
      if (!hasScope('payments')) return forbidden();
      const r = state.refunds.find(x => x.id === m[1]); if (!r) return { status: 404, json: { error: 'not_found' } };
      if (r.status !== 'approved') return { status: 409, json: { error: 'refund_not_approved' } };
      if (!String(c.body?.paymentReference ?? '').trim()) return { status: 400, json: { error: 'payment_reference_required' } };
      r.status = 'paid'; r.paymentReference = c.body.paymentReference; r.paidTo = c.body.paidTo ?? null;
      return { refund: r };
    }],
    ['POST', /^\/admin\/refunds$/, c => {
      if (!hasScope('payments')) return forbidden();
      const b = c.body ?? {};
      if (!b.eventPaymentId || b.reasonCode !== 'payment_error' || !String(b.note ?? '').trim()) return { status: 400, json: { error: 'invalid_body' } };
      if (b.eventPaymentId === 'evp_confirmed') return { status: 409, json: { error: 'payment_not_unfulfilled' } };
      state.refunds.push(REFUND({ id: 'rf_raised', status: 'requested', requestedRole: 'admin', requestedBy: user.id, scope: 'unfulfilled_payment', orderReference: 'EV-2026-0015', policySnapshot: null, reasonCode: 'payment_error' }));
      state.adminOrders.ord_attn2 = { pay: { refundId: 'rf_raised' } };
      return { status: 201, json: { refund: state.refunds[state.refunds.length - 1] } };
    }],
    // ── admin event orders and cancellation (§3.12.3, §3.12.4) ──
    ['GET', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)\/cancel-preview$/, (_c, m) => (m[2] === 'ord_2' ? { eligible: true, blocked: null, paidTzs: 75000, currency: 'TZS', releaseInventory: true, modes: { full: { refundTzs: 75000 }, policy: { evaluable: true, mode: 'auto', percent: 50, refundTzs: 37500 }, none: { refundTzs: 0, requiresScope: 'payments' } }, policy: { preset: 'tiered' } }
      : m[2] === 'ord_cust' ? { eligible: true, blocked: null, paidTzs: 60000, currency: 'TZS', releaseInventory: false, modes: { full: { refundTzs: 60000 }, policy: { evaluable: false, mode: 'manual_review', percent: 0, refundTzs: null, error: 'policy_not_evaluable' }, none: { refundTzs: 0, requiresScope: 'payments' } }, policy: { preset: 'custom' } }
      : { status: 404, json: { error: 'order_not_found' } })],
    ['GET', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)$/, (_c, m) => adminOrder(m[2]) ?? { status: 404, json: { error: 'order_not_found' } }],
    ['GET', /^\/admin\/events\/([^/]+)\/orders$/, (c, m) => (m[1] !== 'evt_pub' ? pageOf([]) : pageOf(orderRows.map(r => ({ ...r, status: state.adminOrders[r.id]?.status ?? r.status })).filter(r => !c.query.status || r.status === c.query.status)))],
    ['POST', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)\/cancel$/, (c, m) => {
      if (!hasScope('events')) return forbidden();
      const d = adminOrder(m[2]); if (!d) return { status: 404, json: { error: 'order_not_found' } };
      if (String(c.body?.note ?? '').trim().length < 5) return { status: 400, json: { error: 'note_required' } };
      const paid = d.order.status === 'confirmed';
      if (paid && !['full', 'policy', 'none'].includes(c.body?.refundMode)) return { status: 400, json: { error: 'refund_mode_required' } };
      // Real rules (backend S4 review): 'none' on a paid order needs `payments`; 'policy' cannot work out a custom preset.
      if (paid && c.body.refundMode === 'none' && !hasScope('payments')) return { status: 403, json: { error: 'payments_scope_required' } };
      if (paid && c.body.refundMode === 'policy' && m[2] === 'ord_cust') return { status: 409, json: { error: 'policy_not_evaluable' } };
      if (!paid && 'refundMode' in (c.body ?? {})) return { status: 400, json: { error: 'invalid_body' } };
      state.adminOrders[m[2]] = { status: paid && c.body.refundMode !== 'none' ? 'refund_pending' : 'cancelled', pay: {} };
      return { order: { ...d.order, status: state.adminOrders[m[2]].status }, registrations: [] };
    }],
    ['GET', /^\/admin\/events\/([^/]+)\/cancel-preview$/, () => ({ awaitingOrders: 2, awaitingWithSubmittedPayment: 1, paidOrders: 3, paidPlaces: 7, totalPaidTzs: 350000, alreadyRefundedTzs: 0, refundableTzs: 350000, openRefunds: 0 })],
    ['POST', /^\/admin\/events\/([^/]+)\/cancel$/, (c, m) => {
      if (!hasScope('events')) return forbidden();
      const b = c.body ?? {};
      if (!['weather', 'permit', 'safety', 'low_turnout', 'organizer_decision', 'other'].includes(b.reason)) return { status: 400, json: { error: 'reason_code_required' } };
      if ('refundPaidOrders' in b && typeof b.refundPaidOrders !== 'boolean') return { status: 400, json: { error: 'invalid_body' } };
      // Real rule: `expectedRefundableTzs` is required when paid orders exist (the preview says 3), whatever refundPaidOrders is.
      if (b.expectedRefundableTzs === undefined) return { status: 400, json: { error: 'expected_refundable_required' } };
      if (b.expectedRefundableTzs !== state.liveRefundable) return { status: 409, json: { error: 'refundable_changed' } };
      if (o.cancelResponse === 'batch_error' && b.refundPaidOrders) return { status: 'cancelled', batch: { error: 'batch_failed', status: null, resumeWith: `/admin/events/${m[1]}/refund-batch` } };
      return { status: 'cancelled', ...(o.cancelResponse === 'batch' && b.refundPaidOrders ? { batch: { batchId: 'evb_9', created: 3, existing: 0, remaining: 0, amountTzs: 350000 } } : {}), eventId: m[1] };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/refund-batch$/, c => {
      // Real rules: resume needs `payments`; the server compares an expected total to the LIVE total, which drops after each 200-order chunk.
      if (!hasScope('payments')) return { status: 403, json: { error: 'forbidden' } };
      if (c.body?.expectedRefundableTzs !== undefined && c.body.expectedRefundableTzs !== state.liveRefundable) return { status: 409, json: { error: 'refundable_changed' } };
      const first = state.batchRemaining > 0; const created = first ? 200 : 150;
      state.batchRemaining = first ? 0 : 0; state.liveRefundable = first ? 120000 : 0;
      return { batchId: 'evb_9', created, existing: first ? 0 : 200, remaining: first ? 150 : 0, amountTzs: 350000 };
    }],
    // ── organizer finance (§3.14): totals only ──
    ['GET', /^\/organizer\/events\/([^/]+)\/finance$/, (_c, m) => {
      if (!me || !['owner', 'admin', 'finance'].includes(me.role)) return { status: 403, json: { error: 'forbidden_role' } };
      if (m[1] !== 'evt_pub') return { status: 404, json: { error: 'event_not_found' } };
      const z = !!o.financeEmpty;
      return {
        eventId: 'evt_pub', currency: 'TZS', asOf: '2026-10-28T08:00:00.000Z', paidTzs: z ? 0 : 1_200_000, refundedTzs: z ? 0 : 100_000, refundPendingTzs: z ? 0 : 50_000, awaitingPaymentTzs: z ? 0 : 75_000,
        commissionPct: 10, commissionTzs: z ? 0 : 105_000, expectedNetTzs: z ? 0 : 945_000, orders: { paid: z ? 0 : 20, refunded: z ? 0 : 2, partlyRefunded: z ? 0 : 1 },
        byTicketType: z ? [] : [{ ticketTypeId: 'tt_1', name: 'Early bird', sold: 40, grossTzs: 1_000_000 }, { ticketTypeId: 'tt_2', name: 'Standard', sold: 20, grossTzs: 200_000 }], settlement: { state: 'not_started' },
        ...(o.financeLeak ? { payerPhone: '0712999888', transactionId: 'LEAKTXN001', perOrder: [{ reference: 'EV-LEAK-1', payerName: 'Leaky Payer' }] } : {}),
      };
    }],
    // ── corporate orders and payment (§3.4.3, §3.5, §3.10, §3.12.2) ──
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders$/, () => pageOf(Object.values(state.corp).map(d => ({ id: d.order.id, reference: d.order.reference, status: d.order.status, event: ORDER_EVENT, placesCount: d.registrations.length, totalTzs: d.order.totalTzs, currency: 'TZS', holdExpiresAt: d.order.holdExpiresAt, createdAt: d.order.createdAt, closedAt: d.order.closedAt, closeReason: d.order.closeReason, createdBy: { name: 'Neema People' } })))],
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/payment-status$/, (_c, m) => { const d = state.corp[m[1]]; return d ? { order: { id: d.order.id, status: d.order.status, holdExpiresAt: d.order.holdExpiresAt, totalTzs: d.order.totalTzs, currency: 'TZS' }, payment: d.payment, refund: d.refunds[0] ?? null } : { status: 404, json: { error: 'order_not_found' } }; }],
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/cancel-preview$/, (_c, m) => (state.corp[m[1]]?.order.status === 'confirmed' ? corpPreview : { status: 409, json: { error: 'order_not_found' } })],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/payment$/, (c, m) => {
      const d = state.corp[m[1]]; if (!d) return { status: 404, json: { error: 'order_not_found' } };
      if (!billing) return { status: 403, json: { error: 'forbidden_role' } };
      if (payment === 'none') return { status: 404, json: { error: 'feature_disabled' } };
      const key = c.headers?.['idempotency-key'];
      if (!key) return { status: 400, json: { error: 'idempotency_key_required' } };
      if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) return { status: 400, json: { error: 'idempotency_key_required' } };
      const b = c.body ?? {};
      // Strict (§3.4.3): the client never sends an amount, currency, provider or payer phone.
      if (Object.keys(b).some(k => !PAYMENT_BODY_KEYS.includes(k))) return { status: 400, json: { error: 'invalid_body' } };
      if (!['bank_transfer', 'mobile_money'].includes(b.method)) return { status: 400, json: { error: 'invalid_body' } };
      if (String(b.reference ?? '').trim().length < 4) return { status: 400, json: { error: 'payment_reference_invalid' } };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.paidOn ?? '') || b.paidOn > eatToday()) return { status: 400, json: { error: 'invalid_body' } };
      if (b.note !== undefined && String(b.note).length > 300) return { status: 400, json: { error: 'invalid_body' } };
      const fp = JSON.stringify(b); const prior = state.idem[`${m[1]}:${key}`];
      if (prior) return prior.body === fp ? { payment: prior.payment, order: { id: d.order.id, status: d.order.status, holdExpiresAt: d.order.holdExpiresAt }, replayed: true } : { status: 409, json: { error: 'idempotency_key_reused' } };
      if (d.order.status === 'awaiting_payment' && d.payment && ['submitted', 'processing'].includes(d.payment.state)) return { status: 409, json: { error: 'payment_in_progress' } };
      if (d.order.status === 'expired' && (!d.order.closedAt || Date.now() - Date.parse(d.order.closedAt) > 24 * 3_600_000)) return { status: 409, json: { error: 'hold_expired' } };
      if (!['awaiting_payment', 'expired'].includes(d.order.status)) return { status: 409, json: { error: 'order_not_payable', status: d.order.status } };
      const pv = PAYMENT_VIEW({ id: `evp_${m[1]}`, reference: b.reference.trim(), payerMethod: b.method, paidOn: b.paidOn, late: d.order.status === 'expired', submittedAt: '2026-10-28T08:00:00.000Z' });
      d.payment = pv; state.idem[`${m[1]}:${key}`] = { body: fp, payment: pv };
      d.allowedActions = []; // a submitted payment blocks the buyer's own cancel (spec §3.6, payment_submitted)
      return { status: 201, json: { payment: pv, order: { id: d.order.id, status: d.order.status, holdExpiresAt: d.order.holdExpiresAt }, replayed: false } };
    }],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/cancel$/, (c, m) => {
      const d = state.corp[m[1]]; if (!d) return { status: 404, json: { error: 'order_not_found' } };
      if (!billing) return { status: 403, json: { error: 'forbidden_role' } };
      if (!['changed_mind', 'wrong_details', 'duplicate', 'other'].includes(c.body?.reason)) return { status: 400, json: { error: 'invalid_reason' } };
      if (d.order.status === 'confirmed') {
        if (typeof c.body?.expectedRefundTzs !== 'number') return { status: 400, json: { error: 'invalid_body' } };
        if (c.body.expectedRefundTzs !== corpPreview.refundTzs) return { status: 409, json: { error: 'refund_changed', refundTzs: corpPreview.refundTzs } };
        d.order = { ...d.order, status: 'refund_pending' }; d.allowedActions = []; d.refunds = [{ id: 'rf_c9', status: 'approved', scope: 'order', amountTzs: corpPreview.refundTzs, currency: 'TZS', requestedAt: '2026-10-28T08:00:00.000Z', decidedAt: '2026-10-28T08:00:00.000Z', paidAt: null, paidTo: null, paymentReference: null, rejectionNote: null }];
        return { order: d.order, registrations: [] };
      }
      if ('expectedRefundTzs' in (c.body ?? {})) return { status: 400, json: { error: 'invalid_body' } };
      d.order = { ...d.order, status: 'cancelled', closedAt: '2026-10-28T08:00:00.000Z', closeReason: 'cancelled' }; d.allowedActions = [];
      return { order: d.order, registrations: [] };
    }],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/claim-invitations$/, (c, m) => {
      const d = state.corp[m[1]]; if (!d) return { status: 404, json: { error: 'order_not_found' } };
      if (!billing) return { status: 403, json: { error: 'forbidden_role' } };
      const reg = d.registrations.find((r: Json) => r.id === c.body?.registrationId);
      if (!reg) return { status: 404, json: { error: 'registration_not_found' } };
      if (d.order.status !== 'confirmed' || reg.claimState !== 'unclaimed') return { status: 409, json: { error: 'order_not_confirmed' } };
      const n = (state.resendCount[reg.id] = (state.resendCount[reg.id] ?? 0) + 1);
      if (n > 1) return { status: 409, json: { error: 'resend_limit_reached' } };
      reg.claimInvitedAt = '2026-10-28T08:00:00.000Z';
      return { sent: true, channel: 'sms', nextAllowedAt: null };
    }],
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)$/, (_c, m) => state.corp[m[1]] ?? { status: 404, json: { error: 'order_not_found' } }],
  ];
  void setup; void ORG_INSTRUCTIONS;
  return { routes, options, state };
}

export type EventsMock = {
  /** S4 state for assertions (statuses move as the strict routes accept writes). */ s4: S4State | null;
  /** S5 state for assertions (kit, bibs, clients, endpoints, payout schedule). */ s5: S5State | null;
  /** S6 state for assertions (results, releases, medals, art uploads, rewards). */ s6: S6State | null;
  calls: Call[]; unmatched: Call[];
  writes: (path?: RegExp) => Call[];
  reads: (path: RegExp) => Call[];
  /** Answer the next matching route differently: later calls to `on` win. */
  on: (method: string, path: RegExp, handler: Handler) => void;
};

/**
 * Signs the page in as `user` (localStorage session, as the other specs do) and answers the API from fixtures.
 * `me` is the GET /organizer/me answer (null → 404 no_organizer). `extra` routes win over the defaults.
 */
export async function setupEvents(page_: Page, user: Json = OWNER, opts: { me?: Json | null; locale?: 'en' | 'sw'; kyc?: Json; extra?: Array<[string, RegExp, Handler]>;
  /** S3: the options probe says registration + corporate are on, and the S3 routes answer. */ s3?: boolean; orgPermissions?: string[]; orgStatus?: string; orders?: Record<string, Json>;
  /** S4 (spec events-s4-payments-and-tickets): payments, refunds, finance and the corporate payment routes, strict about the spec's shapes. Implies s3. */ s4?: S4Opts;
  /** S5 (spec events-s5-venue-api-and-webhooks): kit desk, bibs, export, integrations and the payout schedule, strict about the spec's shapes. Implies s3. */ s5?: S5Opts;
  /** S6 (spec events-s6-runs-results-medals-rewards): results, medals, artwork and the admin reward desk, strict about the spec. Implies s5 and s3. */ s6?: S6Opts } = {}): Promise<EventsMock> {
  const calls: Call[] = [];
  const unmatched: Call[] = [];
  const routes: Array<[string, RegExp, Handler]> = [...(opts.extra ?? [])];
  const me = opts.me === undefined ? organizerMe() : opts.me;
  let kyc: Json = opts.kyc ?? KYC_DRAFT;
  let staff: Json[] = STAFF.map(s => ({ ...s }));
  // Strict about the backend's rules (contract check vs fitflex-functions#249): the organizer lives on its own persona,
  // /me/kyc/* admits only the owner persona, the representative role is fixed, invites are phone/email only, and the
  // kit step must say kitProvided.
  let currentType: string = String(user.userType);
  let created: Json | null = null;
  const isOrganizerSession = () => currentType === 'event_organizer' || currentType === 'organizer_staff';
  const docs: Record<string, Json> = { evt_1: DOC(), evt_pub: PUBLISHED, evt_sub: SUBMITTED, evt_arch: DOC({ id: 'evt_arch', status: 'archived', allowedActions: [] }) };
  const orgRole = (user.organizationRoles ?? [])[0] ?? (user.userType === 'corporate_hr' ? 'hr' : 'member');
  const s4 = opts.s4 ? makeS4(user, me, orgRole, opts.s4, opts) : null;
  if (s4) opts = { ...opts, s3: true };
  const s6 = opts.s6 ? makeS6(user, me, opts.s6) : null;
  const s5 = opts.s5 || s6 ? makeS5(user, me, { ...(opts.s5 ?? {}), resultsScopes: !!s6?.flags.enabled }) : null;
  if (s5) { opts = { ...opts, s3: true }; docs.evt_pub = { ...docs.evt_pub, ...s5.doc('evt_pub'), allowedActions: ['edit', 'cancel'] }; docs.evt_1 = { ...docs.evt_1, payoutSchedule: null }; }
  // The S5 routes answer GET /events/options first, so the S6 flags ride on that same object.
  if (s6) { Object.assign(s5!.options, { results: s6.flags }); docs.evt_pub = { ...docs.evt_pub, status: s6.status }; }
  const orders: Record<string, Json> = opts.orders ?? { ord_1: ORDER_DETAIL() };
  const adminCancelled = new Set<string>();
  let version = 3;

  const defaults: Array<[string, RegExp, Handler]> = [
    ...(s6 ? s6.routes : []),
    ...(s5 ? s5.routes : []),
    ...(s4 ? s4.routes : []),
    ['GET', /^\/me\/personas$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/me\/invitations$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/admin\/shop-merch$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/admin\/tax-rates$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/events\/options$/, () => (s5 ? s5.options : s4 ? s4.options : opts.s3 ? OPTIONS_S3 : OPTIONS)],
    // ── S3: B2B organisation frame, public discovery, corporate orders, organizer/admin reads ──
    ['GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: ORG.id, legalName: ORG.legalName, tradingName: ORG.tradingName, role: orgRole, status: ORG.status }] })],
    ['GET', /^\/b2b\/organizations\/org-1$/, () => ({ organization: { ...ORG, status: opts.orgStatus ?? 'active' }, access: { role: orgRole, permissions: opts.orgPermissions ?? PERMS_BILLING } })],
    ['GET', /^\/events$/, () => (opts.s3 ? pageOf(PUBLIC_EVENTS) : { status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/events\/evt_pub$/, () => PUBLIC_DETAIL],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders\/roster\/validate$/, c => (!opts.s3 ? { status: 404, json: { error: 'feature_disabled' } } : c.body?.eventId !== 'evt_pub' ? { status: 404, json: { error: 'event_not_found' } } : String(c.body?.rawText ?? '').length > 1_000_000 ? { status: 413, json: { error: 'raw_text_too_long', max: 1_000_000 } } : validateRoster(String(c.body?.rawText ?? '')))],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders$/, c => {
      if (!opts.s3) return { status: 404, json: { error: 'feature_disabled' } };
      if (c.body?.acceptedTerms !== true) return { status: 400, json: { error: 'terms_not_accepted' } };
      const placeRows: Json[] = c.body?.rows ?? [];
      if (c.body?.expectedTotalTzs === undefined || c.body?.expectedTotalTzs === null) return { status: 400, json: { error: 'expected_total_required' } };
      // Strict like the real route: every row names its category (id or name) and ticket (id or name), ids must exist in the event,
      // and a row that is not a participant object (e.g. a validate row echoed with its ids at row level only) is refused.
      const bad = placeRows.map((r, index) => ({ index, r })).filter(({ r }) => !(r.categoryId ? ['cat_1', 'cat_2'].includes(r.categoryId) : !!r.category) || !(r.ticketTypeId ? ['tt_1', 'tt_2'].includes(r.ticketTypeId) : !!r.ticketType || !!r.category));
      if (bad.length) return { status: 422, json: { error: 'participant_invalid', participants: bad.map(({ index }) => ({ index, ok: false, problems: [{ field: 'category', code: 'category_unknown' }] })), duplicates: [] } };
      const big = placeRows.findIndex(r => String(r.firstName ?? '').length > 80 || String(r.lastName ?? '').length > 80);
      if (big >= 0) return { status: 400, json: { error: 'field_too_long', index: big, field: 'firstName', max: 80 } };
      const places = placeRows.length;
      const created = ORDER_DETAIL({ id: 'ord_new', reference: 'EV-2026-0009', placesCount: places, costCentre: c.body?.costCentre ?? null, purchaserReference: c.body?.purchaserReference ?? null, totalTzs: c.body?.expectedTotalTzs ?? 0 });
      orders.ord_new = created;
      return { status: 201, json: { order: created.order, lines: created.lines, registrations: created.registrations, holdExpiresAt: created.order.holdExpiresAt, next: { payment: 'none', instructions: null }, event: PUBLISHED, replayed: false, organizationId: 'org-1' } };
    }],
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders$/, () => (opts.s3 ? pageOf(Object.values(orders).map(o => ({ ...ORDER_ROW({ id: o.order.id, reference: o.order.reference, status: o.order.status, holdExpiresAt: o.order.holdExpiresAt, closedAt: o.order.closedAt, closeReason: o.order.closeReason, totalTzs: o.order.totalTzs, placesCount: o.registrations.length }) }))) : { status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)$/, (_c, m) => (orders[m[1]] ? orders[m[1]] : { status: 404, json: { error: 'order_not_found' } })],
    ['POST', /^\/b2b\/organizations\/org-1\/event-orders\/([^/]+)\/cancel$/, (c, m) => {
      const o = orders[m[1]]; if (!o) return { status: 404, json: { error: 'order_not_found' } };
      if (!['changed_mind', 'wrong_details', 'duplicate', 'other'].includes(String(c.body?.reason))) return { status: 400, json: { error: 'invalid_reason' } };
      if (o.order.status !== 'awaiting_payment') return { status: 409, json: { error: 'invalid_transition', kind: 'order', from: o.order.status, to: 'cancelled' } };
      orders[m[1]] = { ...o, order: { ...o.order, status: 'cancelled', closedAt: '2026-10-22T09:00:00.000Z', closeReason: 'cancelled' }, registrations: o.registrations.map((r: Json) => ({ ...r, status: 'cancelled', cancelReason: c.body?.reason })), allowedActions: [] };
      return { order: orders[m[1]].order, registrations: orders[m[1]].registrations };
    }],
    ['GET', /^\/organizer\/events\/([^/]+)\/registrations\/summary$/, (_c, m) => (m[1] === 'evt_pub' ? REG_SUMMARY : { byStatus: { reserved: 0, confirmed: 0, cancelled: 0 }, byCategory: [] })],
    ['GET', /^\/organizer\/events\/([^/]+)\/registrations$/, (c, m) => (m[1] === 'evt_other' ? { status: 404, json: { error: 'event_not_found' } } : m[1] !== 'evt_pub' ? pageOf([]) : pageOf(REG_ROWS.filter(r => (!c.query.status || r.status === c.query.status) && (!c.query.q || (r.status === 'confirmed' && r.participant.name.toLowerCase().includes(c.query.q.toLowerCase()))))))],
    ['GET', /^\/organizer\/events\/([^/]+)\/orders$/, (c, m) => (m[1] === 'evt_other' ? { status: 404, json: { error: 'event_not_found' } } : m[1] !== 'evt_pub' ? pageOf([]) : pageOf(ORG_ORDER_ROWS.filter(r => !c.query.status || r.status === c.query.status)))],
    ['GET', /^\/admin\/events\/([^/]+)\/registrations$/, (c, m) => (m[1] !== 'evt_pub' ? pageOf([]) : pageOf(REG_ROWS_ADMIN.filter(r => !c.query.status || r.status === c.query.status)))],
    ['GET', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)$/, (_c, m) => ADMIN_ORDER_DETAIL(m[2])],
    ['GET', /^\/admin\/events\/([^/]+)\/orders$/, (c, m) => (m[1] !== 'evt_pub' ? pageOf([]) : pageOf(ORG_ORDER_ROWS_ADMIN.filter(r => !adminCancelled.has(r.id) && (!c.query.status || r.status === c.query.status))))],
    ['POST', /^\/admin\/events\/([^/]+)\/orders\/([^/]+)\/cancel$/, (c, m) => {
      if (!c.body?.note || String(c.body.note).length < 5) return { status: 400, json: { error: 'note_required' } };
      const row = ORG_ORDER_ROWS_ADMIN.find(r => r.id === m[2]); if (!row) return { status: 404, json: { error: 'order_not_found' } };
      if (row.status !== 'awaiting_payment') return { status: 409, json: { error: 'invalid_transition', kind: 'order', from: row.status, to: 'cancelled' } };
      adminCancelled.add(m[2]);
      return { order: { ...ORDER_DETAIL({ id: m[2] }).order, status: 'cancelled', closeReason: 'admin' }, registrations: [] };
    }],
    ['GET', /^\/organizer\/me$/, () => {
      if (me) return isOrganizerSession() ? me : { status: 403, json: { error: 'forbidden' } };
      if (!created) return { status: 404, json: { error: 'no_organizer' } };
      return isOrganizerSession() ? created : { status: 403, json: { error: 'forbidden' } };
    }],
    ['POST', /^\/me\/organizer$/, c => {
      if (created || me) return { status: 409, json: { error: 'organizer_exists' } };
      created = organizerMe('draft', 'owner', { name: c.body?.name });
      return { status: 201, json: { organizer: created.organizer, kycCaseId: 'kyc_1', personaId: 'per_org_1' } };
    }],
    ['POST', /^\/auth\/switch-persona$/, c => {
      if (c.body?.personaId !== 'per_org_1') return { status: 404, json: { error: 'persona_not_found' } };
      currentType = 'event_organizer';
      return { token: 'events-e2e-token-2', user: { ...OWNER, displayName: user.displayName ?? OWNER.displayName }, personas: [] };
    }],
    ['GET', /^\/organizer\/summary$/, () => SUMMARY],
    ['GET', /^\/organizer\/events$/, () => pageOf(ROWS)],
    ['POST', /^\/organizer\/events$/, c => { docs.evt_new = DOC({ id: 'evt_new', slug: 'new-event', title: c.body?.title, categories: [], terms: { en: '', sw: '' }, refundPolicy: { preset: null, text: null }, contact: { email: null, phone: null, whatsapp: null }, description: { en: '', sw: '' }, version: 1 }); return { status: 201, json: { id: 'evt_new', version: 1 } }; }],
    ['GET', /^\/organizer\/events\/([^/]+)\/changes$/, () => pageOf(CHANGES)],
    ['GET', /^\/organizer\/events\/([^/]+)$/, (_c, m) => (m[1] === 'evt_other' ? { status: 403, json: { error: 'not_your_organizer' } } : docs[m[1]] ? (s5 && m[1] === 'evt_pub' ? { ...docs[m[1]], payoutSchedule: s5.state.payout.evt_pub } : docs[m[1]]) : { status: 404, json: { error: 'event_not_found' } })],
    ['PATCH', /^\/organizer\/events\/([^/]+)$/, (c, m) => {
      if (s5 && c.body && 'payoutSchedule' in c.body) {
        // S5 §3.1: only a draft takes the schedule; published and later answer 409; the value is one of the two choices.
        if (!['biweekly', 'monthly'].includes(c.body.payoutSchedule)) return { status: 422, json: { error: 'event_invalid', fields: [{ path: 'payoutSchedule', code: 'invalid' }] } };
        if (docs[m[1]]?.status !== 'draft') return { status: 409, json: { error: 'payout_schedule_locked' } };
        docs[m[1]] = { ...docs[m[1]], payoutSchedule: c.body.payoutSchedule }; s5.state.payout[m[1]] = c.body.payoutSchedule;
      }
      if (c.body?.refundPolicy && docs[m[1]]) docs[m[1]] = { ...docs[m[1]], refundPolicy: { ...c.body.refundPolicy, generated: serverPolicyLine(c.body.refundPolicy) } };
      if ('collectionPoints' in (c.body ?? {}) && typeof c.body?.kitProvided !== 'boolean') return { status: 400, json: { error: 'kit_provided_required' } }; version = Number(c.body?.version ?? version) + 1; return { version, updatedAt: '2026-10-22T10:00:00.000Z', material: !!c.body?.changeNote }; }],
    ['POST', /^\/organizer\/events\/([^/]+)\/(submit|withdraw|cancel|complete|archive)$/, (_c, m) => { if (s5 && m[2] === 'submit' && !docs[m[1]]?.payoutSchedule) return { status: 422, json: { error: 'event_invalid', fields: [{ path: 'payoutSchedule', code: 'required' }] } }; const next = { submit: 'submitted', withdraw: 'draft', cancel: 'cancelled', complete: 'completed', archive: 'archived' }[m[2]]!; if (docs[m[1]]) docs[m[1]] = { ...docs[m[1]], status: next, allowedActions: next === 'submitted' ? ['withdraw'] : [] }; return { status: next }; }],
    ['DELETE', /^\/organizer\/events\/([^/]+)$/, () => ({ status: 204 })],
    ['GET', /^\/organizer\/staff$/, () => ({ items: staff })],
    ['POST', /^\/organizer\/staff$/, c => { if (c.body?.userId || (!c.body?.email && !c.body?.phone)) return { status: 400, json: { error: 'invalid_contact' } }; const row = { id: `st_${staff.length}`, userId: null, displayName: null, maskedContact: c.body?.email ? 'n•••@example.com' : '+255 7•• ••• 999', role: c.body?.role, status: 'invited', addedAt: '2026-10-22T08:00:00.000Z' }; staff = [...staff, row]; return { status: 201, json: { invitation: row } }; }],
    ['PATCH', /^\/organizer\/staff\/([^/]+)$/, (c, m) => { staff = staff.map(s => (s.id === m[1] ? { ...s, role: c.body?.role } : s)); return staff.find(s => s.id === m[1])!; }],
    ['DELETE', /^\/organizer\/staff\/([^/]+)$/, (_c, m) => { staff = staff.filter(s => s.id !== m[1]); return { status: 204 }; }],
    ['GET', /^\/me\/kyc$/, () => (currentType === 'event_organizer' ? kyc : { status: 403, json: { error: 'forbidden' } })],
    ['PUT', /^\/me\/kyc\/business$/, c => { kyc = { ...kyc, case: { ...kyc.case, ...c.body } }; return kyc; }],
    ['PUT', /^\/me\/kyc\/people\/([^/]+)$/, (c, m) => { if (m[1] !== 'authorised_representative') return { status: 400, json: { error: 'invalid_role' } }; kyc = { ...kyc, people: [{ id: 'per_1', role: 'authorised_representative', status: 'active', ...c.body }] }; return kyc; }],
    ['POST', /^\/me\/kyc\/documents\/([^/]+)\/file$/, (_c, m) => { kyc = { ...kyc, documents: [...(kyc.documents ?? []), { id: `doc_${m[1]}`, requirementKey: m[1], docType: m[1], status: 'pending', hasFile: true, fileName: 'scan.pdf', createdAt: '2026-10-22T08:00:00.000Z' }] }; return kyc; }],
    ['POST', /^\/me\/kyc\/settlement-accounts$/, c => { kyc = { ...kyc, settlementAccounts: [{ id: 'acc_1', status: 'pending_verification', isPrimary: false, currency: 'TZS', branch: null, createdAt: '2026-10-22T08:00:00.000Z', ...c.body }] }; return kyc; }],
    ['GET', /^\/me\/kyc\/agreements$/, () => AGREEMENTS],
    ['POST', /^\/me\/kyc\/agreements$/, () => kyc],
    ['POST', /^\/me\/kyc\/submit$/, () => (kyc.checklist?.readyToSubmit ? (kyc = KYC_SUBMITTED) : { status: 409, json: { error: 'kyc_incomplete', missing: kyc.checklist?.missing ?? [] } })],
    ['POST', /^\/me\/kyc\/withdraw$/, () => (kyc = KYC_READY)],
    ['GET', /^\/admin\/events\/summary$/, () => ({ submitted: ADMIN_ROWS.filter(r => r.status === 'submitted').length })],
    ['GET', /^\/admin\/events\/audit$/, () => pageOf(AUDIT)],
    ['GET', /^\/admin\/events\/([^/]+)\/audit$/, () => pageOf(AUDIT)],
    ['GET', /^\/admin\/events\/([^/]+)$/, (_c, m) => (s5 && m[1] === 'evt_pub' ? ADMIN_DOC({ ...docs.evt_pub, payoutSchedule: s5.state.payout.evt_pub }, { permitOnFile: true }) : ADMIN_DOC(m[1] === 'evt_pub' ? PUBLISHED : m[1] === 'evt_1' ? DOC() : SUBMITTED, m[1] === 'evt_pub' ? { permitOnFile: true } : {}))],
    ['GET', /^\/admin\/events$/, c => pageOf(c.query.status ? ADMIN_ROWS.filter(r => r.status === c.query.status) : ADMIN_ROWS)],
    ['POST', /^\/admin\/events\/([^/]+)\/decision$/, c => {
      if (c.body?.decision === 'reject' && !c.body?.reason) return { status: 400, json: { error: 'reason_code_required' } };
      if (c.body?.decision === 'reject' && !c.body?.note) return { status: 400, json: { error: 'note_required' } };
      return { status: c.body?.decision === 'approve' ? 'published' : 'draft' };
    }],
    ['POST', /^\/admin\/events\/([^/]+)\/(cancel|archive)$/, (_c, m) => ({ status: m[2] === 'cancel' ? 'cancelled' : 'archived' })],
  ];

  await page_.addInitScript(([u, l]) => {
    localStorage.setItem('token', 'events-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', l as string);
  }, [user, opts.locale ?? 'en']);
  // Nothing may reach a real service (Firebase, Google, tiles).
  await page_.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
  await page_.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    let body: Json | null = null;
    if (method !== 'GET') { try { body = req.postDataJSON() as Json | null; } catch { body = null; } }
    const call: Call = { method, path: url.pathname, query, body, headers: req.headers(), bytes: method === 'GET' ? 0 : (req.postDataBuffer()?.length ?? 0) };
    calls.push(call);
    for (const [m, re, h] of [...routes].reverse().concat(defaults)) {
      if (m !== method) continue;
      const match = url.pathname.match(re);
      if (!match) continue;
      const out = h(call, match);
      if (out === undefined) continue;
      if ('status' in out && out.status === 204 && !('json' in out)) return route.fulfill({ status: 204 });
      if ('body' in out && typeof out.body === 'string') return route.fulfill({ status: out.status, body: out.body, headers: out.headers });
      if ('status' in out && 'json' in out) return route.fulfill({ status: out.status as number, json: out.json });
      return route.fulfill({ status: method === 'POST' ? 201 : 200, json: out });
    }
    unmatched.push(call);
    return route.fulfill({ json: method === 'GET' ? empty : {} });
  });

  return {
    s4: s4 ? s4.state : null,
    s5: s5 ? s5.state : null,
    s6: s6 ? s6.state : null,
    calls, unmatched,
    writes: path => calls.filter(c => c.method !== 'GET' && (!path || path.test(c.path))),
    reads: path => calls.filter(c => c.method === 'GET' && path.test(c.path)),
    on: (method, path, handler) => { routes.push([method, path, handler]); },
  };
}

/** No i18n key leaked as text (P-ON-7, P-AD-6): nothing like "events.list.title" on the page. */
export async function expectNoRawKeys(page: Page) {
  const text = await page.locator('main').innerText();
  expect(text, 'raw i18n key rendered').not.toMatch(/\b(?:events|organizer|admin|nav|common|login|kyc|corp|org|hr)\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+\b/);
}
