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

async function request<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
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

export const api = {
  firebaseSession: (idToken: string, requestedRole: 'member' | 'trainer' | 'gym_owner' | 'gym_operator' | 'admin' = 'gym_operator') =>
    request<{ token: string; user: { id: string; userType: string; gymId?: string; email?: string; portalUser?: boolean; aclPermissions?: string[] } }>(
      '/auth/firebase/session', { method: 'POST', body: JSON.stringify({ idToken, requestedRole }) }
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
  commsSegments: (token: string, scope: CommsScope) =>
    request<CommsCatalog>(`/${scope}/communications/segments`, {}, token),
  commsAudiencePreview: (token: string, scope: CommsScope, body: { gymId?: string; preset?: string | null; filter?: unknown; purpose?: string }) =>
    request<CommsAudiencePreview>(`/${scope}/communications/audience/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsCampaigns: (token: string, scope: CommsScope, opts: { gymId?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.gymId) q.set('gymId', opts.gymId);
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return request<{ campaigns: CommsCampaign[] }>(`/${scope}/communications/campaigns${qs ? `?${qs}` : ''}`, {}, token);
  },
  commsCampaign: (token: string, scope: CommsScope, id: string) =>
    request<{ campaign: CommsCampaign; progress: Record<string, Record<string, number>> }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, {}, token),
  commsPreviewDraft: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<CommsPreview>(`/${scope}/communications/campaigns/preview`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsCreate: (token: string, scope: CommsScope, body: CommsDraft) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns`, { method: 'POST', body: JSON.stringify(body) }, token),
  commsUpdate: (token: string, scope: CommsScope, id: string, body: Partial<CommsDraft>) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token),
  commsDelete: (token: string, scope: CommsScope, id: string) =>
    request<{ ok: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),
  commsAction: (token: string, scope: CommsScope, id: string, action: 'cancel' | 'unschedule') =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, token),
  commsSchedule: (token: string, scope: CommsScope, id: string, scheduledAt: string) =>
    request<{ campaign: CommsCampaign }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) }, token),
  commsSend: (token: string, scope: CommsScope, id: string, sendRequestId: string, confirmLargeSend = false) =>
    request<{ campaign: CommsCampaign; replayed?: boolean }>(`/${scope}/communications/campaigns/${encodeURIComponent(id)}/send`, {
      method: 'POST', body: JSON.stringify({ sendRequestId, ...(confirmLargeSend ? { confirmLargeSend: true } : {}) }),
    }, token),

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
  /** Internal product analytics (aggregates only). Days are member-local (EAT), inclusive. */
  adminAnalytics: (token: string, from: string, to: string) => {
    const qs = new URLSearchParams({ from, to });
    return request<AnalyticsOverview>(`/admin/analytics?${qs}`, {}, token);
  },
  /** Full gym record (with `images`/`thumbnails`) — fetch on demand for the detail/edit views. */
  getGym: (id: string) => request<Gym>(`/gyms/${id}`),
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
  updateAdminVendor: (token: string, id: string, patch: Partial<Pick<VendorSummary, 'approvalStatus' | 'accountStatus' | 'verified' | 'approvalNote'>>) =>
    request<VendorSummary>(`/admin/vendors/${id}`, { method: 'PUT', body: JSON.stringify(patch) }, token),
  trainerBookings: (token: string) => request<TrainerBooking[]>('/admin/trainer-bookings', {}, token),
  updateTrainerBooking: (token: string, id: string, status: 'confirmed' | 'completed' | 'cancelled') =>
    request<TrainerBooking>(`/admin/trainer-bookings/${id}`, { method: 'POST', body: JSON.stringify({ status }) }, token),
  paymentRequests: (token: string) => request<PaymentRequest[]>('/admin/payment-requests', {}, token),
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
  ownerCreateStaff: (token: string, data: { displayName: string; email: string; initialPassword: string; gymIds: string[]; aclPermissions: string[] }) =>
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

export interface PaymentRequest {
  id: string;
  memberId: string;
  /** Null when the request pays for a trainer booking instead. */
  subscriptionId: string | null;
  /** Set when the request pays for a group of trainer booking slots. */
  bookingGroupId?: string | null;
  plan?: string | null;
  currency?: string | null;
  tier: string | null;
  amountTzs: number;
  status: string;
  provider: string;
  reference: string | null;
  note?: string | null;
  requestedAt: string;
  decidedAt: string | null;
  member?: { email?: string | null; phone?: string | null; displayName?: string | null };
  subscription?: { tier?: string | null; status: string; renewsAt?: string } | null;
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
  verified?: boolean;
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
export interface CommsContent {
  title: string; body: string; ctaLabel?: string; deepLink?: CommsDeepLink;
  offerName?: string; discount?: string; amountTzs?: number;
}
export interface CommsAudience { preset?: string | null; filter?: unknown }
export interface CommsDraft {
  gymId?: string; name?: string; purpose?: CommsPurpose; audience?: CommsAudience;
  content?: CommsContent; channels?: CommsChannel[];
}
export interface CommsCounts {
  targeted: number; queued: number; skipped: Record<string, number>;
  byChannel: Partial<Record<CommsChannel, { queued: number; skipped: number }>>;
}
export interface CommsCampaign {
  id: string; senderType: 'gym' | 'platform'; gymId: string | null; name: string; purpose: CommsPurpose;
  category: 'transactional' | 'marketing'; status: CommsStatus; audience?: CommsAudience; content?: CommsContent;
  channels: CommsChannel[]; scheduledAt: string | null; sentAt: string | null; createdAt: string;
  counts: CommsCounts | null; title?: string | null; preset?: string | null;
}
export interface CommsOverview {
  senderType: 'gym' | 'platform'; members: number | null; campaigns: Partial<Record<CommsStatus, number>>;
  recent: CommsCampaign[]; channels: Record<CommsChannel, boolean>;
  limits: { largeSendThreshold: number; marketingWeeklyCap: number };
}
export interface CommsCatalog {
  scope: 'gym' | 'platform';
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
