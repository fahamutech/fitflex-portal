// Labels and small helpers for partner KYC review screens.
import type { BadgeTone } from '@/lib/admin-utils';
import type { KycCaseStatus, KycDecision, KycItemStatus, KycPartnerType } from '@/lib/api';

export const PARTNER_TYPE_LABEL: Record<KycPartnerType, string> = {
  gym_owner: 'Gym owner', trainer: 'Trainer', vendor: 'Vendor', corporate: 'Company',
};

export const CASE_STATUS: Record<KycCaseStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  submitted: { label: 'Submitted', tone: 'warning' },
  in_review: { label: 'In review', tone: 'brand' },
  info_requested: { label: 'Info requested', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

// The order reviewers work through: what needs them first.
export const QUEUE_TABS: KycCaseStatus[] = ['submitted', 'in_review', 'info_requested', 'approved', 'suspended', 'rejected', 'draft'];

export const ITEM_STATUS: Record<KycItemStatus, { label: string; tone: BadgeTone }> = {
  complete: { label: 'Done', tone: 'success' },
  submitted: { label: 'To review', tone: 'brand' },
  missing: { label: 'Missing', tone: 'gray' },
  incomplete: { label: 'Incomplete', tone: 'warning' },
  file_missing: { label: 'File missing', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  mismatch: { label: 'Tier mismatch', tone: 'warning' },
};

export const SECTION_LABEL: Record<string, string> = {
  identity: 'Identity', business: 'Business', operational: 'Operations', settlement: 'Payout',
  professional: 'Professional', representative: 'Representative', marketplace: 'Marketplace',
  company: 'Company', commercial: 'Commercial', agreements: 'Agreements',
};

const ITEM_LABEL: Record<string, string> = {
  fullName: 'Full legal name', idNumber: 'ID number', phone: 'Phone', email: 'Email', address: 'Address',
  relationship: 'Relationship to the business', position: 'Position', authority: 'Signing authority',
  id_document: 'ID document', legalName: 'Legal name', tradingName: 'Trading name',
  registrationNumber: 'Registration number', tin: 'TIN', registeredAddress: 'Business address',
  businessActivity: 'Business activity', registration_certificate: 'Registration certificate',
  tin_certificate: 'TIN certificate', licence: 'Business licence', gym_location: 'Gym location',
  gym_profile: 'Gym profile', rate_card: 'Rate card', site_verification: 'Site verification',
  vetting_score: 'Vetting score', gym_tier: 'Gym tier', payout_account: 'Payout account',
  certification: 'Certification', specialisation: 'Specialisation', liability_cover: 'Liability cover',
  contact: 'Contact', authority_document: 'Proof of authority', product_categories: 'Product categories',
  delivery: 'Delivery', returns: 'Returns policy', settlement: 'Settlement account',
  seats: 'Seats', pass_tier: 'Pass tier', subsidy: 'Subsidy', billing_cycle: 'Billing cycle',
  contract: 'Signed contract', billing_contact: 'Billing contact',
  partner_terms: 'Partner terms', kyc_consent: 'Verification consent',
};

/** "business.tin_certificate" → "TIN certificate". */
export function itemLabel(key: string) {
  const field = key.split('.').pop() ?? key;
  return ITEM_LABEL[field] ?? field.replace(/_/g, ' ');
}

export const AGREEMENT_LABEL: Record<string, string> = {
  partner_agreement: 'Partner terms', kyc_consent: 'Verification consent', corporate_contract: 'Corporate contract',
  platform_terms: 'Platform terms', commission_schedule: 'Commission schedule', data_processing: 'Data processing',
};

export const REQUIREMENT_LABEL: Record<string, string> = {
  owner_id: 'Owner ID', trainer_id: 'Trainer ID', representative_id: 'Representative ID',
  business_registration: 'Registration certificate', tin_certificate: 'TIN certificate',
  business_licence: 'Business licence', certification: 'Certification', liability_insurance: 'Liability cover',
  representative_authority: 'Proof of authority',
};

export const DECISION_COPY: Record<KycDecision, { title: string; action: string; needsReason: boolean; hint: string }> = {
  approve: { title: 'Approve verification', action: 'Approve', needsReason: false, hint: 'The partner becomes verified and is told.' },
  request_info: { title: 'Ask for more information', action: 'Send request', needsReason: true, hint: 'The partner can update their details and submit again.' },
  reject: { title: 'Reject verification', action: 'Reject', needsReason: true, hint: 'This closes the partner role: they can no longer sign in to it. Use “Ask for more information” for anything they can fix.' },
  suspend: { title: 'Suspend verification', action: 'Suspend', needsReason: true, hint: 'The partner stays approved but is marked suspended.' },
  reinstate: { title: 'Reinstate verification', action: 'Reinstate', needsReason: false, hint: 'Needs every checklist item complete again.' },
  reopen: { title: 'Reopen verification', action: 'Reopen', needsReason: false, hint: 'Starts a fresh round; the partner can update and resubmit.' },
};

export const REASON_LABEL: Record<string, string> = {
  document_unreadable: 'Document unreadable',
  document_expired: 'Document expired',
  document_mismatch: 'Document doesn’t match the details',
  identity_unverified: 'Identity not verified',
  business_unverified: 'Business not verified',
  tax_unverified: 'TIN not verified',
  site_visit_failed: 'Site visit failed',
  settlement_unverified: 'Payout account not verified',
  suspected_fraud: 'Suspected fraud',
  duplicate_partner: 'Duplicate partner',
  incomplete_submission: 'Incomplete submission',
  other: 'Other',
};

export const GYM_TIERS = ['standard', 'midtier', 'premium', 'luxury_executive', 'online'] as const;
export const GYM_TIER_LABEL: Record<string, string> = {
  online: 'Online', standard: 'Standard', midtier: 'Mid-tier', premium: 'Premium', luxury_executive: 'Luxury / Executive',
};

const ERRORS: Record<string, string> = {
  invalid_transition: 'That case has already moved on. Refresh to see where it stands.',
  kyc_incomplete: 'Some checklist items aren’t complete yet.',
  reason_code_required: 'Choose a reason.',
  override_requires_super_admin: 'Only a full admin can approve an incomplete case.',
  override_reason_required: 'Write why you’re approving an incomplete case.',
  cannot_review_own_case: 'You can’t review your own verification.',
  case_not_in_review: 'Take the case into review first.',
  document_has_no_file: 'This document has no file yet, so it can’t be accepted.',
  document_already_reviewed: 'That document has already been reviewed.',
  note_required: 'Add a note. The partner will see it.',
  cannot_verify_own_request: 'You added this account, so someone else has to verify it.',
  invalid_score: 'Enter a score of 0 or more.',
  invalid_maxScore: 'The score can’t be more than the maximum.',
  invalid_tier: 'Choose a tier.',
  gym_has_no_owner: 'This gym has no owner account to attach the visit to.',
  storage_service_unavailable: 'Document storage isn’t available right now.',
  storage_download_failed: 'The file couldn’t be fetched from storage. Try again.',
  file_integrity_failed: 'The stored file doesn’t match what was uploaded, so it isn’t shown.',
  case_not_found: 'That case doesn’t exist.',
  acl_forbidden: 'You don’t have access to partner verification.',
};

export function errorMessage(err: unknown) {
  const code = (err as { body?: { error?: string } })?.body?.error ?? '';
  return ERRORS[code] ?? 'Something went wrong.';
}

export const day = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const dateTime = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function addressLine(a: { line1?: string; line2?: string; city?: string; region?: string; country?: string } | null | undefined) {
  if (!a) return '—';
  return [a.line1, a.line2, a.city, a.region, a.country].filter(Boolean).join(', ') || '—';
}

/** What a timeline event says, in a line. */
export function eventLine(e: { eventType: string; fromStatus: string | null; toStatus: string | null; data: Record<string, unknown> }) {
  const d = e.data || {};
  switch (e.eventType) {
    case 'status_changed':
      return e.fromStatus ? `${CASE_STATUS[e.fromStatus as KycCaseStatus]?.label ?? e.fromStatus} → ${CASE_STATUS[e.toStatus as KycCaseStatus]?.label ?? e.toStatus}${d.override ? ' (override)' : ''}` : 'Case opened';
    case 'document_uploaded': return `File uploaded: ${REQUIREMENT_LABEL[String(d.requirementKey)] ?? d.requirementKey}${d.sameFileOnAnotherCase ? ' — same file is on another partner’s case' : ''}`;
    case 'document_updated': return `Document details updated: ${REQUIREMENT_LABEL[String(d.requirementKey)] ?? d.requirementKey}`;
    case 'document_reviewed': return `Document ${d.decision === 'accept' ? 'accepted' : 'rejected'}: ${REQUIREMENT_LABEL[String(d.requirementKey)] ?? d.requirementKey}`;
    case 'person_updated': return 'Identity details updated';
    case 'profile_updated': return 'Business details updated';
    case 'settlement_account_changed': return `Payout account ${d.change ?? 'changed'}${d.primary ? ' (now the payout account)' : ''}`;
    case 'check_recorded': return `Site visit recorded: ${d.result ?? ''}${d.tier ? `, ${GYM_TIER_LABEL[String(d.tier)] ?? d.tier}` : ''}`;
    case 'agreement_accepted': return d.agreementType && d.agreementType !== 'corporate_contract'
      ? `Accepted ${AGREEMENT_LABEL[String(d.agreementType)] ?? d.agreementType} (${d.version ?? ''})`
      : `Contract recorded: ${d.version ?? ''}`;
    case 'reviewer_assigned': return 'Reviewer changed';
    default: return e.eventType.replace(/_/g, ' ');
  }
}
