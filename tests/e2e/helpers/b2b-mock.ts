// A mock of the B2B API for the portal smoke specs: every route the B2B screens call is answered from
// seeded data, nothing reaches a real backend, and every write is recorded (method, path, query, JSON body)
// so a spec can assert the exact request a form sends. Anything not listed answers an empty page
// (`{ items: [], total: 0 }`) for a GET, and `{}` for a write, which is also recorded under `unmatched`.
import { expect, Page } from '@playwright/test';

export const API = process.env.FITFLEX_API_URL || 'http://localhost:3000';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Call = { method: string; path: string; query: Record<string, string>; body: Json | null };
type Reply = Json | { status: number; json: Json };
type Handler = (c: Call, m: RegExpMatchArray) => Reply | undefined;

export const ADMIN = { id: 'admin-1', userType: 'admin', email: 'admin@fitflex.test' };
export const HR = { id: 'hr-1', userType: 'corporate_hr', email: 'hr@example.test' };
export const orgUser = (roles: string[]) => ({ id: 'org-user-1', userType: 'member', email: 'finance@sponsor.test', organizationUser: true, organizationRoles: roles });

// ── Seed data ────────────────────────────────────────────────────────────────
export const REF = {
  organizationTypes: { insurer: 'Insurer', employer: 'Employer', club: 'Club', bank: 'Bank' },
  organizationStatuses: { pending: ['active', 'inactive'], active: ['suspended', 'inactive'], suspended: ['active', 'inactive'], inactive: ['active'] },
  organizationUserRoles: ['owner', 'admin', 'finance', 'hr', 'manager', 'analyst'],
  organizationUserStatuses: ['active', 'suspended', 'removed'],
  permissions: [],
  beneficiaryTypes: { member: 'Member', policyholder: 'Policyholder', employee: 'Employee' },
  beneficiaryStatuses: { pending: ['active'], active: ['suspended', 'inactive'], suspended: ['active', 'inactive'], inactive: ['active'] },
  industrySectors: { insurance: 'Insurance', banking: 'Banking' },
};
export const PROGRAM_REF = {
  programTypes: { wellness: 'Wellness', fitness: 'Fitness' },
  programStatuses: { draft: ['pending', 'cancelled'], pending: ['active', 'draft'], active: ['paused', 'cancelled'], paused: ['active', 'cancelled'], expired: [], cancelled: [] },
  benefitTypes: {
    gym_access: { label: 'Gym access', fulfilledBy: 'Partner gyms', providerKeys: ['gymIds', 'gymTiers'] },
    trainer_session: { label: 'Trainer session', fulfilledBy: 'Verified trainers', providerKeys: ['trainerIds'] },
    sponsored_pass: { label: 'Sponsored pass', fulfilledBy: 'Partner gyms', providerKeys: ['gymIds', 'gymTiers'] },
  },
  benefitStatuses: { draft: ['active'], active: ['inactive'], inactive: ['active'] },
  fundingTypes: { full: 'Sponsor pays in full', sponsor_fixed: 'Sponsor pays a fixed amount', sponsor_percentage: 'Sponsor pays a share', beneficiary_fixed: 'Member pays a fixed amount', none: 'No money involved' },
  fundingByBenefitType: { gym_access: ['full'], trainer_session: ['full'], sponsored_pass: ['sponsor_fixed', 'sponsor_percentage', 'beneficiary_fixed'] },
  usagePeriods: ['day', 'week', 'month', 'program', 'unlimited'],
  eligibilityScopes: ['all', 'groups', 'selected'],
};
export const ORG = {
  id: 'org-1', organizationType: 'insurer', legalName: 'Safari Insurance Ltd', tradingName: 'Safari Cover', industrySector: 'insurance',
  registrationNumber: 'REG-100', taxIdentificationNumber: 'TIN-200', email: 'office@safari.test', phone: '0712345678', status: 'active',
  legacyCorporateId: null, source: 'b2b', managedFields: [], kyc: { supported: false, caseId: null, status: null },
};
export const ORG_PENDING = { ...ORG, id: 'org-2', legalName: 'Kilimani Club Ltd', tradingName: null, organizationType: 'club', status: 'pending', registrationNumber: null, taxIdentificationNumber: null, email: null, phone: null };
export const ORG_COMPANY = { ...ORG, id: 'org-3', organizationType: 'employer', legalName: 'Mwenge Textiles', tradingName: null, legacyCorporateId: 'corp-1', source: 'corporate', managedFields: ['legalName'] };
export const ORG_USERS = [
  { id: 'ou-1', organizationId: 'org-1', userId: 'usr-1', role: 'admin', permissions: [], status: 'active', source: 'b2b', readOnly: false, user: { displayName: 'Neema Admin', email: 'neema@safari.test', userType: 'member' } },
];
export const BENEFICIARIES = [
  { id: 'ben-1', organizationId: 'org-1', userId: 'usr-10', displayName: 'Asha Juma', externalReference: 'POL-1', beneficiaryType: 'policyholder', groupName: 'Head office', status: 'active', enrolledAt: '2026-09-01', source: 'b2b', readOnly: false },
  { id: 'ben-2', organizationId: 'org-1', userId: null, displayName: 'Baraka Mushi', externalReference: null, beneficiaryType: 'member', groupName: 'Branch', status: 'pending', enrolledAt: null, source: 'b2b', readOnly: false },
];
export const PROGRAM = {
  id: 'prog-1', organizationId: 'org-1', name: 'Safari Wellness 2026', description: 'Gym access for policyholders', programType: 'wellness', startDate: '2026-10-01', endDate: '2026-12-31',
  eligibility: { scope: 'all', groups: [], beneficiaryIds: [], beneficiaryTypes: [], enrolledOnOrBefore: null }, budgetTzs: 5000000, discountBps: 0,
  status: 'draft', effectiveStatus: 'draft', statusReason: null,
};
export const PROGRAM_PENDING = { ...PROGRAM, id: 'prog-2', name: 'Awaiting Programme', status: 'pending', effectiveStatus: 'pending' };
export const BENEFIT = {
  id: 'bnf-1', programId: 'prog-1', name: 'Monthly gym visits', description: null, benefitType: 'gym_access', fundingType: 'full', sponsorAmountTzs: null, sponsorShareBps: null,
  sponsorCapTzs: null, beneficiaryAmountTzs: null, usageLimit: 8, usagePeriod: 'month', periodSponsorCapTzs: null, eligibility: null, providerRules: { scope: 'all' },
  startDate: null, endDate: null, terms: null, passTier: null, status: 'draft', validity: { startDate: '2026-10-01', endDate: '2026-12-31' }, fundingSummary: 'Sponsor pays in full',
};
export const AGING = { current: 100000, days1to30: 50000, days31to60: 0, days61to90: 0, over90: 0 };
export const BALANCES = { outstandingTzs: 150000, overdueTzs: 50000, seatBillsTzs: 0, creditTzs: 0, balanceTzs: 150000, unallocatedPaymentsTzs: 0, unappliedCreditNotesTzs: 0, aging: AGING, asOf: '2026-10-10' };
export const INVOICES = [
  { id: 'inv-1', number: 'INV-2026-0001', organizationId: 'org-1', programId: 'prog-1', period: '2026-09', kind: 'prepaid', status: 'issued', dueDate: '2026-10-20', amountPaidTzs: 0, outstandingTzs: 100000, overdue: false, totalTzs: 100000, vatRateBps: 1800, vatTzs: 15254, issuedAt: '2026-10-01T08:00:00Z', issuedBy: 'someone-else', paidAt: null, paymentReference: null, voidReason: null },
  { id: 'inv-2', number: 'INV-2026-0002', organizationId: 'org-1', programId: 'prog-1', period: '2026-08', kind: 'usage', status: 'issued', dueDate: '2026-09-14', amountPaidTzs: 0, outstandingTzs: 50000, overdue: true, totalTzs: 50000, vatRateBps: 1800, vatTzs: 7627, issuedAt: '2026-09-01T08:00:00Z', issuedBy: 'someone-else', paidAt: null, paymentReference: null, voidReason: null },
  { id: 'inv-3', number: 'INV-2026-0003', organizationId: 'org-1', programId: null, period: '2026-10', kind: 'fee', status: 'draft', dueDate: null, amountPaidTzs: 0, outstandingTzs: 25000, overdue: false, totalTzs: 25000, vatRateBps: null, vatTzs: null, issuedAt: null, createdBy: 'admin-1', paidAt: null, paymentReference: null, voidReason: null },
];
export const PAYMENTS = [
  { id: 'pay-1', number: 'RCT-0001', organizationId: 'org-1', amountTzs: 300000, method: 'bank_transfer', reference: 'BANK-REF-1', receivedAt: '2026-09-25T09:00:00Z', status: 'received', allocatedTzs: 250000, unallocatedTzs: 50000 },
];
export const STATEMENT = {
  ...BALANCES, organization: { id: 'org-1', name: 'Safari Cover' }, from: null, to: null, openingBalanceTzs: 0, closingBalanceTzs: 150000,
  entries: [{ at: '2026-10-01T08:00:00Z', day: '2026-10-01', type: 'invoice', reference: 'INV-2026-0001', description: 'Sponsored passes · 2026-09', status: 'issued', dueDate: '2026-10-20', invoiceId: 'inv-1', chargeTzs: 100000, creditTzs: 0, balanceTzs: 100000 }],
  totals: { chargesTzs: 100000, creditsTzs: 0 },
};
export const PAYMENT_INSTRUCTIONS = { bankName: 'CRDB Bank', accountName: 'FitFlex Africa Ltd', accountNumber: '0150123456', branch: 'Posta', swiftCode: 'CORUTZTZ', lipaNamba: '123456', lipaNambaName: 'FitFlex', notes: null };
export const NOTICE = { id: 'ntc-1', organizationId: 'org-1', organizationName: 'Safari Cover', amountTzs: 100000, method: 'bank_transfer', reference: 'SAFARI-REF-9', paidOn: '2026-10-08', invoiceIds: ['inv-1'], invoices: [{ id: 'inv-1', number: 'INV-2026-0001', totalTzs: 100000, outstandingTzs: 100000, status: 'issued', dueDate: '2026-10-20' }], note: null, proofUrl: null, status: 'submitted', submittedAt: '2026-10-08T10:00:00Z', decidedAt: null, decisionNote: null, paymentId: null };
export const COLLECTIONS = {
  today: '2026-10-10', notices: [NOTICE],
  overdue: [{ id: 'inv-2', number: 'INV-2026-0002', kind: 'usage', organizationId: 'org-1', organizationName: 'Safari Cover', dueDate: '2026-09-14', daysOverdue: 26, totalTzs: 50000, outstandingTzs: 50000, lastReminder: null, onHold: false }],
  onHold: [{ organizationId: 'org-9', organizationName: 'Held Holdings', holdReason: 'Three invoices unpaid', holdAt: '2026-10-01' }],
  totals: { noticesToCheck: 1, overdueInvoices: 1, overdueTzs: 50000, organizationsOnHold: 1 },
};
export const BILLING_DASH = {
  asOf: '2026-10-10', totals: { invoicedTzs: 175000, creditNotesTzs: 0, collectedTzs: 300000, outstandingTzs: 150000, overdueTzs: 50000, creditTzs: 50000 }, aging: AGING,
  organizations: [{ organizationId: 'org-1', name: 'Safari Cover', status: 'active', invoicedTzs: 175000, creditNotesTzs: 0, collectedTzs: 300000, outstandingTzs: 150000, overdueTzs: 50000, creditTzs: 50000, aging: AGING }],
  currentPeriod: { period: '2026-10', draftInvoices: 1, draftTotalTzs: 25000 },
  billedAgainstProviders: { period: '2026-10', billedTzs: 175000, differenceTzs: 25000, note: '', providerObligations: { gymVisitsTzs: 100000, sponsoredPassesTzs: 40000, trainerSessionsTzs: 10000, totalTzs: 150000 } },
};
export const PERIOD = { preset: 'this_month', from: '2026-10-01', to: '2026-10-31', days: 31, previous: { from: '2026-09-01', to: '2026-09-30' }, bucket: 'day', timezone: 'Africa/Dar_es_Salaam' };
export const DASHBOARD = {
  organization: { id: 'org-1', name: 'Safari Cover' }, period: PERIOD, freshness: 'live', generatedAt: '2026-10-10T08:00:00Z',
  beneficiaries: { total: 42, enrolled: 40, pending: 2, suspended: 0, inactive: 0, linkedToAccount: 38, enrolledInPeriod: 5, groups: ['Head office', 'Branch'] },
  participation: { activeBeneficiaries: 21, previousActiveBeneficiaries: 18, changePct: 17, utilisationRatePct: 52, inactiveBeneficiaries: 19 },
  usage: { uses: 60, grossTzs: 600000, sponsorTzs: 480000, beneficiaryTzs: 120000, passCheckins: 15, sponsoredVisits: 75, usesChangePct: 10, averagePerActiveBeneficiary: 3.5 },
  spend: { sponsorPerUseTzs: 480000, sponsorPassFeesTzs: 200000, sponsorTotalTzs: 680000, memberPerUseTzs: 120000, memberPassSharesTzs: 0, serviceValueTzs: 600000, passes: 4, passesStarted: 4, costPerActiveBeneficiaryTzs: 32380, costPerSponsoredVisitTzs: 9066 },
  benefits: { active: 3, usedInPeriod: 2, endingWithin30Days: 1, total: 3 },
  providers: { used: 2, top: [{ providerType: 'gym', providerId: 'gym-1', name: 'Zanzibar Iron', visits: 40, uses: 30, passCheckins: 10, sponsorTzs: 300000 }] },
  engagement: { peopleWithActivity: 30, activities: 120, workouts: 80, steps: 450000, distanceKm: 310, activeMinutes: 5400, gymCheckins: 90, peopleInChallenges: 12 },
  trend: [{ bucket: '2026-10-01', uses: 3, sponsorTzs: 24000, passCheckins: 1, activities: 5, activeBeneficiaries: 3 }, { bucket: '2026-10-02', uses: 5, sponsorTzs: 40000, passCheckins: 2, activities: 6, activeBeneficiaries: 4 }],
  billing: { invoicedTzs: 175000, invoices: 3, paidTzs: 300000, payments: 1, outstandingTzs: 150000, overdueTzs: 50000, creditTzs: 50000, aging: AGING, asOf: '2026-10-10' },
};
export const PERSON_ROWS = [
  { beneficiaryId: 'ben-1', name: 'Asha Juma', externalReference: 'POL-1', group: 'Head office', beneficiaryType: 'policyholder', status: 'active', enrolledAt: '2026-09-01', linkedToAccount: true, active: true, sponsoredUses: 4, passCheckins: 1, sponsorTzs: 32000, memberTzs: 0, serviceValueTzs: 40000, gymCheckins: 6, activities: 8, workouts: 5, steps: 30000, activeMinutes: 400, lastActiveDay: '2026-10-09' },
];
export const PERSON_DETAIL = {
  period: PERIOD,
  beneficiary: { id: 'ben-1', name: 'Asha Juma', externalReference: 'POL-1', group: 'Head office', beneficiaryType: 'policyholder', status: 'active', enrolledAt: '2026-09-01', linkedToAccount: true },
  totals: { uses: 4, grossTzs: 40000, sponsorTzs: 32000, beneficiaryTzs: 8000, passCheckins: 1, activities: 1, otherGymVisits: 1, capped: false },
  byBenefit: [], passes: [],
  sponsoredUsage: [{ id: 'use-1', day: '2026-10-05', benefitName: 'Monthly gym visits', serviceType: 'gym_access', providerType: 'gym', provider: 'Zanzibar Iron', quantity: 1, serviceValueTzs: 10000, sponsorTzs: 8000, memberTzs: 2000 }],
  passCheckins: [], otherGymVisits: [{ id: 'v-1', day: '2026-10-04', gym: 'Masaki Fitness' }],
  activities: [{ id: 'act-1', day: '2026-10-06', type: 'running', source: 'device', durationMinutes: 30, distanceKm: 5, steps: 6000, activeMinutes: 30, intensity: null, gym: null }],
  challenges: [], notShown: ['weight', 'height'],
};
export const PROGRAM_ANALYTICS = [
  { programId: 'prog-1', name: 'Safari Wellness 2026', programType: 'wellness', status: 'active', startDate: '2026-10-01', endDate: '2026-12-31', benefits: 2, activeBenefits: 2, eligible: 40, activeBeneficiaries: 21, participationPct: 52, uses: 60, passCheckins: 15, serviceValueTzs: 600000, sponsorPerUseTzs: 480000, sponsorPassFeesTzs: 200000, sponsorTotalTzs: 680000, memberTzs: 120000, budget: { budgetTzs: 5000000, committedTzs: 680000, remainingTzs: 4320000, usedPct: 14 } },
  { programId: 'prog-9', name: 'Branch Challenge', programType: 'fitness', status: 'draft', startDate: '2026-11-01', endDate: null, benefits: 0, activeBenefits: 0, eligible: 0, activeBeneficiaries: 0, participationPct: null, uses: 0, passCheckins: 0, serviceValueTzs: 0, sponsorPerUseTzs: 0, sponsorPassFeesTzs: 0, sponsorTotalTzs: 0, memberTzs: 0, budget: { budgetTzs: null, committedTzs: 0, remainingTzs: null, usedPct: null } },
];
export const ANALYTICS_OVERVIEW = {
  period: PERIOD, generatedAt: '2026-10-10T08:00:00Z',
  organizations: { total: 3, active: 2, createdInPeriod: 1, withUsage: 1, byStatus: [], byType: [] },
  beneficiaries: { total: 42, enrolled: 40, linkedToAccount: 38, active: 21, utilisationRatePct: 52 },
  usage: { uses: 60, grossTzs: 600000, sponsorTzs: 480000, beneficiaryTzs: 120000, passCheckins: 15, usesChangePct: 10 },
  billing: { invoicedTzs: 175000, collectedTzs: 300000 },
  topOrganizations: [{ organizationId: 'org-1', name: 'Safari Cover', uses: 60, grossTzs: 600000, sponsorTzs: 480000, beneficiaryTzs: 120000, passCheckins: 15, activeBeneficiaries: 21 }],
  topProviders: [{ providerType: 'gym', providerId: 'gym-1', name: 'Zanzibar Iron', uses: 40, grossTzs: 400000, sponsorTzs: 300000, beneficiaryTzs: 100000, people: 12, organizations: 1 }],
  trend: [{ bucket: '2026-10-01', uses: 3, sponsorTzs: 24000 }, { bucket: '2026-10-02', uses: 5, sponsorTzs: 40000 }],
};
export const DATA_QUALITY = { checkedAt: '2026-10-10T08:00:00Z', issues: 1, checks: [
  { key: 'unlinked', severity: 'medium', title: 'Beneficiaries not linked to an account', count: 2, examples: ['ben-2'] },
  { key: 'orphans', severity: 'low', title: 'Usage without a programme', count: 0, examples: [] },
] };

