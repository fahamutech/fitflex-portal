'use client';
import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { api, ApiError, B2BBeneficiaryInvite, B2BImportResult } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, Field, Spinner } from '@/components/shared';

const PROBLEMS: Record<string, string> = {
  email_or_phone_required: 'No email address or mobile number',
  invalid_email: 'The email address doesn’t look right',
  invalid_phone: 'The mobile number doesn’t look right',
  invalid_type: 'The type isn’t one FitFlex knows',
  listed_twice: 'Listed more than once in this file',
  external_reference_in_use: 'Someone else on your list already has that reference',
  beneficiary_must_be_member: 'That account isn’t a member account',
};
const ERRORS: Record<string, string> = {
  nothing_to_import: 'There is nobody in that list.',
  too_many_rows: 'That is more than 2,000 people. Split the list and add it in parts.',
  organization_not_active: 'Your organisation isn’t active yet, so people can’t be added.',
  managed_by_corporate: 'Your company’s staff list is managed by its HR login.',
  forbidden: 'Your role doesn’t include adding people.',
  sent_recently: 'An email went to them less than an hour ago.',
  email_limit_reached: 'They have been emailed six times. Tell them directly.',
  invite_has_no_email: 'They were listed by mobile number only, so there is no email to send. Tell them to join FitFlex with that number.',
  invite_already_used: 'They have joined, or the invite was cancelled.',
};
const said = (e: unknown, fallback: string) => {
  const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
  return (code && ERRORS[code]) || fallback;
};
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const EXAMPLE = 'name,email,phone,group,reference\nAsha Mollel,asha@example.co.tz,,Finance,EMP-001\nJuma Omari,,0712 345 678,Operations,EMP-002';

/**
 * Add many people at once, and see who has been invited but has not joined
 * FitFlex yet. Someone who already has the app is added straight away;
 * everyone else is invited and added the moment they join.
 */
