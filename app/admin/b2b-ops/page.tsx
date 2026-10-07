'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, ApiError, B2BJobRun, B2BJobStatus, B2BOpsException, B2BOpsOverview } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, PageHeader, Segmented, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

const ERRORS: Record<string, string> = {
  acl_forbidden: 'Your permissions don’t include this.',
  reason_required: 'Say why.',
  resolution_required: 'Say what was done, or why it can be ignored.',
  retry_limit_reached: 'This has been retried five times. It needs fixing by hand, then resolve it.',
  nothing_to_retry: 'This did not come from a job, so there is nothing to run again. Fix the record, then resolve it.',
  exception_closed: 'This is already closed.',
  already_open_again: 'The same problem has been raised again since. Look at the live one.',
};
const said = (e: unknown, fallback: string) => {
  const body = e instanceof ApiError ? (e.body as { error?: string; requiredScope?: string } | null) : null;
  if (body?.error === 'acl_forbidden' && body.requiredScope === 'b2b_billing_approve') return 'Only someone who can approve billing may close or retry a finance exception.';
  return (body?.error && ERRORS[body.error]) || fallback;
};
const when = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (v: string) => {
  const mins = Math.max(0, Math.round((Date.now() - +new Date(v)) / 60_000));
  return mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
};
/** The schedule in East Africa Time (UTC+3), which is how staff think of it. */
const scheduleText = (s: B2BJobStatus['schedule']) => {
  if (s.type === 'every') return `Every ${s.minutes} minutes`;
  const [h, m] = s.utc.split(':').map(Number);
  return `Daily at ${String((h + 3) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const STATE: Record<B2BJobStatus['state'], { tone: 'success' | 'brand' | 'warning' | 'danger' | 'gray'; label: string }> = {
  ok: { tone: 'success', label: 'OK' }, running: { tone: 'brand', label: 'Running' }, delayed: { tone: 'warning', label: 'Delayed' },
  retrying: { tone: 'warning', label: 'Retrying' }, failed: { tone: 'danger', label: 'Failed' }, paused: { tone: 'gray', label: 'Paused' },
};
const SEVERITY: Record<string, 'danger' | 'warning' | 'gray'> = { high: 'danger', medium: 'warning', low: 'gray' };
const STATUS_LABEL: Record<string, string> = { open: 'Open', investigating: 'Being looked at', retrying: 'Retrying', resolved: 'Resolved', ignored: 'Ignored', permanently_failed: 'Gave up retrying' };
const TYPE_LABEL: Record<string, string> = { job_failed: 'Job did not finish', job_item_failed: 'Item not processed', data_quality: 'Records do not add up' };
const TRIGGER: Record<string, string> = { schedule: 'On schedule', catch_up: 'Caught up', retry: 'Retry', manual: 'By hand' };
const HEAD = 'border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]';
const ROW = 'border-b border-[var(--color-border-secondary)] align-top';

/**
 * FitFlex staff: the recurring B2B work. Which jobs ran, which did not, what
 * went wrong and needs a person, and what is waiting on someone.
 */
export default function B2BOperationsPage() {
  const { token, user, hasPermission } = useApp();
  const [data, setData] = useState<B2BOpsOverview | null>(null);
  const [exceptions, setExceptions] = useState<B2BOpsException[] | null>(null);
  const [filter, setFilter] = useState('live');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runsOf, setRunsOf] = useState<B2BJobStatus | null>(null);
  const [pausing, setPausing] = useState<B2BJobStatus | null>(null);
  const [closing, setClosing] = useState<{ x: B2BOpsException; status: 'resolved' | 'ignored' } | null>(null);
  const [open, setOpen] = useState<B2BOpsException | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      const [overview, list] = await Promise.all([api.adminB2BOps(token), api.adminB2BExceptions(token, { status: filter, limit: 100 })]);
      setData(overview); setExceptions(list.items); setError(null);
    } catch (e) {
      setError(said(e, 'Could not load operations.'));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, filter]);

  if (!token || user?.userType !== 'admin') return null;
  const canAct = hasPermission('b2b');

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setError(null); setInfo(null);
    try { setInfo(await fn()); await load(); } catch (e) { setError(said(e, 'That did not work.')); } finally { setBusy(null); }
  };
  const runNow = (j: B2BJobStatus) => act(`run:${j.name}`, async () => {
    const r = await api.runB2BJob(token, j.name);
    if (r.skipped) return `${j.title} is already running; nothing was started.`;
    return r.outcome === 'ok' ? `${j.title} ran: ${r.processed ?? 0} handled, ${r.failed ?? 0} failed.` : `${j.title} failed: ${r.failure ?? 'see its history'}`;
  });
  const resume = (j: B2BJobStatus) => act(`pause:${j.name}`, async () => { await api.pauseB2BJob(token, j.name, { paused: false }); return `${j.title} resumed.`; });
  const mark = (x: B2BOpsException, status: 'open' | 'investigating') => act(`x:${x.id}`, async () => { await api.setB2BExceptionStatus(token, x.id, { status }); return status === 'open' ? 'Reopened.' : 'Marked as being looked at.'; });
  const retry = (x: B2BOpsException) => act(`x:${x.id}`, async () => {
    const r = await api.retryB2BException(token, x.id);
    return r.exception.status === 'resolved' ? 'Retried and cleared.' : `Retried; it is still there${r.run.failure ? ` (${r.run.failure})` : ''}.`;
  });

  const pending: Array<[string, number, string]> = data ? [
    ['Draft invoices to issue', data.pending.billing.draftInvoices, data.pending.billing.draftsOlderThan7Days ? `${data.pending.billing.draftsOlderThan7Days} older than 7 days` : 'B2B billing'],
    ['Payment notices to check', data.pending.billing.paymentNoticesToCheck, 'B2B billing → Collections'],
    ['Overdue invoices', data.pending.billing.overdueInvoices, `${data.pending.billing.organizationsOnHold} organisation${data.pending.billing.organizationsOnHold === 1 ? '' : 's'} on hold`],
    ['Payments not fully applied', data.pending.billing.paymentsNotFullyApplied, 'Credit sitting on accounts'],
    ['Benefit holds older than an hour', data.pending.usage.holdsOlderThan1Hour, 'Normally settled within minutes'],
    ['Passes waiting for the member to pay', data.pending.usage.passesAwaitingMemberPayment, 'Sponsor paid; member’s share outstanding'],
    ['Passes waiting for an account', data.pending.usage.passesAwaitingAccountLink, 'Person not linked to a FitFlex account'],
    ['People not yet active or linked', data.pending.people.beneficiariesPending + data.pending.people.employeesNotLinked, `${data.pending.people.beneficiariesPending} pending · ${data.pending.people.employeesNotLinked} employees not linked`],
    ['Invited, not joined yet', data.pending.people.invitesWaiting ?? 0, `${data.pending.people.invitesEmailFailed ?? 0} with undelivered email · ${data.pending.people.importsWithRejectedRowsLast7Days ?? 0} import${(data.pending.people.importsWithRejectedRowsLast7Days ?? 0) === 1 ? '' : 's'} with rejected rows this week`],
  ] : [];

  return (
    <div className="space-y-5" data-testid="b2b-ops">
      <PageHeader title="B2B operations" description="The recurring work: what ran, what did not, what needs a person, and what is waiting."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {error && <Alert tone="error">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      {!data ? !error && <Spinner className="h-6 w-6" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ops-summary">
            {([['Jobs healthy', `${data.jobs.ok + data.jobs.running} of ${data.jobs.total}`, [data.jobs.failed && `${data.jobs.failed} failed`, data.jobs.retrying && `${data.jobs.retrying} retrying`, data.jobs.delayed && `${data.jobs.delayed} delayed`, data.jobs.paused && `${data.jobs.paused} paused`].filter(Boolean).join(' · ') || 'All on schedule', data.jobs.failed > 0],
              ['Exceptions needing someone', String(data.exceptions.live), data.exceptions.oldestDetectedAt ? `Oldest ${ago(data.exceptions.oldestDetectedAt)} old` : 'None', (data.exceptions.bySeverity.high ?? 0) > 0],
              ['High severity', String(data.exceptions.bySeverity.high ?? 0), `${data.exceptions.bySeverity.medium ?? 0} medium · ${data.exceptions.bySeverity.low ?? 0} low`, (data.exceptions.bySeverity.high ?? 0) > 0],
              ['Gave up retrying', String(data.exceptions.byStatus.permanently_failed ?? 0), 'Tried three times; needs a person', (data.exceptions.byStatus.permanently_failed ?? 0) > 0]] as Array<[string, string, string, boolean]>).map(([label, value, sub, bad]) => (
              <Card key={label}><CardContent className="py-4">
                <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
                <div className={`mt-1 text-xl font-semibold ${bad ? 'text-[var(--color-error-600)]' : ''}`}>{value}</div>
                <div className="mt-0.5 text-xs text-[var(--color-fg-tertiary)]">{sub}</div>
              </CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader><span className="text-sm font-semibold">Jobs</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="ops-jobs">
                  <thead><tr className={HEAD}><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Runs</th><th className="py-2 pr-3">State</th><th className="py-2 pr-3">Last run</th><th className="py-2 pr-3">Next due</th><th className="py-2" /></tr></thead>
                  <tbody>
                    {data.jobs.items.map(j => (
                      <tr key={j.name} className={ROW}>
                        <td className="py-2 pr-3"><div className="font-medium">{j.title}{j.domain === 'finance' && <span className="ml-2 text-xs font-normal text-[var(--color-fg-quaternary)]">finance</span>}</div><div className="max-w-md text-xs text-[var(--color-fg-quaternary)]">{j.description}</div></td>
                        <td className="py-2 pr-3 whitespace-nowrap">{scheduleText(j.schedule)}</td>
                        <td className="py-2 pr-3"><Badge tone={STATE[j.state].tone}>{STATE[j.state].label}</Badge>{j.paused && j.pauseReason && <div className="mt-1 max-w-48 text-xs text-[var(--color-fg-tertiary)]">{j.pauseReason}</div>}</td>
                        <td className="py-2 pr-3 text-xs">
                          {j.lastRun ? (<>
                            <div>{when(j.lastRun.startedAt)} · {j.lastRun.status === 'ok' ? `${j.lastRun.processed ?? 0} handled${j.lastRun.failed ? `, ${j.lastRun.failed} failed` : ''}` : j.lastRun.status}</div>
                            {j.lastRun.error && <div className="max-w-64 text-[var(--color-error-600)]">{j.lastRun.error}</div>}
                          </>) : 'Nothing recorded yet'}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-xs">{when(j.nextDue)}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <span className="inline-flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setRunsOf(j)}>History</Button>
                            {canAct && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => runNow(j)} data-testid={`run-${j.name}`}>{busy === `run:${j.name}` ? 'Running…' : 'Run now'}</Button>}
                            {canAct && (j.paused
                              ? <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => resume(j)}>Resume</Button>
                              : <Button size="sm" variant="secondary" onClick={() => setPausing(j)}>Pause</Button>)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
                Times are East Africa Time. A daily job that is missed or fails is run again automatically, up to three times. Every job is safe to run twice: “Run now” only does what is still missing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-semibold">Exceptions</span>
              <Segmented className="ml-3 w-fit" value={filter} onChange={setFilter} options={[['live', 'Needing someone'], ['resolved', 'Resolved'], ['ignored', 'Ignored'], ['all', 'All']]} />
            </CardHeader>
            <CardContent>
              {!exceptions ? <Spinner className="h-6 w-6" /> : exceptions.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{filter === 'live' ? 'Nothing needs anyone right now.' : 'None.'}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="ops-exceptions">
                    <thead><tr className={HEAD}><th className="py-2 pr-3">What</th><th className="py-2 pr-3">Severity</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">First seen</th><th className="py-2 pr-3 text-right">Seen</th><th className="py-2" /></tr></thead>
                    <tbody>
                      {exceptions.map((x) => {
                        const live = !['resolved', 'ignored'].includes(x.status);
                        return (
                          <tr key={x.id} className={ROW}>
                            <td className="py-2 pr-3">
                              <button className="text-left font-medium text-[var(--color-fg-brand)]" onClick={() => setOpen(x)} data-testid={`exception-${x.id}`}>{x.title}</button>
                              <div className="text-xs text-[var(--color-fg-quaternary)]">{TYPE_LABEL[x.type] ?? x.type}{x.job ? ` · ${data.jobs.items.find(j => j.name === x.job)?.title ?? x.job}` : ''}</div>
                              {!live && x.resolution && <div className="mt-0.5 max-w-md text-xs text-[var(--color-fg-tertiary)]">{x.resolution}</div>}
                            </td>
                            <td className="py-2 pr-3"><Badge tone={SEVERITY[x.severity]}>{x.severity}</Badge></td>
                            <td className="py-2 pr-3 whitespace-nowrap">{STATUS_LABEL[x.status] ?? x.status}{x.retryCount > 0 && <span className="text-xs text-[var(--color-fg-quaternary)]"> · retried {x.retryCount}×</span>}</td>
                            <td className="py-2 pr-3 whitespace-nowrap text-xs">{when(x.detectedAt)}</td>
                            <td className="py-2 pr-3 text-right">{x.occurrences}×</td>
                            <td className="py-2 text-right whitespace-nowrap">
                              {canAct && (
                                <span className="inline-flex gap-2">
                                  {live && x.status !== 'investigating' && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => mark(x, 'investigating')}>Looking into it</Button>}
                                  {live && x.job && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => retry(x)} data-testid={`retry-${x.id}`}>{busy === `x:${x.id}` ? 'Retrying…' : 'Retry'}</Button>}
                                  {live && <Button size="sm" variant="secondary" onClick={() => setClosing({ x, status: 'resolved' })}>Resolve</Button>}
                                  {live && <Button size="sm" variant="secondary" onClick={() => setClosing({ x, status: 'ignored' })}>Ignore</Button>}
                                  {!live && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => mark(x, 'open')}>Reopen</Button>}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">
                An exception clears itself when the problem goes away. Resolving or ignoring one records your reason and changes nothing in the records it is about. Finance exceptions can only be closed or retried by someone who can approve billing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span className="text-sm font-semibold">Waiting on a person</span></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ops-pending">
                {pending.map(([label, value, sub]) => (
                  <div key={label} className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
                    <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div>
                    <div className="text-lg font-semibold">{value.toLocaleString('en-US')}</div>
                    <div className="text-xs text-[var(--color-fg-tertiary)]">{sub}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {runsOf && <Runs token={token} job={runsOf} onClose={() => setRunsOf(null)} />}
      {open && (
        <Dialog open onClose={() => setOpen(null)} title={open.title} description={`${TYPE_LABEL[open.type] ?? open.type} · ${STATUS_LABEL[open.status] ?? open.status} · first seen ${when(open.detectedAt)} · last seen ${when(open.lastSeenAt)}`} size="lg">
          <div className="space-y-3 text-sm" data-testid="exception-detail">
            {open.entityType && <div><span className="text-[var(--color-fg-quaternary)]">About: </span>{open.entityType} <span className="font-mono text-xs">{open.entityId}</span>{open.organizationId && <> · organisation <span className="font-mono text-xs">{open.organizationId}</span></>}</div>}
            {open.resolution && <div><span className="text-[var(--color-fg-quaternary)]">Closed with: </span>{open.resolution}</div>}
            <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--color-bg-tertiary)] p-3 text-xs">{JSON.stringify(open.detail ?? {}, null, 2)}</pre>
          </div>
        </Dialog>
      )}
      {pausing && <ReasonDialog title={`Pause ${pausing.title}`} label="Why" hint="A paused job is skipped by the schedule and by catch-up until you resume it. It can still be run by hand." action="Pause" onClose={() => setPausing(null)}
        onSubmit={async (reason) => { await api.pauseB2BJob(token, pausing.name, { paused: true, reason }); setPausing(null); setInfo(`${pausing.title} paused.`); await load(); }} />}
      {closing && <ReasonDialog title={closing.status === 'resolved' ? 'Resolve' : 'Ignore'} label={closing.status === 'resolved' ? 'What was done' : 'Why it can be ignored'} hint={closing.x.title} action={closing.status === 'resolved' ? 'Resolve' : 'Ignore'} onClose={() => setClosing(null)}
        onSubmit={async (resolution) => { await api.setB2BExceptionStatus(token, closing.x.id, { status: closing.status, resolution }); setClosing(null); setInfo(closing.status === 'resolved' ? 'Resolved.' : 'Ignored.'); await load(); }} />}
    </div>
  );
}

function Runs({ token, job, onClose }: { token: string; job: B2BJobStatus; onClose: () => void }) {
  const [rows, setRows] = useState<B2BJobRun[] | null>(null);
  useEffect(() => { api.adminB2BJobRuns(token, job.name).then(r => setRows(r.items)).catch(() => setRows([])); }, [token, job.name]);
  return (
    <Dialog open onClose={onClose} title={`${job.title}: recent runs`} description={job.schedule.type === 'every' ? 'This job runs often, so only runs that did something or failed are kept.' : undefined} size="xl">
      {!rows ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">No runs recorded yet.</p> : (
        <table className="w-full text-sm" data-testid="job-runs">
          <thead><tr className={HEAD}><th className="py-2 pr-3">Started</th><th className="py-2 pr-3">Why</th><th className="py-2 pr-3">Attempt</th><th className="py-2 pr-3">Result</th><th className="py-2 pr-3 text-right">Handled</th><th className="py-2 pr-3 text-right">Failed</th><th className="py-2">Error</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={ROW}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{when(r.startedAt)}</td><td className="py-1.5 pr-3">{r.trigger ? TRIGGER[r.trigger] : ''}</td><td className="py-1.5 pr-3">{r.attempt}</td>
                <td className="py-1.5 pr-3">{r.status === 'ok' ? <Badge tone="success">OK</Badge> : r.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Badge tone="brand">Running</Badge>}</td>
                <td className="py-1.5 pr-3 text-right">{r.processed ?? ''}</td><td className="py-1.5 pr-3 text-right">{r.failed || ''}</td><td className="py-1.5 text-xs text-[var(--color-error-600)]">{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

function ReasonDialog({ title, label, hint, action, onClose, onSubmit }: { title: string; label: string; hint?: string; action: string; onClose: () => void; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={title} size="md">
      <form className="space-y-3" data-testid="reason-form" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await onSubmit(text.trim()); } catch (err) { setError(said(err, 'That did not work.')); setBusy(false); }
      }}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={label} hint={hint}><textarea className="ui-input" rows={3} required maxLength={500} value={text} onChange={e => setText(e.target.value)} data-testid="reason-text" /></Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="reason-submit">{action}</Button>
        </div>
      </form>
    </Dialog>
  );
}
