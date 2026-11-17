'use client';
import { useEffect, useState } from 'react';
import { Alert, Card, CardContent, MetricCard, Table, TBody, Td, Th, THead, Tr } from './shared';
import { useGymPassFormat } from './gym-pass-shared';
import { fill } from './communication-shared';
import { gymPassesApi, type PassMembership, type PassSummary } from '@/lib/gym-passes';
import { money } from '@/lib/admin-utils';
import { useApp } from '../../app/providers';
import type { MessageKey } from '@/lib/i18n';

export interface DateRange { from: string; to: string }
const LIST_MAX = 100;
const DAY_MS = 86_400_000;
const num = (n: number | undefined | null) => (typeof n === 'number' ? n : '—');

/** True when the server sent any of the analytics keys (they exist only while its flag is on). */
export const hasAnalytics = (s: PassSummary | null) => !!s && (!!s.byPlan || !!s.expiring || !!s.utilisation || !!s.groups);

/**
 * Owner (scope payments for the figures, members for the lists): by-pass sales, expiring, visits and group fill, with an
 * optional approval-date range. Every figure is shown as the server gave it; a missing key reads as "not available".
 */
export function GymPassAnalytics({ gymId, summary, range, onRange, canMembers }: {
  gymId: string; summary: PassSummary; range: DateRange; onRange: (r: DateRange) => void; canMembers: boolean;
}) {
  const { token, t } = useApp();
  const fmtr = useGymPassFormat();
  const [rows, setRows] = useState<PassMembership[] | null>(null);

  // People lists: running passes already served by pass-memberships (no new endpoint).
  useEffect(() => {
    if (!token || !canMembers) return;
    let live = true;
    gymPassesApi.memberships(token, gymId, { state: 'active', limit: LIST_MAX }).then(r => { if (live) setRows(r.memberships); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [token, gymId, canMembers, summary]);

  const { byPlan, expiring, utilisation: u, groups } = summary;
  const invalid = !!range.from && !!range.to && range.to <= range.from;
  const now = Date.now();
  const withinDays = expiring?.withinDays;
  const expiringRows = (rows ?? []).filter(m => withinDays != null && m.expiresAt && +new Date(m.expiresAt) > now && +new Date(m.expiresAt) <= now + withinDays * DAY_MS);
  const neverRows = (rows ?? []).flatMap(m => m.beneficiaries.filter(p => p.status === 'active' && p.attendance?.visits === 0).map(p => ({ m, p })));

  return (
    <section className="space-y-4" data-testid="gp-analytics" aria-label={t('gp.an.title')}>
      <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('gp.an.title')}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-[var(--color-fg-quaternary)]">{t('gp.an.range.from')}</span>
          <input className="ui-input !w-auto" type="date" value={range.from} max={range.to || undefined} onChange={e => onRange({ ...range, from: e.target.value })} data-testid="gp-range-from" />
        </label>
        <label className="text-sm">
          <span className="block text-[var(--color-fg-quaternary)]">{t('gp.an.range.to')}</span>
          <input className="ui-input !w-auto" type="date" value={range.to} min={range.from || undefined} onChange={e => onRange({ ...range, to: e.target.value })} data-testid="gp-range-to" />
        </label>
        {(range.from || range.to) && (
          <button type="button" className="min-h-11 text-sm underline" onClick={() => onRange({ from: '', to: '' })} data-testid="gp-range-clear">{t('gp.an.range.clear')}</button>
        )}
      </div>
      <p className="text-xs text-[var(--color-fg-quaternary)]" data-testid="gp-range-note">{t('gp.an.range.note')}</p>
      {invalid && <Alert tone="warning">{t('gp.an.range.invalid')}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="gp-utilisation">
        <MetricCard wrapLabel label={t('gp.an.expiring')} value={<span data-testid="gp-an-expiring">{num(expiring?.people)}</span>}
          sub={expiring ? fill(t('gp.an.expiringSub'), { purchases: expiring.purchases, days: expiring.withinDays }) : t('gp.an.unavailable')} />
        <MetricCard wrapLabel label={t('gp.an.visits')} value={<span data-testid="gp-an-visits">{num(u?.visits)}</span>} sub={u ? t('gp.an.visitsSub') : t('gp.an.unavailable')} />
        <MetricCard wrapLabel label={t('gp.an.withVisit')} value={<span data-testid="gp-an-with-visit">{num(u?.peopleWithVisit)}</span>} sub={u ? fill(t('gp.an.withVisitSub'), { n: u.activePeople }) : t('gp.an.unavailable')} />
        <MetricCard wrapLabel label={t('gp.an.never')} value={<span data-testid="gp-an-never">{num(u?.peopleNeverVisited)}</span>} sub={u ? fill(t('gp.an.neverSub'), { n: u.activePeople }) : t('gp.an.unavailable')} />
        <MetricCard wrapLabel label={t('gp.an.perPerson')} value={<span data-testid="gp-an-per-person">{u ? u.visitsPerActivePerson.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span>} sub={u ? t('gp.an.perPersonSub') : t('gp.an.unavailable')} />
        <MetricCard wrapLabel label={t('gp.an.groupFill')} value={<span data-testid="gp-an-group-fill">{groups ? fill(t('gp.an.groupFillValue'), { filled: groups.filled, slots: groups.slots }) : '—'}</span>}
          sub={groups ? fill(t('gp.an.groupFillSub'), { rate: `${Math.round(groups.fillRate * 1000) / 10}%` }) : t('gp.an.unavailable')} />
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-semibold">{t('gp.an.byPlan')}</h3>
          {!byPlan ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('gp.an.unavailable')}</p> : byPlan.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="gp-byplan-empty">{t('gp.an.byPlan.empty')}</p>
          ) : (
            <Table aria-label={t('gp.an.byPlan.table')}>
              <THead><Tr><Th>{t('gp.sales.col.pass')}</Th><Th>{t('gp.an.col.sales')}</Th><Th>{t('gp.an.col.revenue')}</Th><Th>{t('gp.an.col.people')}</Th></Tr></THead>
              <TBody>
                {byPlan.map(r => (
                  <Tr key={r.planId} data-testid="gp-byplan-row">
                    <Td><div className="font-medium">{r.name || '—'}</div><div className="text-xs text-[var(--color-fg-quaternary)]">{t(`gp.category.${r.category}` as MessageKey)}</div></Td>
                    <Td className="tabular-nums">{r.sales}</Td><Td className="tabular-nums whitespace-nowrap">{money(r.revenueTzs)}</Td><Td className="tabular-nums">{r.people}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canMembers && rows && (u || expiring) && (
        <div className="space-y-3" data-testid="gp-lists">
          <p className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('gp.an.lists.note'), { n: LIST_MAX })}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {u && (
              <Card><CardContent className="space-y-3">
                <h3 className="text-sm font-semibold">{t('gp.an.lists.never')}</h3>
                {neverRows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('gp.an.lists.empty')}</p> : (
                  <Table aria-label={t('gp.an.lists.never')}>
                    <THead><Tr><Th>{t('gp.an.lists.person')}</Th><Th>{t('gp.an.lists.pass')}</Th><Th>{t('gp.an.lists.ends')}</Th></Tr></THead>
                    <TBody>{neverRows.map(({ m, p }) => (
                      <Tr key={p.id} data-testid="gp-never-row"><Td>{p.displayName || t('gp.mem.noName')}</Td><Td>{m.plan.name}</Td><Td className="whitespace-nowrap">{fmtr.date(m.expiresAt)}</Td></Tr>
                    ))}</TBody>
                  </Table>
                )}
              </CardContent></Card>
            )}
            {expiring && (
              <Card><CardContent className="space-y-3">
                <h3 className="text-sm font-semibold">{fill(t('gp.an.lists.expiring'), { days: expiring.withinDays })}</h3>
                {expiringRows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('gp.an.lists.empty')}</p> : (
                  <Table aria-label={fill(t('gp.an.lists.expiring'), { days: expiring.withinDays })}>
                    <THead><Tr><Th>{t('gp.an.lists.pass')}</Th><Th>{t('gp.an.lists.people')}</Th><Th>{t('gp.an.lists.ends')}</Th></Tr></THead>
                    <TBody>{expiringRows.map(m => (
                      <Tr key={m.id} data-testid="gp-expiring-row"><Td>{m.plan.name}<div className="text-xs text-[var(--color-fg-quaternary)]">{m.purchaser?.displayName || t('gp.sales.buyerUnknown')}</div></Td><Td className="tabular-nums">{m.beneficiaries.filter(p => p.status !== 'removed').length}</Td><Td className="whitespace-nowrap">{fmtr.date(m.expiresAt)}</Td></Tr>
                    ))}</TBody>
                  </Table>
                )}
              </CardContent></Card>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
