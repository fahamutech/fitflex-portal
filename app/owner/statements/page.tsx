'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { api, Gym, OwnerStatement, OwnerStatementDetail, OwnerStatementStatus } from '@/lib/api';
import { BadgeTone, money } from '@/lib/admin-utils';
import { signed } from '@/lib/settlements';
import { MessageKey, messages } from '@/lib/i18n';
import { fill } from '@/components/communication-shared';
import { Alert, Badge, Card, CardContent, CardHeader, EmptyState, MetricCard, PageHeader, Spinner } from '@/components/shared';
import { useApp } from '../../providers';

const TONE: Record<OwnerStatementStatus, BadgeTone> = { preparing: 'gray', in_review: 'warning', approved: 'brand', payment_due: 'warning', paid: 'success' };
const th = 'px-4 py-2.5 font-medium';

/** Owner / gym staff with the payments permission: the gym's monthly statements. Read-only. */
export default function OwnerStatementsPage() {
  const { token, locale, t } = useApp();
  const dateLocale = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  // A status, rate or adjustment type the portal has no label for yet.
  const text = (key: string): string | undefined => (key in messages.en ? t(key as MessageKey) : undefined);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState('');
  const [rows, setRows] = useState<OwnerStatement[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OwnerStatementDetail | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const utc = (date: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(dateLocale, { ...opts, timeZone: 'UTC' });
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
      <Badge tone={TONE[s.status]}>{t(`statements.status.${s.status}`)}</Badge>
      {s.onHold && <span className="ml-2"><Badge tone="danger">{t('statements.onHold')}</Badge></span>}
    </>
  );

  if (openId) {
    const s = detail?.statement;
    return (
      <div className="space-y-6">
        <button onClick={() => open(null)} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="statement-back"><ArrowLeft className="h-4 w-4" />{t('statements.back')}</button>
        {error && <Alert tone="error">{t('statements.failed')}</Alert>}
        {!detail || !s ? (!error && <Spinner className="h-6 w-6" />) : (
          <>
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{month(s)}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-quaternary)]">{s.gymName}{status(s)}</p>
            </div>
            {s.onHold && <Alert tone="warning">{t('statements.onHoldHint')}</Alert>}
            {s.status === 'preparing' && <Alert tone="info">{t('statements.preparingHint')}</Alert>}
            {s.carriedForwardTzs > 0 && <Alert tone="info">{fill(t('statements.carried'), { amount: money(s.carriedForwardTzs) })}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label={t('statements.earnedLabel')} value={money(s.earnedTzs)} sub={fill(t('statements.visitsMembers'), { visits: s.visits, members: s.members })} />
              <MetricCard label={t('statements.network')} value={signed(-s.networkAdjustmentTzs)} sub={t('statements.networkHint')} />
              <MetricCard label={t('statements.adjustments')} value={signed(s.adjustmentsTzs)} />
              <MetricCard label={s.status === 'paid' ? t('statements.paid') : t('statements.toPay')} value={<span data-testid="statement-net">{money(s.payableTzs)}</span>} />
            </div>

            {s.status === 'paid' && (
              <Card>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{t('statements.paidOn')}</p><p className="font-medium">{s.paidAt ? day(s.paidAt) : '—'}</p></div>
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{t('statements.reference')}</p><p className="font-medium" data-testid="statement-reference">{s.paymentReference || '—'}{s.receiptUrl && <a className="ml-2 underline" href={s.receiptUrl} target="_blank" rel="noreferrer">{t('statements.receipt')}</a>}</p></div>
                  <div><p className="text-xs text-[var(--color-fg-tertiary)]">{t('statements.account')}</p><p className="font-medium">{s.payoutAccountLast4 ? `····${s.payoutAccountLast4}` : '—'}</p></div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><div><h2 className="font-semibold">{t('statements.membersTitle')}</h2><p className="text-sm text-[var(--color-fg-quaternary)]">{t('statements.membersHint')}</p></div></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm" data-testid="statement-lines">
                    <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                      <tr className="border-b border-[var(--color-border-secondary)]">
                        <th className={th}>{t('statements.member')}</th><th className={th}>{t('statements.fundedBy')}</th><th className={`${th} text-right`}>{t('statements.visits')}</th>
                        <th className={th}>{t('statements.rate')}</th><th className={`${th} text-right`}>{t('statements.earned')}</th><th className={`${th} text-right`}>{t('statements.network')}</th><th className={`${th} text-right`}>{t('statements.final')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {detail.lines.map((l, i) => (
                        <Fragment key={i}>
                          <tr className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => setOpenLine(openLine === i ? null : i)} data-testid={`statement-line-${i}`}>
                            <td className="px-4 py-3"><span className="flex items-center gap-1.5 font-medium">{openLine === i ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{l.memberCode || t('statements.member')}</span></td>
                            <td className="px-4 py-3">{l.funding === 'sponsored' ? t('statements.sponsored') : t('statements.pass')}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{l.visits}</td>
                            <td className="px-4 py-3">{text(`statements.bracket.${l.bracket}`) ?? '—'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(l.earnedTzs)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{l.networkAdjustmentTzs ? signed(-l.networkAdjustmentTzs) : '—'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(l.finalTzs)}</td>
                          </tr>
                          {openLine === i && (
                            <tr>
                              <td colSpan={7} className="bg-[var(--color-bg-secondary)] px-4 py-3">
                                {l.rates && <p className="mb-2 text-xs text-[var(--color-fg-tertiary)]">{fill(t('statements.yourRates'), { daily: money(l.rates.dailyTzs), weekly: money(l.rates.weeklyTzs), monthly: money(l.rates.monthlyTzs) })}</p>}
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
                <CardHeader><h2 className="font-semibold">{t('statements.adjustments')}</h2></CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="statement-adjustments">
                    {detail.adjustments.map((a, i) => (
                      <li key={i} className="flex items-start justify-between gap-4 px-4 py-3">
                        <div><p className="font-medium">{text(`statements.type.${a.type}`) ?? a.type}</p><p className="text-[var(--color-fg-quaternary)]">{a.reason}</p></div>
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
        title={t('statements.title')}
        description={t('statements.subtitle')}
        actions={gyms.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            {t('dash.gym')}
            <select className="ui-input" value={gymId} onChange={e => { setRows(null); setGymId(e.target.value); }} data-testid="statement-gym-select">
              <option value="">{t('dash.allGyms')}</option>
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {error && <Alert tone="error">{t('statements.failed')}</Alert>}
      {rows == null ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? (!error && <EmptyState title={t('statements.none')} body={t('statements.noneHint')} />) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm" data-testid="statement-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className={th}>{t('statements.month')}</th>
                    {gyms.length > 1 && <th className={th}>{t('dash.gym')}</th>}
                    <th className={`${th} text-right`}>{t('statements.visits')}</th><th className={`${th} text-right`}>{t('statements.earned')}</th>
                    <th className={`${th} text-right`}>{t('statements.toPay')}</th><th className={th}>{t('statements.status')}</th>
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
