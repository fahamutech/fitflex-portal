import { request } from './api';

/** Held payments worklist (functions admin-held-payments.mjs). Server flag HELD_PAYMENTS_WORKLIST; off => 404 feature_disabled. Scope `payments`. */
export type HeldNotRefundableReason = 'reference_already_used' | 'sandbox_not_settled' | 'request_not_closed' | 'already_refunded';

export interface HeldPayment {
  paymentRequestId: string;
  transactionId: string | null;
  amountTzs: number | null;
  memberId: string | null;
  reason: string;
  at: string | null;
  refundId: string | null;
  requestStatus: string;
  productType: string | null;
  refundStatus: string | null;
  refundable: boolean;
  notRefundableReason: HeldNotRefundableReason | null;
  amountReceivedKnown: boolean;
}

export type HeldStatus = 'open' | 'resolved';

export interface HeldRefundBody { transactionId: string; reasonCode: string; amountTzs?: number; note?: string }

export const heldPaymentsApi = {
  list: (token: string, status: HeldStatus) => request<{ items: HeldPayment[] }>(`/admin/payments/held?status=${status}`, {}, token),
  refund: (token: string, paymentRequestId: string, body: HeldRefundBody) =>
    request<{ refund: { id: string; status?: string } }>(`/admin/payments/held/${encodeURIComponent(paymentRequestId)}/refund`, { method: 'POST', body: JSON.stringify(body) }, token),
};

/** Reasons an admin may give for held money, in the order shown. Labels reuse refunds.reason.*. */
export const HELD_REFUND_REASONS = ['payment_error', 'cancelled_by_fitflex', 'charged_twice', 'other'] as const;
