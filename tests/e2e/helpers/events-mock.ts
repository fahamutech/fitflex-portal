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
  accessibility: null, inclusions: null,
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
export const AUDIT = [{ id: 'aud_1', at: '2026-10-21T09:00:00.000Z', actor: { id: 'admin-1', name: 'Admin One' }, action: 'submitted', target: 'evt_sub', reason: null, note: null }];

const empty = { items: [], total: 0, nextCursor: null };
export const pageOf = <T,>(items: T[]) => ({ items, total: items.length, nextCursor: null });

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
export async function setupEvents(page_: Page, user: Json = OWNER, opts: { me?: Json | null; locale?: 'en' | 'sw'; kyc?: Json; extra?: Array<[string, RegExp, Handler]> } = {}): Promise<EventsMock> {
  const calls: Call[] = [];
  const unmatched: Call[] = [];
  const routes: Array<[string, RegExp, Handler]> = [...(opts.extra ?? [])];
  const me = opts.me === undefined ? organizerMe() : opts.me;
  let kyc: Json = opts.kyc ?? KYC_DRAFT;
  let staff: Json[] = STAFF.map(s => ({ ...s }));
  const docs: Record<string, Json> = { evt_1: DOC(), evt_pub: PUBLISHED, evt_sub: SUBMITTED, evt_arch: DOC({ id: 'evt_arch', status: 'archived', allowedActions: [] }) };
  let version = 3;

  const defaults: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/me\/personas$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/me\/invitations$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/admin\/shop-merch$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/admin\/tax-rates$/, () => ({ status: 404, json: { error: 'feature_disabled' } })],
    ['GET', /^\/events\/options$/, () => OPTIONS],
    ['GET', /^\/organizer\/me$/, () => (me ? me : { status: 404, json: { error: 'no_organizer' } })],
    ['POST', /^\/me\/organizer$/, c => ({ status: 201, json: { organizer: { ...organizerMe('draft').organizer, name: c.body?.name }, kycCaseId: 'kyc_1' } })],
    ['GET', /^\/organizer\/summary$/, () => SUMMARY],
    ['GET', /^\/organizer\/events$/, () => pageOf(ROWS)],
    ['POST', /^\/organizer\/events$/, c => { docs.evt_new = DOC({ id: 'evt_new', slug: 'new-event', title: c.body?.title, categories: [], terms: { en: '', sw: '' }, refundPolicy: { preset: null, text: null }, contact: { email: null, phone: null, whatsapp: null }, description: { en: '', sw: '' }, version: 1 }); return { status: 201, json: { id: 'evt_new', version: 1 } }; }],
    ['GET', /^\/organizer\/events\/([^/]+)\/changes$/, () => pageOf(CHANGES)],
    ['GET', /^\/organizer\/events\/([^/]+)$/, (_c, m) => (m[1] === 'evt_other' ? { status: 403, json: { error: 'not_your_organizer' } } : docs[m[1]] ? docs[m[1]] : { status: 404, json: { error: 'event_not_found' } })],
    ['PATCH', /^\/organizer\/events\/([^/]+)$/, c => { version = Number(c.body?.version ?? version) + 1; return { version, updatedAt: '2026-10-22T10:00:00.000Z', material: !!c.body?.changeNote }; }],
    ['POST', /^\/organizer\/events\/([^/]+)\/(submit|withdraw|cancel|complete|archive)$/, (_c, m) => { const next = { submit: 'submitted', withdraw: 'draft', cancel: 'cancelled', complete: 'completed', archive: 'archived' }[m[2]]!; if (docs[m[1]]) docs[m[1]] = { ...docs[m[1]], status: next, allowedActions: next === 'submitted' ? ['withdraw'] : [] }; return { status: next }; }],
    ['DELETE', /^\/organizer\/events\/([^/]+)$/, () => ({ status: 204 })],
    ['GET', /^\/organizer\/staff$/, () => ({ items: staff })],
    ['POST', /^\/organizer\/staff$/, c => { const row = { id: `st_${staff.length}`, userId: null, displayName: null, maskedContact: c.body?.email ? 'n•••@example.com' : '+255 7•• ••• 999', role: c.body?.role, status: 'invited', addedAt: '2026-10-22T08:00:00.000Z' }; staff = [...staff, row]; return { status: 201, json: row }; }],
    ['PATCH', /^\/organizer\/staff\/([^/]+)$/, (c, m) => { staff = staff.map(s => (s.id === m[1] ? { ...s, role: c.body?.role } : s)); return staff.find(s => s.id === m[1])!; }],
    ['DELETE', /^\/organizer\/staff\/([^/]+)$/, (_c, m) => { staff = staff.filter(s => s.id !== m[1]); return { status: 204 }; }],
    ['GET', /^\/me\/kyc$/, () => kyc],
    ['PUT', /^\/me\/kyc\/business$/, c => { kyc = { ...kyc, case: { ...kyc.case, ...c.body } }; return kyc; }],
    ['PUT', /^\/me\/kyc\/people\/([^/]+)$/, c => { kyc = { ...kyc, people: [{ id: 'per_1', role: 'authorised_representative', status: 'active', ...c.body }] }; return kyc; }],
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
  expect(text, 'raw i18n key rendered').not.toMatch(/\b(?:events|organizer|admin|nav|common|login|kyc)\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+\b/);
}
