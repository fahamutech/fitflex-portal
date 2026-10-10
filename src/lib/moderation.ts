// Listing moderation — labels, tones and error text for the admin screens.
import type { ModerationAction, ModerationEntityType, ModerationStatus } from './api';
import type { MessageKey } from './i18n';
import type { BadgeTone } from './admin-utils';

export const ENTITY_TYPES: ModerationEntityType[] = ['gym', 'trainer', 'vendor', 'product'];
export const STATUS_TAB_ORDER: ModerationStatus[] = ['pending', 'approved', 'rejected', 'suspended', 'hidden'];

export const TYPE_KEY: Record<ModerationEntityType, MessageKey> = {
  gym: 'mod.type.gym', trainer: 'mod.type.trainer', vendor: 'mod.type.vendor', product: 'mod.type.product',
};

export const STATUS_KEY: Record<ModerationStatus, MessageKey> = {
  pending: 'mod.status.pending', approved: 'mod.status.approved', rejected: 'mod.status.rejected',
  suspended: 'mod.status.suspended', hidden: 'mod.status.hidden',
};

export const STATUS_TONE: Record<ModerationStatus, BadgeTone> = {
  pending: 'warning', approved: 'success', rejected: 'danger', suspended: 'danger', hidden: 'gray',
};

export const ACTION_KEY: Record<ModerationAction, MessageKey> = {
  approve: 'mod.action.approve', reject: 'mod.action.reject', suspend: 'mod.action.suspend', hide: 'mod.action.hide',
  restore: 'mod.action.restore', reopen: 'mod.action.reopen', require_review: 'mod.action.require_review',
};

export const ACTION_HINT_KEY: Record<ModerationAction, MessageKey> = {
  approve: 'mod.action.approve.hint', reject: 'mod.action.reject.hint', suspend: 'mod.action.suspend.hint', hide: 'mod.action.hide.hint',
  restore: 'mod.action.restore.hint', reopen: 'mod.action.reopen.hint', require_review: 'mod.action.require_review.hint',
};

/** Actions that take a listing out of public view. Shown in the danger tone. */
export const DESTRUCTIVE: ModerationAction[] = ['reject', 'suspend', 'hide'];

const WHY: Record<string, MessageKey> = {
  moderation_pending: 'mod.why.moderation_pending', moderation_rejected: 'mod.why.moderation_rejected',
  moderation_suspended: 'mod.why.moderation_suspended', moderation_hidden: 'mod.why.moderation_hidden',
  gym_not_active: 'mod.why.gym_not_active', trainer_not_active: 'mod.why.trainer_not_active',
  trainer_not_approved: 'mod.why.trainer_not_approved', not_visible: 'mod.why.not_visible',
  vendor_not_approved: 'mod.why.vendor_not_approved', vendor_suspended: 'mod.why.vendor_suspended',
  vendor_not_published: 'mod.why.vendor_not_published', vendor_not_operational: 'mod.why.vendor_not_operational',
  product_not_active: 'mod.why.product_not_active', product_not_approved: 'mod.why.product_not_approved',
  product_hidden: 'mod.why.product_hidden', product_deleted: 'mod.why.product_deleted', entity_not_found: 'mod.why.entity_not_found',
};
/** The words for a reason an entity can't be listed or promoted; an unknown code is shown as it is. */
export const whyKey = (code: string): MessageKey | null => WHY[code] ?? null;

const ERRORS: Record<string, MessageKey> = {
  reason_required: 'mod.err.reason_required', invalid_transition: 'mod.err.invalid_transition',
  entity_not_found: 'mod.err.entity_not_found', acl_forbidden: 'mod.err.acl_forbidden',
};
export function errorKey(err: unknown): MessageKey {
  const code = (err as { body?: { error?: string } })?.body?.error ?? '';
  return ERRORS[code] ?? 'mod.err.generic';
}

export const dateTime = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
