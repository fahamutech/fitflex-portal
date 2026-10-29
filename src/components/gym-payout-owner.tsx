'use client';
// Gym payout owner (backend flag GYM_PAYOUT_OWNER, functions#247).
// A gym shared by two or more owners has ONE payout owner, named by an admin.
// Nothing is named automatically: until an admin names one, payouts for a
// shared gym wait (reason payout_owner_required). With the switch off, the
// first owner account found is paid, but a payout owner can still be named
// now so it is ready when the switch goes on.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/providers';
import {
  api, Gym, GymOwnerSummary, GymPayoutOwnerState, GymPayoutOwnerView, SettlementPayee,
} from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Field, Select, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';

type T = (key: MessageKey) => string;

/** Replace {name} placeholders in a translated string. */
export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));

export const ownerName = (o: Pick<GymOwnerSummary, 'id' | 'displayName' | 'email'> | null | undefined) =>
  (o ? o.displayName || o.email || o.id : '');

/** True when the backend says this gym's payouts wait for an admin to name a payout owner. */
export const needsPayoutOwner = (gym: Pick<Gym, 'payoutOwner'>) => gym.payoutOwner?.reason === 'payout_owner_required';

const SOURCE_KEYS: Record<string, MessageKey> = {
  named: 'admin.gym.payout.source.named',
  only_owner: 'admin.gym.payout.source.only_owner',
  first_owner: 'admin.gym.payout.source.first_owner',
  destination_snapshot: 'admin.gym.payout.source.destination_snapshot',
};
export const payoutSourceLabel = (t: T, source: string | null | undefined) => (source && SOURCE_KEYS[source] ? t(SOURCE_KEYS[source]) : '');

const REASON_KEYS: Record<string, MessageKey> = {
  payout_owner_required: 'admin.gym.payout.reason.payout_owner_required',
  no_owner_account: 'admin.gym.payout.reason.no_owner_account',
};
export const payoutReasonText = (t: T, reason: string | null | undefined) => (reason && REASON_KEYS[reason] ? t(REASON_KEYS[reason]) : '');

const ERROR_KEYS: Record<string, MessageKey> = {
  ownerId_required: 'admin.gym.payout.err.ownerId_required',
  invalid_ownerId: 'admin.gym.payout.err.invalid_ownerId',
  gym_not_found: 'admin.gym.payout.err.gym_not_found',
  not_a_gym_owner: 'admin.gym.payout.err.not_a_gym_owner',
  forbidden: 'admin.gym.payout.err.forbidden',
  acl_forbidden: 'admin.gym.payout.err.forbidden',
};
/** A payout-owner endpoint error as a sentence in the admin's language. */
export function payoutOwnerError(t: T, err: unknown) {
  const e = err as { status?: number; body?: { error?: string } } | null;
  const code = e?.body?.error ?? '';
  if (ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
  if (e?.status === 403) return t('admin.gym.payout.err.forbidden');
  return t('admin.gym.payout.err.generic');
}

/** The list cell: who is paid, or a badge saying a payout owner is needed. */
export function PayoutOwnerCell({ gym, onOpen }: { gym: Gym; onOpen: () => void }) {
  const { t } = useApp();
  const state = gym.payoutOwner;
  if (!state) return <span className="text-xs text-[var(--color-fg-quaternary)]">—</span>;
  const owners = gym.owners ?? [];
  const named = gym.payoutOwnerId ? owners.find(o => o.id === gym.payoutOwnerId) : null;
  const paid = state.ownerId ? owners.find(o => o.id === state.ownerId) : null;
  let body;
  if (needsPayoutOwner(gym)) body = <Badge tone="warning" dot>{t('admin.gym.payout.needs')}</Badge>;
  else if (state.reason === 'no_owner_account') body = <span className="text-xs text-[var(--color-fg-quaternary)]">{t('admin.gym.payout.noOwner')}</span>;
  else if (named || paid) {
    const who = named ?? paid;
    body = (
      <span className="flex flex-col">
        <span className="text-sm text-[var(--color-fg-secondary)]">{ownerName(who)}</span>
        <span className="text-xs text-[var(--color-fg-quaternary)]">{named ? t('admin.gym.payout.source.named') : payoutSourceLabel(t, state.source)}</span>
      </span>
    );
  } else if (owners.length > 1) body = <Badge tone="gray">{t('admin.gym.payout.notNamed')}</Badge>;
  else body = <span className="text-xs text-[var(--color-fg-quaternary)]">{payoutSourceLabel(t, state.source) || '—'}</span>;
  return (
    <button
      type="button"
      className="text-left"
      data-testid={`payout-owner-cell-${gym.id}`}
      title={t('admin.gym.payout.change')}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {body}
    </button>
  );
}

/** What the gym detail dialog shows: the named payout owner and who is paid now. */
export function PayoutOwnerSummary({ gym, onChange }: { gym: Gym; onChange: () => void }) {
  const { t } = useApp();
  const state = gym.payoutOwner;
  if (!state) return null;
  return (
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid="payout-owner-summary">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.gym.payout.title')}</p>
        <Button variant="secondary" size="sm" onClick={onChange} data-testid="payout-owner-change">
          {gym.payoutOwnerId ? t('admin.gym.payout.change') : t('admin.gym.payout.set')}
        </Button>
      </div>
      <PayoutOwnerFacts owners={gym.owners ?? []} payoutOwnerId={gym.payoutOwnerId ?? null} state={state} />
    </div>
  );
}

function PayoutOwnerFacts({ owners, payoutOwnerId, state }: { owners: GymOwnerSummary[]; payoutOwnerId: string | null; state: GymPayoutOwnerState }) {
  const { t } = useApp();
  const named = payoutOwnerId ? owners.find(o => o.id === payoutOwnerId) : null;
  const paid = state.ownerId ? owners.find(o => o.id === state.ownerId) : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('admin.gym.payout.named')}</p>
          <p className="font-medium" data-testid="payout-owner-named">{named ? ownerName(named) : t('admin.gym.payout.noneNamed')}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('admin.gym.payout.paidNow')}</p>
          <p className="font-medium" data-testid="payout-owner-paid">
            {state.reason ? t('admin.gym.payout.nobodyPaid') : paid ? ownerName(paid) : payoutSourceLabel(t, state.source)}
            {paid && state.source && <span className="ml-1 text-xs font-normal text-[var(--color-fg-quaternary)]">({payoutSourceLabel(t, state.source)})</span>}
          </p>
        </div>
      </div>
      {state.reason && <Alert tone="warning"><span data-testid="payout-owner-reason">{payoutReasonText(t, state.reason)}</span></Alert>}
      {state.mode === 'first_owner' && <Alert tone="info"><span data-testid="payout-owner-switch-off">{t('admin.gym.payout.firstOwnerNote')}</span></Alert>}
    </div>
  );
}

