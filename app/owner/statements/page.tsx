'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { api, Gym, OwnerStatement, OwnerStatementDetail, OwnerStatementStatus } from '@/lib/api';
import { BadgeTone, money } from '@/lib/admin-utils';
import { signed } from '@/lib/settlements';
import { Alert, Badge, Card, CardContent, CardHeader, EmptyState, MetricCard, PageHeader, Spinner } from '@/components/shared';
import { useApp } from '../../providers';

const EN = {
  title: 'Statements', subtitle: 'What FitFlex owes your gym each month for pass and sponsored visits, and when it was paid.',
  gym: 'Gym', allGyms: 'All gyms', none: 'No statements yet.', noneHint: 'Your first statement appears after the end of the month.',
  failed: 'Could not load your statements.', back: 'All statements',
  month: 'Month', members: 'Members', visits: 'Visits', earned: 'Earned', toPay: 'To be paid', paid: 'Paid', status: 'Status',
  status_preparing: 'Being prepared', status_in_review: 'In review', status_approved: 'Approved', status_payment_due: 'Payment due', status_paid: 'Paid',
  onHold: 'On hold', onHoldHint: 'This statement is on hold while FitFlex checks something. We will contact you if we need anything.',
  preparingHint: 'These amounts can still change until the statement is approved.',
  earnedLabel: 'Earned at your rates', network: 'Network adjustment', networkHint: 'Limit on what one member’s plan pays out',
  adjustments: 'Adjustments', carried: (v: string) => `${v} could not be recovered from this statement and is carried forward to your next one.`,
  visitsMembers: (v: number, m: number) => `${v} visits · ${m} members`,
  paidOn: 'Paid on', reference: 'Payment reference', account: 'Payout account', receipt: 'Receipt',
  membersTitle: 'Members', membersHint: 'One row per member for the month. Open a row for the visit dates.',
  member: 'Member', fundedBy: 'Paid by', pass: 'Pass', sponsored: 'Sponsored', rate: 'Rate used', final: 'Final',
  bracket_daily: 'Daily rate', bracket_weekly: 'One week', bracket_double_weekly: 'Two weeks', bracket_monthly: 'Month',
  yourRates: (d: string, w: string, m: string) => `Your rates: daily ${d} · weekly ${w} · monthly ${m}`,
  adjustmentsTitle: 'Adjustments', type_correction: 'Correction', type_clawback: 'Clawback', type_manual: 'Adjustment', type_carry_forward: 'Carried forward',
  locale: 'en-GB',
};
const SW: typeof EN = {
  title: 'Taarifa za malipo', subtitle: 'Kiasi ambacho FitFlex inadaiwa na gym yako kila mwezi kwa ziara za pasi na za wadhamini, na lini kililipwa.',
  gym: 'Gym', allGyms: 'Gym zote', none: 'Bado hakuna taarifa.', noneHint: 'Taarifa yako ya kwanza itaonekana baada ya mwisho wa mwezi.',
  failed: 'Imeshindikana kupakia taarifa zako.', back: 'Taarifa zote',
  month: 'Mwezi', members: 'Wanachama', visits: 'Ziara', earned: 'Mapato', toPay: 'Kitakacholipwa', paid: 'Kimelipwa', status: 'Hali',
  status_preparing: 'Inaandaliwa', status_in_review: 'Inakaguliwa', status_approved: 'Imeidhinishwa', status_payment_due: 'Inasubiri malipo', status_paid: 'Imelipwa',
  onHold: 'Imesitishwa', onHoldHint: 'Taarifa hii imesitishwa wakati FitFlex inakagua jambo. Tutawasiliana nawe tukihitaji chochote.',
  preparingHint: 'Kiasi hiki kinaweza kubadilika hadi taarifa itakapoidhinishwa.',
  earnedLabel: 'Mapato kwa bei zako', network: 'Marekebisho ya mtandao', networkHint: 'Kikomo cha malipo ya mpango wa mwanachama mmoja',
  adjustments: 'Marekebisho', carried: (v: string) => `${v} haikuweza kurejeshwa kwenye taarifa hii na imehamishiwa kwenye taarifa yako ijayo.`,
  visitsMembers: (v: number, m: number) => `Ziara ${v} · wanachama ${m}`,
  paidOn: 'Ililipwa tarehe', reference: 'Kumbukumbu ya malipo', account: 'Akaunti ya malipo', receipt: 'Risiti',
  membersTitle: 'Wanachama', membersHint: 'Mstari mmoja kwa kila mwanachama kwa mwezi. Fungua mstari kuona tarehe za ziara.',
  member: 'Mwanachama', fundedBy: 'Amelipiwa na', pass: 'Pasi', sponsored: 'Mdhamini', rate: 'Bei iliyotumika', final: 'Mwisho',
  bracket_daily: 'Bei ya siku', bracket_weekly: 'Wiki moja', bracket_double_weekly: 'Wiki mbili', bracket_monthly: 'Mwezi',
  yourRates: (d: string, w: string, m: string) => `Bei zako: siku ${d} · wiki ${w} · mwezi ${m}`,
  adjustmentsTitle: 'Marekebisho', type_correction: 'Sahihisho', type_clawback: 'Marejesho', type_manual: 'Marekebisho', type_carry_forward: 'Kimehamishwa',
  locale: 'sw-TZ',
};

