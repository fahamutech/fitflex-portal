'use client';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, muted } from '@/components/member/member-frame';
import { PayPanel, type PayTarget } from '@/components/member/pay-panel';
import { fmt, isActive, passOf, passVisits, tierLabel, unlimited } from '@/components/member/member-shared';
import { formatDate, formatTzs, memberApi, type MemberSession, type MeResponse, type Pass, type PaymentOptions, type PaymentRequest, type UpgradeOption } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberPassPage() {
  return <MemberFrame testId="member-pass-page">{s => <PassPage session={s} />}</MemberFrame>;
}

interface Data { me: MeResponse; passes: Pass[]; upgrades: UpgradeOption[]; options: PaymentOptions | null; payments: PaymentRequest[] }

const STATUS_KEYS: Record<string, MessageKey> = {
  active: 'member.pass.status.active', expired: 'member.pass.status.expired', suspended: 'member.pass.status.suspended',
  payment_pending: 'member.pass.status.payment_pending',
};
const PAY_STATUS_KEYS: Record<string, MessageKey> = {
  pending: 'member.pass.pay.status.pending', approved: 'member.pass.pay.status.approved',
  rejected: 'member.pass.pay.status.rejected', cancelled: 'member.pass.pay.status.cancelled',
};

function PassPage({ session }: { session: MemberSession | null }) {
  const { t, locale } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [choice, setChoice] = useState<string>('');
  const [target, setTarget] = useState<PayTarget | null>(null);
  const [chooseError, setChooseError] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const me = await memberApi.me();
      const active = isActive(me);
      const [passes, upgrades, options, payments] = await Promise.all([
        memberApi.passes(),
        active ? memberApi.upgradeOptions().catch(() => []) : Promise.resolve([]),
        memberApi.paymentOptions().catch(() => null),
        memberApi.payments().catch(() => []),
      ]);
      setData({ me, passes, upgrades, options, payments }); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'error' || !data) return <LoadError onRetry={load} />;

  const { me, passes, upgrades, options, payments } = data;
  const sub = passOf(me);
  const active = isActive(me);
  const v = passVisits(me);
  const pending = me.pendingPayment;

  if (target) {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title={t('member.pass.title')} />
        <PayPanel target={target} options={options} defaultPhone={session?.user.phone ?? ''}
          onBack={() => { setTarget(null); void load(); }} />
      </div>
    );
  }

  const choices = active
    ? upgrades.map(u => ({ key: u.tier, label: u.label, visits: u.visits ?? null, amount: u.differenceTzs, kind: 'upgrade' as const }))
    : passes.map(p => ({ key: p.key, label: p.label, visits: p.visitCap ?? p.visits ?? null, amount: p.price, kind: 'subscribe' as const }));

  const proceed = () => {
    const c = choices.find(x => x.key === choice);
    if (!c) { setChooseError(true); return; }
    setTarget({
      label: c.label, amountTzs: c.amount, product: 'FITFLEX_PASS', manual: true,
      create: async extra => {
        const body = { tier: c.key, ...(extra ?? {}) };
        const r = c.kind === 'upgrade' ? await memberApi.upgrade(body) : await memberApi.subscribe(body);
        return { id: r.paymentRequest.id, amountTzs: r.paymentRequest.amountTzs };
      },
    });
  };

  return (
    <>
      <PageTitle title={t('member.pass.title')} />
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <div className="flex flex-col gap-4">
          <section aria-labelledby="pass-current" className={`${card} flex flex-col gap-2`} data-testid="member-pass-current">
            <h2 id="pass-current" className="text-sm font-semibold uppercase tracking-wider text-[#94a3b8]">{t('member.pass.current')}</h2>
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-3xl font-black">{tierLabel(sub.tier, passes)}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-[#134e48] text-[#ccfbef]' : 'bg-[#1e293b] text-[#cbd5e1]'}`}>
                    {t(STATUS_KEYS[sub.status] ?? 'member.pass.status.other')}
                  </span>
                </div>
                {sub.expiresAt && <p className={muted}>{fmt(t('member.pass.endsOn'), { date: formatDate(sub.expiresAt, locale) })}</p>}
                {v && (v.cap != null
                  ? <p className="tabular-nums">{fmt(t('member.pass.visits'), { used: v.used, cap: v.cap })}</p>
                  : <p className="tabular-nums">{fmt(t('member.today.visitsUnlimited'), { used: v.used })}</p>)}
              </>
            ) : <p>{t('member.pass.none')}</p>}
          </section>

          {pending && (
            <section className="flex flex-col gap-3 rounded-3xl border-2 border-[#ff8a6b] bg-[#0f172a] p-6" data-testid="member-pass-pending">
              <p>{fmt(t('member.pay.pendingExisting'), { amount: formatTzs(pending.amountTzs, locale), tier: tierLabel(pending.tier, passes) })}</p>
              {/* A Lipa Namba payment already sent with its transaction ID (memberReference): it waits for the team. */}
              {(pending.memberReference || (pending.reference && pending.provider !== 'tunzaa'))
                ? <p className={muted}>{t('member.pay.pendingManual')}</p>
                : (
                  <button type="button" className="inline-flex min-h-11 items-center justify-center self-start rounded-full bg-[#c8f04a] px-5 text-sm font-extrabold text-[#020617]"
                    onClick={() => setTarget({ label: tierLabel(pending.tier, passes), amountTzs: pending.amountTzs, product: 'FITFLEX_PASS', paymentId: pending.id })}
                    data-testid="member-pass-pay-existing">
                    {t('member.pay.continueExisting')}
                  </button>
                )}
            </section>
          )}
        </div>

        {!pending && (
          <section aria-labelledby="pass-choose" className={`${card} flex flex-col gap-4`} data-testid="member-pass-choose">
            <div>
              <h2 id="pass-choose" className="text-xl font-extrabold">{t(active ? 'member.pass.upgradeTitle' : 'member.pass.plansTitle')}</h2>
              {active && <p className={`mt-1 text-sm ${muted}`}>{t(choices.length ? 'member.pass.upgradeBody' : 'member.pass.noUpgrades')}</p>}
            </div>
            {choices.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{t(active ? 'member.pass.upgradeTitle' : 'member.pass.plansTitle')}</legend>
                {choices.map(c => (
                  <label key={c.key} className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 ${choice === c.key ? 'border-2 border-[#c8f04a]' : 'border-[#334155]'}`}>
                    <span className="flex items-center gap-3">
                      <input type="radio" name="member-pass" value={c.key} checked={choice === c.key} className="h-5 w-5 accent-[#c8f04a]"
                        onChange={() => { setChoice(c.key); setChooseError(false); }} data-testid={`member-pass-option-${c.key}`} />
                      <span className="flex flex-col">
                        <strong>{c.label}</strong>
                        <span className={`text-sm ${muted}`}>{unlimited(c.visits) ? t('member.pass.planUnlimited') : fmt(t('member.pass.planVisits'), { n: c.visits as number })}</span>
                      </span>
                    </span>
                    <strong className="tabular-nums">
                      {c.kind === 'upgrade' ? fmt(t('member.pass.difference'), { amount: formatTzs(c.amount, locale) }) : fmt(t('member.pass.planPrice'), { amount: formatTzs(c.amount, locale) })}
                    </strong>
                  </label>
                ))}
              </fieldset>
            )}
            {chooseError && <p role="alert" className="text-sm text-[#ff8a6b]">{t('member.pass.selectFirst')}</p>}
            {choices.length > 0 && (
              <button type="button" onClick={proceed} data-testid="member-pass-continue"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#c8f04a] px-6 font-extrabold text-[#020617]">
                {t('member.pass.continue')}
              </button>
            )}
            {active && <p className={`text-sm ${muted}`}>{t('member.pass.renewLater')}</p>}
          </section>
        )}
      </div>

      <section aria-labelledby="pass-history" className={`${card} mt-4`}>
        <h2 id="pass-history" className="mb-2 text-xl font-extrabold">{t('member.pass.historyTitle')}</h2>
        {payments.length === 0 ? <p className={muted}>{t('member.pass.historyEmpty')}</p> : (
          <ul className="divide-y divide-[#1e293b]" data-testid="member-pass-history">
            {payments.slice(0, 12).map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <strong>{p.eventTitle || p.eventName || p.gym?.name || tierLabel(p.tier, passes) || t('member.unknown')}</strong>
                  <span className={`text-sm ${muted}`}>{formatDate(p.requestedAt, locale)}</span>
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span>{formatTzs(p.amountTzs, locale)}</span>
                  <span className="rounded-full bg-[#1e293b] px-2.5 py-0.5 text-xs font-bold">{t(PAY_STATUS_KEYS[p.status] ?? 'member.pass.pay.status.other')}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
