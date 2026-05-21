export type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'brand' | 'gray';

export function money(value: number | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US').format(Number(value || 0))}`;
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