const TONE: Record<OwnerStatementStatus, BadgeTone> = { preparing: 'gray', in_review: 'warning', approved: 'brand', payment_due: 'warning', paid: 'success' };
const th = 'px-4 py-2.5 font-medium';

/** Owner / gym staff with the payments permission: the gym's monthly statements. Read-only. */
export default function OwnerStatementsPage() {
  const { token, locale } = useApp();
  const copy = locale === 'sw' ? SW : EN;
  const text = (key: string) => (copy as unknown as Record<string, string>)[key];
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState('');
  const [rows, setRows] = useState<OwnerStatement[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OwnerStatementDetail | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const utc = (date: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(copy.locale, { ...opts, timeZone: 'UTC' });
  };
  const month = (s: OwnerStatement) => utc(s.periodStartDate, { month: 'long', year: 'numeric' });
  const day = (date: string) => utc(date, { day: 'numeric', month: 'short' });

  // The open statement lives in the URL so it survives a refresh and can be shared.
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('statement'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?statement=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };

  useEffect(() => {
    if (!token) return;
    api.ownerGyms(token).then(setGyms).catch(() => setGyms([]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(false);
    try {
      setRows(await api.ownerSettlements(token, gymId || undefined));
    } catch {
      setRows([]);
      setError(true);
    }
  }, [token, gymId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setDetail(null);
    setOpenLine(null);
    if (!token || !openId) return;
    api.ownerSettlement(token, openId).then(setDetail).catch(() => setError(true));
  }, [token, openId]);

  const status = (s: OwnerStatement) => (
    <>
      <Badge tone={TONE[s.status]}>{text(`status_${s.status}`)}</Badge>
      {s.onHold && <span className="ml-2"><Badge tone="danger">{copy.onHold}</Badge></span>}
    </>
  );

  if (openId) {
    const s = detail?.statement;
    return (
      <div className="space-y-6">
        <button onClick={() => open(null)} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="statement-back"><ArrowLeft className="h-4 w-4" />{copy.back}</button>
        {error && <Alert tone="error">{copy.failed}</Alert>}
        {!detail || !s ? (!error && <Spinner className="h-6 w-6" />) : (
          <>
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{month(s)}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-quaternary)]">{s.gymName}{status(s)}</p>
            </div>
            {s.onHold && <Alert tone="warning">{copy.onHoldHint}</Alert>}
            {s.status === 'preparing' && <Alert tone="info">{copy.preparingHint}</Alert>}
            {s.carriedForwardTzs > 0 && <Alert tone="info">{copy.carried(money(s.carriedForwardTzs))}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label={copy.earnedLabel} value={money(s.earnedTzs)} sub={copy.visitsMembers(s.visits, s.members)} />
              <MetricCard label={copy.network} value={signed(-s.networkAdjustmentTzs)} sub={copy.networkHint} />
              <MetricCard label={copy.adjustments} value={signed(s.adjustmentsTzs)} />
              <MetricCard label={s.status === 'paid' ? copy.paid : copy.toPay} value={<span data-testid="statement-net">{money(s.payableTzs)}</span>} />
            </div>

            {s.status === 'paid' && (
              <Card>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{copy.paidOn}</p><p className="font-medium">{s.paidAt ? day(s.paidAt) : '—'}</p></div>
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{copy.reference}</p><p className="font-medium" data-testid="statement-reference">{s.paymentReference || '—'}{s.receiptUrl && <a className="ml-2 underline" href={s.receiptUrl} target="_blank" rel="noreferrer">{copy.receipt}</a>}</p></div>
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{copy.account}</p><p className="font-medium">{s.payoutAccountLast4 ? `····${s.payoutAccountLast4}` : '—'}</p></div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><div><h2 className="font-semibold">{copy.membersTitle}</h2><p className="text-sm text-[var(--color-fg-quaternary)]">{copy.membersHint}</p></div></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm" data-testid="statement-lines">
                    <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                      <tr className="border-b border-[var(--color-border-secondary)]">
                        <th className={th}>{copy.member}</th><th className={th}>{copy.fundedBy}</th><th className={`${th} text-right`}>{copy.visits}</th>
                        <th className={th}>{copy.rate}</th><th className={`${th} text-right`}>{copy.earned}</th><th className={`${th} text-right`}>{copy.network}</th><th className={`${th} text-right`}>{copy.final}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {detail.lines.map((l, i) => (
                        <Fragment key={i}>
                          <tr className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => setOpenLine(openLine === i ? null : i)} data-testid={`statement-line-${i}`}>
                            <td className="px-4 py-3"><span className="flex items-center gap-1.5 font-medium">{openLine === i ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{l.memberCode || copy.member}</span></td>
                            <td className="px-4 py-3">{l.funding === 'sponsored' ? copy.sponsored : copy.pass}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{l.visits}</td>
                            <td className="px-4 py-3">{text(`bracket_${l.bracket}`) ?? '—'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(l.earnedTzs)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{l.networkAdjustmentTzs ? signed(-l.networkAdjustmentTzs) : '—'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(l.finalTzs)}</td>
                          </tr>
                          {openLine === i && (
                            <tr>
                              <td colSpan={7} className="bg-[var(--color-bg-secondary)] px-4 py-3">
                                {l.rates && <p className="mb-2 text-xs text-[var(--color-fg-tertiary)]">{copy.yourRates(money(l.rates.dailyTzs), money(l.rates.weeklyTzs), money(l.rates.monthlyTzs))}</p>}
                                <ul className="flex flex-wrap gap-2 text-xs">
                                  {l.visitDates.map((d, j) => <li key={j} className="rounded-md border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] px-2 py-1">{day(d)}</li>)}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {detail.adjustments.length > 0 && (
              <Card>
                <CardHeader><h2 className="font-semibold">{copy.adjustmentsTitle}</h2></CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="statement-adjustments">
                    {detail.adjustments.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div><p className="font-medium">{text(`type_${a.type}`) ?? a.type}</p><p className="text-[var(--color-fg-quaternary)]">{a.reason}</p></div>
                        <span className="whitespace-nowrap tabular-nums">{signed(a.amountTzs)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.subtitle}
        actions={gyms.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            {copy.gym}
            <select className="ui-input" value={gymId} onChange={e => { setRows(null); setGymId(e.target.value); }} data-testid="statement-gym-select">
              <option value="">{copy.allGyms}</option>
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {error && <Alert tone="error">{copy.failed}</Alert>}
      {rows == null ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? (!error && <EmptyState title={copy.none} body={copy.noneHint} />) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm" data-testid="statement-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className={th}>{copy.month}</th>
                    {gyms.length > 1 && <th className={th}>{copy.gym}</th>}
                    <th className={`${th} text-right`}>{copy.visits}</th><th className={`${th} text-right`}>{copy.earned}</th>
                    <th className={`${th} text-right`}>{copy.toPay}</th><th className={th}>{copy.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {rows.map(s => (
                    <tr key={s.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(s.id)} data-testid={`statement-row-${s.id}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">{month(s)}</td>
                      {gyms.length > 1 && <td className="px-4 py-3">{s.gymName}</td>}
                      <td className="px-4 py-3 text-right tabular-nums">{s.visits}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(s.earnedTzs)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(s.payableTzs)}</td>
                      <td className="px-4 py-3">{status(s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
