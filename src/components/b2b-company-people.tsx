'use client';
import { ReactNode, useEffect, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, userContact, type B2BBeneficiary, type B2BImportResult } from '@/lib/api';
import { messages, type MessageKey } from '@/lib/i18n';
import { errorBody, fmt } from '@/lib/vendor';
import {
  Alert, Badge, Button, Card, CardContent, Checkbox, Field, Input, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr,
} from '@/components/shared';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';

/**
 * Phase B · B5b: a company's staff list, managed from its organisation (/org/people) while the server has
 * ORG_ONLY_SPONSORS on. Everything goes through /b2b/organizations/:id/beneficiaries*, which writes through
 * to the company staff list (seat limit, seat billing and audit stay with the company account; contract in
 * fitflex-functions#252 and B2B_FOUNDATION.md §3a). With the flag off the older screens are used instead.
 */

type Mine = { organization: { id: string }; permissions: string[] };
type T = (key: MessageKey) => string;

const known = (key: string): key is MessageKey => key in messages.en;

/** The message for an error the server answered with, or the fallback. */
function errorText(t: T, err: unknown, fallback: MessageKey): string {
  const body = errorBody<{ seatsAvailable?: number; requested?: number }>(err);
  const code = body?.error;
  // An import that needs more seats than are free adds nobody, and says how many it asked for.
  if (code === 'seat_limit_reached' && typeof body?.requested === 'number') {
    return fmt(t('b2b.hrOrg.err.seat_limit_import'), { requested: body.requested, available: body.seatsAvailable ?? 0 });
  }
  const key = `b2b.hrOrg.err.${code ?? ''}`;
  return code && known(key) ? t(key) : t(fallback);
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'gray'> = { active: 'success', pending: 'warning', suspended: 'danger', inactive: 'gray' };
const statusLabel = (t: T, status: string) => { const key = `b2b.hrOrg.status.${status}`; return known(key) ? t(key) : status; };
const problemLabel = (t: T, problem: string) => { const key = `b2b.hrOrg.problem.${problem}`; return known(key) ? t(key) : problem; };
const countLabel = (t: T, base: 'b2b.hrOrg.count' | 'b2b.hrOrg.import.confirm', n: number) => fmt(t(`${base}.${n === 1 ? 'one' : 'other'}` as MessageKey), { n });

// ── Is ORG_ONLY_SPONSORS on? ─────────────────────────────────────────────────

const flagCache = new Map<string, 'on' | 'off'>();

/** 'checking' until known; 'off' also when it can't be told (the older screens keep working either way). */
export function useOrgOnlySponsors(token: string, orgId: string, enabled: boolean): 'checking' | 'on' | 'off' {
  const cacheKey = `${token.slice(-24)}:${orgId}`;
  const [state, setState] = useState<'checking' | 'on' | 'off'>(() => (enabled ? flagCache.get(cacheKey) ?? 'checking' : 'off'));
  useEffect(() => {
    if (!enabled) { setState('off'); return; }
    const cached = flagCache.get(cacheKey);
    if (cached) { setState(cached); return; }
    let cancelled = false;
    setState('checking');
    api.orgOnlySponsors(token, orgId).then((flag) => {
      if (cancelled) return;
      const answer = flag === 'on' ? 'on' : 'off';
      if (flag !== 'unknown') flagCache.set(cacheKey, answer);
      setState(answer);
    });
    return () => { cancelled = true; };
  }, [token, orgId, enabled, cacheKey]);
  return state;
}

/** For a company's organisation: this screen while ORG_ONLY_SPONSORS is on, else `fallback` (unchanged). */
export function CompanyPeopleOr({ token, mine, children }: { token: string; mine: Mine; children: ReactNode }) {
  const flag = useOrgOnlySponsors(token, mine.organization.id, true);
  if (flag === 'checking') return <Spinner className="h-6 w-6" />;
  return flag === 'on' ? <CompanyPeople token={token} mine={mine} /> : <>{children}</>;
}

// ── The staff list ───────────────────────────────────────────────────────────

export function CompanyPeople({ token, mine }: { token: string; mine: Mine }) {
  const { t } = useApp();
  const orgId = mine.organization.id;
  const canManage = mine.permissions.includes('beneficiaries.manage');
  const [people, setPeople] = useState<B2BBeneficiary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', groupName: '', active: true });
  const [link, setLink] = useState<Record<string, string>>({});
  const [pin, setPin] = useState<{ name: string; pin: string } | null>(null);
  const [leaving, setLeaving] = useState<B2BBeneficiary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.b2bBeneficiaries(token, orgId, { search: search.trim() || undefined, limit: 100 });
    setPeople(r.items); setTotal(r.total);
  };
  useEffect(() => {
    load().catch(() => { setError(t('b2b.hrOrg.loadFailed')); setPeople([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const run = async (fn: () => Promise<string | void>, fallback: MessageKey) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const told = await fn();
      if (told) setNotice(told);
      await load().catch(() => undefined);
    } catch (e) {
      setError(errorText(t, e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const out = await api.enrollB2BBeneficiary(token, orgId, {
        displayName: form.displayName.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.groupName.trim() ? { groupName: form.groupName.trim() } : {}),
        status: form.active ? 'active' : 'pending',
      });
      const name = out.beneficiary.displayName ?? form.displayName.trim();
      setForm({ displayName: '', email: '', phone: '', groupName: form.groupName, active: form.active });
      // The activation PIN comes back once: show it now, keep it nowhere else.
      if (out.pin) setPin({ name, pin: out.pin });
      // By contact the reply never says whether a member account was linked (so the form can't be used to
      // test who is a member); the reloaded list shows it.
      return fmt(t('b2b.hrOrg.add.done'), { name });
    }, 'b2b.hrOrg.add.failed');
  };

  const setStatus = (p: B2BBeneficiary, status: 'active' | 'suspended' | 'inactive') =>
    run(async () => { await api.setB2BBeneficiaryStatus(token, orgId, p.id, status); }, 'b2b.hrOrg.action.failed');

  const name = (p: B2BBeneficiary) => p.displayName ?? '—';
  const isLinked = (p: B2BBeneficiary) => p.linked ?? !!p.userId;
  // Only a company employee this screen may change (the server marks them readOnly: false).
  const editable = (p: B2BBeneficiary) => canManage && p.source === 'corporate_employee' && !p.readOnly;

  return (
    <div className="space-y-4" data-testid="org-staff">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!canManage && <Alert tone="info">{t('b2b.hrOrg.readOnlyNote')}</Alert>}

      {canManage && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div>
              <div className="text-sm font-semibold">{t('b2b.hrOrg.add.heading')}</div>
              <div className="text-xs text-[var(--color-fg-quaternary)]">{t('b2b.hrOrg.description')}</div>
            </div>
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-4" data-testid="org-staff-add">
              <Field label={t('b2b.hrOrg.add.name')} hint={t('b2b.hrOrg.add.nameHint')} required>
                <Input required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} data-testid="org-staff-name" />
              </Field>
              <Field label={t('b2b.hrOrg.add.email')} hint={t('b2b.hrOrg.add.contactHint')}>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="asha@example.co.tz" data-testid="org-staff-email" />
              </Field>
              <Field label={t('b2b.hrOrg.add.phone')}>
                <Input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0712 345 678" data-testid="org-staff-phone" />
              </Field>
              <Field label={t('b2b.hrOrg.add.department')}>
                <Input value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} data-testid="org-staff-department" />
              </Field>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
                <Checkbox checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} label={t('b2b.hrOrg.add.activeNow')} description={t('b2b.hrOrg.add.activeNowHint')} data-testid="org-staff-active" />
                <Button type="submit" size="sm" loading={busy} disabled={!form.displayName.trim()} data-testid="org-staff-add-button">{t('b2b.hrOrg.add.submit')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {canManage && <CompanyStaffImport token={token} orgId={orgId} onChanged={() => load().catch(() => undefined)} />}

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{countLabel(t, 'b2b.hrOrg.count', total)}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => undefined, 'b2b.hrOrg.loadFailed'); }}>
              <Input className="!w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('b2b.hrOrg.search')} aria-label={t('b2b.hrOrg.search')} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('b2b.hrOrg.searchButton')}</Button>
            </form>
          </div>
          {!people ? <Spinner className="h-5 w-5" /> : people.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('b2b.hrOrg.empty')}</p> : (
            <Table aria-label={countLabel(t, 'b2b.hrOrg.count', total)} data-testid="org-staff-list">
              <THead>
                <Tr>
                  <Th>{t('b2b.hrOrg.col.name')}</Th><Th>{t('b2b.hrOrg.col.department')}</Th><Th>{t('b2b.hrOrg.col.account')}</Th><Th>{t('b2b.hrOrg.col.status')}</Th>
                  <Th><span className="sr-only">{t('b2b.hrOrg.col.actions')}</span></Th>
                </Tr>
              </THead>
              <TBody>
                {people.map(p => (
                  <Tr key={p.id} className="align-top" data-testid={`org-staff-row-${p.id}`}>
                    <Td className="font-medium">
                      {name(p)}
                      {(p.email || p.phone) && <div className="text-xs font-normal text-[var(--color-fg-quaternary)]">{[p.email, p.phone].filter(Boolean).join(' · ')}</div>}
                    </Td>
                    <Td>{p.groupName ?? ''}</Td>
                    <Td>
                      {isLinked(p) ? (
                        <span className="flex items-center gap-2">
                          <Badge tone="success">{t('b2b.hrOrg.linked')}</Badge>
                          {editable(p) && (
                            <Button variant="link" className="h-auto px-0 text-xs font-normal" disabled={busy}
                              onClick={() => run(async () => { await api.linkB2BBeneficiary(token, orgId, p.id, {}); return fmt(t('b2b.hrOrg.unlink.done'), { name: name(p) }); }, 'b2b.hrOrg.unlink.failed')}>
                              {t('b2b.hrOrg.unlink.button')}
                            </Button>
                          )}
                        </span>
                      ) : editable(p) && p.status !== 'inactive' ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Input className="!w-52" value={link[p.id] ?? ''} onChange={e => setLink({ ...link, [p.id]: e.target.value })}
                            placeholder={t('b2b.hrOrg.link.placeholder')} aria-label={fmt(t('b2b.hrOrg.link.label'), { name: name(p) })} data-testid={`org-staff-link-${p.id}`} />
                          <Button size="sm" variant="secondary" disabled={busy || !(link[p.id] ?? '').trim()}
                            onClick={() => run(async () => {
                              await api.linkB2BBeneficiary(token, orgId, p.id, userContact(link[p.id]));
                              setLink({ ...link, [p.id]: '' });
                              return fmt(t('b2b.hrOrg.link.done'), { name: name(p) });
                            }, 'b2b.hrOrg.link.failed')}>
                            {t('b2b.hrOrg.link.button')}
                          </Button>
                        </span>
                      ) : <Badge tone="gray">{t('b2b.hrOrg.notLinked')}</Badge>}
                    </Td>
                    <Td><Badge tone={STATUS_TONE[p.status] ?? 'gray'}>{statusLabel(t, p.status)}</Badge></Td>
                    <Td className="text-right">
                      {editable(p) && (
                        <span className="flex justify-end gap-2">
                          {/* Someone who left is not brought back from here: their seat went back to the pool. */}
                          {(p.status === 'pending' || p.status === 'suspended') && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus(p, 'active')}>{t('b2b.hrOrg.action.activate')}</Button>}
                          {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus(p, 'suspended')}>{t('b2b.hrOrg.action.suspend')}</Button>}
                          {p.status !== 'inactive' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setLeaving(p)}>{t('b2b.hrOrg.action.left')}</Button>}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('b2b.hrOrg.coveredNote')}</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!leaving}
        onClose={() => setLeaving(null)}
        onConfirm={() => { const p = leaving; setLeaving(null); if (p) setStatus(p, 'inactive'); }}
        title={leaving ? fmt(t('b2b.hrOrg.left.title'), { name: name(leaving) }) : ''}
        description={t('b2b.hrOrg.left.body')}
        confirmLabel={t('b2b.hrOrg.left.confirm')}
        cancelLabel={t('b2b.hrOrg.cancel')}
        busy={busy}
      />
      <PinOnce pin={pin} onDone={() => setPin(null)} />
    </div>
  );
}

