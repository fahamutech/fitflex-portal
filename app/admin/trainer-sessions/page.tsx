'use client';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, UserX, XCircle } from 'lucide-react';
import { useApp } from '../../providers';
import { api, TrainerBooking } from '@/lib/api';
import { Badge, Button, PageHeader, Spinner, Card, ErrorState, Alert, Input, Select, useToast } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { money } from '@/lib/admin-utils';
import { fill } from '@/components/communication-shared';
import type { MessageKey } from '@/lib/i18n';
import {
  ERROR_KEY, RELOAD_AFTER, SESSION_STATUSES, STATUS_LABEL, STATUS_TONE,
  availability, eatText, refusalOf, sessionWhen,
  type SessionAction, type SessionStatus, type StatementLock,
} from '@/lib/trainer-sessions';

type Row = TrainerBooking & { trainerName: string; memberName: string; startKey: string };
type Pending = { row: Row; to: SessionAction };

const STATEMENT_STATUS: Record<string, MessageKey> = {
  draft: 'payouts.status.draft', submitted: 'payouts.status.submitted', approved: 'payouts.status.approved',
  payable: 'payouts.status.payable', paid: 'payouts.status.paid', voided: 'payouts.status.voided',
};
const CONFIRM: Record<SessionAction, { title: MessageKey; submit: MessageKey; saved: MessageKey }> = {
  completed: { title: 'tsess.confirm.complete.title', submit: 'tsess.action.complete', saved: 'tsess.saved.completed' },
  no_show: { title: 'tsess.confirm.noShow.title', submit: 'tsess.action.noShow', saved: 'tsess.saved.no_show' },
  cancelled: { title: 'tsess.confirm.cancel.title', submit: 'tsess.action.cancel', saved: 'tsess.saved.cancelled' },
};

const trainerNameOf = (b: TrainerBooking) =>
  b.trainer?.displayName || b.trainer?.fullName || b.trainer?.nickname || b.trainer?.email || b.trainerId;
const memberNameOf = (b: TrainerBooking) => b.member?.displayName || b.member?.email || b.member?.phone || b.memberId;

