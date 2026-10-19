'use client';
// Slice A3: the transaction ID a member typed after paying the Lipa Namba
// (`PaymentRequest.memberReference`, upper case). The admin matches it against
// the till statement before approving; it is prefilled as the reference to record.
import { useEffect, useState } from 'react';
import { useApp } from '../../app/providers';
import type { PaymentRequest } from '@/lib/api';
import { Button, Field, Input } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { money } from '@/lib/admin-utils';

/** True when approving this payment should go through the transaction-ID dialog. */
export function approvesWithMemberReference(target: { payment: PaymentRequest; action: string } | null): boolean {
  return !!target && target.action === 'approved' && !!target.payment.memberReference;
}

/** Table cell: the member's transaction ID, or a dash. */
export function MemberReferenceCell({ payment }: { payment: PaymentRequest }) {
  return payment.memberReference
    ? <span className="text-xs font-mono font-semibold text-[var(--color-fg-primary)]" data-testid="member-reference">{payment.memberReference}</span>
    : <span className="text-xs">—</span>;
}

/**
 * Approve a payment that carries a member transaction ID. The reference field starts from
 * the reference already recorded (e.g. by a verifying admin) or else the member's ID.
 */
export function ApproveWithReferenceDialog({
  payment, busy, onClose, onConfirm,
}: {
  payment: PaymentRequest | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reference: string) => void;
}) {
  const { t } = useApp();
  const [reference, setReference] = useState('');
  useEffect(() => { setReference(payment ? (payment.reference || payment.memberReference || '') : ''); }, [payment]);
  if (!payment) return null;
  const memberRef = payment.memberReference || '';
  const differs = reference.trim().toUpperCase() !== memberRef.toUpperCase();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('manualPay.approveTitle')}
      description={`${payment.member?.displayName || payment.member?.email || payment.memberId} · ${money(payment.amountTzs)}`}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('manualPay.approveBody').replace('{amount}', money(payment.amountTzs))}</p>
        <div
          className="rounded-[var(--radius-lg)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-4 py-3"
          data-testid="member-reference-highlight"
        >
          <p className="text-xs font-medium text-[var(--color-brand-700)]">{t('manualPay.memberRef')}</p>
          <p className="mt-1 font-mono text-lg font-bold tracking-wide text-[var(--color-fg-primary)] select-all">{memberRef}</p>
        </div>
        <Field label={t('manualPay.referenceToRecord')} hint={t('manualPay.referenceHint')}>
          <Input className="font-mono" data-testid="approve-reference" value={reference} onChange={e => setReference(e.target.value)} />
        </Field>
        {differs && (
          <p role="status" className="text-xs font-medium text-[var(--color-warning-700)]" data-testid="approve-reference-differs">
            {t('manualPay.referenceDiffers')}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="primary" size="md" onClick={() => onConfirm(reference.trim())} disabled={busy} data-testid="approve-with-reference">
          {busy ? t('common.pleaseWait') : t('admin.payment.approve')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
