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

/** Tanzanian numbers compared by their last 9 digits (+255 712…, 255712…, 0712… are the same). */
function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/** True only when both numbers are known and are not the same number. Paying from another number is allowed. */
export function payerPhoneDiffers(payment: PaymentRequest): boolean {
  const paid = phoneKey(payment.payerPhone);
  const registered = phoneKey(payment.member?.phone);
  return !!paid && !!registered && paid !== registered;
}

const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Table cell: the payment's transaction ID, shown once. The recorded reference wins; the member's
 * own ID shows only when nothing is recorded yet, or when it differs from what was recorded.
 * The number the member paid from follows, or a dash when there is nothing at all.
 */
export function TransactionIdCell({ payment }: { payment: PaymentRequest }) {
  const { t } = useApp();
  const recorded = payment.reference?.trim() || '';
  const member = payment.memberReference?.trim() || '';
  if (!recorded && !member && !payment.payerPhone) return <span className="text-xs">—</span>;
  return (
    <div className="space-y-0.5 max-w-[9rem]">
      {recorded && (
        <div className="truncate text-xs font-mono font-semibold text-[var(--color-fg-primary)]" title={recorded} data-testid="payment-reference">{recorded}</div>
      )}
      {member && !recorded && (
        <>
          <div className="truncate text-xs font-mono font-semibold text-[var(--color-fg-primary)]" title={member} data-testid="member-reference">{member}</div>
          <div className="text-xs text-[var(--color-fg-tertiary)]">{t('payments.fromMember')}</div>
        </>
      )}
      {member && recorded && !sameId(member, recorded) && (
        <div className="truncate text-xs text-[var(--color-warning-700)]" title={member} data-testid="member-reference-differs">
          {t('payments.memberGave').replace('{ref}', member)}
        </div>
      )}
      {payment.payerPhone && (
        <div className="text-xs text-[var(--color-fg-tertiary)]" data-testid="payer-phone">
          {t('manualPay.payerPhone')}: <span className="font-mono">{payment.payerPhone}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Approve a payment that carries a member transaction ID. The reference field starts from
 * the reference already recorded (e.g. by a verifying admin) or else the member's ID.
 */
export function ApproveWithReferenceDialog({
  payment, busy, onClose, onConfirm, verifiedText,
}: {
  payment: PaymentRequest | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reference: string) => void;
  /** Who verified the payment and when (two-admin approval), shown so the approver sees it before approving. */
  verifiedText?: string | null;
}) {
  const { t } = useApp();
  const [reference, setReference] = useState('');
  useEffect(() => { setReference(payment ? (payment.reference || payment.memberReference || '') : ''); }, [payment]);
  if (!payment) return null;
  const memberRef = payment.memberReference || '';
  // A1 (MONEY_SECOND_APPROVER): a verified payment is approved with the reference it was verified with.
  const locked = !!payment.secondApproverRequired && !!payment.verifiedBy;
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
          {payment.payerPhone && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" data-testid="payer-phone-highlight">
              <dt className="font-medium text-[var(--color-brand-700)]">{t('manualPay.payerPhone')}</dt>
              <dd className="font-mono font-semibold text-[var(--color-fg-primary)] select-all">{payment.payerPhone}</dd>
              {payment.member?.phone && (
                <>
                  <dt className="text-[var(--color-fg-tertiary)]">{t('manualPay.registeredPhone')}</dt>
                  <dd className="font-mono text-[var(--color-fg-secondary)]" data-testid="registered-phone">{payment.member.phone}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        {verifiedText && (
          <p className="text-xs text-[var(--color-fg-tertiary)]" data-testid="approve-verified-by">{verifiedText}</p>
        )}
        {payerPhoneDiffers(payment) && (
          <p role="status" className="text-xs text-[var(--color-fg-tertiary)]" data-testid="payer-phone-differs">{t('manualPay.phoneDiffers')}</p>
        )}
        <Field label={t('manualPay.referenceToRecord')} hint={locked ? t('money2.referenceLocked') : t('manualPay.referenceHint')}>
          <Input className="font-mono" data-testid="approve-reference" value={reference} disabled={locked} onChange={e => setReference(e.target.value)} />
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
