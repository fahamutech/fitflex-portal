// Thin client for the bfast-functions backend.

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://fitflex-faas.bfast.smartstock.co.tz';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
}

let _onUnauthorized: (() => void) | null = null;

/** Register a callback invoked when any API call returns 401. */
export function setOnUnauthorized(cb: (() => void) | null) {
  _onUnauthorized = cb;
}

// Identity V2 (decision C3b): this build understands persons and personas.
// The backend ignores the header unless its V2 flags are on.
export const IDENTITY_V2_CLIENT = 'identity-v2';

type SessionResult = { token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] } };

// The portal never registers anyone. It asks for an admin profile first (as it
// always has), then for an existing gym owner profile, then an existing gym
// staff profile. Only "no such profile" moves on to the next role; any other
// refusal (suspended, email not verified, …) is final.
const PORTAL_SIGN_IN_ROLES = [
  { requestedRole: 'admin' },
  { requestedRole: 'gym_operator', existingOnly: true },
  { requestedRole: 'gym_staff', existingOnly: true },
];
const NO_SUCH_PROFILE = new Set(['admin_self_registration_not_allowed', 'profile_not_found']);

/** A persona (User row) of the signed-in Person, as the backend returns it. */
export interface PersonaSummary {
  id: string;
  userType: string;
  displayName?: string | null;
  approvalStatus?: string;
  accountStatus?: string;
  onboardingCompleted?: boolean;
  portalOnly?: boolean;
}

export type InviteRole = 'member' | 'staff' | 'trainer';

/** An invitation as the organisation that sent it sees it (Identity V2 · I6). */
export interface GymInvitation {
  id: string;
  role: InviteRole;
  status: 'pending' | 'claimed' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  identifierType: 'phone' | 'email';
  identifierValue?: string;
  expiresAt: string;
  createdAt: string;
  plan?: { tier: string; durationUnit: 'D' | 'W' | 'M'; startDate: string; endDate: string };
  paidAmountTzs?: number | null;
  /** A paid invitation that expired unaccepted: re-issue it or record the refund. */
  needsResolution?: boolean;
}

export interface GymInvitationInput {
  role: InviteRole;
  phone?: string;
  email?: string;
  aclPermissions?: string[];
  durationUnit?: 'D' | 'W' | 'M';
  startDate?: string;
  endDate?: string;
  tier?: string;
  paidAmount?: number;
}

async function request<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-fitflex-client': IDENTITY_V2_CLIENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && _onUnauthorized) {
      _onUnauthorized();
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}

