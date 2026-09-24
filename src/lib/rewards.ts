import type { RewardItem, RewardRule, RewardStatus, RewardType } from '@/lib/api';

export const REWARD_TYPES: { value: RewardType; label: string; valueHint: string }[] = [
  { value: 'gym_pass', label: 'Gym pass', valueHint: 'e.g. 7 days' },
  { value: 'points', label: 'FitFlex points', valueHint: 'e.g. 500' },
  { value: 'discount', label: 'Discount', valueHint: 'e.g. 20%' },
  { value: 'trainer_session', label: 'Trainer session', valueHint: 'e.g. 1 session' },
  { value: 'vendor_voucher', label: 'Vendor voucher', valueHint: 'e.g. TSh 20,000' },
  { value: 'corporate_reward', label: 'Company reward', valueHint: 'e.g. 1 day off' },
  { value: 'badge', label: 'Badge', valueHint: '' },
  { value: 'certificate', label: 'Certificate', valueHint: '' },
  { value: 'other', label: 'Other', valueHint: '' },
];

export const typeLabel = (t: RewardType) => REWARD_TYPES.find(x => x.value === t)?.label ?? t;

export const RULES: { value: RewardRule; label: string }[] = [
  { value: 'finishers', label: 'Everyone who finishes' },
  { value: 'top', label: 'Top places' },
  { value: 'team', label: 'Winning team' },
];

/** Who earns it, in words: "Everyone who finishes", "Top 3", "Winning team". */
export function ruleLabel(r: Pick<RewardItem, 'rule' | 'topN'>) {
  if (r.rule === 'top') return `Top ${r.topN ?? ''}`.trim();
  if (r.rule === 'team') return 'Winning team';
  return 'Everyone who finishes';
}

/** Why this member earned it. */
export function reasonLabel(rule: RewardRule, rank: number | null) {
  if (rule === 'top') return rank ? `Placed #${rank}` : 'Top place';
  if (rule === 'team') return 'Winning team';
  return 'Finished';
}

export const STATUS: Record<RewardStatus, { label: string; tone: 'warning' | 'brand' | 'success' | 'danger' }> = {
  pending: { label: 'Pending fulfilment', tone: 'warning' },
  approved: { label: 'Approved', tone: 'brand' },
  issued: { label: 'Issued', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};
