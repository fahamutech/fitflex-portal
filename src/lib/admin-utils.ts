export type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'brand' | 'gray';

/**
 * Display label for a currency. ISO codes stay in data, APIs and exports;
 * Tanzanian shillings are shown as "TSh" in English and Swahili (D-8,
 * glossary "Currency label (display)"). Deliberately not Intl currencyDisplay,
 * which renders TZS differently per locale.
 */
export function currencyLabel(code: string | null | undefined = 'TZS') {
  if (!code || code.toUpperCase() === 'TZS') return 'TSh';
  return code;
}

/** "TSh 279,000". Pass an ISO code (default TZS); pass '' for the number only. */
export function money(value: number | null | undefined, currency = 'TZS') {
  const amount = new Intl.NumberFormat('en-US').format(Number(value || 0));
  return currency === '' ? ` ${amount}` : `${currencyLabel(currency)} ${amount}`;
}

/** "1,234" or "4.67" (up to `maxDecimals` places); '—' for no value. Counts and ratings, not money. */
export function formatNumber(value: number | null | undefined, maxDecimals = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(Number(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function statusTone(status?: string): BadgeTone {
  if (status === 'active' || status === 'approved' || status === 'completed') return 'success';
  if (status === 'rejected' || status === 'suspended' || status === 'cancelled') return 'danger';
  if (status === 'pending' || status === 'payment_pending' || status === 'pending_approval' || status === 'confirmed') return 'warning';
  return 'gray';
}

export function statusLabel(status: string | undefined): string {
  const MAP: Record<string, string> = {
    active: 'Active', suspended: 'Suspended', pending: 'Pending',
    pending_approval: 'Pending approval', payment_pending: 'Payment pending',
    approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
    confirmed: 'Confirmed', completed: 'Completed', inactive: 'Inactive', none: '—',
  };
  return MAP[status ?? ''] ?? status ?? '—';
}

/**
 * A trainer's two names, for staff: the name clients see (the nickname when
 * the trainer chose one) and the trainer's own name when it is different.
 */
export function trainerNames(t?: { displayName?: string | null; fullName?: string | null; nickname?: string | null } | null) {
  const shown = t?.displayName || '';
  const own = t?.nickname && t?.fullName && t.fullName !== shown ? t.fullName : '';
  return { shown, own, label: own ? `${shown} (${own})` : shown };
}