/** "?a=1&b=2" from the set values of `params`, or "". */
function qs(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** A PIN is always exactly four digits. */
export const isPin = (pin: string) => /^[0-9]{4}$/.test(pin);

/** The sign-in password the app derives from a PIN; the portal must send the same. */
export const passwordForPin = (pin: string) => `fitflex-pin:${pin}`;

export const api = {
  firebaseSession: (idToken: string, requestedRole: 'member' | 'trainer' | 'gym_owner' | 'gym_operator' | 'admin' = 'gym_operator') =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] } }>(
      '/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, requestedRole }) }
    ),
  portalSession: async (idToken: string): Promise<SessionResult> => {
    let refused: unknown;
    for (const role of PORTAL_SIGN_IN_ROLES) {
      try {
        return await request<SessionResult>('/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, ...role }) });
      } catch (err) {
        const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
        if (!code || !NO_SUCH_PROFILE.has(code)) throw err;
        refused = err;
      }
    }
    throw refused;
  },
  // ─── Identity V2 personas (404 while the backend flags are off) ───
  myPersonas: (token: string) =>
    request<{ personas: PersonaSummary[]; activePersonaId: string }>('/me/personas', {}, token),
  // Identity V2 · I6: invitations. Every route is 404 while the backend flag is off.
  myInvitations: (token: string) => request<{ invitations: unknown[] }>('/me/invitations', {}, token),
  gymLookupPerson: (token: string, gymId: string, contact: { phone?: string; email?: string }) =>
    request<{ found: boolean; maskedName: string | null }>(`/orgs/gym/${encodeURIComponent(gymId)}/people/lookup`, { method: 'POST', body: JSON.stringify(contact) }, token),
  /** `token` (the link) is returned once, and only for a newly created invitation. */
  gymCreateInvitation: (token: string, gymId: string, body: GymInvitationInput) =>
    request<{ created: boolean; invitation: GymInvitation; token?: string }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations`, { method: 'POST', body: JSON.stringify(body) }, token),
  gymInvitations: (token: string, gymId: string) =>
    request<{ invitations: GymInvitation[] }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations`, {}, token),
  gymInvitationAction: (token: string, gymId: string, invitationId: string, action: 'cancel' | 'resend' | 'reissue' | 'refunded') =>
    request<{ invitation: GymInvitation; token?: string }>(`/orgs/gym/${encodeURIComponent(gymId)}/invitations/${encodeURIComponent(invitationId)}/${action}`, { method: 'POST', body: '{}' }, token),
  switchPersona: (token: string, personaId: string) =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] }; personas: PersonaSummary[] }>(
      '/auth/switch-persona', { method: 'POST', body: JSON.stringify({ personaId }) }, token
    ),
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; portalUser?: boolean; aclPermissions?: string[] } }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, requestedRole: 'admin' }) }
    ),
  // ─── Portal user management (admin only) ───
  listPortalUsers: (token: string) => request<PortalUser[]>('/admin/portal-users', {}, token),
  createPortalUser: (token: string, data: { email: string; password: string; displayName?: string; aclPermissions: string[] }) =>
    request<PortalUser>('/admin/portal-users', { method: 'POST', body: JSON.stringify(data) }, token),
  updatePortalUser: (token: string, id: string, data: { aclPermissions?: string[]; accountStatus?: string; displayName?: string; portalUser?: boolean }) =>
    request<PortalUser>(`/admin/portal-users/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  deletePortalUser: (token: string, id: string) =>
    request<{ ok: boolean }>(`/admin/portal-users/${id}`, { method: 'DELETE' }, token),
  dashboard: (token: string, filters?: { gymId?: string; periodStart?: string; periodEnd?: string; memberType?: 'all' | 'direct' | 'fitflex' }) => {
    const q = new URLSearchParams();
    if (filters?.gymId) q.set('gymId', filters.gymId);
    if (filters?.periodStart) q.set('periodStart', filters.periodStart);
    if (filters?.periodEnd) q.set('periodEnd', filters.periodEnd);
    if (filters?.memberType) q.set('memberType', filters.memberType);
    const s = q.toString();
    return request<DashboardResponse>(`/operator/dashboard${s ? '?' + s : ''}`, {}, token);
  },
  recentCheckIns: (token: string) => request<CheckIn[]>('/operator/checkins', {}, token),
  checkIn: (token: string, qrToken: string) =>
    request<CheckInResult>('/operator/checkins', { method: 'POST', body: JSON.stringify({ qrToken }) }, token),
  /** Slimmed list — no `images`/`thumbnails` arrays, only a single `thumbnail` field. */
  adminGyms: (token: string) => request<Gym[]>('/admin/gyms', {}, token),
  // ── Communications: a gym's messages to its direct members (scope 'owner')
  // and FitFlex-wide messages (scope 'admin'). Same shapes for both. ──
  commsOverview: (token: string, scope: CommsScope, gymId?: string) =>
    request<CommsOverview>(`/${scope}/communications/overview${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  /** FitFlex (admin) can ask for the trainer audiences with recipients 'trainers'. */
  commsSegments: (token: string, scope: CommsScope, recipients: CommsRecipients = 'members') =>
    request<CommsCatalog>(`/${scope}/communications/segments${recipients === 'trainers' ? '?recipients=trainers' : ''}`, {}, token),
  commsAudiencePreview: (token: string, scope: CommsScope, body: { gymId?: string; recipients?: CommsRecipients; preset?: string | null; filter?: unknown; purpose?: string }) =>
    request<CommsAudiencePreview>(`/${scope}/communications/audience/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** Campaign history. Filters: gymId, status, purpose, channel, from, to, search; cursor paging. */
  commsCampaigns: (token: string, scope: CommsScope, opts: Record<string, string | undefined> = {}) =>
    request<{ campaigns: CommsCampaign[]; nextCursor: string | null }>(`/${scope}/communications/campaigns${qs(opts)}`, {}, token),
  commsCampaign: (token: string, scope: CommsScope, id: string) =>
    request<{ campaign: CommsCampaign; progress: Record<string, Record<string, number>>; stats: CommsStats | null }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, {}, token),
  // History (M8): the message log, one message, a campaign's recipients, a member's timeline, counts.
  commsMessages: (token: string, scope: CommsScope, filters: CommsHistoryFilters = {}) =>
    request<{ messages: CommsMessage[]; nextCursor: string | null }>(`/${scope}/communications/messages${qs(filters)}`, {}, token),
  commsMessage: (token: string, scope: CommsScope, id: string) =>
    request<{ message: CommsMessage }>(`/${scope}/communications/messages/${encodeURIComponent(id)}`, {}, token),
  commsRecipients: (token: string, scope: CommsScope, campaignId: string, filters: CommsHistoryFilters = {}) =>
    request<{ recipients: CommsRecipient[]; nextCursor: string | null }>(`/${scope}/communications/campaigns/${encodeURIComponent(campaignId)}/recipients${qs(filters)}`, {}, token),
  commsMemberHistory: (token: string, scope: CommsScope, memberId: string, filters: CommsHistoryFilters = {}) =>
    request<{ memberId: string; items: CommsTimelineItem[]; nextCursor: string | null }>(`/${scope}/members/${encodeURIComponent(memberId)}/communications${qs(filters)}`, {}, token),
  commsSummary: (token: string, scope: CommsScope, filters: CommsHistoryFilters = {}) =>
    request<CommsStats & { byDay: Array<{ day: string; messages: number }> }>(`/${scope}/communications/summary${qs(filters)}`, {}, token),
  commsPreviewDraft: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<CommsPreview>(`/${scope}/communications/campaigns/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsCreate: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsUpdate: (token: string, scope: CommsScope, id: string, body: Partial<CommsDraft>) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsDelete: (token: string, scope: CommsScope, id: string) =>
    request<{ ok: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),
  /** Any campaign copied into a new draft (same audience, message and channels). */
  commsDuplicate: (token: string, scope: CommsScope, id: string) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }, token),
  commsAction: (token: string, scope: CommsScope, id: string, action: 'cancel' | 'unschedule') =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, token),
  commsSchedule: (token: string, scope: CommsScope, id: string, scheduledAt: string, confirmLargeSend = false) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/schedule`, {
      method: 'POST', body: JSON.stringify({ scheduledAt, ...(confirmLargeSend ? { confirmLargeSend: true } : {}) }),
    }, token),
  commsSend: (token: string, scope: CommsScope, id: string, sendRequestId: string, confirmLargeSend = false) =>
    request<{ campaign: CommsCampaign; replayed?: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/send`, {
      method: 'POST', body: JSON.stringify({ sendRequestId, ...(confirmLargeSend ? { confirmLargeSend: true } : {}) }),
    }, token),
  // Templates: FitFlex's (read-only) and, for gyms, their own.
  commsTemplates: (token: string, scope: CommsScope, opts: { gymId?: string; group?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.gymId) q.set('gymId', opts.gymId);
    if (opts.group) q.set('group', opts.group);
    const qs = q.toString();
    return request<{ templates: CommsTemplate[] }>(`/${scope}/communications/templates${qs ? `?${qs}` : ''}`, {}, token);
  },
  commsTemplate: (token: string, scope: CommsScope, id: string) =>
    request<{ template: CommsTemplate }>(`/${scope}/communications/templates/${encodeURIComponent(id)}`, {}, token),
  commsTemplatePreview: (token: string, scope: CommsScope, id: string, body: { gymId?: string; values?: CommsTemplateValues } = {}) =>
    request<CommsTemplatePreview>(`/${scope}/communications/templates/${encodeURIComponent(id)}/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplatePreviewNew: (token: string, scope: CommsScope, body: CommsTemplateDraft & { values?: CommsTemplateValues }) =>
    request<CommsTemplatePreview>(`/${scope}/communications/templates/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplateCreate: (token: string, body: CommsTemplateDraft) =>
    request<{ template: CommsTemplate }>('/owner/communications/templates', { method: 'POST', body: JSON.stringify(body) }, token),
  commsTemplateUpdate: (token: string, id: string, body: Partial<CommsTemplateDraft>) =>
    request<{ template: CommsTemplate }>(`/owner/communications/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsTemplateDuplicate: (token: string, id: string, opts: { gymId?: string; name?: string } = {}) =>
    request<{ template: CommsTemplate }>(`/owner/communications/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify(opts) }, token),
  // WhatsApp (FitFlex admins): provider status, kill switch, approved-template registry, test send.
  waStatus: (token: string) => request<WhatsAppStatus>('/admin/communications/whatsapp', {}, token),
  waSetEnabled: (token: string, enabled: boolean) =>
    request<WhatsAppStatus>('/admin/communications/whatsapp', { method: 'PUT', body: JSON.stringify({ enabled }) }, token),
  waRegistry: (token: string) => request<WhatsAppRegistry>('/admin/communications/whatsapp/templates', {}, token),
  waRegister: (token: string, body: { providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory; variables: string[]; approvalStatus?: WhatsAppApproval }) =>
    request<{ template: WhatsAppRegistryRow }>('/admin/communications/whatsapp/templates', { method: 'POST', body: JSON.stringify(body) }, token),
  waUpdate: (token: string, id: string, body: { approvalStatus?: WhatsAppApproval; variables?: string[]; category?: WhatsAppCategory }) =>
    request<{ template: WhatsAppRegistryRow }>(`/admin/communications/whatsapp/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  waSync: (token: string) =>
    request<WhatsAppRegistry & { synced: number }>('/admin/communications/whatsapp/templates/sync', { method: 'POST' }, token),
  waTest: (token: string, body: { phone: string; templateName: string; language: CommsLocale; parameters: string[] }) =>
    request<{ ok: boolean; providerMessageId: string }>('/admin/communications/whatsapp/test', { method: 'POST', body: JSON.stringify(body) }, token),
  // Analytics: delivery, engagement and attributed revenue.
  commsAnalytics: (token: string, scope: CommsScope, opts: { days?: number; gymId?: string } = {}) =>
    request<CommsResults>(`/${scope}/communications/analytics${qs(opts)}`, {}, token),
  commsCampaignAnalytics: (token: string, scope: CommsScope, id: string) =>
    request<CommsResults>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/analytics`, {}, token),
  commsAutomationAnalytics: (token: string, id: string, days = 30) =>
    request<CommsResults>(`/owner/communications/automations/${encodeURIComponent(id)}/analytics${qs({ days })}`, {}, token),
  // Automations (gym owners): lifecycle messages that send themselves.
  commsAutomations: (token: string, gymId?: string) =>
    request<{ automations: CommsAutomation[] }>(`/owner/communications/automations${qs({ gymId })}`, {}, token),
  commsAutomationUpdate: (token: string, id: string, body: { status?: 'enabled' | 'disabled'; channels?: CommsChannel[]; templateId?: string }) =>
    request<{ automation: CommsAutomation }>(`/owner/communications/automations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsAutomationRuns: (token: string, id: string) =>
    request<{ runs: CommsAutomationRun[] }>(`/owner/communications/automations/${encodeURIComponent(id)}/runs`, {}, token),
  commsAutomationPreview: (token: string, id: string) =>
    request<CommsTemplatePreview>(`/owner/communications/automations/${encodeURIComponent(id)}/preview`, { method: 'POST' }, token),
  commsTemplateArchive: (token: string, id: string) =>
    request<{ ok: boolean }>(`/owner/communications/templates/${encodeURIComponent(id)}/archive`, { method: 'POST' }, token),

  // ── Challenges: FitFlex admin (scope 'admin') and company HR ('corporate') ──
  creatorChallenges: (token: string, scope: ChallengeScope) =>
    request<{ challenges: ManagedChallenge[] }>(`/${scope}/challenges`, {}, token),
  createChallenge: (token: string, scope: ChallengeScope, body: ChallengeInput) =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateChallenge: (token: string, scope: ChallengeScope, id: string, body: Partial<ChallengeInput>) =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  challengeAction: (token: string, scope: ChallengeScope, id: string, action: 'cancel' | 'close' | 'archive') =>
    request<{ challenge: ManagedChallenge }>(`/${scope}/challenges/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, token),
  challengeParticipation: (token: string, scope: ChallengeScope, id: string) =>
    request<ChallengeParticipation>(`/${scope}/challenges/${encodeURIComponent(id)}/participants`, {}, token),
  challengeStandings: (token: string, scope: ChallengeScope, id: string) =>
    request<ChallengeStandings>(`/${scope}/challenges/${encodeURIComponent(id)}/leaderboard`, {}, token),
  // ─── Gym settlements (admin; reads need 'payments', each step its own scope) ───
  settlementRuns: (token: string, mode?: SettlementMode) =>
    request<SettlementRun[]>(`/admin/settlements/runs${qs({ mode })}`, {}, token),
  settlementRun: (token: string, id: string) =>
    request<{ run: SettlementRun; statements: GymSettlement[] }>(`/admin/settlements/runs/${encodeURIComponent(id)}`, {}, token),
  runSettlement: (token: string, body: { month: string; mode: SettlementMode }) =>
    request<{ run: SettlementRun; alreadyRun?: boolean }>('/admin/settlements/runs', { method: 'POST', body: JSON.stringify(body) }, token),
  settlementStatements: (token: string, filters: { mode?: SettlementMode; status?: GymSettlementStatus; gymId?: string } = {}) =>
    request<GymSettlement[]>(`/admin/settlements/statements${qs(filters)}`, {}, token),
  settlementStatement: (token: string, id: string) =>
    request<GymSettlementDetail>(`/admin/settlements/statements/${encodeURIComponent(id)}`, {}, token),
  settlementStep: (token: string, id: string, step: SettlementStep, body: { reason?: string; paymentReference?: string; receiptUrl?: string } = {}) =>
    request<unknown>(`/admin/settlements/statements/${encodeURIComponent(id)}/${step}`, { method: 'POST', body: JSON.stringify(body) }, token),
  proposeSettlementAdjustment: (token: string, id: string, body: { amountTzs: number; type: 'correction' | 'clawback' | 'manual'; reason: string }) =>
    request<{ adjustment: SettlementAdjustment }>(`/admin/settlements/statements/${encodeURIComponent(id)}/adjustments`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** Differences from voided check-ins: waiting for a draft statement, about to be raised, or needing a person. Nothing is changed. */
  settlementClawbacks: (token: string) => request<SettlementClawbacks>('/admin/settlements/clawbacks', {}, token),
  decideSettlementAdjustment: (token: string, id: string, decision: 'apply' | 'reject', reason?: string) =>
    request<unknown>(`/admin/settlements/adjustments/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  // ─── Settlement configuration (admin, 'payments' scope) ───
  settlementConfig: (token: string) => request<SettlementConfig>('/admin/settlement-config', {}, token),
  draftPassTierVersion: (token: string, body: { tierKey: string; priceTzs: number; visitAllowance: number; reason?: string }) =>
    request<unknown>('/admin/settlement-config/pass-tiers', { method: 'POST', body: JSON.stringify(body) }, token),
  draftSettlementRule: (token: string, body: Partial<SettlementRuleValues> & { scopeType: SettlementRuleScope; scopeId?: string | null; name?: string; reason?: string }) =>
    request<unknown>('/admin/settlement-config/rules', { method: 'POST', body: JSON.stringify(body) }, token),
  draftGymRateCard: (token: string, body: { gymId: string; retailDailyTzs: number; retailWeeklyTzs: number; retailMonthlyTzs: number; reason?: string }) =>
    request<unknown>('/admin/settlement-config/rate-cards', { method: 'POST', body: JSON.stringify(body) }, token),
  draftMissingRateCards: (token: string) =>
    request<{ drafted: GymRateCard[]; skipped: Array<{ gymId: string; reason: string }> }>('/admin/settlement-config/rate-cards/draft-missing', { method: 'POST' }, token),
  activateSettlementConfig: (token: string, kind: SettlementConfigKind, id: string, effectiveFrom: string) =>
    request<unknown>(`/admin/settlement-config/${kind}/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify({ effectiveFrom }) }, token),
  rejectSettlementConfig: (token: string, kind: SettlementConfigKind, id: string, reason: string) =>
    request<unknown>(`/admin/settlement-config/${kind}/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  // ─── Gym settlements (owner / gym staff with 'payments') ───
  ownerSettlements: (token: string, gymId?: string) =>
    request<OwnerStatement[]>(`/owner/settlements${qs({ gymId })}`, {}, token),
  ownerSettlement: (token: string, id: string) =>
    request<OwnerStatementDetail>(`/owner/settlements/${encodeURIComponent(id)}`, {}, token),

  // ─── Partner KYC / KYB review (admin, 'kyc' scope) ───
  kycCases: (token: string, filters: { status?: KycCaseStatus; partnerType?: KycPartnerType } = {}) => {
    const q = new URLSearchParams();
    if (filters.status) q.set('status', filters.status);
    if (filters.partnerType) q.set('partnerType', filters.partnerType);
    const s = q.toString();
    return request<KycCaseRow[]>(`/admin/kyc/cases${s ? '?' + s : ''}`, {}, token);
  },
  kycCase: (token: string, id: string) => request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}`, {}, token),
  claimKycCase: (token: string, id: string) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/claim`, { method: 'POST' }, token),
  decideKycCase: (token: string, id: string, body: { decision: KycDecision; reasonCode?: string; reasonNote?: string; override?: boolean }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),
  reviewKycDocument: (token: string, id: string, documentId: string, body: { decision: 'accept' | 'reject'; note?: string }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/review`, { method: 'POST', body: JSON.stringify(body) }, token),
  reviewKycSettlementAccount: (token: string, id: string, accountId: string, body: { decision: 'verify' | 'reject'; note?: string }) =>
    request<KycCaseDetail>(`/admin/kyc/cases/${encodeURIComponent(id)}/settlement-accounts/${encodeURIComponent(accountId)}/review`, { method: 'POST', body: JSON.stringify(body) }, token),
  recordKycSiteVisit: (token: string, gymId: string, body: { result: 'passed' | 'failed'; score: number; maxScore?: number; tier: string; visitedOn?: string; notes?: string }) =>
    request<{ check: KycCheck; gymTier: string | null; tierMatches: boolean }>(`/admin/kyc/gyms/${encodeURIComponent(gymId)}/site-visit`, { method: 'POST', body: JSON.stringify(body) }, token),
  /** A KYC document's file, fetched with the session token (it has no public URL). */
  kycDocumentFile: async (token: string, id: string, documentId: string): Promise<Blob> => {
    const res = await fetch(`${BASE}/admin/kyc/cases/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/file`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401 && _onUnauthorized) _onUnauthorized();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  },
  /** Earned rewards to hand out: FitFlex admin ('admin') or company HR ('corporate'). */
  rewardQueue: (token: string, scope: ChallengeScope, filters: { status?: RewardStatus; challengeId?: string } = {}) => {
    const q = new URLSearchParams();
    if (filters.status) q.set('status', filters.status);
    if (filters.challengeId) q.set('challengeId', filters.challengeId);
    const s = q.toString();
    return request<RewardQueue>(`/${scope}/rewards${s ? '?' + s : ''}`, {}, token);
  },
  setRewardStatus: (token: string, scope: ChallengeScope, id: string, body: { status: RewardStatus; reference?: string; note?: string }) =>
    request<{ reward: RewardAward }>(`/${scope}/rewards/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify(body) }, token),
  // ── Groups (company HR) and moderation (admin) ──
  corporateGroups: (token: string) => request<{ groups: SocialGroup[] }>('/corporate/groups', {}, token),
  createCorporateGroup: (token: string, body: GroupInput) =>
    request<{ group: SocialGroup }>('/corporate/groups', { method: 'POST', body: JSON.stringify(body) }, token),
  corporateGroup: (token: string, id: string) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`/corporate/groups/${encodeURIComponent(id)}`, {}, token),
  updateCorporateGroup: (token: string, id: string, body: Partial<GroupInput>) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`/corporate/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  archiveCorporateGroup: (token: string, id: string) =>
    request<{ archived: boolean }>(`/corporate/groups/${encodeURIComponent(id)}/archive`, { method: 'POST' }, token),
  corporateGroupMember: (token: string, id: string, userId: string, action: GroupMemberAction) =>
    request<{ group: SocialGroup; members: GroupMember[] }>(`/corporate/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/${action}`, { method: 'POST' }, token),
  socialReports: (token: string, status: SocialReportStatus) =>
    request<{ reports: SocialReport[] }>(`/admin/social/reports?${new URLSearchParams({ status })}`, {}, token),
  resolveSocialReport: (token: string, id: string, action: 'remove' | 'dismiss') =>
    request<{ resolved: boolean }>(`/admin/social/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ action }) }, token),
  // ─── Gym and trainer reviews ───
  /** Admin: every review of one kind, newest first (max 200), optionally one status. */
  adminReviews: (token: string, kind: ReviewKind, status?: ReviewStatus) =>
    request<AdminReview[]>(`/admin/${kind}-reviews${qs({ status })}`, {}, token),
  moderateReview: (token: string, kind: ReviewKind, id: string, action: ReviewAction) =>
    request<{ ok: boolean; reviewId: string; status: ReviewStatus }>(
      `/admin/${kind}-reviews/${encodeURIComponent(id)}/moderate`, { method: 'POST', body: JSON.stringify({ action }) }, token),
  /** Owner / gym staff: published reviews for one of their gyms. */
  ownerGymReviews: (token: string, gymId: string) =>
    request<{ gymId: string; summary: ReviewSummary; reviews: PublicReview[] }>(`/operator/gym-reviews${qs({ gymId })}`, {}, token),
  /** HR: the company's staff (for eligibility by department or person). */
  corporateStaff: (token: string) =>
    request<{ employees: CorporateEmployee[] }>('/corporate/staff', {}, token),
  /** HR sign-in: email + password (not Firebase). */
  hrLogin: (email: string, password: string) =>
    request<{ token: string; user: { id: string; userType: string; email?: string; displayName?: string; corporateId?: string } }>(
      '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, requestedRole: 'corporate_hr' }) }
    ),
  // ── Companies and their HR logins (admin) ──
  corporateAccounts: (token: string) =>
    request<CorporateAccount[]>('/admin/corporate', {}, token),
  hrUsers: (token: string, corporateId: string) =>
    request<{ hrUsers: HrUser[] }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users`, {}, token),
  createHrUser: (token: string, corporateId: string, body: { displayName: string; email: string; password: string }) =>
    request<{ hrUser: HrUser }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users`, { method: 'POST', body: JSON.stringify(body) }, token),
  setHrUserStatus: (token: string, corporateId: string, userId: string, status: 'active' | 'suspended') =>
    request<{ hrUser: HrUser }>(`/admin/corporate/${encodeURIComponent(corporateId)}/hr-users/${encodeURIComponent(userId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B organisations (admin, 'b2b' scope) ──
  b2bReference: () => request<B2BReference>('/b2b/reference'),
  b2bOrganizations: (token: string, params: { type?: string; status?: string; search?: string; limit?: number; cursor?: number | null } = {}) =>
    request<Paged<B2BOrganization>>(`/admin/b2b/organizations${qs(params)}`, {}, token),
  createB2BOrganization: (token: string, body: Partial<B2BOrganization>) =>
    request<{ organization: B2BOrganization }>('/admin/b2b/organizations', { method: 'POST', body: JSON.stringify(body) }, token),
  b2bOrganization: (token: string, id: string) =>
    request<{ organization: B2BOrganization; access: { role: string; permissions: string[] } }>(`/b2b/organizations/${encodeURIComponent(id)}`, {}, token),
  updateB2BOrganization: (token: string, id: string, body: Partial<B2BOrganization>) =>
    request<{ organization: B2BOrganization }>(`/b2b/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BOrganizationStatus: (token: string, id: string, status: string, reason?: string) =>
    request<{ organization: B2BOrganization }>(`/admin/b2b/organizations/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }, token),
  syncCorporateOrganizations: (token: string) =>
    request<{ created: number; existing: number }>('/admin/b2b/corporate-sync', { method: 'POST' }, token),
  b2bOrganizationUsers: (token: string, id: string, params: { status?: string; limit?: number } = {}) =>
    request<Paged<B2BOrganizationUser>>(`/b2b/organizations/${encodeURIComponent(id)}/users${qs(params)}`, {}, token),
  addB2BOrganizationUser: (token: string, id: string, body: { userId: string; role: string; permissions?: string[] }) =>
    request<{ organizationUser: B2BOrganizationUser }>(`/b2b/organizations/${encodeURIComponent(id)}/users`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BOrganizationUser: (token: string, id: string, orgUserId: string, body: { role?: string; status?: string; permissions?: string[] }) =>
    request<{ organizationUser: B2BOrganizationUser }>(`/b2b/organizations/${encodeURIComponent(id)}/users/${encodeURIComponent(orgUserId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  b2bBeneficiaries: (token: string, id: string, params: { status?: string; search?: string; limit?: number } = {}) =>
    request<Paged<B2BBeneficiary>>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries${qs(params)}`, {}, token),
  enrollB2BBeneficiary: (token: string, id: string, body: { userId: string; beneficiaryType?: string; externalReference?: string; groupName?: string; status?: string }) =>
    request<{ beneficiary: B2BBeneficiary }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries`, { method: 'POST', body: JSON.stringify(body) }, token),
  setB2BBeneficiaryStatus: (token: string, id: string, beneficiaryId: string, status: string) =>
    request<{ beneficiary: B2BBeneficiary }>(`/b2b/organizations/${encodeURIComponent(id)}/beneficiaries/${encodeURIComponent(beneficiaryId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B wellness programmes and benefits ──
  b2bProgramReference: () => request<B2BProgramReference>('/b2b/programs/reference'),
  adminB2BPrograms: (token: string, params: { status?: string; organizationId?: string; limit?: number } = {}) =>
    request<Paged<B2BProgram>>(`/admin/b2b/programs${qs(params)}`, {}, token),
  b2bPrograms: (token: string, orgId: string) =>
    request<Paged<B2BProgram>>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs?limit=100`, {}, token),
  b2bProgram: (token: string, orgId: string, programId: string) =>
    request<{ program: B2BProgram; benefits: B2BBenefit[] }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}`, {}, token),
  createB2BProgram: (token: string, orgId: string, body: B2BProgramInput) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BProgram: (token: string, orgId: string, programId: string, body: Partial<B2BProgramInput>) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BProgramStatus: (token: string, orgId: string, programId: string, status: string, reason?: string) =>
    request<{ program: B2BProgram }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }, token),
  b2bProgramEligibility: (token: string, orgId: string, programId: string, params: { benefitId?: string; include?: 'all'; limit?: number } = {}) =>
    request<Paged<B2BEligibilityRow> & { counts: { beneficiaries: number; wouldBeEligible: number; eligibleToday: number } }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/eligibility${qs(params)}`, {}, token),
  createB2BBenefit: (token: string, orgId: string, programId: string, body: B2BBenefitInput) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits`, { method: 'POST', body: JSON.stringify(body) }, token),
  updateB2BBenefit: (token: string, orgId: string, programId: string, benefitId: string, body: Partial<B2BBenefitInput>) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits/${encodeURIComponent(benefitId)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  setB2BBenefitStatus: (token: string, orgId: string, programId: string, benefitId: string, status: string) =>
    request<{ benefit: B2BBenefit }>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/benefits/${encodeURIComponent(benefitId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  // ── B2B benefit usage (consumption ledger) ──
  b2bProgramUsage: (token: string, orgId: string, programId: string, params: { from?: string; to?: string } = {}) =>
    request<B2BProgramUsage>(`/b2b/organizations/${encodeURIComponent(orgId)}/programs/${encodeURIComponent(programId)}/usage${qs(params)}`, {}, token),
  adminB2BConsumptions: (token: string, params: B2BConsumptionFilters = {}) =>
    request<Paged<B2BConsumption> & { totals: B2BUsageMoney }>(`/admin/b2b/consumptions${qs(params)}`, {}, token),
  adminB2BConsumption: (token: string, id: string) =>
    request<{ consumption: B2BConsumption; sourceEvent: Record<string, unknown> | null; settlementCandidate: Record<string, unknown> }>(`/admin/b2b/consumptions/${encodeURIComponent(id)}`, {}, token),
  reverseB2BConsumption: (token: string, id: string, reason: string) =>
    request<{ consumption: B2BConsumption }>(`/admin/b2b/consumptions/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  // ── B2B sponsor billing (FitFlex admin) ──
  prepareB2BInvoice: (token: string, programId: string, kind: 'prepaid' | 'usage', period: string) =>
    request<{ invoice: B2BSponsorInvoice | null; added: number; credited?: number }>(`/admin/b2b/programs/${encodeURIComponent(programId)}/invoices/prepare`, { method: 'POST', body: JSON.stringify({ kind, period }) }, token),
  adminB2BInvoices: (token: string, params: { organizationId?: string; programId?: string; period?: string; kind?: string; status?: string; limit?: number } = {}) =>
    request<Paged<B2BSponsorInvoice>>(`/admin/b2b/invoices${qs(params)}`, {}, token),
  adminB2BInvoice: (token: string, invoiceId: string) =>
    request<{ invoice: B2BSponsorInvoice; lines: B2BSponsorInvoiceLine[] }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}`, {}, token),
  issueB2BInvoice: (token: string, invoiceId: string, vatRateBps: number) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/issue`, { method: 'POST', body: JSON.stringify({ vatRateBps }) }, token),
  payB2BInvoice: (token: string, invoiceId: string, paymentReference: string) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/paid`, { method: 'POST', body: JSON.stringify({ paymentReference }) }, token),
  voidB2BInvoice: (token: string, invoiceId: string, reason: string) =>
    request<{ invoice: B2BSponsorInvoice }>(`/admin/b2b/invoices/${encodeURIComponent(invoiceId)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }, token),
  b2bEntitlements: (token: string, programId: string, period?: string) =>
    request<{ period: string; counts: Record<string, number>; entitlements: B2BPassEntitlement[] }>(`/admin/b2b/programs/${encodeURIComponent(programId)}/entitlements${qs({ period })}`, {}, token),
  convertCorporateToProgram: (token: string, corporateId: string) =>
    request<{ organizationId: string; program: B2BProgram; benefit: B2BBenefit }>(`/admin/b2b/corporate/${encodeURIComponent(corporateId)}/convert`, { method: 'POST' }, token),
  /** Internal product analytics (aggregates only). Days are member-local (EAT), inclusive. */
  adminAnalytics: (token: string, from: string, to: string) => {
    const qs = new URLSearchParams({ from, to });
    return request<AnalyticsOverview>(`/admin/analytics?${qs}`, {}, token);
  },
  /** Full gym record (with `images`/`thumbnails`) — fetch on demand for the detail/edit views. */
  /** Pass the admin token to include trainer-pass pricing (hidden from anonymous callers). */
  getGym: (id: string, token?: string) => request<Gym>(`/gyms/${id}`, {}, token),
  saveGym: (token: string, gym: Partial<Gym>) =>
    request<Gym>('/admin/gyms', { method: 'POST', body: JSON.stringify(gym) }, token),
  deleteGym: (token: string, id: string) =>
    request<{ ok: boolean; gym: Gym }>(`/admin/gyms/${id}`, { method: 'DELETE' }, token),
  gymOwners: (token: string) => request<GymOwner[]>('/admin/gym-owners', {}, token),
  /** Lightweight owner refs (id/displayName/email/gymIds) — use for owner-name lookups instead of the full gymOwners() list. */
  gymOwnerRefs: (token: string) => request<GymOwnerRef[]>('/admin/gym-owners?refs=true', {}, token),
  saveGymOwner: (token: string, owner: Partial<GymOwner>) =>
    request<GymOwner>('/admin/gym-owners', { method: 'POST', body: JSON.stringify(owner) }, token),
  deleteGymOwner: (token: string, id: string) =>
    request<{ ok: boolean; owner: GymOwner }>(`/admin/gym-owners/${id}`, { method: 'DELETE' }, token),
  adminTrainers: (token: string) => request<TrainerProfile[]>('/admin/trainers', {}, token),
  /** Lightweight trainer refs (id/displayName/email/gymIds) — use for trainer-name/assignment lookups instead of the full adminTrainers() list. */
  adminTrainerRefs: (token: string) => request<TrainerRef[]>('/admin/trainers?refs=true', {}, token),
  saveTrainer: (token: string, trainer: Partial<TrainerProfile>) =>
    request<TrainerProfile>('/admin/trainers', { method: 'POST', body: JSON.stringify(trainer) }, token),
  deleteTrainer: (token: string, id: string) =>
    request<{ ok: boolean; trainer: TrainerProfile }>(`/admin/trainers/${id}`, { method: 'DELETE' }, token),
  adminProducts: (token: string) => request<ShopProduct[]>('/admin/products', {}, token),
  createAdminProduct: (token: string, product: AdminProductDraft) =>
    request<ShopProduct>('/admin/products', { method: 'POST', body: JSON.stringify(product) }, token),
  updateProductListing: (token: string, id: string, listing: { homepageVisible: boolean; homepagePriority: number; approvalStatus?: 'pending' | 'approved' | 'rejected' }) =>
    request<ShopProduct>(`/admin/products/${id}/listing`, { method: 'PUT', body: JSON.stringify(listing) }, token),
  adminVendors: (token: string) => request<VendorSummary[]>('/admin/vendors', {}, token),
  updateAdminVendor: (token: string, id: string, patch: Partial<Pick<VendorSummary, 'approvalStatus' | 'accountStatus' | 'approvalNote'>>) =>
    request<VendorSummary>(`/admin/vendors/${id}`, { method: 'PUT', body: JSON.stringify(patch) }, token),
  trainerBookings: (token: string) => request<TrainerBooking[]>('/admin/trainer-bookings', {}, token),
  updateTrainerBooking: (token: string, id: string, status: 'confirmed' | 'completed' | 'cancelled') =>
    request<TrainerBooking>(`/admin/trainer-bookings/${id}`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  paymentRequests: (token: string) => request<PaymentRequest[]>('/admin/payment-requests', {}, token),
  refunds: (token: string, status?: RefundStatus) =>
    request<{ refunds: Refund[] }>(`/admin/refunds${status ? `?status=${status}` : ''}`, {}, token),
  raiseRefund: (token: string, body: { paymentRequestId: string; amountTzs?: number; note?: string }) =>
    request<{ refund: Refund }>('/admin/refunds', { method: 'POST', body: JSON.stringify(body) }, token),
  decideRefund: (token: string, id: string, body: { decision: 'approve' | 'reject'; note?: string; amountTzs?: number; endAccess?: boolean }) =>
    request<{ refund: Refund }>(`/admin/refunds/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),
  markRefundPaid: (token: string, id: string, body: { paymentReference: string; paidTo?: string }) =>
    request<{ refund: Refund }>(`/admin/refunds/${encodeURIComponent(id)}/paid`, { method: 'POST', body: JSON.stringify(body) }, token),
  decidePayment: (token: string, id: string, decision: 'approve' | 'reject', reference?: string, note?: string) =>
    request<PaymentRequest>(`/admin/payment-requests/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reference, note })
    }, token),
  updatePayment: (token: string, id: string, patch: Pick<Partial<PaymentRequest>, 'status' | 'reference' | 'note'>) =>
    request<PaymentRequest>(`/admin/payment-requests/${id}`, { method: 'POST', body: JSON.stringify(patch) }, token),
  members: (token: string) => request<MemberSummary[]>('/admin/members', {}, token),
  saveMember: (token: string, member: Partial<MemberSummary>) =>
    request<MemberSummary>('/admin/members', { method: 'POST', body: JSON.stringify(member) }, token),
  setMemberStatus: (token: string, id: string, status: 'active' | 'suspended') =>
    request<MemberSummary>(`/admin/members/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  memberPayments: (token: string, memberId: string) =>
    request<PaymentRequest[]>(`/admin/members/${memberId}/payments`, {}, token),
  adminMemberQr: (token: string, memberId: string) =>
    request<{ token: string; expiresAt: string; rotatesEverySeconds: number }>(`/admin/members/${memberId}/qr`, {}, token),
  adminMemberCheckins: (token: string, memberId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return request<MemberCheckinRecord[]>(`/admin/members/${memberId}/checkins${q ? '?' + q : ''}`, {}, token);
  },
  roleApprovals: (token: string) => request<RoleApproval[]>('/admin/role-approvals?status=all', {}, token),
  decideRoleApproval: (token: string, id: string, decision: 'approve' | 'reject', note?: string) =>
    request<RoleApproval>(`/admin/role-approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note })
    }, token),
  gymUsageSummary: (token: string) => request<GymUsageSummary[]>('/admin/gym-usage', {}, token),
  gymVisitDetails: (token: string, gymId: string) => request<GymVisitRecord[]>(`/admin/gym-usage/${gymId}/visits`, {}, token),
  bookKeeping: (token: string) => request<BookKeepingEntry[]>('/admin/book-keeping', {}, token),
  listInvoices: (token: string, params?: { gymId?: string; status?: string; ownerId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.gymId) qs.set('gymId', params.gymId);
    if (params?.status) qs.set('status', params.status);
    if (params?.ownerId) qs.set('ownerId', params.ownerId);
    const q = qs.toString();
    return request<Invoice[]>(`/admin/invoices${q ? '?' + q : ''}`, {}, token);
  },
  createInvoice: (token: string, data: { gymId: string; amount: number; note?: string; periodStart?: string; periodEnd?: string }) =>
    request<Invoice>('/admin/invoices', { method: 'POST', body: JSON.stringify(data) }, token),
  updateInvoice: (token: string, id: string, data: { receiptUrl?: string; paymentReference?: string; status?: string; note?: string }) =>
    request<Invoice>(`/admin/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  periodDistribution: (token: string) => request<PeriodDistribution[]>('/admin/distributions/periods', {}, token),
  getSettings: (token: string) => request<PlatformSettings>('/admin/settings', {}, token),
  updateSettings: (token: string, data: Partial<PlatformSettings>) =>
    request<PlatformSettings>('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }, token),
  getSpecialties: () => request<string[]>('/settings/specialties'),
  adminGetSpecialties: (token: string) => request<string[]>('/admin/settings/specialties', {}, token),
  adminSaveSpecialty: (token: string, name: string) =>
    request<string[]>('/admin/settings/specialties', { method: 'POST', body: JSON.stringify({ name }) }, token),
  adminDeleteSpecialty: (token: string, name: string) =>
    request<string[]>(`/admin/settings/specialties/${encodeURIComponent(name)}`, { method: 'DELETE' }, token),

  // ─── Owner/Operator role ───
  ownerGyms: (token: string) => request<Gym[]>('/owner/gyms', {}, token),
  ownerInvoices: (token: string) => request<Invoice[]>('/owner/invoices', {}, token),
  ownerEarnings: (token: string) => request<OwnerEarnings>('/owner/earnings', {}, token),
  ownerGymCheckins: (token: string, gymId: string) => request<CheckIn[]>(`/owner/gyms/${gymId}/checkins`, {}, token),
  ownerUpdateGym: (token: string, gymId: string, data: Partial<Gym>) =>
    request<Gym>(`/owner/gyms/${gymId}`, { method: 'PUT', body: JSON.stringify(data) }, token),
  ownerMembers: (token: string, gymId?: string) =>
    request<{ members: any[]; stats: Record<string, number> }>(`/owner/members${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  ownerCreateMember: (token: string, data: { displayName: string; email?: string; phone?: string; initialPassword?: string; gymId?: string; paidAmount?: number; durationUnit: 'D' | 'W' | 'M'; startDate: string; endDate: string; tier?: string }) =>
    request<{ member: any; subscription: any }>('/owner/members', { method: 'POST', body: JSON.stringify(data) }, token),
  ownerStaff: (token: string) => request<any[]>('/owner/staff', {}, token),
  ownerCreateStaff: (token: string, data: { displayName: string; email: string; password: string; gymIds: string[]; aclPermissions: string[] }) =>
    request<any>('/owner/staff', { method: 'POST', body: JSON.stringify(data) }, token),
  ownerTrainers: (token: string, gymId?: string) =>
    request<TrainerProfile[]>(`/owner/trainers${gymId ? `?gymId=${encodeURIComponent(gymId)}` : ''}`, {}, token),
  ownerPendingTrainers: (token: string) => request<TrainerProfile[]>('/owner/trainers/pending', {}, token),
  ownerDecideTrainer: (token: string, trainerId: string, gymId: string, decision: 'approve' | 'reject') =>
    request<TrainerProfile>(`/owner/trainers/${trainerId}/decision`, { method: 'POST', body: JSON.stringify({ gymId, decision }) }, token),

  // ─── Trainer role ───
  trainerProfile: (token: string) => request<TrainerProfile>('/trainer/me', {}, token),
  trainerUpdateProfile: (token: string, data: Partial<TrainerProfile>) =>
    request<TrainerProfile>('/trainer/me', { method: 'PUT', body: JSON.stringify(data) }, token),
  trainerMyBookings: (token: string) => request<TrainerBooking[]>('/trainer/bookings', {}, token),
  trainerCompleteBooking: (token: string, id: string) =>
    request<TrainerBooking>(`/trainer/bookings/${id}/complete`, { method: 'POST' }, token),

  // ─── Member role ───
  memberMe: (token: string) => request<MemberMeResponse>('/me', {}, token),
  memberProfile: (token: string, data: Partial<MemberProfile>) =>
    request<{ user: MemberSummary }>('/me/profile', { method: 'POST', body: JSON.stringify(data) }, token),
  memberCheckins: (token: string) => request<CheckIn[]>('/me/checkins', {}, token),
  memberBookings: (token: string) => request<TrainerBooking[]>('/me/trainer-bookings', {}, token),
  memberCreateBooking: (token: string, data: { trainerId: string; gymId: string; date: string; slot: string }) =>
    request<{ booking: TrainerBooking; trainer: TrainerProfile }>('/me/trainer-bookings', { method: 'POST', body: JSON.stringify(data) }, token),
  memberMyPayments: (token: string) => request<PaymentRequest[]>('/me/payments', {}, token),
  memberSubscribe: (token: string, data: { tier: string; type?: string; homeGymId?: string }) =>
    request<{ subscription: any; paymentRequest: PaymentRequest | null }>('/me/subscribe', { method: 'POST', body: JSON.stringify(data) }, token),
  memberQr: (token: string) => request<{ token: string; expiresAt: string }>('/me/qr', {}, token),

  // ─── Public ───
  publicGyms: () => request<Gym[]>('/gyms'),
  publicTrainers: (q?: string, specialty?: string) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (specialty) qs.set('specialty', specialty);
    const s = qs.toString();
    return request<TrainerProfile[]>(`/trainers${s ? '?' + s : ''}`);
  },
  publicPasses: () => request<any[]>('/passes'),

  /**
   * Uploads a single file (image) to the Zebra storage service via the
   * backend's multipart proxy (`POST /storage`). Returns the persisted URL
   * to store in place of a base64 data URL.
   */
  uploadFile: async (token: string, file: Blob, filename: string): Promise<UploadedFile> => {
    const form = new FormData();
    form.append('file', file, filename);
    const res = await fetch(`${BASE}/storage/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, body);
    // `url`/`thumbnailUrl` from the backend are root-relative to the API
    // server (e.g. `/storage/<cid>/<filename>`), not the portal's own
    // origin — resolve them against the API base so <img src> works from
    // the portal domain.
    return { ...body, url: `${BASE}${body.url}`, thumbnailUrl: `${BASE}${body.thumbnailUrl}` } as UploadedFile;
  },
};

export interface UploadedFile {
  cid: string | null;
  filename: string | null;
  url: string;
  thumbnailCid: string | null;
  thumbnailFilename: string | null;
  thumbnailUrl: string;
}

export interface PortalUser {
  id: string;
  email: string | null;
  displayName: string | null;
  userType: string;
  accountStatus: 'active' | 'suspended';
  portalUser: boolean;
  aclPermissions: string[];
  createdAt?: string;
  isEnvAdmin?: boolean;
}

export interface DashboardResponse {
  gym: { id: string; name: string; tier: string; perVisitRate: number };
  gyms?: Array<{ id: string; name: string; tier: string; perVisitRate: number }>;
  todayCount: number;
  monthVisits: number;
  periodStart?: string;
  periodEnd?: string;
  memberType?: 'all' | 'direct' | 'fitflex';
  periodVisits?: number;
  periodMembers?: number;
  directVisits?: number;
  directMembers?: number;
  fitflexVisits?: number;
  fitflexMembers?: number;
  overall?: {
    gymCount: number;
    totalVisits: number;
    uniqueMembers: number;
    directVisits: number;
    directMembers: number;
    fitflexVisits: number;
    fitflexMembers: number;
  };
  gymSummaries?: Array<{
    gymId: string;
    gymName: string;
    tier: string;
    totalVisits: number;
    uniqueMembers: number;
    directVisits: number;
    directMembers: number;
    fitflexVisits: number;
    fitflexMembers: number;
  }>;
  payout: { band: number; commissionPct?: number; net?: number; flatFee?: boolean; payoutDelayDays?: number };
}

export interface CheckIn {
  id: string;
  memberId: string;
  memberPublicId?: string;
  memberPhone: string | null;
  memberEmail?: string | null;
  timestamp: string;
  passTier: string | null;
  visitNumberInCycle: number | null;
  gymTier: string;
}

export interface CheckInResult {
  ok: boolean;
  failure?: string;
  checkin?: CheckIn;
  visitNumberInCycle?: number;
}

export interface Gym {
  id: string;
  name: string;
  tier: string;
  location: string;
  perVisitRate: number;
  ratePerDay?: number;
  ratePerWeek?: number;
  ratePerMonth?: number;
  commissionRate: number;
  status: string;
  accessMode?: 'free_online' | 'paid_visit';
  venueType?: 'physical';
  coordinates?: { lat: number | null; lng: number | null };
  /** Only present on the full record (GET /gyms/:id or ?full=true) — absent from the slimmed admin list. */
  images?: string[];
  /** Small WebP previews, parallel to `images` (same index = same photo). Only present on the full record. */
  thumbnails?: string[];
  /** Single pre-generated thumbnail for list rows — present on the slimmed admin list response. */
  thumbnail?: string | null;
  amenities?: string[];
  equipment?: string[];
  verified?: boolean;
  homepageVisible?: boolean;
  homepagePriority?: number;
  /** Trainer passes the owner sells — only trainers (and admins) see them. */
  trainerPass?: TrainerPassConfig;
}

export type TrainerPassPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Gym trainer passes: any of daily/weekly/monthly, each with its own fee in
 * TZS. `feeTzs`/`period` mirror the first option for older app builds.
 */
export interface TrainerPassConfig {
  enabled: boolean;
  options?: Partial<Record<TrainerPassPeriod, number>>;
  feeTzs?: number;
  period?: TrainerPassPeriod;
}

/** Trainer social profiles, stored as bare handles. */
export interface TrainerSocialLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
}

export interface GymVisitRecord {
  gymId: string;
  gymName: string;
  memberId: string;
  memberName?: string;
  memberEmail?: string;
  date: string;
  billingType: 'day' | 'week' | 'month';
  rate: number;
}

export interface GymUsageSummary {
  gymId: string;
  gymName: string;
  location: string;
  totalVisits: number;
  uniqueMembers: number;
  dayVisits: number;
  weekVisits: number;
  monthVisits: number;
  totalOwed: number;
  totalPaid: number;
  balance: number;
}

export interface BookKeepingEntry {
  id: string;
  date: string;
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  reference?: string;
  gymId?: string;
  memberId?: string;
}

export interface SubscriptionTierConfig {
  key: string;
  label: string;
  monthlyPrice: number;
  visits: number;
  gymAccess: string;
}

export interface PayoutBandConfig {
  key: string;
  label: string;
  minVisits: number;
  maxVisits: number;
  payoutTiming: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  commissionPct: number;
}

export interface PlatformSettings {
  id: string;
  subscriptionTiers: SubscriptionTierConfig[];
  payoutBands: PayoutBandConfig[];
  paymentPeriodDays: number;
  payoutModel: 'commission' | 'discounted_rate';
  currency: string;
  updatedAt: string;
}

export interface PeriodMemberDetail {
  memberId: string;
  memberName: string;
  visitCount: number;
  billingType: string;
  amount: number;
}

export interface PeriodGymBreakdown {
  gymId: string;
  gymName: string;
  location: string;
  totalVisits: number;
  uniqueMembers: number;
  totalOwed: number;
  totalPaid: number;
  balance: number;
  members: PeriodMemberDetail[];
  invoice: Invoice | null;
}

export interface PeriodDistribution {
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  gyms: PeriodGymBreakdown[];
  totalOwed: number;
  totalPaid: number;
  balance: number;
}

export interface Invoice {
  id: string;
  gymId: string;
  gymName: string;
  ownerId: string | null;
  ownerName: string | null;
  amount: number;
  status: 'unpaid' | 'paid';
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  receiptUrl: string | null;
  paymentReference: string | null;
  createdAt: string;
  createdBy: string;
  paidAt: string | null;
}

export type RefundStatus = 'requested' | 'approved' | 'paid' | 'rejected';
export type RefundKind = 'subscription' | 'trainer_booking' | 'shop_order';

/** Money FitFlex owes back to a payer: requested → approved → paid, or rejected. */
export interface Refund {
  id: string;
  memberId: string;
  kind: RefundKind;
  subscriptionId: string | null;
  bookingId: string | null;
  orderId: string | null;
  paymentRequestId: string | null;
  amountTzs: number;
  currency: string;
  reasonCode: string;
  note: string | null;
  status: RefundStatus;
  requestedBy: string | null;
  requestedRole: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  paidTo: string | null;
  createdAt: string;
  member?: { id: string; displayName: string | null; phone: string | null; email: string | null } | null;
}

export interface PaymentRequest {
  id: string;
  memberId: string;
  /** Null when the request pays for a trainer booking or a shop order instead. */
  subscriptionId: string | null;
  /** Set when the request pays for a group of trainer booking slots. */
  bookingGroupId?: string | null;
  /** Set when the request pays for a marketplace order. */
  orderId?: string | null;
  plan?: string | null;
  currency?: string | null;
  tier: string | null;
  amountTzs: number;
  status: string;
  provider: string;
  reference: string | null;
  note?: string | null;
  /** The gym a gym-bound request pays for (trainer pass / gym plan). */
  gymId?: string | null;
  gym?: { id: string; name: string } | null;
  requestedAt: string;
  decidedAt: string | null;
  member?: { email?: string | null; phone?: string | null; displayName?: string | null };
  subscription?: {
    tier?: string | null;
    /** 'platform_pass' | 'direct_sub' | 'trainer_pass' | … */
    type?: string | null;
    plan?: string | null;
    status: string;
    renewsAt?: string;
    expiresAt?: string | null;
  } | null;
}

export interface MemberProfile {
  fitnessGoal?: string | null;
  fitnessLevel?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  preferredWorkoutTimes?: string[];
}

export interface MemberSummary {
  id: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: string;
  accountStatus?: 'active' | 'suspended';
  memberProfile?: MemberProfile | null;
  subscription?: { tier?: string | null; status: string; renewsAt: string } | null;
  pendingPayment?: PaymentRequest | null;
}

export interface RoleApproval {
  id: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: 'gym_operator' | 'trainer' | 'vendor';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
  verified?: boolean;
  approvalNote?: string | null;
  createdAt?: string;
}

export interface GymOwner {
  id: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  userType: 'gym_operator';
  gymId?: string | null;
  gymIds?: string[];
  gym?: Gym | null;
  gyms?: Gym[];
  accountStatus?: 'active' | 'suspended';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
}

export interface TrainerProfile {
  id: string;
  userId?: string | null;
  email?: string | null;
  displayName: string;
  photoUrl?: string | null;
  images?: string[];
  imageThumbnails?: string[];
  specialties: string[];
  bio?: string;
  rating?: number;
  reviewCount?: number;
  hourlyRateTzs: number;
  experienceYears?: number;
  gymIds: string[];
  gyms?: Gym[];
  status: 'active' | 'inactive' | 'suspended';
  sessionRateCurrency?: 'TZS' | 'USD';
  approvalStatus?: 'pending_approval' | 'approved' | 'rejected';
  verified?: boolean;
  homepageVisible?: boolean;
  homepagePriority?: number;
  availability?: Array<{ day?: string; date?: string; gymId?: string; gymName?: string; slots: string[] }>;
  socialLinks?: TrainerSocialLinks;
}

export interface ShopProduct {
  id: string;
  vendorId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  priceTzs: number;
  discountPriceTzs?: number | null;
  stock: number;
  images?: string[];
  status: 'active' | 'paused' | 'archived';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  homepageVisible?: boolean;
  homepagePriority?: number;
}

export interface AdminProductDraft {
  vendorId: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  priceTzs: number;
  stock: number;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  homepageVisible?: boolean;
  homepagePriority?: number;
}

export interface VendorSummary {
  id: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  userType: 'vendor';
  approvalStatus: 'pending_approval' | 'approved' | 'rejected';
  approvalNote?: string | null;
  accountStatus: 'active' | 'suspended';
  /** The vendor's KYC case status; null if they haven't started. */
  kycStatus?: KycCaseStatus | null;
  /** Existing vendors predate KYC and keep working without it. */
  kycExempt?: boolean;
  productCount: number;
  pendingProductCount: number;
  createdAt?: string;
  vendorProfile?: {
    businessName?: string | null;
    businessCategory?: string | null;
    address?: string | null;
    status?: string | null;
  } | null;
}

/** Lightweight owner projection (id/displayName/email/gymIds) for pages that only need owner names, e.g. the gyms table's owner column and owner-select dropdown. */
export interface GymOwnerRef {
  id: string;
  displayName?: string | null;
  email?: string | null;
  gymId?: string | null;
  gymIds?: string[];
}

/** Lightweight trainer projection (id/displayName/email/gymIds) for pages that only need trainer names and gym links, e.g. the gyms table's trainer-select dropdown. */
export interface TrainerRef {
  id: string;
  displayName?: string | null;
  email?: string | null;
  gymIds?: string[];
}

export interface TrainerBooking {
  id: string;
  memberId: string;
  trainerId: string;
  gymId: string;
  date: string;
  slot: string;
  amountTzs: number;
  status: 'confirmed' | 'completed' | 'cancelled';
  createdAt?: string;
  member?: { email?: string | null; phone?: string | null; displayName?: string | null } | null;
  trainer?: TrainerProfile | null;
  gym?: Gym | null;
}

export interface OwnerEarnings {
  totalPaid: number;
  totalPending: number;
  paidCount: number;
  pendingCount: number;
}

export interface MemberCheckinRecord {
  id: string;
  memberId: string;
  gymId: string;
  timestamp: string;
  method: string;
  subscriptionType: string;
  passTier: string | null;
  visitNumberInCycle: number | null;
  gymTier: string;
  visitConsumed: boolean;
  gym: Gym | null;
}

export interface MemberMeResponse {
  user: MemberSummary;
  subscription: { id: string; type: string; tier: string | null; status: string; renewsAt: string; expiresAt: string } | null;
  pendingPayment: PaymentRequest | null;
  visitsUsed: number;
  visitCap: number | null;
}

// ── Internal analytics ──────────────────────────────────────────────────
/** Share 0–1, or null when there was nothing to measure. */
export type Rate = number | null;
export interface WorkoutTally { due: number; completed: number; skipped: number; missed: number; completionRate: Rate }
export interface CompletionTally { evaluated: number; met: number; completionRate: Rate }
export interface AnalyticsOverview {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  members: number;
  dailyActive: {
    series: { day: string; members: number }[];
    averageDaily: number; activeInPeriod: number; activeLast7Days: number; stickiness: Rate;
  };
  activityLogging: {
    activities: number; membersLogging: number; loggingRate: Rate; perLoggingMember: number | null;
    byOrigin: { device: number; fitflex: number; manual: number };
  };
  workouts: WorkoutTally & { trainerAssigned: WorkoutTally; selfPlanned: WorkoutTally; completedInPeriod: number };
  challenges: {
    running: number; byCreator: Record<string, number>; joinsInPeriod: number; participants: number;
    participationRate: Rate; finishedEntries: number; completionRate: Rate; leaderboardOptInRate: Rate;
  };
  streaks: {
    distributionAtEnd: { from: number; to: number | null; members: number }[];
    onStreakAtStart: number; unbrokenThroughPeriod: number; streakRetention: Rate;
    weeklyRetention: { week: string; active: number; activeNextWeek: number; retention: Rate }[];
  };
  goals: {
    membersWithGoals: number; periodsEvaluated: number; periodsMet: number; completionRate: Rate;
    byType: Record<string, CompletionTally>; byPeriod: Record<string, CompletionTally>;
  };
  trainers: {
    activeConnections: number; trainersWithClients: number; requests: number; accepted: number; declined: number;
    pending: number; acceptanceRate: Rate; clientsSharingData: number; workoutsAssigned: number;
    trainersAssigning: number; assignedCompletionRate: Rate;
  };
  gyms: {
    checkins: number; membersVisiting: number; visitRate: Rate; visitsPerVisitingMember: number | null;
    gymsVisited: number; topGyms: { gymId: string; name: string | null; checkins: number; members: number }[];
    gymChallenges: number; gymChallengeParticipants: number; membersSharingWithGyms: number;
  };
}

// ── Challenge management (admin + HR) ───────────────────────────────────
export type ChallengeScope = 'admin' | 'corporate';
export type ChallengeType = 'steps' | 'distance_km' | 'workouts' | 'active_minutes' | 'consistency' | 'gym_attendance';
export type ChallengeMode = 'individual' | 'teams' | 'gym_vs_gym' | 'department';
export type RewardFunding = 'fitflex' | 'company' | 'partner';
export interface SocialGroup {
  id: string;
  name: string;
  description: string | null;
  ownerType: 'member' | 'trainer' | 'gym' | 'corporate';
  joinPolicy: 'open' | 'approval';
  discoverable: boolean;
  memberCount: number;
  inviteCode?: string;
  pending?: number;
  canManage?: boolean;
}
export interface GroupInput { name: string; description?: string; joinPolicy: 'open' | 'approval'; discoverable: boolean }
export interface GroupMember { id: string; displayName: string | null; role: 'admin' | 'member'; status: 'active' | 'pending' }
export type GroupMemberAction = 'approve' | 'remove' | 'make_admin' | 'make_member';
export type ReviewKind = 'gym' | 'trainer';
export type ReviewStatus = 'published' | 'flagged' | 'hidden';
export type ReviewAction = 'hide' | 'flag' | 'restore';
/** A review as admins see it: full member name and moderation state. */
export interface AdminReview {
  id: string;
  gymId?: string;
  trainerId?: string;
  gymName?: string | null;
  trainerName?: string | null;
  memberId: string;
  memberName: string | null;
  rating: number;
  text: string | null;
  status: ReviewStatus;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
}
/** A published review as the public sees it: first name + initial only. */
export interface PublicReview {
  id: string;
  rating: number;
  text: string | null;
  memberName: string;
  memberPhotoUrl: string | null;
  createdAt: string;
}
export interface ReviewSummary {
  averageRating: number | null;
  reviewCount: number;
  distribution: Record<string, number>;
}
export type SocialReportStatus = 'open' | 'actioned' | 'dismissed';
export interface SocialReport {
  id: string;
  targetType: 'user' | 'activity' | 'comment' | 'group';
  targetId: string;
  reason: string | null;
  status: SocialReportStatus;
  createdAt: string;
  reporter: string | null;
  target: { text?: string; author?: string | null; removed?: boolean; displayName?: string | null; name?: string; archived?: boolean; owner?: string | null; type?: string; title?: string | null } | null;
}
export type RewardType = 'points' | 'discount' | 'gym_pass' | 'trainer_session' | 'vendor_voucher' | 'corporate_reward' | 'badge' | 'certificate' | 'other';
export type RewardRule = 'finishers' | 'top' | 'team';
export interface RewardItem {
  id: string;
  type: RewardType;
  label: string;
  value: string | null;
  rule: RewardRule;
  topN: number | null;
}
export type RewardItemInput = Omit<RewardItem, 'id'> & { id?: string };
export type RewardStatus = 'pending' | 'approved' | 'issued' | 'rejected';
export interface RewardHistoryEntry { status: RewardStatus; at: string; by: string | null; byName?: string | null; note?: string; reference?: string }
/** One member's earned reward, as a fulfilment queue sees it (never their activity). */
export interface RewardAward {
  id: string;
  challenge: { id: string; name: string | null; endDate: string | null };
  reward: { id: string; type: RewardType; label: string; value: string | null; rule: RewardRule };
  rank: number | null;
  status: RewardStatus;
  earnedAt: string;
  issuedAt: string | null;
  reference: string | null;
  note: string | null;
  member: { id: string; displayName: string | null; department?: string | null };
  funder: string;
  history: RewardHistoryEntry[];
}
export interface RewardQueue { rewards: RewardAward[]; counts: Record<RewardStatus, number> }
export type Eligibility =
  | { kind: 'all' }
  | { kind: 'tiers'; tiers: string[] }
  | { kind: 'departments'; departments: string[] }
  | { kind: 'employees'; employeeIds: string[] };
export interface ChallengeInput {
  name: string;
  description?: string | null;
  type: ChallengeType;
  target: number;
  startDate: string;
  endDate: string;
  rewardItems: RewardItemInput[];
  rewardFunding?: RewardFunding;
  eligibility?: Eligibility;
  mode?: ChallengeMode;
  teams?: string[];
}
export interface ManagedChallenge {
  id: string;
  name: string;
  description?: string | null;
  type: ChallengeType;
  target: number;
  startDate: string;
  endDate: string;
  rewards: string[];
  rewardItems?: RewardItem[] | null;
  rewardFunding?: RewardFunding | null;
  eligibility: Eligibility | null;
  mode?: ChallengeMode;
  status: 'active' | 'closed' | 'cancelled' | 'archived';
  phase: 'upcoming' | 'active' | 'ended' | 'cancelled';
  participantCount: number;
  teams?: { id: string; name: string }[];
}
export interface ChallengeSummary {
  eligible: number | null;
  joined: number;
  participationRate: Rate;
  completed: number;
  completionRate: Rate;
  averageProgress: number;
}
export interface DepartmentParticipation {
  department: string | null;
  other: boolean;
  eligible: number;
  joined: number;
  participationRate: Rate;
  completed?: number;
  averageProgress?: number;
}
export interface ChallengeParticipation {
  summary: ChallengeSummary;
  byDepartment?: DepartmentParticipation[];
  minGroupSize?: number;
}
export interface ChallengeStandings {
  teams: { rank: number; teamId: string; name: string; members: number; averageCompletion: number }[];
  hiddenTeams: number;
  minTeamSize: number;
  participants: number;
}
export interface CorporateEmployee {
  id: string;
  displayName: string;
  department?: string | null;
  email?: string | null;
  status: string;
}
export interface CorporateAccount {
  id: string;
  companyName: string;
  status: string;
  seatLimit?: number;
  industrySector?: string;
}
export interface Paged<T> {
  items: T[];
  total: number;
  nextCursor: number | null;
}
export type B2BOrganizationStatus = 'pending' | 'active' | 'suspended' | 'inactive';
export interface B2BReference {
  organizationTypes: Record<string, string>;
  organizationStatuses: Record<B2BOrganizationStatus, B2BOrganizationStatus[]>;
  organizationUserRoles: string[];
  organizationUserStatuses: string[];
  permissions: string[];
  beneficiaryTypes: Record<string, string>;
  beneficiaryStatuses: Record<string, string[]>;
  industrySectors: Record<string, string>;
}
export interface B2BOrganization {
  id: string;
  organizationType: string;
  legalName: string;
  tradingName?: string | null;
  industrySector?: string | null;
  registrationNumber?: string | null;
  taxIdentificationNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, string> | null;
  status: B2BOrganizationStatus;
  statusReason?: string | null;
  legacyCorporateId?: string | null;
  /** 'corporate' = mapped from a CorporateAccount, which owns `managedFields`. */
  source: 'b2b' | 'corporate';
  managedFields: string[];
  kyc: { supported: boolean; caseId: string | null; status: string | null };
  createdAt?: string;
}
export interface B2BOrganizationUser {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  permissions: string[];
  status: 'active' | 'suspended' | 'removed';
  source: 'b2b' | 'corporate_hr';
  readOnly: boolean;
  user: { displayName: string | null; email: string | null; userType: string } | null;
}
export interface B2BBeneficiary {
  id: string;
  organizationId: string;
  userId: string | null;
  displayName: string | null;
  externalReference: string | null;
  beneficiaryType: string;
  groupName: string | null;
  status: 'pending' | 'active' | 'suspended' | 'inactive';
  enrolledAt: string | null;
  source: 'b2b' | 'corporate_employee';
  readOnly: boolean;
}
export type B2BProgramStatus = 'draft' | 'pending' | 'active' | 'paused' | 'expired' | 'cancelled';
export interface B2BProgramReference {
  programTypes: Record<string, string>;
  programStatuses: Record<B2BProgramStatus, B2BProgramStatus[]>;
  benefitTypes: Record<string, { label: string; fulfilledBy: string; providerKeys: string[] }>;
  benefitStatuses: Record<string, string[]>;
  fundingTypes: Record<string, string>;
  usagePeriods: string[];
  eligibilityScopes: string[];
}
export interface B2BEligibility {
  scope: 'all' | 'groups' | 'selected';
  groups: string[];
  beneficiaryIds: string[];
  beneficiaryTypes: string[];
  enrolledOnOrBefore: string | null;
}
export interface B2BProgramInput {
  name: string;
  description?: string | null;
  programType?: string;
  startDate: string;
  endDate?: string | null;
  eligibility?: Partial<B2BEligibility>;
  budgetTzs?: number | null;
  /** Discount on the pass tier's price, basis points. FitFlex admins only. */
  discountBps?: number;
}
export interface B2BProgram extends B2BProgramInput {
  id: string;
  organizationId: string;
  programType: string;
  endDate: string | null;
  eligibility: B2BEligibility;
  status: B2BProgramStatus;
  effectiveStatus: B2BProgramStatus;
  statusReason?: string | null;
  budgetTzs: number | null;
  activatedAt?: string | null;
  createdAt?: string;
}
export interface B2BProviderRules {
  scope: 'all' | 'selected';
  gymIds?: string[];
  gymTiers?: string[];
  trainerIds?: string[];
  vendorIds?: string[];
  productCategories?: string[];
  challengeIds?: string[];
}
export interface B2BBenefitInput {
  name: string;
  description?: string | null;
  benefitType: string;
  fundingType: string;
  sponsorAmountTzs?: number | null;
  sponsorShareBps?: number | null;
  sponsorCapTzs?: number | null;
  beneficiaryAmountTzs?: number | null;
  usageLimit?: number | null;
  usagePeriod: string;
  periodSponsorCapTzs?: number | null;
  eligibility?: { groups: string[]; beneficiaryTypes: string[] } | null;
  providerRules?: B2BProviderRules;
  startDate?: string | null;
  endDate?: string | null;
  terms?: string | null;
  /** Sponsored pass only: the pass tier the member gets. */
  passTier?: string | null;
}
export interface B2BBenefit extends B2BBenefitInput {
  id: string;
  programId: string;
  status: 'draft' | 'active' | 'inactive';
  providerRules: B2BProviderRules;
  validity: { startDate: string; endDate: string | null };
  fundingSummary: string;
}
export interface B2BEligibilityRow {
  beneficiary: { id: string; displayName: string | null; userId: string | null; beneficiaryType: string; groupName: string | null; status: string; source: string };
  wouldBeEligible: boolean;
  reason: string | null;
  eligibleToday: boolean;
  todayReason: string | null;
}
export interface B2BUsageMoney { grossTzs: number; sponsorTzs: number; beneficiaryTzs: number }
export interface B2BUsageRow extends B2BUsageMoney { uses: number }
export interface B2BProgramUsage {
  program: { id: string; name: string; status: string; statusReason: string | null };
  budget: { budgetTzs: number | null; spentTzs: number; remainingTzs: number | null };
  totals: B2BUsageRow;
  byStatus: Record<string, number>;
  byBenefit: (B2BUsageRow & { benefitId: string; benefitName: string | null })[];
  byProvider: (B2BUsageRow & { providerType: string; providerId: string; providerName: string | null })[];
  byBeneficiary: (B2BUsageRow & { beneficiaryId: string; beneficiaryName: string | null })[];
}
export interface B2BConsumptionFilters {
  organizationId?: string; programId?: string; benefitId?: string; beneficiaryId?: string; userId?: string;
  providerId?: string; serviceType?: string; status?: string; from?: string; to?: string; limit?: number; cursor?: number | null;
}
export interface B2BConsumption extends B2BUsageMoney {
  id: string;
  organizationId: string; organizationName: string | null;
  programId: string; programName: string | null;
  benefitId: string; benefitName: string | null;
  beneficiaryId: string; beneficiaryName: string | null; userId: string | null;
  sourceType: string; sourceId: string; serviceType: string;
  providerType: string; providerId: string; providerName: string | null;
  consumedAt: string; businessDate: string; quantity: number;
  status: 'pending' | 'approved' | 'rejected' | 'reversed' | 'cancelled';
  rejectionReason: string | null;
  verifiedAt: string | null;
  reversedAt: string | null; reversedBy: string | null; reversalReason: string | null;
  rulesSnapshot: Record<string, unknown> | null;
}
export interface B2BSponsorInvoice {
  id: string;
  number: string;
  organizationId: string;
  programId: string;
  period: string;
  kind: 'prepaid' | 'usage';
  status: 'draft' | 'issued' | 'paid' | 'void';
  /** VAT-inclusive. */
  totalTzs: number;
  vatRateBps: number | null;
  vatTzs: number | null;
  issuedAt: string | null;
  /** Who issued it (FitFlex admin views only). The same person can't record it as paid. */
  issuedBy?: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  voidReason: string | null;
}
export interface B2BSponsorInvoiceLine {
  id: string;
  kind: 'pass' | 'usage' | 'credit';
  description: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  quantity: number;
  amountTzs: number;
}
export interface B2BPassEntitlement {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string | null;
  period: string;
  passTier: string;
  feeTzs: number;
  sponsorTzs: number;
  memberTzs: number;
  status: 'invoiced' | 'scheduled' | 'awaiting_link' | 'awaiting_member' | 'active' | 'void';
}
export interface HrUser {
  id: string;
  displayName: string;
  email: string;
  accountStatus: 'active' | 'suspended';
  createdAt?: string;
}

// ── Communications ──────────────────────────────────────────────────────
export type CommsScope = 'owner' | 'admin';
export type CommsChannel = 'in_app' | 'push' | 'whatsapp';
export type CommsPurpose = 'promotion' | 'renewal' | 'payment' | 'announcement' | 'engagement' | 'general';
export type CommsStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partially_failed' | 'failed' | 'cancelled';
export type CommsDeepLink = 'message' | 'membership' | 'renewal' | 'payment' | 'gym';
export type CommsLocale = 'en' | 'sw';
export interface CommsText { title: string; body: string; ctaLabel?: string }
/** The main language's text is inline; the other language, if written, is in `translations`. */
export interface CommsContent {
  title: string; body: string; ctaLabel?: string; deepLink?: CommsDeepLink;
  offerName?: string; discount?: string; amountTzs?: number;
  locale?: CommsLocale; translations?: Partial<Record<CommsLocale, CommsText>>;
}
export type CommsTemplateGroup = 'membership' | 'payment' | 'marketing' | 'engagement' | 'general';
export interface CommsTemplate {
  id: string; key: string; system: boolean; gymId: string | null; name: string;
  group: CommsTemplateGroup; purpose: CommsPurpose; category: string; deepLink: CommsDeepLink;
  bodies: Partial<Record<CommsLocale, CommsText>>; variables: string[]; status: string;
  basedOn: string | null; updatedAt: string | null;
  /** Only on a single template (GET …/templates/:id): whether it's approved for WhatsApp. */
  whatsapp?: { ready: boolean; byLocale: Partial<Record<CommsLocale, { ready: boolean; reason?: string }>> };
}
export interface CommsTemplateDraft {
  gymId?: string; name: string; purpose: CommsPurpose; group?: CommsTemplateGroup; deepLink?: CommsDeepLink;
  bodies: Partial<Record<CommsLocale, CommsText>>;
}
export type WhatsAppApproval = 'pending' | 'approved' | 'rejected' | 'paused';
export type WhatsAppCategory = 'utility' | 'marketing' | 'authentication';
export interface WhatsAppStatus {
  /** Never includes credentials — only which environment variables are missing. */
  provider: { name: string; configured: boolean; setup?: { reason: string; wanted: string | null; missing: string[] } };
  enabled: boolean; available: boolean;
  webhook: { path: string; secretSet: boolean };
  members: { withPhone: number; marketingOptedIn: number; optedOut: number };
  templates: Record<WhatsAppApproval, number>;
  last7Days: Record<string, number>;
}
export interface WhatsAppRegistryRow {
  id: string; provider: string; providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory;
  variables: string[]; approvalStatus: WhatsAppApproval; lastSyncedAt: string | null; updatedAt: string | null;
}
export interface WhatsAppExpected {
  templateKey: string; providerTemplateName: string; language: CommsLocale; category: WhatsAppCategory;
  variables: string[]; body: string; registered: { id: string; approvalStatus: WhatsAppApproval } | null;
}
export interface WhatsAppRegistry { provider: string; templates: WhatsAppRegistryRow[]; expected: WhatsAppExpected[] }
export interface CommsTemplateValues { offerName?: string; discount?: string; amountTzs?: number }
export interface CommsTemplatePreview {
  senderName: string; sampleMember: string;
  byLocale: Partial<Record<CommsLocale, {
    in_app: { title: string; body: string; ctaLabel: string | null; deepLink: CommsDeepLink };
    push: { title: string; body: string; truncated: boolean };
  }>>;
  whatsapp: { ready: boolean; byLocale: Partial<Record<CommsLocale, { ready: boolean; reason?: string }>> };
  needsValues: string[];
}
/** Who a FitFlex message goes to; gym messages always go to members. */
export type CommsRecipients = 'members' | 'trainers';
export interface CommsAudience { preset?: string | null; filter?: unknown; recipients?: CommsRecipients }
export interface CommsDraft {
  gymId?: string; name?: string; purpose?: CommsPurpose; audience?: CommsAudience;
  content?: CommsContent; channels?: CommsChannel[]; templateId?: string | null;
}
export interface CommsCounts {
  targeted: number; queued: number; skipped: Record<string, number>;
  byChannel: Partial<Record<CommsChannel, { queued: number; skipped: number }>>;
}
export interface CommsCampaign {
  id: string; senderType: 'gym' | 'platform'; gymId: string | null; name: string; purpose: CommsPurpose;
  category: 'transactional' | 'marketing'; status: CommsStatus; audience?: CommsAudience; content?: CommsContent;
  channels: CommsChannel[]; scheduledAt: string | null; sentAt: string | null; createdAt: string;
  counts: CommsCounts | null; title?: string | null; preset?: string | null; recipients?: CommsRecipients; templateId?: string | null;
  /** History: who created it and its delivery numbers from the ledger. */
  createdByName?: string | null; stats?: CommsStats | null;
  template?: { id: string; key: string; name: string; system: boolean } | null;
}
export type CommsMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'clicked' | 'failed' | 'skipped';
export interface CommsTotals { pending: number; sent: number; delivered: number; opened: number; clicked: number; failed: number; skipped: number }
export interface CommsStats {
  targeted?: number; messages: number;
  byChannel: Partial<Record<CommsChannel, Partial<Record<CommsMessageStatus | 'opened', number>>>>;
  totals: CommsTotals;
}
export interface CommsMessage {
  id: string; campaignId: string | null; automationRunId: string | null; campaignName: string | null;
  senderType: 'gym' | 'platform'; gymId: string | null; memberId: string; memberName: string | null;
  channel: CommsChannel; category: 'transactional' | 'marketing'; messageType: CommsPurpose;
  title: string; body: string; locale: string | null; deepLink: string | null;
  status: CommsMessageStatus; skipReason: string | null; failureReason: string | null; failurePermanent: boolean; attempts: number;
  /** Who delivered it and their reference — never credentials. */
  provider: { name: 'inbox' | 'fcm' | 'whatsapp'; messageId: string | null; templateName?: string | null; language?: string | null; devices?: number | null; failedDevices?: number; errors?: string[]; parameters?: string[] };
  createdAt: string | null; sentAt: string | null; deliveredAt: string | null; openedAt: string | null;
  clickedAt: string | null; failedAt: string | null; nextAttemptAt: string | null;
  /** Only on a single message. */
  notificationId?: string | null;
  campaign?: { id: string; name: string; purpose: CommsPurpose; status: CommsStatus } | null;
  template?: { id: string; key: string | null; name: string | null; system: boolean } | null;
}
export type CommsOutcome = 'reached' | 'pending' | 'failed' | 'skipped';
/** Results. A null count means there's no data for it (shown as "—"), never zero. */
export interface CommsResults {
  period?: { from: string; to: string; days?: number };
  attribution: { model: 'last_touch'; clickWindowDays: number; openWindowDays: number };
  members: {
    recipients: number; sent: number; delivered: number | null; failed: number;
    opened: number; clicked: number; ctaCompleted?: number | null; renewed: number; paid: number;
  };
  revenue: { currency: 'TZS'; attributedTzs: number; payments: number };
  channels: Partial<Record<CommsChannel, { messages: number; sent: number; delivered: number | null; opened: number; clicked: number; failed: number; skipped: number; pending: number }>>;
  reasons?: { failed: Record<string, number>; skipped: Record<string, number> };
  conversions?: Array<{ paymentId: string; memberId: string; memberName: string | null; amountTzs: number; paidAt: string | null; via: 'click' | 'open'; touchAt: string | null; renewal: boolean }>;
  sources?: Array<{
    type: 'campaign' | 'automation'; id: string; name: string | null; purpose?: CommsPurpose | null; trigger?: CommsAutomationTrigger | null;
    offsetDays?: number | null; lastSentAt: string | null; recipients: number; sent: number; opened: number; clicked: number; paid: number; attributedTzs: number;
  }>;
}
export type CommsAutomationTrigger = 'membership_activated' | 'membership_expiring' | 'membership_expired' | 'payment_failed' | 'member_inactive';
export interface CommsAutomation {
  id: string; gymId: string; name: string; trigger: CommsAutomationTrigger; offsetDays: number;
  conditions: Record<string, unknown> | null; channels: CommsChannel[];
  /** 'paused' = stopped by the engine; see pausedReason. */
  status: 'enabled' | 'disabled' | 'paused'; pausedReason: string | null;
  template: { id: string; key: string | null; name: string | null; system: boolean; purpose: CommsPurpose | null } | null;
  lastRunAt: string | null; updatedAt: string | null;
  stats?: { fired: number; skipped: number; messages: number; reached: number; failed: number; opened: number };
}
export interface CommsAutomationRun {
  id: string; memberId: string; memberName: string | null; occurrenceKey: string; status: 'queued' | 'skipped';
  context: Record<string, unknown> | null; createdAt: string | null;
  channels: Array<{ id: string; channel: CommsChannel; status: CommsMessageStatus; reason: string | null }>;
}
export interface CommsTimelineItem {
  key: string; campaignId: string | null; automationRunId: string | null; campaignName: string | null;
  memberId: string; memberName: string | null; category: string; messageType: CommsPurpose;
  title: string; body: string; locale: string | null; createdAt: string | null; outcome: CommsOutcome; channels: CommsMessage[];
}
export interface CommsRecipient { memberId: string; memberName: string | null; outcome: CommsOutcome; channels: CommsMessage[] }
export interface CommsHistoryFilters {
  memberId?: string; campaignId?: string; channel?: string; category?: string; messageType?: string;
  status?: string; from?: string; to?: string; search?: string; gymId?: string; cursor?: string; limit?: number;
}
export interface CommsOverview {
  senderType: 'gym' | 'platform'; members: number | null;
  /** FitFlex only: active trainers FitFlex can message. */
  trainers?: number | null;
  campaigns: Partial<Record<CommsStatus, number>>;
  recent: CommsCampaign[]; channels: Record<CommsChannel, boolean>;
  limits: { largeSendThreshold: number; marketingWeeklyCap: number };
}
export interface CommsCatalog {
  scope: 'gym' | 'platform' | 'trainers';
  presets: Array<{ key: string; filter: unknown }>;
  fields: Array<{ key: string; type: string; ops: string[]; values?: string[] }>;
}
export interface CommsAudiencePreview {
  count: number; category: string;
  channels: Record<CommsChannel, { eligible: number; excluded: Record<string, number> }>;
  sample: Array<{ id: string; displayName: string | null; status: string }>;
}
export interface CommsPreview {
  category: string; counts: CommsCounts; largeSendThreshold: number;
  example: { memberName: string | null; title: string; body: string; ctaLabel: string | null; deepLink: CommsDeepLink } | null;
  warnings: Array<{ code: string; count?: number; channel?: CommsChannel }>;
}

// ── Partner KYC / KYB ────────────────────────────────────────────────────
export type KycPartnerType = 'gym_owner' | 'trainer' | 'vendor' | 'corporate';
export type KycCaseStatus = 'draft' | 'submitted' | 'in_review' | 'info_requested' | 'approved' | 'rejected' | 'suspended';
export type KycDecision = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate' | 'reopen';
export type KycItemStatus = 'complete' | 'submitted' | 'missing' | 'incomplete' | 'file_missing' | 'rejected' | 'expired' | 'failed' | 'mismatch';

export interface KycCaseRow {
  id: string;
  partnerType: KycPartnerType;
  subjectId: string;
  partnerName: string | null;
  legalName: string | null;
  status: KycCaseStatus;
  tier: number;
  round: number;
  submittedAt: string | null;
  updatedAt: string;
  createdAt: string;
  /** Uploaded documents waiting for review (e.g. renewals on an approved case). */
  documentsToReview?: number;
}

export interface KycAddress { line1?: string; line2?: string; city?: string; region?: string; country?: string; postalCode?: string }

export interface KycCase {
  id: string;
  partnerType: KycPartnerType;
  userId: string | null;
  corporateId: string | null;
  status: KycCaseStatus;
  tier: number;
  round: number;
  legalName: string | null;
  tradingName: string | null;
  entityType: string | null;
  registrationNumber: string | null;
  registrationAuthority: string | null;
  incorporatedOn: string | null;
  registeredAddress: KycAddress | null;
  businessActivity: string | null;
  tin: string | null;
  submittedAt: string | null;
  reviewerId: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  reverifyAt: string | null;
  updatedAt: string;
}

export interface KycPerson {
  id: string;
  role: string;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  idType: string | null;
  idNumber: string | null;
  idExpiresOn: string | null;
  phone: string | null;
  email: string | null;
  address: KycAddress | null;
  position: string | null;
  relationship: string | null;
  authority: string | null;
  ownershipPct: number | null;
  status: string;
}

export interface KycDocument {
  id: string;
  requirementKey: string;
  docType: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
  hasFile: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  documentNumber: string | null;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  details: Record<string, unknown>;
  reviewNote: string | null;
  reviewedAt: string | null;
  supersedesId: string | null;
  round: number;
  createdAt: string;
}

export interface KycSettlementAccount {
  id: string;
  method: 'bank' | 'mobile_money';
  provider: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  currency: string;
  status: 'pending_verification' | 'verified' | 'rejected' | 'disabled';
  isPrimary: boolean;
  createdAt: string;
}

export interface KycCheck {
  id: string;
  checkType: string;
  targetType: string;
  targetId: string | null;
  method: string;
  provider: string | null;
  result: 'pending' | 'passed' | 'failed' | 'inconclusive';
  evidence: Record<string, unknown>;
  note: string | null;
  performedAt: string | null;
  createdAt: string;
}

export interface KycEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  targetType: string | null;
  targetId: string | null;
  actorId: string | null;
  actorRole: string | null;
  reasonCode: string | null;
  note: string | null;
  data: Record<string, unknown>;
  at: string;
}

export interface KycChecklistItem {
  key: string;
  by: 'partner' | 'reviewer';
  status: KycItemStatus;
  gymId?: string;
  gymName?: string;
  requirementKey?: string;
  /** Collected if given, never required (e.g. a vendor's business licence). */
  optional?: boolean;
  missingFields?: string[];
  note?: string | null;
  expiresOn?: string | null;
  score?: number;
  maxScore?: number | null;
  gymTier?: string | null;
  vettedTier?: string;
  expectedIdType?: string;
}

export interface KycChecklist {
  partnerType: KycPartnerType;
  tier: number;
  sections: Array<{ key: string; items: KycChecklistItem[] }>;
  missing: string[];
  awaitingReview: string[];
  readyToSubmit: boolean;
  complete: boolean;
}

export interface KycCaseDetail {
  partnerType: KycPartnerType;
  case: KycCase;
  people: KycPerson[];
  documents: KycDocument[];
  settlementAccounts: KycSettlementAccount[];
  checklist: KycChecklist;
  checks: KycCheck[];
  agreements: Array<{ id: string; agreementType: string; version: string; status: string; acceptedAt: string; acceptedIp?: string | null; acceptedUserAgent?: string | null }>;
  events: KycEvent[];
}

// ─── Gym settlements ───
export type SettlementMode = 'live' | 'shadow';
export type GymSettlementStatus = 'draft' | 'submitted' | 'approved' | 'payable' | 'paid' | 'voided';
export type SettlementStep = 'submit' | 'reject' | 'approve' | 'hold' | 'release' | 'payable' | 'pay' | 'void';

export interface SettlementRunException { subscriptionId: string; memberId: string; reason: string; missing?: string[] }

export interface SettlementRun {
  id: string;
  mode: SettlementMode;
  periodStartDate: string;
  periodEndDate: string;
  status: 'draft' | 'locked' | 'failed';
  engineVersion: string;
  error?: string | null;
  createdAt?: string;
  lockedAt?: string | null;
  configurationSnapshot?: {
    stats?: { candidateCycles: number; settledCycles: number; skippedCycles: number; statements: number; b2bCycles: number; payableVisits: number; totalPreliminaryTzs: number; totalFinalTzs: number };
    exceptions?: SettlementRunException[];
  } | null;
}

export interface GymSettlement {
  id: string;
  runId: string;
  mode: SettlementMode;
  gymId: string;
  gymName: string | null;
  periodStartDate: string;
  periodEndDate: string;
  memberCycleCount: number;
  qualifyingVisitCount: number;
  heldVisitCount: number;
  preliminaryTzs: number;
  networkAdjustmentTzs: number;
  adjustmentsTzs: number;
  carryForwardTzs: number;
  finalNetTzs: number;
  status: GymSettlementStatus;
  holdReason?: string | null;
  rejectReason?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  destinationSnapshot?: { accountLast4?: string; method?: string; provider?: string; accountName?: string } | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paymentReference?: string | null;
  receiptUrl?: string | null;
}

export interface GymSettlementLine {
  id: string;
  memberId: string;
  member: { publicId: string | null; displayName: string | null } | null;
  fundingType: 'platform_pass' | 'b2b_benefit' | null;
  qualifyingVisitCount: number;
  heldVisitCount: number;
  bracket: string | null;
  rawPreliminaryTzs: number;
  preliminaryTzs: number;
  monotonicGuardApplied: boolean;
  networkAdjustmentTzs: number;
  finalTzs: number;
  rateCardSnapshot?: { wholesaleDailyTzs?: number; wholesaleWeeklyTzs?: number; wholesaleMonthlyTzs?: number } | null;
}

export interface SettlementVisit {
  id: string;
  lineId: string | null;
  checkinId: string;
  businessDate: string | null;
  outcome: string;
  eligibility: string;
  allowanceSlot: number | null;
}

export interface SettlementAdjustment {
  id: string;
  gymSettlementId: string;
  amountTzs: number;
  type: 'correction' | 'clawback' | 'manual' | 'carry_forward';
  reason: string;
  status: 'proposed' | 'applied' | 'rejected' | 'voided';
  createdBy: string;
  createdAt?: string;
  appliedAt?: string | null;
  rejectReason?: string | null;
}

export interface GymSettlementDetail {
  statement: GymSettlement;
  lines: GymSettlementLine[];
  visits: SettlementVisit[];
  adjustments: SettlementAdjustment[];
}

// ─── Settlement configuration ───
export type SettlementConfigKind = 'pass-tiers' | 'rules' | 'rate-cards';
export type SettlementConfigStatus = 'draft' | 'active' | 'rejected';
export type SettlementRuleScope = 'global' | 'pass_tier' | 'gym_tier' | 'gym';

interface SettlementConfigRow {
  id: string;
  version: number;
  status: SettlementConfigStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reason: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt?: string;
}

export interface PassTierVersion extends SettlementConfigRow { tierKey: string; priceTzs: number; visitAllowance: number }

export interface SettlementRuleValues {
  networkPayoutBps: number | null;
  dailyDiscountBps: number | null; weeklyDiscountBps: number | null; monthlyDiscountBps: number | null;
  dailyCeilingTzs: number | null; weeklyCeilingTzs: number | null; monthlyCeilingTzs: number | null;
}

export interface SettlementRule extends SettlementConfigRow, SettlementRuleValues {
  name: string | null;
  scopeType: SettlementRuleScope | 'special_contract';
  scopeId: string | null;
}

export interface GymRateCard extends SettlementConfigRow, Omit<SettlementRuleValues, 'networkPayoutBps'> {
  gymId: string;
  gymTier: string;
  retailDailyTzs: number; retailWeeklyTzs: number; retailMonthlyTzs: number;
}

export interface SettlementConfig { passTierVersions: PassTierVersion[]; rules: SettlementRule[]; rateCards: GymRateCard[] }

// ─── Gym settlements, as the gym's owner sees them ───
export type OwnerStatementStatus = 'preparing' | 'in_review' | 'approved' | 'payment_due' | 'paid';

export interface OwnerStatement {
  id: string;
  gymId: string;
  gymName: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: OwnerStatementStatus;
  onHold: boolean;
  members: number;
  visits: number;
  earnedTzs: number;
  networkAdjustmentTzs: number;
  adjustmentsTzs: number;
  carriedForwardTzs: number;
  payableTzs: number;
  paidAt: string | null;
  paymentReference: string | null;
  receiptUrl: string | null;
  payoutAccountLast4: string | null;
}

export interface OwnerStatementLine {
  memberCode: string | null;
  funding: 'pass' | 'sponsored';
  visits: number;
  visitDates: string[];
  bracket: string | null;
  rates: { dailyTzs: number; weeklyTzs: number; monthlyTzs: number } | null;
  earnedTzs: number;
  networkAdjustmentTzs: number;
  finalTzs: number;
}

export interface OwnerStatementDetail {
  statement: OwnerStatement;
  lines: OwnerStatementLine[];
  adjustments: Array<{ amountTzs: number; type: string; reason: string; appliedAt: string | null }>;
}

export interface SettlementClawbackItem {
  gymId: string;
  gymName: string | null;
  memberCycleSettlementId: string;
  amountTzs: number;
  type: 'clawback' | 'correction';
  reason: string;
}

export interface SettlementClawbacks {
  raised: SettlementClawbackItem[];
  pending: SettlementClawbackItem[];
  skipped: Array<{ memberCycleSettlementId: string; memberId: string; reason: string }>;
}