const empty = { items: [], total: 0, nextCursor: null };
const page = <T,>(items: T[]) => ({ items, total: items.length, nextCursor: null });

// ── Mock ────────────────────────────────────────────────────────────────────
export type B2BMock = {
  calls: Call[];
  unmatched: Call[];
  /** Recorded writes (anything but GET), optionally those whose path matches. */
  writes: (path?: RegExp) => Call[];
  /** Recorded GETs whose path matches. */
  reads: (path: RegExp) => Call[];
  /** Answer the next matching route differently: later calls to `on` win. */
  on: (method: string, path: RegExp, handler: Handler) => void;
};

export async function setupB2B(page_: Page, user: Json = ADMIN, extra: Array<[string, RegExp, Handler]> = []): Promise<B2BMock> {
  const calls: Call[] = [];
  const unmatched: Call[] = [];
  const routes: Array<[string, RegExp, Handler]> = [...extra];
  const org = (id: string) => [ORG, ORG_PENDING, ORG_COMPANY].find(o => o.id === id) ?? ORG;

  const defaults: Array<[string, RegExp, Handler]> = [
    // Shell background calls (identity V2 is "off")
    ['GET', /^\/me\/personas$/, () => ({ status: 404, json: { error: 'not_found' } })],
    ['GET', /^\/me\/invitations$/, () => ({ status: 404, json: { error: 'not_found' } })],
    // B2B reference
    ['GET', /^\/b2b\/reference$/, () => REF],
    ['GET', /^\/b2b\/programs\/reference$/, () => PROGRAM_REF],
    // Admin: organisations
    ['GET', /^\/admin\/b2b\/organizations$/, () => page([ORG, ORG_PENDING, ORG_COMPANY])],
    ['POST', /^\/admin\/b2b\/organizations$/, c => ({ organization: { ...ORG, id: 'org-new', status: 'pending', legalName: c.body?.legalName, organizationType: c.body?.organizationType } })],
    ['POST', /^\/admin\/b2b\/organizations\/([^/]+)\/status$/, (c, m) => ({ organization: { ...org(m[1]), status: c.body?.status } })],
    ['POST', /^\/admin\/b2b\/corporate-sync$/, () => ({ created: 2, existing: 1 })],
    ['POST', /^\/admin\/b2b\/corporate\/([^/]+)\/convert$/, () => ({ organizationId: 'org-3', program: { ...PROGRAM, name: 'Seats programme' }, benefit: BENEFIT })],
    ['GET', /^\/admin\/b2b\/programs$/, () => page([PROGRAM_PENDING])],
    // Org users, beneficiaries
    ['GET', /^\/b2b\/organizations\/([^/]+)\/users$/, () => page(ORG_USERS)],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/users$/, c => ({ organizationUser: { ...ORG_USERS[0], id: 'ou-new', userId: 'usr-new', role: c.body?.role, user: { displayName: 'New User', email: 'new@safari.test', userType: 'member' } } })],
    ['PUT', /^\/b2b\/organizations\/([^/]+)\/users\/([^/]+)$/, (c, m) => ({ organizationUser: { ...ORG_USERS[0], id: m[2], ...c.body } })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/beneficiaries$/, () => page(BENEFICIARIES)],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries$/, c => ({ beneficiary: { ...BENEFICIARIES[0], id: 'ben-new', displayName: 'New Person', beneficiaryType: c.body?.beneficiaryType ?? 'member' } })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/beneficiaries\/([^/]+)\/status$/, (c, m) => ({ beneficiary: { ...BENEFICIARIES.find(b => b.id === m[2]), status: c.body?.status } })],
    // Programmes and benefits
    ['GET', /^\/b2b\/organizations\/([^/]+)\/programs$/, () => page([PROGRAM, PROGRAM_PENDING])],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/programs$/, c => ({ program: { ...PROGRAM, id: 'prog-new', name: c.body?.name } })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)$/, (_c, m) => ({ program: m[2] === 'prog-2' ? PROGRAM_PENDING : PROGRAM, benefits: [BENEFIT] })],
    ['PUT', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)$/, c => ({ program: { ...PROGRAM, ...c.body } })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/status$/, c => ({ program: { ...PROGRAM, status: c.body?.status, effectiveStatus: c.body?.status } })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/benefits$/, c => ({ benefit: { ...BENEFIT, id: 'bnf-new', name: c.body?.name } })],
    ['PUT', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/benefits\/([^/]+)$/, c => ({ benefit: { ...BENEFIT, ...c.body } })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/benefits\/([^/]+)\/status$/, c => ({ benefit: { ...BENEFIT, status: c.body?.status } })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/programs\/([^/]+)\/eligibility$/, () => ({ ...page([]), counts: { beneficiaries: 2, wouldBeEligible: 1, eligibleToday: 1 } })],
    // Admin billing
    ['GET', /^\/admin\/b2b\/billing$/, () => BILLING_DASH],
    ['GET', /^\/admin\/b2b\/collections$/, () => COLLECTIONS],
    ['GET', /^\/admin\/b2b\/payment-instructions$/, () => ({ instructions: PAYMENT_INSTRUCTIONS, configured: true })],
    ['PUT', /^\/admin\/b2b\/payment-instructions$/, c => ({ instructions: { ...PAYMENT_INSTRUCTIONS, ...c.body }, configured: true })],
    ['POST', /^\/admin\/b2b\/payment-notices\/([^/]+)\/confirm$/, () => ({ notice: { ...NOTICE, status: 'confirmed' }, payment: { ...PAYMENTS[0], number: 'RCT-0002', unallocatedTzs: 0 } })],
    ['POST', /^\/admin\/b2b\/payment-notices\/([^/]+)\/reject$/, () => ({ notice: { ...NOTICE, status: 'rejected' } })],
    ['POST', /^\/admin\/b2b\/invoices\/([^/]+)\/remind$/, () => ({ sent: true, recipients: 2, emailedTo: null })],
    ['POST', /^\/admin\/b2b\/organizations\/([^/]+)\/billing-hold$/, c => ({ organizationId: 'org-1', onHold: !!c.body?.onHold, holdReason: c.body?.reason ?? null })],
    ['GET', /^\/admin\/b2b\/invoices$/, () => page(INVOICES)],
    ['GET', /^\/admin\/b2b\/invoices\/([^/]+)$/, (_c, m) => ({ invoice: INVOICES.find(i => i.id === m[1]) ?? INVOICES[0], lines: [{ kind: 'pass', description: 'Sponsored pass · Asha Juma', quantity: 1, amountTzs: 100000 }], settlements: [], relatedInvoice: null, notes: [] })],
    ['POST', /^\/admin\/b2b\/invoices\/([^/]+)\/issue$/, (_c, m) => ({ invoice: { ...INVOICES.find(i => i.id === m[1]), status: 'issued' } })],
    ['POST', /^\/admin\/b2b\/invoices\/([^/]+)\/void$/, (_c, m) => ({ invoice: { ...INVOICES.find(i => i.id === m[1]), status: 'void' } })],
    ['POST', /^\/admin\/b2b\/invoices\/([^/]+)\/notes$/, () => ({ note: { ...INVOICES[0], id: 'note-1', kind: 'credit_note', totalTzs: 5000 } })],
    ['GET', /^\/admin\/b2b\/invoices\/([^/]+)\/reconciliation$/, () => ({ invoice: INVOICES[0], lines: [], settlements: [], checks: { linesAddUp: true, linesTotalTzs: 100000, invoiceTotalTzs: 100000, usageMatchesLedger: true, reversedSinceInvoiced: [], amountPaidTzs: 0, outstandingTzs: 100000 } })],
    ['GET', /^\/admin\/b2b\/organizations\/([^/]+)\/statement$/, () => STATEMENT],
    ['GET', /^\/admin\/b2b\/organizations\/([^/]+)\/agreements$/, () => ({ agreements: [{ id: 'agr-1', organizationId: 'org-1', reference: 'AGR-0001', contractReference: null, status: 'draft', effectiveFrom: '2026-11-01', effectiveTo: null, billingCycle: 'monthly', currency: 'TZS', prepaidTermsDays: 0, usageTermsDays: 14, platformFeeTzs: 50000, vatRateBps: 1800, notes: null }], inForce: null })],
    ['POST', /^\/admin\/b2b\/organizations\/([^/]+)\/agreements$/, () => ({ agreement: { id: 'agr-2', reference: 'AGR-0002' } })],
    ['POST', /^\/admin\/b2b\/agreements\/([^/]+)\/activate$/, () => ({ agreement: { id: 'agr-1', status: 'active' } })],
    ['GET', /^\/admin\/b2b\/organizations\/([^/]+)\/billing-account$/, () => ({ account: { organizationId: 'org-1', contactName: 'Neema Finance', email: 'finance@safari.test', phone: '0712000111', taxIdentificationNumber: 'TIN-200', registrationNumber: null, currency: 'TZS', source: 'billing_account' } })],
    ['PUT', /^\/admin\/b2b\/organizations\/([^/]+)\/billing-account$/, c => ({ account: { organizationId: 'org-1', ...c.body } })],
    ['POST', /^\/admin\/b2b\/organizations\/([^/]+)\/invoices\/prepare-fee$/, () => ({ invoice: { ...INVOICES[2], totalTzs: 50000 }, added: 1 })],
    ['GET', /^\/admin\/b2b\/payments$/, () => ({ items: PAYMENTS, total: 1 })],
    ['POST', /^\/admin\/b2b\/organizations\/([^/]+)\/payments$/, () => ({ payment: { ...PAYMENTS[0], number: 'RCT-0003', allocatedTzs: 10000, unallocatedTzs: 0 } })],
    ['POST', /^\/admin\/b2b\/payments\/([^/]+)\/allocate$/, () => ({ payment: PAYMENTS[0] })],
    ['POST', /^\/admin\/b2b\/payments\/([^/]+)\/reverse$/, () => ({ payment: { ...PAYMENTS[0], status: 'reversed' } })],
    // Organisation's own billing
    ['GET', /^\/b2b\/me\/organizations$/, () => ({ organizations: [{ id: 'org-1', legalName: 'Safari Insurance Ltd', tradingName: 'Safari Cover', role: 'finance', status: 'active' }] })],
    ['GET', /^\/b2b\/organizations\/([^/]+)$/, (_c, m) => ({ organization: org(m[1]), access: { role: 'admin', permissions: ['beneficiaries.read', 'beneficiaries.manage', 'programs.read', 'analytics.read', 'analytics.people', 'billing.read', 'engagement.read'] } })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/billing$/, () => ({ ...BALANCES, organization: { id: 'org-1', name: 'Safari Cover' }, account: { organizationId: 'org-1', contactName: 'Neema Finance', email: 'finance@safari.test', phone: null, taxIdentificationNumber: 'TIN-200', registrationNumber: null, currency: 'TZS', source: 'billing_account' }, terms: { reference: 'AGR-0001', contractReference: null, billingCycle: 'monthly', prepaidTermsDays: 0, usageTermsDays: 14, platformFeeTzs: 50000 }, recentInvoices: INVOICES.slice(0, 2) })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/invoices$/, () => page(INVOICES.slice(0, 2))],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/invoices\/([^/]+)$/, (_c, m) => ({ invoice: INVOICES.find(i => i.id === m[2]) ?? INVOICES[0], lines: [{ kind: 'pass', description: 'Sponsored pass · Asha Juma', quantity: 1, amountTzs: 100000 }], settlements: [], relatedInvoice: null, notes: [] })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/payments$/, () => page(PAYMENTS)],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/statement$/, () => STATEMENT],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/paying$/, () => ({ instructions: PAYMENT_INSTRUCTIONS, configured: true, canPay: true, onHold: false, holdReason: null, notices: [NOTICE] })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/payment-notices$/, () => ({ notice: NOTICE })],
    ['POST', /^\/b2b\/organizations\/([^/]+)\/payment-notices\/([^/]+)\/withdraw$/, () => ({ notice: { ...NOTICE, status: 'withdrawn' } })],
    // Company staff (HR)
    ['GET', /^\/corporate\/staff$/, () => ({ employees: [
      { id: 'emp-1', displayName: 'Fatuma Hassan', email: 'fatuma@mwenge.test', phone: null, department: 'Sales', userId: 'usr-20', status: 'active' },
      { id: 'emp-2', displayName: 'Juma Kileo', email: null, phone: null, department: null, userId: null, status: 'pending' },
    ] })],
    ['POST', /^\/corporate\/staff$/, c => ({ employee: { id: 'emp-new', displayName: c.body?.displayName, status: 'pending', userId: null } })],
    ['POST', /^\/corporate\/staff\/([^/]+)\/status$/, c => ({ employee: { id: 'emp-new', status: c.body?.status } })],
    ['POST', /^\/corporate\/staff\/([^/]+)\/link$/, () => ({ employee: { id: 'emp-2', userId: 'usr-30' } })],
    // Insights
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/dashboard$/, () => DASHBOARD],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/programs$/, () => ({ period: PERIOD, items: PROGRAM_ANALYTICS })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/people$/, () => ({ period: PERIOD, items: PERSON_ROWS, total: 1, nextCursor: null })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/people\/([^/]+)$/, () => PERSON_DETAIL],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/benefits$/, () => ({ period: PERIOD, items: [] })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/providers$/, () => ({ period: PERIOD, items: [], totals: { providers: 0, visits: 0, serviceValueTzs: 0 } })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/finance$/, () => ({ period: PERIOD, billing: DASHBOARD.billing, note: 'Figures are from invoices and payments.', months: [{ month: '2026-10', invoicedTzs: 175000, creditNotesTzs: 0, collectedTzs: 300000, sponsorPerUseTzs: 480000, sponsorPassFeesTzs: 200000, memberTzs: 120000, serviceValueTzs: 600000 }] })],
    ['GET', /^\/b2b\/organizations\/([^/]+)\/analytics\/export\/([^/]+)$/, (_c, m) => ({ filename: `${m[2]}.csv`, title: 'Beneficiaries', rows: 1, csv: 'name\nAsha Juma\n' })],
    ['GET', /^\/admin\/b2b\/analytics$/, () => ANALYTICS_OVERVIEW],
    ['GET', /^\/admin\/b2b\/analytics\/data-quality$/, () => DATA_QUALITY],
  ];

  await page_.addInitScript(([u]) => {
    localStorage.setItem('token', 'b2b-e2e-token'); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('locale', 'en');
  }, [user]);

  await page_.route(`${API}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const call: Call = { method, path: url.pathname, query, body: method === 'GET' ? null : (req.postDataJSON() as Json | null) };
    calls.push(call);
    for (const [m, re, h] of [...routes].reverse().concat(defaults)) {
      if (m !== method) continue;
      const match = url.pathname.match(re);
      if (!match) continue;
      const out = h(call, match);
      if (out === undefined) continue;
      if ('status' in out && 'json' in out) return route.fulfill({ status: out.status, json: out.json });
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

/**
 * The shell scrolls inside <main> (the document itself is overflow-hidden), so the check is on both.
 * `knownMainOverflow` is the number of pixels a page is already known to overflow at the time the spec
 * was written (documented in the spec): it can't get worse, and a fix is allowed to remove it.
 */
export async function expectNoHorizontalScroll(page: Page, knownMainOverflow = 0) {
  const over = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(over.doc, 'document scrolls horizontally').toBeLessThanOrEqual(1);
  // 8px of slack for font differences between machines.
  expect(over.main, 'main scrolls horizontally').toBeLessThanOrEqual(knownMainOverflow + 8);
}
