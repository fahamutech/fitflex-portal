'use client';
import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Play, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, GymSettlement, GymSettlementStatus, SettlementMode, SettlementRun } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { STATEMENT_STATUS, STATEMENT_TABS, lastMonth, period, settlementError, shortDay, skipReason } from '@/lib/settlements';
import { Alert, Badge, Button, Card, CardContent, Field, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { SettlementStatementView } from '@/components/settlement-statement';

type View = 'statements' | 'runs';

/**
 * Gym settlements: the statements each run produced, by where they stand, and
 * one statement at a time (?statement=<id>) to check, approve and pay.
 * Shadow runs are for checking the numbers and can never be paid.
 */
export default function SettlementsPage() {
  const { token, user, hasPermission } = useApp();
  const [view, setView] = useState<View>('statements');
  const [mode, setMode] = useState<SettlementMode>('live');
  const [rows, setRows] = useState<GymSettlement[] | null>(null);
  const [runs, setRuns] = useState<SettlementRun[] | null>(null);
  const [tab, setTab] = useState<GymSettlementStatus>('draft');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [statements, runRows] = await Promise.all([api.settlementStatements(token, { mode }), api.settlementRuns(token, mode)]);
      setRows(statements);
      setRuns(runRows);
    } catch (err) {
      setError(settlementError(err));
      setRows([]);
      setRuns([]);
    }
  }, [token, mode]);
  useEffect(() => { load(); }, [load]);

  if (!token || user?.userType !== 'admin') return null;

  if (openId) return <SettlementStatementView statementId={openId} onBack={() => { open(null); load(); }} />;

  const count = (s: GymSettlementStatus) => (rows ?? []).filter(r => r.status === s).length;
  const shown = (rows ?? []).filter(r => r.status === tab);
  const total = shown.reduce((sum, r) => sum + r.finalNetTzs, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gym settlements"
        description="What each gym is owed for a month of pass and sponsored visits. A statement is prepared, approved by someone else, then paid."
        actions={<>
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
          {hasPermission('settlements_prepare') && (
            <Button size="sm" onClick={() => setRunning(true)} data-testid="settlement-run-open"><Play className="h-4 w-4" />Run a month</Button>
          )}
        </>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {mode === 'shadow' && <Alert tone="info">Shadow statements are a trial calculation. They can’t be submitted, approved or paid.</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={v => setView(v as View)} options={[['statements', 'Statements'], ['runs', 'Runs']]} />
        <Segmented value={mode} onChange={v => { setRows(null); setRuns(null); setMode(v as SettlementMode); }} options={[['live', 'Live'], ['shadow', 'Shadow']]} />
      </div>

      {view === 'statements' ? (
        <>
          <div role="tablist" className="flex w-fit flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
            {STATEMENT_TABS.map(s => (
              <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} data-testid={`settlement-tab-${s}`}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
                {STATEMENT_STATUS[s].label}
                <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{count(s)}</span>
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
                  <HandCoins className="h-6 w-6" />
                  {rows.length === 0 ? 'No statements yet. They appear after a month has been run.' : `No ${STATEMENT_STATUS[tab].label.toLowerCase()} statements.`}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm" data-testid="settlement-table">
                    <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                      <tr className="border-b border-[var(--color-border-secondary)]">
                        <th className="px-4 py-2.5 font-medium">Gym</th>
                        <th className="px-4 py-2.5 font-medium">Month</th>
                        <th className="px-4 py-2.5 text-right font-medium">Members</th>
                        <th className="px-4 py-2.5 text-right font-medium">Visits</th>
                        <th className="px-4 py-2.5 text-right font-medium">Earned</th>
                        <th className="px-4 py-2.5 text-right font-medium">To pay</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-secondary)]">
                      {shown.map(r => (
                        <tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`settlement-row-${r.id}`}>
                          <td className="px-4 py-3">
                            <button className="text-left font-medium text-[var(--color-fg-primary)] hover:underline" onClick={e => { e.stopPropagation(); open(r.id); }}>
                              {r.gymName || 'Unnamed gym'}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{period(r)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.memberCycleCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.qualifyingVisitCount}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.preliminaryTzs)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(r.finalNetTzs)}</td>
                          <td className="px-4 py-3">
                            <Badge tone={STATEMENT_STATUS[r.status].tone}>{STATEMENT_STATUS[r.status].label}</Badge>
                            {r.holdReason && <span className="ml-2"><Badge tone="danger">On hold</Badge></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--color-border-secondary)] text-sm">
                        <td className="px-4 py-3 font-medium" colSpan={5}>{shown.length} {shown.length === 1 ? 'statement' : 'statements'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums" data-testid="settlement-total">{money(total)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            {runs == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : runs.length === 0 ? (
              <div className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">No {mode} runs yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm" data-testid="settlement-runs-table">
                  <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                    <tr className="border-b border-[var(--color-border-secondary)]">
                      <th className="px-4 py-2.5 font-medium">Month</th>
                      <th className="px-4 py-2.5 font-medium">Run on</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Gyms</th>
                      <th className="px-4 py-2.5 text-right font-medium">Settled</th>
                      <th className="px-4 py-2.5 text-right font-medium">Skipped</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-secondary)]">
                    {runs.map(run => {
                      const stats = run.configurationSnapshot?.stats;
                      const skipped = run.configurationSnapshot?.exceptions ?? [];
                      return (
                        <RunRows key={run.id} run={run} open={openRun === run.id} onToggle={() => setOpenRun(openRun === run.id ? null : run.id)}
                          statements={stats?.statements} settled={stats?.settledCycles} total={stats?.totalFinalTzs} skipped={skipped} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {running && (
        <RunDialog
          onClose={() => setRunning(false)}
          onDone={(message, ranMode) => { setRunning(false); setNotice(message); setView('runs'); if (ranMode === mode) load(); else { setRows(null); setRuns(null); setMode(ranMode); } }}
        />
      )}
    </div>
  );
}

function RunRows({ run, open, onToggle, statements, settled, total, skipped }: {
  run: SettlementRun; open: boolean; onToggle: () => void;
  statements?: number; settled?: number; total?: number; skipped: NonNullable<NonNullable<SettlementRun['configurationSnapshot']>['exceptions']>;
}) {
  const tone = run.status === 'locked' ? 'success' : run.status === 'failed' ? 'danger' : 'gray';
  const label = run.status === 'locked' ? 'Complete' : run.status === 'failed' ? 'Failed' : 'In progress';
  return (
    <>
      <tr className={skipped.length ? 'cursor-pointer hover:bg-[var(--color-bg-secondary)]' : ''} onClick={skipped.length ? onToggle : undefined} data-testid={`settlement-run-${run.id}`}>
        <td className="whitespace-nowrap px-4 py-3 font-medium">{period(run)}</td>
        <td className="whitespace-nowrap px-4 py-3">{shortDay(run.lockedAt || run.createdAt)}</td>
        <td className="px-4 py-3"><Badge tone={tone}>{label}</Badge>{run.error && <span className="ml-2 text-xs text-[var(--color-error-600)]">{run.error}</span>}</td>
        <td className="px-4 py-3 text-right tabular-nums">{statements ?? '—'}</td>
        <td className="px-4 py-3 text-right tabular-nums">{settled ?? '—'}</td>
        <td className="px-4 py-3 text-right tabular-nums">
          {skipped.length ? <button className="underline" onClick={e => { e.stopPropagation(); onToggle(); }}>{skipped.length}</button> : 0}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{total == null ? '—' : money(total)}</td>
      </tr>
      {open && skipped.length > 0 && (
        <tr>
          <td colSpan={7} className="bg-[var(--color-bg-secondary)] px-4 py-3">
            <p className="mb-2 text-xs font-medium text-[var(--color-fg-tertiary)]">Member cycles left out of this run. They are picked up by a later run once fixed.</p>
            <ul className="space-y-1 text-xs">
              {skipped.map(x => (
                <li key={x.subscriptionId} className="flex flex-wrap gap-x-3">
                  <span className="font-mono">{x.subscriptionId}</span>
                  <span>{skipReason(x.reason)}{x.missing?.length ? `: ${x.missing.join(', ')}` : ''}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function RunDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string, mode: SettlementMode) => void }) {
  const { token } = useApp();
  const [month, setMonth] = useState(lastMonth());
  const [mode, setMode] = useState<SettlementMode>('shadow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.runSettlement(token, { month, mode });
      onDone(res.alreadyRun ? `${period(res.run)} was already run. Showing the existing run.` : `${period(res.run)} has been calculated.`, mode);
    } catch (err) {
      setError(settlementError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Run a month" description="Calculates what every gym is owed for the month. Nothing is approved or paid by running it.">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Month">
          <input type="month" className="ui-input" value={month} onChange={e => setMonth(e.target.value)} data-testid="settlement-run-month" />
        </Field>
        <Field label="Type" hint={mode === 'live' ? 'The real run: once per month, only after the month has ended.' : 'A trial calculation that can never be paid. Run it as often as you like.'}>
          <Segmented value={mode} onChange={v => setMode(v as SettlementMode)} options={[['shadow', 'Shadow'], ['live', 'Live']]} className="w-fit" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={run} disabled={busy || !month} data-testid="settlement-run-submit">{busy ? 'Running…' : 'Run'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
