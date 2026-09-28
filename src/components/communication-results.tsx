'use client';
// Results (M10) in the Communication Center: Delivery, Engagement and
// Business for a campaign, an automation or a period, with attributed
// revenue. "—" means there's no data (push can't confirm delivery; a
// message whose button only opens it has no action to complete).

import { useEffect, useState } from 'react';
import { CommsResults } from '@/lib/api';
import { Alert, Card, Spinner } from './shared';
import { T, errorText, fill, when } from './communication-shared';

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null | undefined, of: number) => (n == null || !of ? '' : ` · ${Math.round((n * 100) / of)}%`);

export function ResultsView({ t, r, conversions = true }: { t: T; r: CommsResults; conversions?: boolean }) {
  const m = r.members;
  const row = (key: string, value: number | null | undefined, withPct = false) => (
    <div key={key} className="flex justify-between py-0.5 text-sm" data-testid={`result-${key}`}>
      <span className="text-[var(--color-fg-tertiary)]">{t(`comms.results.${key}`)}</span>
      <span className="font-semibold tabular-nums">{value == null ? '—' : `${value}${withPct ? pct(value, m.recipients) : ''}`}</span>
    </div>
  );
  const group = (key: string, rows: React.ReactNode) => (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand-700)]">{t(`comms.results.group.${key}`)}</p>
      {rows}
    </div>
  );
  return (
    <div className="space-y-3" data-testid="results">
      <div className="grid gap-4 sm:grid-cols-3">
        {group('delivery', <>{row('recipients', m.recipients)}{row('sent', m.sent)}{row('delivered', m.delivered)}{row('failed', m.failed)}</>)}
        {group('engagement', <>{row('opened', m.opened, true)}{row('clicked', m.clicked, true)}{row('ctaCompleted', m.ctaCompleted, true)}</>)}
        {group('business', (
          <>
            {row('renewed', m.renewed)}{row('paid', m.paid)}
            <div className="mt-1 flex justify-between border-t border-[var(--color-border-secondary)] pt-1" data-testid="result-revenue">
              <span className="text-sm">{t('comms.results.revenue')}</span>
              <span className="text-base font-semibold tabular-nums">{tzs(r.revenue.attributedTzs)}</span>
            </div>
          </>
        ))}
      </div>
      <p className="text-xs text-[var(--color-fg-quaternary)]">
        {t('comms.results.attribution').replace('{click}', String(r.attribution.clickWindowDays)).replace('{open}', String(r.attribution.openWindowDays))}
      </p>
      {conversions && r.conversions && r.conversions.length > 0 && (
        <div data-testid="result-conversions">
          <p className="mb-1 text-sm font-semibold">{t('comms.results.whoPaid')}</p>
          {r.conversions.map(c => (
            <p key={c.paymentId} className="text-xs text-[var(--color-fg-tertiary)]">
              {[c.memberName || t('comms.history.unknownMember'), tzs(c.amountTzs), t(c.renewal ? 'comms.results.renewal' : 'comms.results.firstPayment'),
                t(`comms.results.via.${c.via}`), when(c.paidAt)].filter(Boolean).join(' · ')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Loads results and shows them in a card. */
export function ResultsPanel({ t, title, load, deps, conversions = true, children }: {
  t: T; title: string; load: () => Promise<CommsResults>; deps: unknown[]; conversions?: boolean;
  children?: (r: CommsResults) => React.ReactNode;
}) {
  const [r, setR] = useState<CommsResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setR(null); setError(null);
    load().then(setR).catch(e => setError(errorText(t, e)));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card className="space-y-3 p-4" data-testid="results-panel">
      <p className="text-sm font-semibold">{title}</p>
      {error ? <Alert tone="error">{error}</Alert> : !r ? <Spinner /> : (
        <>
          <ResultsView t={t} r={r} conversions={conversions} />
          {children?.(r)}
        </>
      )}
    </Card>
  );
}

/** The overview's list of campaigns and automations with their results. */
export function SourcesTable({ t, r, nameOf, onOpen }: {
  t: T; r: CommsResults; nameOf: (s: NonNullable<CommsResults['sources']>[number]) => string;
  onOpen?: (s: NonNullable<CommsResults['sources']>[number]) => void;
}) {
  if (!r.sources?.length) return null;
  return (
    <div className="overflow-x-auto" data-testid="result-sources">
      <p className="mb-1 text-sm font-semibold">{t('comms.results.bySource')}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--color-fg-quaternary)]">
            <th className="py-1 pr-3">{t('comms.results.source')}</th>
            <th className="py-1 pr-3 text-right">{t('comms.results.recipients')}</th>
            <th className="py-1 pr-3 text-right">{t('comms.results.opened')}</th>
            <th className="py-1 pr-3 text-right">{t('comms.results.clicked')}</th>
            <th className="py-1 pr-3 text-right">{t('comms.results.paid')}</th>
            <th className="py-1 text-right">{t('comms.results.revenue')}</th>
          </tr>
        </thead>
        <tbody>
          {r.sources.map(s => (
            <tr key={`${s.type}:${s.id}`} className="border-t border-[var(--color-border-secondary)]" data-testid={`source-${s.id}`}>
              <td className="py-1 pr-3">
                <button type="button" className="text-left hover:underline disabled:no-underline" disabled={!onOpen} onClick={() => onOpen?.(s)}>{nameOf(s)}</button>
                <span className="block text-xs text-[var(--color-fg-quaternary)]">{t(`comms.results.type.${s.type}`)}{s.lastSentAt ? ` · ${when(s.lastSentAt)}` : ''}</span>
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.recipients}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.opened}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.clicked}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{s.paid}</td>
              <td className="py-1 text-right tabular-nums">{tzs(s.attributedTzs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const periodTitle = (t: T, days: number) => fill(t('comms.results.lastDays'), { n: days });