export function PeopleImport({ token, orgId, canManage, onChanged }: { token: string; orgId: string; canManage: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<B2BImportResult | null>(null);
  const [done, setDone] = useState<B2BImportResult | null>(null);
  const [invites, setInvites] = useState<B2BBeneficiaryInvite[] | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInvites = () => api.b2bBeneficiaryInvites(token, orgId).then((r) => { setInvites(r.items); setEmailConfigured(r.emailConfigured); }).catch(() => setInvites([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setInvites(null); setPreview(null); setDone(null); setText(''); loadInvites(); }, [token, orgId]);

  const pick = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('That file is too big. Save the list as CSV, 2,000 people at most.'); return; }
    setText(await file.text()); setPreview(null); setDone(null); setError(null);
  };
  const send = async (dryRun: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const out = await api.importB2BBeneficiaries(token, orgId, { rawText: text, dryRun });
      if (dryRun) { setPreview(out); setDone(null); } else { setDone(out); setPreview(null); setText(''); await loadInvites(); onChanged(); }
    } catch (e) {
      setError(said(e, dryRun ? 'Could not check the list.' : 'Could not add the list.'));
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await loadInvites(); } catch (e) { setError(said(e, 'That did not work.')); } finally { setBusy(false); }
  };

  const summary = (r: B2BImportResult, past: boolean) => (
    <div className="space-y-2" data-testid={past ? 'import-result' : 'import-preview'}>
      <div className="grid gap-2 sm:grid-cols-4">
        {([[past ? 'Added now' : 'Will be added now', r.enrolled, 'Already use FitFlex'], [past ? 'Invited' : 'Will be invited', r.invited, 'Added when they join'],
          ['Already on your list', r.unchanged, 'Nothing to do'], ['Can’t be used', r.rejected, 'See below']] as Array<[string, number, string]>).map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border border-[var(--color-border-secondary)] px-3 py-2">
            <div className="text-xs text-[var(--color-fg-quaternary)]">{label}</div><div className="text-lg font-semibold">{value}</div><div className="text-xs text-[var(--color-fg-tertiary)]">{sub}</div>
          </div>
        ))}
      </div>
      {r.invited > 0 && r.withoutEmail > 0 && <p className="text-xs text-[var(--color-fg-tertiary)]">People listed with a mobile number only get no email from FitFlex. Tell them to join the app with that number.</p>}
      {r.problems.length > 0 && (
        <table className="w-full text-sm" data-testid="import-problems">
          <thead><tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]"><th className="py-1.5 pr-3">Line</th><th className="py-1.5 pr-3">Who</th><th className="py-1.5">Why it can’t be used</th></tr></thead>
          <tbody>
            {r.problems.slice(0, 50).map(p => (
              <tr key={`${p.line}-${p.problem}`} className="border-b border-[var(--color-border-secondary)]"><td className="py-1.5 pr-3">{p.line}</td><td className="py-1.5 pr-3">{[p.name, p.contact].filter(Boolean).join(' · ') || '—'}</td><td className="py-1.5">{PROBLEMS[p.problem] ?? p.problem}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {r.problems.length > 50 && <p className="text-xs text-[var(--color-fg-quaternary)]">And {r.problems.length - 50} more.</p>}
    </div>
  );

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {canManage && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Add many people</div>
                <div className="text-xs text-[var(--color-fg-quaternary)]">Paste or upload a list. People who already use FitFlex are added now; everyone else is invited and added when they join.</div>
              </div>
              {!open && <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="import-open"><Upload className="h-4 w-4" />Add a list</Button>}
            </div>
            {open && (
              <div className="space-y-3">
                <Field label="One person per line" hint="Columns: name, email, phone, group, reference. Each person needs an email address or a mobile number. A first line naming the columns lets you use any order.">
                  <textarea className="ui-input font-mono text-xs" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }} placeholder={EXAMPLE} data-testid="import-text" />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="file" accept=".csv,text/csv,text/plain" className="text-sm" onChange={e => pick(e.target.files?.[0])} aria-label="Upload a CSV file" />
                  <Button size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => send(true)} data-testid="import-check">{busy && !preview ? 'Checking…' : 'Check the list'}</Button>
                  {preview && preview.enrolled + preview.invited > 0 && <Button size="sm" disabled={busy} onClick={() => send(false)} data-testid="import-confirm">Add {preview.enrolled + preview.invited} {preview.enrolled + preview.invited === 1 ? 'person' : 'people'}</Button>}
                  <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setPreview(null); setDone(null); setText(''); }}>Close</Button>
                </div>
                {preview && summary(preview, false)}
                {preview && preview.enrolled + preview.invited === 0 && <p className="text-sm text-[var(--color-fg-tertiary)]">There is nobody new to add in this list.</p>}
                {done && <><Alert tone="success">Done. {done.enrolled} added, {done.invited} invited.</Alert>{summary(done, true)}</>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {invites === null ? <Spinner className="h-5 w-5" /> : invites.length > 0 && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="text-sm font-semibold">{invites.length} invited, not joined yet</div>
            {!emailConfigured && <Alert tone="warning">FitFlex can’t send invitation emails at the moment. People are still added when they join; tell them to sign up with the email or number you listed.</Alert>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="org-invites">
                <thead>
                  <tr className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-quaternary)]">
                    <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Listed as</th><th className="py-2 pr-3">Group</th><th className="py-2 pr-3">Invited</th><th className="py-2 pr-3">Emails</th><th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {invites.map(i => (
                    <tr key={i.id} className="border-b border-[var(--color-border-secondary)]">
                      <td className="py-2 pr-3 font-medium">{i.displayName ?? '—'}</td>
                      <td className="py-2 pr-3">{i.email ?? i.phone}</td>
                      <td className="py-2 pr-3">{i.groupName ?? ''}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{day(i.invitedAt)}</td>
                      <td className="py-2 pr-3 text-xs">
                        {!i.email ? <span className="text-[var(--color-fg-quaternary)]">No email: tell them yourself</span>
                          : i.emailFailures >= 3 ? <Badge tone="danger">Email not delivered</Badge>
                            : i.emailsSent === 0 ? 'Being sent' : `${i.emailsSent} sent · last ${day(i.lastEmailAt)}${i.nextEmailAt ? ` · next ${day(i.nextEmailAt)}` : ''}`}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {canManage && (
                          <span className="inline-flex gap-2">
                            {i.canResend && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(async () => { const r = await api.resendB2BBeneficiaryInvite(token, orgId, i.id); return r.sent ? 'Email sent again.' : 'The email could not be sent just now.'; })}>Send again</Button>}
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(async () => { await api.cancelB2BBeneficiaryInvite(token, orgId, i.id); return 'Invite cancelled.'; })}>Cancel</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--color-fg-quaternary)]">They are added to your list the moment they join FitFlex as a member with the email or number shown. FitFlex emails the invitation, then a reminder after 3 days and another after 10.</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