/** The activation PIN of someone just added: shown once, copied or written down, then gone. */
function PinOnce({ pin, onDone }: { pin: { name: string; pin: string } | null; onDone: () => void }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [pin]);
  return (
    <Dialog open={!!pin} onClose={onDone} title={pin ? fmt(t('b2b.hrOrg.pin.title'), { name: pin.name }) : ''} size="sm">
      <div className="space-y-3" data-testid="org-staff-pin">
        <Alert tone="warning">{t('b2b.hrOrg.pin.warning')}</Alert>
        <Field label={t('b2b.hrOrg.pin.label')}>
          <Input readOnly value={pin?.pin ?? ''} onFocus={e => e.currentTarget.select()} className="font-mono text-lg tracking-widest" data-testid="org-staff-pin-value" />
        </Field>
        <Button type="button" size="sm" variant="secondary" data-testid="org-staff-pin-copy"
          onClick={async () => { try { await navigator.clipboard.writeText(pin?.pin ?? ''); setCopied(true); } catch { /* the field stays selectable */ } }}>
          {copied ? t('b2b.hrOrg.pin.copied') : t('b2b.hrOrg.pin.copy')}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone} data-testid="org-staff-pin-done">{t('b2b.hrOrg.pin.done')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Many at once ─────────────────────────────────────────────────────────────

const EXAMPLE = 'name,email,phone,group\nAsha Mollel,asha@example.co.tz,,Finance\nJuma Omari,,0712 345 678,Operations';
const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Hands the browser a file to save. The mark at the front makes Excel read it as UTF-8. */
function saveCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function CompanyStaffImport({ token, orgId, onChanged }: { token: string; orgId: string; onChanged: () => void }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<B2BImportResult | null>(null);
  const [done, setDone] = useState<B2BImportResult | null>(null);
  // Shown once, then dropped: never kept with the import or anywhere else.
  const [credentials, setCredentials] = useState<NonNullable<B2BImportResult['credentials']>>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPreview(null); setDone(null); setText(''); setCredentials([]); }, [orgId]);

  const pick = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError(t('b2b.hrOrg.import.fileTooBig')); return; }
    setText(await file.text()); setPreview(null); setDone(null); setError(null);
  };
  const send = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    try {
      const out = await api.importB2BBeneficiaries(token, orgId, { rawText: text, dryRun });
      if (dryRun) { setPreview(out); setDone(null); return; }
      setDone(out); setPreview(null); setText(''); setCopied(false);
      setCredentials(out.credentials ?? []);
      onChanged();
    } catch (e) {
      setError(errorText(t, e, dryRun ? 'b2b.hrOrg.import.checkFailed' : 'b2b.hrOrg.import.addFailed'));
    } finally {
      setBusy(false);
    }
  };
  const credentialsCsv = () => [
    [t('b2b.hrOrg.creds.csvLine'), t('b2b.hrOrg.creds.csvEmployeeId'), t('b2b.hrOrg.creds.csvName'), t('b2b.hrOrg.creds.csvPin')].map(csvCell).join(','),
    ...credentials.map(c => [c.line, c.employeeId, c.displayName, c.pin].map(csvCell).join(',')),
  ].join('\n') + '\n';

  const summary = (r: B2BImportResult, past: boolean) => (
    <div className="space-y-2" data-testid={past ? 'org-staff-import-result' : 'org-staff-import-preview'}>
      <div className="grid gap-2 sm:grid-cols-3">
        {([[past ? t('b2b.hrOrg.import.added') : t('b2b.hrOrg.import.willAdd'), r.enrolled], [t('b2b.hrOrg.import.unchanged'), r.unchanged], [t('b2b.hrOrg.import.rejected'), r.rejected]] as Array<[string, number]>).map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] px-3 py-2">
            <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div><div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>
      {!past && r.seatsAvailable !== undefined && (
        <p className="text-xs text-[var(--color-fg-tertiary)]">{r.seatsAvailable === null ? t('b2b.hrOrg.import.seatsUnlimited') : fmt(t('b2b.hrOrg.import.seatsFree'), { n: r.seatsAvailable })}</p>
      )}
      {r.problems.length > 0 && (
        <Table aria-label={t('b2b.hrOrg.import.rejected')} data-testid="org-staff-import-problems">
          <THead><Tr><Th>{t('b2b.hrOrg.import.line')}</Th><Th>{t('b2b.hrOrg.import.who')}</Th><Th>{t('b2b.hrOrg.import.why')}</Th></Tr></THead>
          <TBody>
            {r.problems.slice(0, 50).map(p => (
              <Tr key={`${p.line}-${p.problem}`}><Td>{p.line}</Td><Td>{[p.name, p.contact].filter(Boolean).join(' · ') || '—'}</Td><Td>{problemLabel(t, p.problem)}</Td></Tr>
            ))}
          </TBody>
        </Table>
      )}
      {r.problems.length > 50 && <p className="text-xs text-[var(--color-fg-quaternary)]">{fmt(t('b2b.hrOrg.import.more'), { n: r.problems.length - 50 })}</p>}
    </div>
  );

  return (
    <>
      {credentials.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-4" data-testid="org-staff-credentials">
            <div className="text-sm font-semibold">{t('b2b.hrOrg.creds.title')}</div>
            <Alert tone="warning">{t('b2b.hrOrg.creds.warning')}</Alert>
            <Table aria-label={t('b2b.hrOrg.creds.title')}>
              <THead><Tr><Th>{t('b2b.hrOrg.import.line')}</Th><Th>{t('b2b.hrOrg.col.name')}</Th><Th>{t('b2b.hrOrg.pin.label')}</Th></Tr></THead>
              <TBody>
                {credentials.map(c => <Tr key={c.employeeId}><Td>{c.line}</Td><Td>{c.displayName ?? '—'}</Td><Td className="font-mono">{c.pin}</Td></Tr>)}
              </TBody>
            </Table>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => saveCsv(t('b2b.hrOrg.creds.filename'), credentialsCsv())} data-testid="org-staff-credentials-download">{t('b2b.hrOrg.creds.download')}</Button>
              <Button size="sm" variant="secondary" data-testid="org-staff-credentials-copy"
                onClick={async () => { try { await navigator.clipboard.writeText(credentialsCsv()); setCopied(true); } catch { /* the table stays selectable */ } }}>
                {copied ? t('b2b.hrOrg.creds.copied') : t('b2b.hrOrg.creds.copy')}
              </Button>
              <Button size="sm" onClick={() => setCredentials([])} data-testid="org-staff-credentials-done">{t('b2b.hrOrg.creds.done')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-3 py-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{t('b2b.hrOrg.import.heading')}</div>
              <div className="text-xs text-[var(--color-fg-quaternary)]">{t('b2b.hrOrg.import.description')}</div>
            </div>
            {!open && <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="org-staff-import-open"><Upload className="h-4 w-4" aria-hidden="true" />{t('b2b.hrOrg.import.open')}</Button>}
          </div>
          {open && (
            <div className="space-y-3">
              <Field label={t('b2b.hrOrg.import.text')} hint={t('b2b.hrOrg.import.textHint')}>
                <Textarea className="font-mono text-xs" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }} placeholder={EXAMPLE} data-testid="org-staff-import-text" />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <input type="file" accept=".csv,text/csv,text/plain" className="text-sm" onChange={e => pick(e.target.files?.[0])} aria-label={t('b2b.hrOrg.import.file')} />
                <Button size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => send(true)} data-testid="org-staff-import-check">{busy && !preview ? t('b2b.hrOrg.import.checking') : t('b2b.hrOrg.import.check')}</Button>
                {preview && preview.enrolled > 0 && <Button size="sm" disabled={busy} onClick={() => send(false)} data-testid="org-staff-import-confirm">{countLabel(t, 'b2b.hrOrg.import.confirm', preview.enrolled)}</Button>}
                <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setPreview(null); setDone(null); setText(''); }}>{t('b2b.hrOrg.import.close')}</Button>
              </div>
              {preview && summary(preview, false)}
              {preview && preview.enrolled === 0 && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('b2b.hrOrg.import.nobodyNew')}</p>}
              {done && <><Alert tone="success">{fmt(t('b2b.hrOrg.import.done'), { added: done.enrolled, unchanged: done.unchanged, rejected: done.rejected })}</Alert>{summary(done, true)}</>}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
