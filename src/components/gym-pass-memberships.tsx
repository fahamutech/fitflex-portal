'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Segmented, Select, Spinner, Table, TBody, Td, Th, THead, Tr } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { FailureView, PERSON_TONE, PURCHASE_TONE, useFailureText, useGymPassFormat } from './gym-pass-shared';
import { fill } from './communication-shared';
import { classifyGymPassError, gymPassesApi, type GymPassFailure, type PassMembership, type PassPerson, type PassVisit } from '@/lib/gym-passes';
import { useApp } from '../../app/providers';
import type { MessageKey } from '@/lib/i18n';

const PAGE = 25;
type Action = 'suspend' | 'resume' | 'remove';
// Check-in values the backend records (check-in-service methods; CHECKIN_STATUS). Anything else reads "Other".
const KNOWN_METHODS = new Set(['gym_scanned', 'member_scanned', 'web_scanned']);
const KNOWN_VISIT_STATUS = new Set(['valid', 'disputed', 'flagged', 'voided']);

const personName = (p: PassPerson, fallback: string) => p.displayName || p.contact || fallback;

/** Owner (scope members): running or ended passes with each person's status, expiry and visits, and the owner's actions. */
export function GymPassMemberships({ gymId, onChanged }: { gymId: string; onChanged: () => void }) {
  const { token, t } = useApp();
  const fmtr = useGymPassFormat();
  const failureText = useFailureText();
  const [state, setState] = useState<'active' | 'expired'>('active');
  const [rows, setRows] = useState<PassMembership[] | null>(null);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState<GymPassFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirm, setConfirm] = useState<{ m: PassMembership; p: PassPerson; action: Action } | null>(null);
  const [adding, setAdding] = useState<PassMembership | null>(null);
  const [addType, setAddType] = useState<'phone' | 'email'>('phone');
  const [addValue, setAddValue] = useState('');
  const [visits, setVisits] = useState<{ m: PassMembership; p: PassPerson; list: PassVisit[] | null; failure: GymPassFailure | null } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before?: string) => {
    if (!token) return;
    setFailure(null);
    try {
      const { memberships } = await gymPassesApi.memberships(token, gymId, { state, before, limit: PAGE });
      setRows(prev => (before && prev ? [...prev, ...memberships] : memberships));
      setMore(memberships.length >= PAGE);
    } catch (e) { setRows(prev => prev ?? []); setFailure(classifyGymPassError(e)); }
  }, [token, gymId, state]);
  useEffect(() => { setRows(null); setOpen({}); void load(); }, [load]);

  async function run() {
    if (!token || !confirm) return;
    setBusy(true); setDialogError(null);
    try {
      await gymPassesApi.personAction(token, gymId, confirm.m.id, confirm.p.id, confirm.action);
      setNotice(t(confirm.action === 'suspend' ? 'gp.person.suspended' : confirm.action === 'resume' ? 'gp.person.resumed' : 'gp.person.removed'));
      setConfirm(null);
      await load(); onChanged();
    } catch (e) {
      const f = classifyGymPassError(e);
      if (f.kind === 'disabled') { setConfirm(null); setFailure(f); } else setDialogError(failureText(f));
    } finally { setBusy(false); }
  }

  async function add() {
    if (!token || !adding || !addValue.trim()) return;
    setBusy(true); setDialogError(null);
    try {
      await gymPassesApi.addPerson(token, gymId, adding.id, addType === 'phone' ? { phone: addValue.trim() } : { email: addValue.trim() });
      setNotice(t('gp.add.added'));
      setAdding(null);
      await load(); onChanged();
    } catch (e) {
      const f = classifyGymPassError(e);
      if (f.kind === 'disabled') { setAdding(null); setFailure(f); } else setDialogError(failureText(f));
    } finally { setBusy(false); }
  }

  async function showVisits(m: PassMembership, p: PassPerson) {
    if (!token) return;
    setVisits({ m, p, list: null, failure: null });
    try { const r = await gymPassesApi.attendance(token, gymId, m.id, p.id); setVisits({ m, p, list: r.visits, failure: null }); }
    catch (e) { setVisits({ m, p, list: [], failure: classifyGymPassError(e) }); }
  }

  if (failure?.kind === 'disabled') return <FailureView failure={failure} />;
  const last = rows?.[rows.length - 1];
  const live = (p: PassPerson) => p.status !== 'removed';

  return (
    <div className="space-y-4" data-testid="gp-memberships">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('gp.mem.state')}>
          <Segmented value={state} onChange={v => setState(v as 'active' | 'expired')} options={[['active', t('gp.mem.running')], ['expired', t('gp.mem.ended')]]} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} />
          {t('gp.mem.showRemoved')}
        </label>
      </div>
      <Alert tone="info">{t('gp.mem.privacy')}</Alert>
      {notice && <Alert tone="success">{notice}</Alert>}
      {failure && <FailureView failure={failure} onRetry={() => load()} />}
      {rows == null ? <Spinner className="h-6 w-6" /> : rows.length === 0 ? (!failure && <EmptyState title={t('gp.mem.empty')} body={t('gp.mem.emptyBody')} />) : (
        <>
          <ul className="space-y-3">
            {rows.map(m => {
              const isOpen = open[m.id] ?? true;
              const people = m.beneficiaries.filter(p => showRemoved || live(p));
              return (
                <li key={m.id} data-testid={`gp-membership-${m.id}`}>
                  <Card>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button type="button" className="flex min-h-11 items-start gap-2 text-left" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [m.id]: !isOpen }))}>
                          {isOpen ? <ChevronDown aria-hidden="true" className="mt-1 h-4 w-4" /> : <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4" />}
                          <span>
                            <span className="block font-semibold">{m.plan.name}</span>
                            <span className="block text-xs text-[var(--color-fg-quaternary)]">
                              {t(`gp.category.${m.plan.category}`)} · {fmtr.duration(m.plan.durationValue, m.plan.durationUnit)} · {fill(t('gp.mem.boughtBy'), { name: m.purchaser?.displayName || t('gp.sales.buyerUnknown') })}
                            </span>
                            <span className="block text-xs text-[var(--color-fg-quaternary)]">
                              {m.startsAt && <>{fill(t('gp.mem.starts'), { date: fmtr.date(m.startsAt) })} · </>}<span data-testid="gp-expiry">{fill(t('gp.mem.expires'), { date: fmtr.date(m.expiresAt) })}</span>
                              {m.slots && <> · {fill(t('gp.sales.slots'), { used: m.slots.used, limit: m.slots.limit })}</>}
                            </span>
                          </span>
                        </button>
                        <div className="flex items-center gap-2">
                          <Badge tone={PURCHASE_TONE[m.status] ?? 'gray'}>{t(`gp.purchase.status.${m.status}` as MessageKey)}</Badge>
                          {m.status === 'active' && (
                            <Button variant="secondary" size="sm" onClick={() => { setAdding(m); setAddValue(''); setAddType('phone'); setDialogError(null); setNotice(null); }} data-testid="gp-add-person">
                              <UserPlus aria-hidden="true" className="mr-1.5 h-4 w-4" />{t('gp.person.add')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {isOpen && (
                        <Table aria-label={t('gp.mem.table')}>
                          <THead>
                            <Tr>
                              <Th>{t('gp.mem.col.person')}</Th><Th>{t('gp.mem.col.contact')}</Th><Th>{t('gp.mem.col.status')}</Th>
                              <Th>{t('gp.mem.col.visits')}</Th><Th>{t('gp.mem.col.last')}</Th><Th>{t('gp.mem.col.actions')}</Th>
                            </Tr>
                          </THead>
                          <TBody>
                            {people.map(p => (
                              <Tr key={p.id} data-testid={`gp-person-${p.id}`}>
                                <Td>
                                  <div className="font-medium">{p.displayName || t('gp.mem.noName')}</div>
                                  <div className="text-xs text-[var(--color-fg-quaternary)]">{p.isPurchaser ? t('gp.mem.you') : fill(t('gp.mem.slot'), { n: p.slot })}</div>
                                </Td>
                                {/* Masked by the server until the first valid check-in: shown as given. */}
                                <Td className="tabular-nums" data-testid="gp-person-contact">{p.contact || '—'}</Td>
                                <Td>
                                  <Badge tone={PERSON_TONE[p.status] ?? 'gray'}>{t(`gp.person.status.${p.status}` as MessageKey)}</Badge>
                                  {p.status === 'removed' && p.removedByRole && <div className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{t(`gp.mem.removedBy.${p.removedByRole}` as MessageKey)}</div>}
                                </Td>
                                <Td className="tabular-nums">{p.attendance?.visits ?? 0}</Td>
                                <Td className="whitespace-nowrap">{p.attendance?.lastVisitAt ? fmtr.dateTime(p.attendance.lastVisitAt) : t('gp.mem.noVisit')}</Td>
                                <Td>
                                  <div className="flex flex-wrap gap-1">
                                    {p.status !== 'removed' && p.status !== 'awaiting_payment' && (
                                      <Button variant="ghost" size="sm" onClick={() => void showVisits(m, p)} data-testid="gp-person-visits">{t('gp.person.visits')}</Button>
                                    )}
                                    {m.status === 'active' && !p.isPurchaser && p.status === 'suspended' && (
                                      <Button variant="ghost" size="sm" onClick={() => { setConfirm({ m, p, action: 'resume' }); setDialogError(null); setNotice(null); }} data-testid="gp-person-resume">{t('gp.person.resume')}</Button>
                                    )}
                                    {m.status === 'active' && !p.isPurchaser && p.status === 'active' && (
                                      <Button variant="ghost" size="sm" onClick={() => { setConfirm({ m, p, action: 'suspend' }); setDialogError(null); setNotice(null); }} data-testid="gp-person-suspend">{t('gp.person.suspend')}</Button>
                                    )}
                                    {m.status === 'active' && !p.isPurchaser && live(p) && (
                                      <Button variant="ghost" size="sm" onClick={() => { setConfirm({ m, p, action: 'remove' }); setDialogError(null); setNotice(null); }} data-testid="gp-person-remove">{t('gp.person.remove')}</Button>
                                    )}
                                  </div>
                                </Td>
                              </Tr>
                            ))}
                          </TBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
          {more && last?.createdAt && <Button variant="secondary" size="md" onClick={() => load(last.createdAt)} data-testid="gp-memberships-more">{t('gp.mem.loadMore')}</Button>}
        </>
      )}

      <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} size="sm" testId="gp-person-confirm"
        title={confirm ? t(`gp.person.${confirm.action}Title` as MessageKey) : ''}
        description={confirm ? t(`gp.person.${confirm.action}Body` as MessageKey) : ''}>
        <div className="space-y-3">
          {confirm && <p className="text-sm font-medium">{fill(t('gp.person.named'), { name: personName(confirm.p, t('gp.mem.noName')) })}</p>}
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setConfirm(null)} disabled={busy}>{t('gp.person.cancel')}</Button>
          <Button variant={confirm?.action === 'remove' ? 'destructive' : 'primary'} size="md" onClick={run} disabled={busy} data-testid="gp-person-confirm-yes">{busy ? t('gp.person.working') : t('gp.person.confirm')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!adding} onClose={() => !busy && setAdding(null)} size="sm" testId="gp-add-dialog" title={t('gp.add.title')} description={t('gp.add.body')}>
        <div className="space-y-4">
          {dialogError && <Alert tone="error">{dialogError}</Alert>}
          <Field label={t('gp.add.contactType')}>
            <Select value={addType} onChange={e => setAddType(e.target.value as 'phone' | 'email')}>
              <option value="phone">{t('gp.add.phone')}</option>
              <option value="email">{t('gp.add.email')}</option>
            </Select>
          </Field>
          <Field label={t('gp.add.value')}>
            <Input value={addValue} type={addType === 'email' ? 'email' : 'tel'} autoComplete="off" onChange={e => setAddValue(e.target.value)} data-testid="gp-add-value" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setAdding(null)} disabled={busy}>{t('gp.person.cancel')}</Button>
          <Button variant="primary" size="md" onClick={add} disabled={busy || !addValue.trim()} data-testid="gp-add-submit">{busy ? t('gp.person.working') : t('gp.add.submit')}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!visits} onClose={() => setVisits(null)} size="md" testId="gp-visits-dialog" title={t('gp.att.title')}
        description={visits ? fill(t('gp.att.for'), { name: personName(visits.p, t('gp.mem.noName')) }) : ''}>
        {visits?.failure ? <FailureView failure={visits.failure} /> : visits?.list == null ? <Spinner className="h-6 w-6" /> : visits.list.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-quaternary)]">{t('gp.att.empty')}</p>
        ) : (
          <Table aria-label={t('gp.att.table')}>
            <THead><Tr><Th>{t('gp.att.col.when')}</Th><Th>{t('gp.att.col.method')}</Th><Th>{t('gp.att.col.status')}</Th></Tr></THead>
            <TBody>
              {visits.list.map(v => (
                <Tr key={v.id} data-testid="gp-visit-row"><Td className="whitespace-nowrap">{fmtr.dateTime(v.timestamp)}</Td><Td>{v.method ? t(`gp.att.method.${KNOWN_METHODS.has(v.method) ? v.method : 'other'}` as MessageKey) : '—'}</Td><Td>{v.status ? t(`gp.att.status.${KNOWN_VISIT_STATUS.has(v.status) ? v.status : 'other'}` as MessageKey) : '—'}</Td></Tr>
              ))}
            </TBody>
          </Table>
        )}
        <DialogFooter><Button variant="secondary" size="md" onClick={() => setVisits(null)}>{t('gp.att.close')}</Button></DialogFooter>
      </Dialog>
    </div>
  );
}
