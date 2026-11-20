'use client';
// Member portal: custom gym passes (flags NEXT_PUBLIC_MEMBER_PORTAL + NEXT_PUBLIC_GYM_CUSTOM_PASSES). A pass chosen on a
// gym's public page (/g) is bought here: the people it covers, the gym's terms, one payment by the phone prompt. Below
// it, the passes the member bought and the passes they are on. Nothing here marks a pass paid: the server does.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, input, muted, primaryBtn } from '@/components/member/member-frame';
import { PayPanel, type PayTarget } from '@/components/member/pay-panel';
import { fmt } from '@/components/member/member-shared';
import { useGymPassFormat } from '@/components/gym-pass-shared';
import { GYM_CUSTOM_PASSES } from '@/lib/flags';
import { clearBuyIntent, contactOf, loadBuyIntent, othersRange, type BuyIntent } from '@/lib/gym-pass-buy';
import {
  MemberApiError, formatDate, formatTzs, memberApi, memberGymPassApi,
  type GymPassPersonView, type MemberSession, type MyGymPassMembership, type MyGymPassPurchase, type PaymentOptions,
} from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberGymPassesPage() {
  return <MemberFrame testId="member-gym-passes-page">{s => <GymPasses session={s} />}</MemberFrame>;
}

/** The server's own code → the sentence shown (never the raw code). */
const ERR: Record<string, MessageKey> = {
  terms_changed: 'gp.m.err.terms_changed', terms_not_accepted: 'gp.m.err.terms_changed',
  plan_not_found: 'gp.m.err.plan_gone', plan_not_available: 'gp.m.err.plan_gone', gym_not_found: 'gp.m.err.plan_gone', gym_not_available: 'gp.m.err.plan_gone',
  payment_already_pending: 'gp.m.err.payment_already_pending',
  invalid_contact: 'gp.m.err.invalid_contact', cannot_add_yourself: 'gp.m.err.cannot_add_yourself',
  duplicate_beneficiary: 'gp.m.err.duplicate_beneficiary', invalid_beneficiaries: 'gp.m.err.invalid_beneficiaries',
  beneficiary_limit_exceeded: 'gp.m.err.beneficiary_limit_exceeded', 
  beneficiaries_not_allowed: 'gp.m.err.headcount', couples_needs_two_people: 'gp.m.err.headcount', group_needs_minimum: 'gp.m.err.headcount',
  rate_limited: 'gp.m.err.rate_limited', not_cancellable: 'gp.m.err.not_cancellable', payment_in_progress: 'gp.m.err.payment_in_progress',
};
function errorText(err: unknown): MessageKey {
  if (!(err instanceof MemberApiError)) return 'gp.m.err.generic';
  if (err.status === 429) return 'gp.m.err.rate_limited';
  const raw = typeof err.body?.error === 'string' ? err.body.error : '';
  return ERR[raw] ?? 'gp.m.err.generic';
}

interface Data { purchased: MyGymPassPurchase[]; memberships: MyGymPassMembership[]; options: PaymentOptions | null }