/**
 * Name or clear a gym's payout owner. Only the gym's own owners are offered.
 * Saving and clearing both ask for confirmation first (inline, so no second
 * modal is stacked on this one).
 */
export function GymPayoutOwnerDialog({
  gym, open, onClose, onSaved,
}: {
  gym: Gym | null;
  open: boolean;
  onClose: () => void;
  onSaved: (view: GymPayoutOwnerView) => void;
}) {
  const { token, t } = useApp();
  const [view, setView] = useState<GymPayoutOwnerView | null>(null);
  const [choice, setChoice] = useState('');
  const [asking, setAsking] = useState<null | 'set' | 'clear'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const show = (v: GymPayoutOwnerView) => { setView(v); setChoice(v.payoutOwnerId ?? ''); };

  useEffect(() => {
    if (!open || !gym || !token) return;
    setError(null); setNotice(null); setAsking(null);
    // Start from the list row, then read the current answer.
    if (gym.payoutOwner) show({ gymId: gym.id, payoutOwnerId: gym.payoutOwnerId ?? null, owners: gym.owners ?? [], payoutOwner: gym.payoutOwner });
    else setView(null);
    let live = true;
    api.gymPayoutOwner(token, gym.id)
      .then(v => { if (live) show(v); })
      .catch(err => { if (live) setError(gym.payoutOwner ? payoutOwnerError(t, err) : t('admin.gym.payout.loadFailed')); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gym?.id, token]);

  async function commit() {
    if (!token || !gym || !asking) return;
    const ownerId = asking === 'clear' ? null : choice;
    setBusy(true); setError(null); setNotice(null);
    try {
      const v = await api.setGymPayoutOwner(token, gym.id, ownerId);
      show(v);
      setNotice(ownerId ? t('admin.gym.payout.saved') : t('admin.gym.payout.cleared'));
      onSaved(v);
    } catch (err) {
      setError(payoutOwnerError(t, err));
      // 409 not_a_gym_owner carries the gym's owners as they are now.
      const owners = (err as { body?: { owners?: GymOwnerSummary[] } })?.body?.owners;
      if (owners && view) { setView({ ...view, owners }); setChoice(''); }
    } finally {
      setAsking(null);
      setBusy(false);
    }
  }

  const owners = view?.owners ?? [];
  const chosen = owners.find(o => o.id === choice);
  const gymLabel = gym?.name ?? '';
  const unchanged = (view?.payoutOwnerId ?? '') === choice;

  return (
    <Dialog open={open} onClose={onClose} title={t('admin.gym.payout.title')} description={fill(t('admin.gym.payout.dialogDescription'), { gym: gymLabel })} size="md">
      <div className="space-y-4" data-testid="payout-owner-dialog">
        {error && <Alert tone="error"><span data-testid="payout-owner-error">{error}</span></Alert>}
        {notice && <Alert tone="success"><span data-testid="payout-owner-notice">{notice}</span></Alert>}
        {!view ? (!error && <div className="flex justify-center py-6"><Spinner className="h-6 w-6" /></div>) : (
          <>
            <PayoutOwnerFacts owners={owners} payoutOwnerId={view.payoutOwnerId} state={view.payoutOwner} />
            {owners.length === 0 ? (
              <Alert tone="info">{t('admin.gym.payout.noOwners')}</Alert>
            ) : (
              <Field label={t('admin.gym.payout.pick')} hint={t('admin.gym.payout.pickHint')}>
                <Select
                  aria-label={t('admin.gym.payout.pick')}
                  data-testid="payout-owner-select"
                  value={choice}
                  disabled={busy || !!asking}
                  onChange={e => { setChoice(e.target.value); setNotice(null); }}
                >
                  <option value="">{t('admin.gym.payout.pickPlaceholder')}</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>{ownerName(o)}{o.email && o.displayName ? ` · ${o.email}` : ''}</option>
                  ))}
                </Select>
              </Field>
            )}
            {asking && (
              <Alert tone="warning">
                <span data-testid="payout-owner-confirm-text">
                  {asking === 'clear'
                    ? fill(t('admin.gym.payout.confirmClear'), { gym: gymLabel })
                    : fill(t('admin.gym.payout.confirmSet'), { gym: gymLabel, name: ownerName(chosen) })}
                </span>
              </Alert>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        {asking ? (
          <>
            <Button variant="secondary" size="md" onClick={() => setAsking(null)} disabled={busy}>{t('admin.gym.payout.back')}</Button>
            <Button variant={asking === 'clear' ? 'destructive' : 'primary'} size="md" onClick={commit} disabled={busy} data-testid="payout-owner-confirm">
              {busy ? t('admin.gym.payout.saving') : t('admin.gym.payout.confirm')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>{t('admin.gym.payout.close')}</Button>
            {view?.payoutOwnerId && (
              <Button variant="destructive" size="md" onClick={() => setAsking('clear')} disabled={busy} data-testid="payout-owner-clear">
                {t('admin.gym.payout.clear')}
              </Button>
            )}
            {owners.length > 0 && (
              <Button variant="primary" size="md" onClick={() => setAsking('set')} disabled={busy || !choice || unchanged} data-testid="payout-owner-save">
                {t('admin.gym.payout.save')}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/**
 * After gym owners are saved: the gyms the change left with 2+ owners and no
 * payout owner (POST /admin/gym-owners payoutOwnerRequiredGymIds). Each gym
 * opens its payout-owner picker, in place (onOpen) or on the Gyms page.
 */
export function PayoutOwnerRequiredAlert({
  gymIds, gymName, onOpen,
}: {
  gymIds: string[];
  gymName: (id: string) => string;
  onOpen?: (gymId: string) => void;
}) {
  const { t } = useApp();
  if (!gymIds.length) return null;
  return (
    <Alert tone="warning">
      <div data-testid="payout-owner-required-warning">
        <p>{t('admin.gym.payout.requiredWarning')}</p>
        <ul className="mt-1 list-disc pl-5">
          {gymIds.map(id => (
            <li key={id}>
              {onOpen ? (
                <button type="button" className="font-medium underline" onClick={() => onOpen(id)}>{gymName(id)}</button>
              ) : (
                <Link className="font-medium underline" href={`/admin/gyms?payoutOwner=${encodeURIComponent(id)}`}>{gymName(id)}</Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}

/** Statement detail: who the statement is paid to (GYM_PAYOUT_OWNER on). */
export function SettlementPayeeLine({ payee }: { payee: SettlementPayee }) {
  const { t } = useApp();
  return (
    <div data-testid="settlement-payee">
      <p className="text-xs text-[var(--color-fg-tertiary)]">{t('settlement.payee')}</p>
      {payee.ownerId ? (
        <p className="font-medium">
          {payee.displayName || payee.ownerId}
          {payee.source && <span className="ml-1 text-xs font-normal text-[var(--color-fg-quaternary)]">({payoutSourceLabel(t, payee.source)})</span>}
        </p>
      ) : (
        <>
          <p className="font-medium">{t('settlement.payee.nobody')}</p>
          {payee.reason && <p className="text-xs text-[var(--color-warning-700)]">{payoutReasonText(t, payee.reason)}</p>}
        </>
      )}
    </div>
  );
}