export default function TrainerSessionsPage() {
  const { token, user, t, locale } = useApp();
  const toast = useToast();
  const [bookings, setBookings] = useState<TrainerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<SessionStatus | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Statements past draft that hold a session, as the server reported them on a refused change.
  const [locks, setLocks] = useState<Record<string, StatementLock>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setBookings(await api.trainerBookings(token));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const rows = useMemo<Row[]>(() => bookings.map(b => ({
    ...b, trainerName: trainerNameOf(b), memberName: memberNameOf(b), startKey: `${b.date || ''}T${b.slot || ''}`,
  })), [bookings]);
  const shown = rows.filter(r =>
    (status === 'all' || r.status === status) && (!from || r.date >= from) && (!to || r.date <= to));
  const filtered = status !== 'all' || !!from || !!to;

  const statusText = (s: string) => (STATUS_LABEL[s as SessionStatus] ? t(STATUS_LABEL[s as SessionStatus]) : s);
  const statementText = (s?: string) => (s && STATEMENT_STATUS[s] ? t(STATEMENT_STATUS[s]) : s || '—');

  function errorText(e: unknown): string {
    const { status: http, body } = refusalOf(e);
    if (http === 403) return t('tsess.err.forbidden');
    const key = body.error ? ERROR_KEY[body.error] : undefined;
    if (!key) return t('tsess.err.generic');
    return fill(t(key), {
      from: body.from ? statusText(body.from) : '—',
      when: body.startsAt && !Number.isNaN(Date.parse(body.startsAt)) ? eatText(Date.parse(body.startsAt), locale) : '—',
      id: body.statementId || '—',
      status: statementText(body.statementStatus),
    });
  }

  function open(row: Row, action: SessionAction) {
    setPending({ row, to: action });
    setActionError(null);
  }

  async function submit() {
    if (!token || !pending) return;
    const { row, to: next } = pending;
    setBusy(true);
    try {
      const updated = await api.updateTrainerBooking(token, row.id, next);
      // The server's answer carries the new status and actions; keep the hydrated names if it omits them.
      setBookings(list => list.map(b => (b.id === row.id ? { ...b, ...updated, trainer: updated.trainer ?? b.trainer, member: updated.member ?? b.member } : b)));
      setPending(null);
      toast.success(t(CONFIRM[next].saved));
    } catch (e) {
      const { body } = refusalOf(e);
      setActionError(errorText(e));
      if (body.error === 'booking_on_trainer_statement') {
        setLocks(l => ({ ...l, [row.id]: { statementId: body.statementId, statementStatus: body.statementStatus } }));
      }
      if (body.error && RELOAD_AFTER.has(body.error)) await load();
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const whyText = (r: Row): string | null => {
    const why = availability(r, locks[r.id]).why;
    if (why === 'cancelled') return t('tsess.why.cancelled');
    if (why === 'unpaid') return t('tsess.why.unpaid');
    if (why === 'locked') {
      const lock = locks[r.id];
      return lock?.statementId ? fill(t('tsess.why.lockedOn'), { id: lock.statementId, status: statementText(lock.statementStatus) }) : t('tsess.why.locked');
    }
    return null;
  };

  const columns: ColumnDef<Row>[] = [
    {
      key: 'startKey', header: t('tsess.col.session'), sortable: true,
      cell: r => (
        <div className="min-w-[10rem]">
          <div className="whitespace-nowrap text-sm font-medium tabular-nums text-[var(--color-fg-primary)]" data-testid="tsess-when">{sessionWhen(r, locale)}</div>
          {r.gym?.name && <div className="text-xs text-[var(--color-fg-quaternary)]">{r.gym.name}</div>}
        </div>
      ),
    },
    { key: 'trainerName', header: t('tsess.col.trainer'), sortable: true, cell: r => <span className="text-sm text-[var(--color-fg-primary)]">{r.trainerName}</span> },
    {
      key: 'memberName', header: t('tsess.col.member'), sortable: true,
      cell: r => (
        <div>
          <div className="text-sm text-[var(--color-fg-primary)]">{r.memberName}</div>
          {r.member?.phone && r.member.phone !== r.memberName && <div className="text-xs text-[var(--color-fg-quaternary)]">{r.member.phone}</div>}
        </div>
      ),
    },
    { key: 'amountTzs', header: t('tsess.col.amount'), sortable: true, align: 'right', cell: r => <span className="whitespace-nowrap font-medium tabular-nums">{money(r.amountTzs)}</span> },
    {
      key: 'status', header: t('tsess.col.status'), sortable: true,
      cell: r => (
        <div className="max-w-[16rem] space-y-1">
          <span data-testid="tsess-status"><Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{statusText(r.status)}</Badge></span>
          {whyText(r) && <div id={`tsess-why-${r.id}`} className="text-xs text-[var(--color-fg-tertiary)]" data-testid="tsess-why">{whyText(r)}</div>}
        </div>
      ),
    },
  ];

  const nothingLoaded = loadFailed && !bookings.length;
  const amount = pending ? Number(pending.row.amountTzs) || 0 : 0;
  const consequence = !pending ? '' : pending.to === 'completed' ? t('tsess.confirm.complete.body')
    : pending.to === 'no_show' ? t('tsess.confirm.noShow.body')
    : amount > 0 ? fill(t('tsess.confirm.cancel.refund'), { amount: money(amount) }) : t('tsess.confirm.cancel.noRefund');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('tsess.title')}
        description={t('tsess.description')}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading} data-testid="tsess-refresh">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('tsess.refresh')}
          </Button>
        }
      />

      {loadFailed && bookings.length > 0 && <Alert tone="error">{t('tsess.loadFailedTitle')}. {t('tsess.loadFailedBody')}</Alert>}

      {loading && !bookings.length ? (
        <div className="flex h-64 items-center justify-center" aria-busy="true"><Spinner className="h-8 w-8" /></div>
      ) : nothingLoaded ? (
        <div data-testid="tsess-load-error">
          <ErrorState title={t('tsess.loadFailedTitle')} message={t('tsess.loadFailedBody')} onRetry={load} retryLabel={t('common.tryAgain')} />
        </div>
      ) : (
        <Card>
          <div className="p-4 sm:p-5">
            <DataTable
              columns={columns}
              data={shown}
              keyFn={r => r.id}
              label={t('tsess.title')}
              filterPlaceholder={t('tsess.search')}
              emptyState={t(rows.length ? 'tsess.empty.filtered' : 'tsess.empty.none')}
              defaultSort={{ key: 'startKey', dir: 'desc' }}
              stickyActions
              dense
              extraFilters={
                <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={t('tsess.filtersLabel')}>
                  <Select
                    size="sm" className="!w-auto" aria-label={t('tsess.filter.status')} data-testid="tsess-filter-status"
                    value={status} onChange={e => setStatus(e.target.value as SessionStatus | 'all')}
                  >
                    <option value="all">{t('tsess.filter.all')}</option>
                    {SESSION_STATUSES.map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
                  </Select>
                  <Input
                    type="date" size="sm" className="!w-auto min-w-0" aria-label={t('tsess.filter.from')} title={t('tsess.filter.from')}
                    data-testid="tsess-filter-from" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
                  />
                  <Input
                    type="date" size="sm" className="!w-auto min-w-0" aria-label={t('tsess.filter.to')} title={t('tsess.filter.to')}
                    data-testid="tsess-filter-to" value={to} min={from || undefined} onChange={e => setTo(e.target.value)}
                  />
                  {filtered && (
                    <Button variant="ghost" size="sm" onClick={() => { setStatus('all'); setFrom(''); setTo(''); }} data-testid="tsess-filter-clear">
                      {t('tsess.filter.clear')}
                    </Button>
                  )}
                </div>
              }
              actions={r => {
                const can = availability(r, locks[r.id]);
                return (
                  <>
                    {can.complete && (
                      <Button variant="ghost" size="sm" onClick={() => open(r, 'completed')} title={t('tsess.action.complete')} aria-label={t('tsess.action.complete')} data-testid="tsess-complete">
                        <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-[var(--color-success-600)]" />
                      </Button>
                    )}
                    {can.noShow && (
                      <Button variant="ghost" size="sm" onClick={() => open(r, 'no_show')} title={t('tsess.action.noShow')} aria-label={t('tsess.action.noShow')} data-testid="tsess-noshow">
                        <UserX aria-hidden="true" className="h-4 w-4 text-[var(--color-info-600)]" />
                      </Button>
                    )}
                    {can.cancel && (
                      <Button variant="ghost" size="sm" onClick={() => open(r, 'cancelled')} title={t('tsess.action.cancel')} aria-label={t('tsess.action.cancel')} data-testid="tsess-cancel">
                        <XCircle aria-hidden="true" className="h-4 w-4 text-[var(--color-error-600)]" />
                      </Button>
                    )}
                  </>
                );
              }}
            />
          </div>
        </Card>
      )}

      <Dialog
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={pending ? t(CONFIRM[pending.to].title) : ''}
        description={pending ? `${sessionWhen(pending.row, locale)} · ${pending.row.trainerName} · ${pending.row.memberName}` : ''}
        size="sm"
      >
        <div className="space-y-4">
          {actionError && <div data-testid="tsess-action-error"><Alert tone="error">{actionError}</Alert></div>}
          <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="tsess-consequence">{consequence}</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setPending(null)} disabled={busy}>{t('tsess.confirm.keep')}</Button>
          <Button
            variant={pending?.to === 'cancelled' ? 'destructive' : 'primary'} size="md" onClick={submit} disabled={busy} data-testid="tsess-submit"
          >
            {busy ? t('tsess.saving') : pending ? t(CONFIRM[pending.to].submit) : ''}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