function GymPasses({ session }: { session: MemberSession | null }) {
  const { t } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [intent, setIntent] = useState<BuyIntent | null>(null);
  const [target, setTarget] = useState<PayTarget | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [mine, options] = await Promise.all([memberGymPassApi.mine(), memberApi.paymentOptions().catch(() => null)]);
      setData({ ...mine, options }); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => {
    if (!GYM_CUSTOM_PASSES) return;
    setIntent(loadBuyIntent());
    void load();
  }, [load]);

  if (!GYM_CUSTOM_PASSES) {
    return (
      <div className="py-16 text-center" data-testid="member-gym-passes-off">
        <h1 className="text-2xl font-extrabold">{t('gp.m.off.title')}</h1>
        <p className={`mt-2 ${muted}`}>{t('gp.m.off.body')}</p>
      </div>
    );
  }
  if (state === 'loading') return <Loading />;
  if (state === 'error' || !data) return <LoadError onRetry={load} />;

  if (target) {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title={t('gp.m.title')} />
        <PayPanel target={target} options={data.options} defaultPhone={session?.user.phone ?? ''}
          onBack={() => { setTarget(null); void load(); }} />
      </div>
    );
  }

  const pay = (label: string, amountTzs: number, paymentId: string) =>
    setTarget({ label, amountTzs, product: 'GYM_SUBSCRIPTION', paymentId, doneBody: t('gp.m.payDone') });
  const dropIntent = () => { clearBuyIntent(); setIntent(null); };

  return (
    <>
      <PageTitle title={t('gp.m.title')} />
      <div className="flex flex-col gap-4">
        {intent && (
          <BuyForm intent={intent} onDismiss={dropIntent}
            onCreated={(id, amountTzs) => { dropIntent(); pay(intent.plan.name, amountTzs, id); }} />
        )}
        <Purchased items={data.purchased} onPay={pay} onChanged={load} />
        {data.memberships.length > 0 && <Shared items={data.memberships} />}
      </div>
    </>
  );
}

function BuyForm({ intent, onCreated, onDismiss }: { intent: BuyIntent; onCreated: (paymentId: string, amountTzs: number) => void; onDismiss: () => void }) {
  const { t, locale } = useApp();
  const f = useGymPassFormat();
  const { plan, gymName } = intent;
  const range = othersRange(plan);
  const [others, setOthers] = useState<string[]>(() => Array.from({ length: range.min }, () => ''));
  const [accepted, setAccepted] = useState(false);
  const [priceTzs, setPriceTzs] = useState(plan.priceTzs);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    setNotice(null);
    const people = others.map(contactOf);
    if (people.some(p => !p)) { setNotice(t('gp.m.buy.personMissing')); return; }
    if (plan.terms && !accepted) { setNotice(t('gp.m.buy.termsMissing')); return; }
    sending.current = true; setBusy(true);
    try {
      const r = await memberGymPassApi.purchase({
        planId: plan.planId,
        beneficiaries: people as Array<{ phone: string } | { email: string }>,
        ...(plan.terms && plan.termsVersion != null ? { termsVersion: plan.termsVersion } : {}),
        // The price the member is looking at: a change is refused (409) and shown before anything is created.
        expectedPriceTzs: priceTzs,
      });
      onCreated(r.paymentRequest.id, r.paymentRequest.amountTzs);
    } catch (err) {
      const now = err instanceof MemberApiError && err.body?.error === 'price_changed' ? Number(err.body.priceTzs) : NaN;
      if (Number.isFinite(now) && now > 0) {
        setPriceTzs(now);
        setNotice(fmt(t('gp.m.buy.priceChanged'), { amount: formatTzs(now, locale) }));
      } else {
        setNotice(t(errorText(err)));
      }
    } finally { sending.current = false; setBusy(false); }
  }

  const setOther = (i: number, v: string) => setOthers(list => list.map((x, j) => (j === i ? v : x)));
  const othersLabel = range.max === 1 ? t('gp.m.buy.othersOne')
    : range.min === range.max ? fmt(t('gp.m.buy.othersExact'), { n: range.min })
    : fmt(t('gp.m.buy.othersMany'), { min: range.min, max: range.max });

  return (
    <form onSubmit={submit} noValidate aria-labelledby="gp-buy-title" className={`${card} flex flex-col gap-5`} data-testid="member-gym-pass-buy">
      <div>
        <h2 id="gp-buy-title" className="text-xl font-extrabold">{t('gp.m.buy.title')}</h2>
        <p className="mt-2 text-lg font-bold">{plan.name}</p>
        {gymName && <p className={muted}>{fmt(t('gp.m.buy.at'), { gym: gymName })}</p>}
        <p className={muted}>{t(`gp.category.${plan.category}` as MessageKey)} · {f.people(plan.category, plan.beneficiaryLimit)} · {f.duration(plan.durationValue, plan.durationUnit)}</p>
        {plan.description && <p className={`mt-2 whitespace-pre-line text-sm ${muted}`}>{plan.description}</p>}
        <p className="mt-3 text-lg font-bold tabular-nums" data-testid="member-gym-pass-price">{fmt(t('gp.m.buy.price'), { amount: formatTzs(priceTzs, locale) })}</p>
      </div>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} role="alert" data-testid="member-gym-pass-notice" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{notice}</div>
      )}

      {range.max > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{othersLabel}</legend>
          <p className={`text-sm ${muted}`}>{t('gp.m.buy.you')}</p>
          {others.map((v, i) => (
            <div key={i} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold">
                {fmt(t('gp.m.buy.person'), { n: i + 2 })}
                <input className={input} value={v} onChange={e => setOther(i, e.target.value)} inputMode="email" autoComplete="off" disabled={busy}
                  data-testid={`member-gym-pass-person-${i}`} />
              </label>
              {i >= range.min && (
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => setOthers(list => list.filter((_, j) => j !== i))}
                  aria-label={fmt(t('gp.m.buy.removePerson'), { n: i + 2 })} data-testid={`member-gym-pass-person-remove-${i}`}>
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
          ))}
          {others.length < range.max && (
            <button type="button" className={`${ghostBtn} self-start`} disabled={busy} onClick={() => setOthers(list => [...list, ''])} data-testid="member-gym-pass-person-add">
              {t('gp.m.buy.addPerson')}
            </button>
          )}
          <p className={`text-sm ${muted}`}>{t('gp.m.buy.personHint')}</p>
        </fieldset>
      )}

      {plan.terms && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t('gp.m.buy.terms')}</h3>
          <div tabIndex={0} role="group" aria-label={t('gp.m.buy.terms')} className={`max-h-48 overflow-y-auto whitespace-pre-line rounded-xl border border-[#1e293b] px-4 py-3 text-sm ${muted}`} data-testid="member-gym-pass-terms">{plan.terms}</div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy} className="mt-0.5 h-5 w-5 flex-none accent-[#c8f04a]" data-testid="member-gym-pass-accept" />
            <span>{t('gp.m.buy.acceptTerms')}</span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryBtn} disabled={busy} data-testid="member-gym-pass-continue">{busy ? t('gp.m.buy.working') : t('gp.m.buy.continue')}</button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={onDismiss} data-testid="member-gym-pass-dismiss">{t('gp.m.buy.notNow')}</button>
      </div>
    </form>
  );
}

