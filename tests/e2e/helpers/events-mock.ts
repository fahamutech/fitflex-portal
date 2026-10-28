// A mock of the events S2 API (design spec events-s2-organizer-and-discovery §14) for the portal specs: every route the
// organizer area and the admin queue call is answered from fixtures shaped like §14, nothing reaches a real backend, and
// every call is recorded so a spec can assert the exact request a form sends. Same style as b2b-mock.ts.
import { expect, Page } from '@playwright/test';

export const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Call = { method: string; path: string; query: Record<string, string>; body: Json | null };
type Reply = Json | { status: number; json: Json } | { status: 204 };
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
  terms: { en: 'T'.repeat(120), sw: 'M'.repeat(120) }, refundPolicy: { preset: 'no_refund', text: null }, cancellation: null, shareUrl: null, publishedAt: null,
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

export type EventsMock = {
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
  /** S3: the options probe says registration + corporate are on, and the S3 routes answer. */ s3?: boolean; orgPermissions?: string[]; orgStatus?: string; orders?: Record<string, Json> } = {}): Promise<EventsMock> {
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
  const orders: Record<string, Json> = opts.orders ?? { ord_1: ORDER_DETAIL() };
  const adminCancelled = new Set<string>();
  let version = 3;

  const defaults: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/me\/personas$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/me\/invitations$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/admin\/shop-merch$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/admin\/tax-rates$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/events\/options$/, () => (opts.s3 ? OPTIONS_S3 : OPTIONS)],
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
    ['GET', /^\/organizer\/events\/([^/]+)$/, (_c, m) => (m[1] === 'evt_other' ? { status: 403, json: { error: 'not_your_organizer' } } : docs[m[1]] ? docs[m[1]] : { status: 404, json: { error: 'event_not_found' } })],
    ['PATCH', /^\/organizer\/events\/([^/]+)$/, c => { if ('collectionPoints' in (c.body ?? {}) && typeof c.body?.kitProvided !== 'boolean') return { status: 400, json: { error: 'kit_provided_required' } }; version = Number(c.body?.version ?? version) + 1; return { version, updatedAt: '2026-10-22T10:00:00.000Z', material: !!c.body?.changeNote }; }],
    ['POST', /^\/organizer\/events\/([^/]+)\/(submit|withdraw|cancel|complete|archive)$/, (_c, m) => { const next = { submit: 'submitted', withdraw: 'draft', cancel: 'cancelled', complete: 'completed', archive: 'archived' }[m[2]]!; if (docs[m[1]]) docs[m[1]] = { ...docs[m[1]], status: next, allowedActions: next === 'submitted' ? ['withdraw'] : [] }; return { status: next }; }],
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
    ['GET', /^\/admin\/events\/([^/]+)$/, (_c, m) => ADMIN_DOC(m[1] === 'evt_pub' ? PUBLISHED : m[1] === 'evt_1' ? DOC() : SUBMITTED, m[1] === 'evt_pub' ? { permitOnFile: true } : {})],
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
    const call: Call = { method, path: url.pathname, query, body };
    calls.push(call);
    for (const [m, re, h] of [...routes].reverse().concat(defaults)) {
      if (m !== method) continue;
      const match = url.pathname.match(re);
      if (!match) continue;
      const out = h(call, match);
      if (out === undefined) continue;
      if ('status' in out && out.status === 204 && !('json' in out)) return route.fulfill({ status: 204 });
      if ('status' in out && 'json' in out) return route.fulfill({ status: out.status as number, json: out.json });
      return route.fulfill({ status: method === 'POST' ? 201 : 200, json: out });
    }
    unmatched.push(call);
    return route.fulfill({ json: method === 'GET' ? empty : {} });
  });

  return {
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
