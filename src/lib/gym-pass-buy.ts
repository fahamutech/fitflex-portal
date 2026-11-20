// Buying a custom gym pass on the web (flags NEXT_PUBLIC_GYM_CUSTOM_PASSES + NEXT_PUBLIC_MEMBER_PORTAL): the public gym
// page (/g) lists the gym's passes; "Buy" remembers the chosen one for this tab and goes to the member portal, where the
// person signs in and pays. What is remembered is only what the public page already showed (no token, no contact); the
// server sets the price and refuses a stale one (expectedPriceTzs).
import type { DurationUnit, PassCategory } from './gym-passes';

/** A gym's custom pass as POST /public/gyms/resolve lists it (`membership.gymPasses`). Never the gym id. */
export interface WebGymPass {
  planId: string;
  name: string;
  description: string | null;
  category: PassCategory;
  durationValue: number;
  durationUnit: DurationUnit;
  beneficiaryLimit: number;
  priceTzs: number;
  terms: string | null;
  termsVersion: number | null;
}

export interface BuyIntent { plan: WebGymPass; gymName: string }

const KEY = 'ff_gym_pass_buy';
const MAX_AGE_MS = 30 * 60_000;
const CATEGORIES: readonly string[] = ['individual', 'couples', 'group'];
const UNITS: readonly string[] = ['days', 'weeks', 'months'];

/** Only a well-formed pass is shown or remembered: the answer comes from the network and the copy from storage. */
export function isWebGymPass(p: unknown): p is WebGymPass {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  return typeof x.planId === 'string' && !!x.planId && typeof x.name === 'string' && !!x.name
    && CATEGORIES.includes(x.category as string) && UNITS.includes(x.durationUnit as string)
    && Number.isInteger(x.durationValue) && (x.durationValue as number) > 0
    && Number.isInteger(x.beneficiaryLimit) && (x.beneficiaryLimit as number) >= 1
    && Number.isFinite(x.priceTzs) && (x.priceTzs as number) > 0;
}

export function saveBuyIntent(plan: WebGymPass, gymName: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ plan, gymName, at: Date.now() })); } catch { /* storage blocked: nothing to continue from */ }
}

export function loadBuyIntent(): BuyIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { plan?: unknown; gymName?: unknown; at?: unknown };
    if (!isWebGymPass(v.plan) || typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) { clearBuyIntent(); return null; }
    return { plan: v.plan, gymName: typeof v.gymName === 'string' ? v.gymName : '' };
  } catch { return null; }
}

export function clearBuyIntent(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* blocked */ }
}

/** How many OTHER people the buyer names at checkout (the buyer is always the first person covered). */
export function othersRange(plan: Pick<WebGymPass, 'category' | 'beneficiaryLimit'>): { min: number; max: number } {
  if (plan.category === 'individual') return { min: 0, max: 0 };
  if (plan.category === 'couples') return { min: 1, max: 1 };
  return { min: 2, max: Math.max(2, plan.beneficiaryLimit - 1) };
}

/** A typed phone number or email as the server takes it; null when empty. The server validates the value itself. */
export function contactOf(typed: string): { phone: string } | { email: string } | null {
  const v = typed.trim();
  if (!v) return null;
  return v.includes('@') ? { email: v } : { phone: v };
}