const badge = 'rounded-full bg-[#1e293b] px-3 py-1 text-xs font-bold';

function personName(p: GymPassPersonView, t: (k: MessageKey) => string): string {
  if (p.you) return t('gp.m.mine.you');
  return p.displayName || p.contact || fmt(t('gp.m.mine.personSlot'), { n: p.slot });
}

function Purchased({ items, onPay, onChanged }: { items: MyGymPassPurchase[]; onPay: (label: string, amountTzs: number, paymentId: string) => void; onChanged: () => void | Promise<void> }) {
  const { t, locale } = useApp();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ id: string; key: MessageKey } | null>(null);

  async function cancel(id: string) {
    if (busy) return;
    setBusy(true); setFailed(null);
    try { await memberGymPassApi.cancel(id); setAsking(null); await onChanged(); }
    catch (err) { setFailed({ id, key: errorText(err) }); setAsking(null); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="gp-mine" className={`${card} flex flex-col gap-4`} data-testid="member-gym-passes-mine">
      <h2 id="gp-mine" className="text-xl font-extrabold">{t('gp.m.mine.title')}</h2>
      {items.length === 0 ? <p className={muted} data-testid="member-gym-passes-empty">{t('gp.m.mine.empty')}</p> : (
        <ul className="divide-y divide-[#1e293b]">
          {items.map(p => {
            const people = (p.beneficiaries ?? []).filter(b => b.status !== 'removed');
            return (
              <li key={p.id} className="flex flex-col gap-2 py-4" data-testid={`member-gym-pass-${p.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <strong>{p.plan.name}</strong>
                    {p.gym?.name && <span className={`text-sm ${muted}`}>{p.gym.name}</span>}
                  </span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <span>{formatTzs(p.priceTzs, locale)}</span>
                    <span className={badge}>{t(`gp.purchase.status.${p.status}` as MessageKey)}</span>
                  </span>
                </div>
                {p.status === 'active' && p.expiresAt && <p className={`text-sm ${muted}`}>{fmt(t('gp.m.mine.until'), { date: formatDate(p.expiresAt, locale) })}</p>}
                {people.length > 1 && (
                  <div className="text-sm">
                    <p className="font-semibold">{t('gp.m.mine.people')}{p.slots ? ` · ${fmt(t('gp.m.mine.places'), { used: p.slots.used, limit: p.slots.limit })}` : ''}</p>
                    <ul className={`mt-1 ${muted}`}>
                      {people.map(b => (
                        <li key={b.id}>{personName(b, t)} · {t(`gp.person.status.${b.status}` as MessageKey)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {failed?.id === p.id && <p role="alert" className="text-sm text-[#ff8a6b]">{t(failed.key)}</p>}
                {p.status === 'pending_payment' && (asking === p.id ? (
                  <div role="group" aria-label={t('gp.m.mine.cancel')} className="flex flex-wrap items-center gap-3">
                    <p className="text-sm">{t('gp.m.mine.cancelAsk')}</p>
                    <button type="button" className={ghostBtn} disabled={busy} onClick={() => void cancel(p.id)} data-testid={`member-gym-pass-cancel-yes-${p.id}`}>{t('gp.m.mine.cancelYes')}</button>
                    <button type="button" className={ghostBtn} disabled={busy} onClick={() => setAsking(null)}>{t('gp.m.mine.cancelNo')}</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {p.paymentRequestId && (
                      <button type="button" className={primaryBtn} onClick={() => onPay(p.plan.name, p.priceTzs, p.paymentRequestId as string)} data-testid={`member-gym-pass-pay-${p.id}`}>{t('gp.m.mine.payNow')}</button>
                    )}
                    <button type="button" className={ghostBtn} onClick={() => { setFailed(null); setAsking(p.id); }} data-testid={`member-gym-pass-cancel-${p.id}`}>{t('gp.m.mine.cancel')}</button>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      <p className={`text-sm ${muted}`}>{t('gp.m.mine.manageInApp')}</p>
    </section>
  );
}

function Shared({ items }: { items: MyGymPassMembership[] }) {
  const { t, locale } = useApp();
  return (
    <section aria-labelledby="gp-shared" className={`${card} flex flex-col gap-4`} data-testid="member-gym-passes-shared">
      <h2 id="gp-shared" className="text-xl font-extrabold">{t('gp.m.shared.title')}</h2>
      <ul className="divide-y divide-[#1e293b]">
        {items.map(m => (
          <li key={m.beneficiaryId} className="flex flex-col gap-1 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-col">
                <strong>{m.plan.name}</strong>
                {m.gym?.name && <span className={`text-sm ${muted}`}>{m.gym.name}</span>}
              </span>
              <span className={badge}>{t(`gp.purchase.status.${m.purchaseStatus}` as MessageKey)}</span>
            </div>
            {m.purchaseStatus === 'active' && m.expiresAt && <p className={`text-sm ${muted}`}>{fmt(t('gp.m.mine.until'), { date: formatDate(m.expiresAt, locale) })}</p>}
            {m.status === 'suspended' && <p className="text-sm text-[#ff8a6b]">{t('gp.m.shared.suspended')}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
