'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Check, Eye, FileText, History, Lock, MapPin, RefreshCw, ShieldAlert, ShieldCheck, UserCheck, Wallet, X,
} from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, KycCaseDetail, KycChecklistItem, KycDecision, KycDocument, KycSettlementAccount } from '@/lib/api';
import {
  CASE_STATUS, DECISION_COPY, GYM_TIERS, GYM_TIER_LABEL, ITEM_STATUS, PARTNER_TYPE_LABEL, REASON_LABEL, REQUIREMENT_LABEL,
  SECTION_LABEL, addressLine, dateTime, day, errorMessage, eventLine, itemLabel,
} from '@/lib/kyc';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Field, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

type Pending =
  | { kind: 'decision'; decision: KycDecision }
  | { kind: 'document'; doc: KycDocument; decision: 'accept' | 'reject' }
  | { kind: 'account'; account: KycSettlementAccount; decision: 'verify' | 'reject' }
  | { kind: 'site-visit'; gymId: string; gymName: string; gymTier: string | null }
  | { kind: 'view'; doc: KycDocument };

/** One KYC case: what the partner provided, what's left, and the reviewer's actions. */
export function KycCaseView({ caseId, partnerName, onBack }: { caseId: string; partnerName: string | null; onBack: () => void }) {
  const { token, user } = useApp();
  const [data, setData] = useState<KycCaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await api.kycCase(token, caseId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [token, caseId]);
  useEffect(() => { load(); }, [load]);

  const claim = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setData(await api.claimKycCase(token, caseId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All cases</Button>
        {error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }

  const c = data.case;
  const status = CASE_STATUS[c.status];
  const inReview = c.status === 'in_review';
  const mine = c.reviewerId === user?.id;
  const name = partnerName || c.legalName || data.people[0]?.fullName || 'Partner';
  const currentDocs = latestDocuments(data.documents);
  const siteVisitGyms = gymsForSiteVisits(data.checklist.sections.flatMap(s => s.items));

  const actions: Array<{ decision: KycDecision; primary?: boolean }> =
    c.status === 'in_review' ? [{ decision: 'approve', primary: true }, { decision: 'request_info' }, { decision: 'reject' }]
      : c.status === 'approved' ? [{ decision: 'suspend' }]
        : c.status === 'suspended' ? [{ decision: 'reinstate', primary: true }]
          : c.status === 'rejected' ? [{ decision: 'reopen' }]
            : [];

  return (
    <div className="space-y-6" data-testid="kyc-case">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All cases</Button>
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-quaternary)]">
            <Badge tone={status.tone}>{status.label}</Badge>
            {PARTNER_TYPE_LABEL[c.partnerType]} · Tier {c.tier}{c.round > 1 ? ` · Round ${c.round}` : ''}
            {c.submittedAt && ` · Submitted ${day(c.submittedAt)}`}
            {inReview && ` · ${mine ? 'You are reviewing' : 'Another reviewer has it'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
          {(c.status === 'submitted' || (inReview && !mine)) && (
            <Button size="sm" onClick={claim} disabled={busy} data-testid="kyc-claim">
              <UserCheck className="h-4 w-4" />{c.status === 'submitted' ? 'Start review' : 'Take over'}
            </Button>
          )}
          {actions.map(a => (
            <Button key={a.decision} size="sm" variant={a.primary ? 'primary' : a.decision === 'reject' || a.decision === 'suspend' ? 'destructive' : 'secondary'}
              onClick={() => setPending({ kind: 'decision', decision: a.decision })} data-testid={`kyc-decide-${a.decision}`}>
              {DECISION_COPY[a.decision].action}
            </Button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {c.reasonCode && (
        <Alert tone={c.status === 'info_requested' ? 'warning' : 'error'}>
          <strong>{REASON_LABEL[c.reasonCode] ?? c.reasonCode}.</strong> {c.reasonNote}
        </Alert>
      )}
      {c.status === 'approved' && c.reverifyAt && (
        <Alert tone="success">Verified {day(c.decidedAt)}. Due for review again by {day(c.reverifyAt)}.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Checklist data={data} />

          <Card>
            <CardHeader><h2 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" />Documents</h2></CardHeader>
            <CardContent className="p-0">
              {currentDocs.length === 0 ? <p className="p-5 text-sm text-[var(--color-fg-quaternary)]">No documents yet.</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {currentDocs.map(d => (
                    <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" data-testid={`kyc-doc-${d.requirementKey}`}>
                      <div className="min-w-0 flex-1 space-y-1 text-sm">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {REQUIREMENT_LABEL[d.requirementKey] ?? d.requirementKey}
                          <Badge tone={d.status === 'accepted' ? 'success' : d.status === 'rejected' || d.status === 'expired' ? 'danger' : d.hasFile ? 'brand' : 'warning'}>
                            {d.status === 'pending' ? (d.hasFile ? 'To review' : 'File missing') : d.status[0].toUpperCase() + d.status.slice(1)}
                          </Badge>
                        </p>
                        <p className="text-xs text-[var(--color-fg-tertiary)]">
                          {[d.docType.replace(/_/g, ' '), d.documentNumber && `No. ${d.documentNumber}`, d.issuer && `Issued by ${d.issuer}`,
                            d.issuedOn && `from ${day(d.issuedOn)}`, d.expiresOn && `expires ${day(d.expiresOn)}`].filter(Boolean).join(' · ')}
                        </p>
                        {d.fileName && <p className="text-xs text-[var(--color-fg-quaternary)]">{d.fileName}{d.sizeBytes ? ` · ${Math.ceil(d.sizeBytes / 1024)} KB` : ''}</p>}
                        {d.reviewNote && <p className="text-xs text-[var(--color-fg-tertiary)]">Note: {d.reviewNote}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {d.hasFile && <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'view', doc: d })} data-testid="kyc-doc-view"><Eye className="h-4 w-4" />View</Button>}
                        {inReview && d.status === 'pending' && <>
                          <Button size="sm" disabled={!d.hasFile} title={d.hasFile ? undefined : 'No file yet'} onClick={() => setPending({ kind: 'document', doc: d, decision: 'accept' })} data-testid="kyc-doc-accept"><Check className="h-4 w-4" />Accept</Button>
                          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'document', doc: d, decision: 'reject' })} data-testid="kyc-doc-reject"><X className="h-4 w-4" />Reject</Button>
                        </>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {data.settlementAccounts.length > 0 && (
            <Card>
              <CardHeader><h2 className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4" />Payout accounts</h2></CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {data.settlementAccounts.map(a => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm" data-testid={`kyc-account-${a.id}`}>
                      <div>
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {a.method === 'bank' ? a.provider : providerLabel(a.provider)} · <span className="font-mono">{a.accountNumber}</span>
                          <Badge tone={a.status === 'verified' ? 'success' : a.status === 'rejected' || a.status === 'disabled' ? 'danger' : 'warning'}>
                            {a.status === 'pending_verification' ? 'To verify' : a.status[0].toUpperCase() + a.status.slice(1)}
                          </Badge>
                          {a.isPrimary && <Badge tone="brand">Payout account</Badge>}
                        </p>
                        <p className="text-xs text-[var(--color-fg-tertiary)]">{a.accountName}{a.branch ? ` · ${a.branch}` : ''} · added {day(a.createdAt)}</p>
                      </div>
                      {a.status === 'pending_verification' && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => setPending({ kind: 'account', account: a, decision: 'verify' })} data-testid="kyc-account-verify"><Check className="h-4 w-4" />Verify</Button>
                          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'account', account: a, decision: 'reject' })}><X className="h-4 w-4" />Reject</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {siteVisitGyms.length > 0 && (
            <Card>
              <CardHeader><h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4" />Site visits</h2></CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-[var(--color-border-secondary)]">
                  {siteVisitGyms.map(g => {
                    const visits = data.checks.filter(k => k.checkType === 'site_visit' && k.targetId === g.gymId)
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                    const last = visits[0];
                    return (
                      <li key={g.gymId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm" data-testid={`kyc-gym-${g.gymId}`}>
                        <div>
                          <p className="font-medium">{g.gymName}</p>
                          <p className="text-xs text-[var(--color-fg-tertiary)]">
                            {last
                              ? `${last.result === 'passed' ? 'Passed' : 'Failed'} ${day(String(last.evidence.visitedOn ?? last.createdAt))} · score ${String(last.evidence.score)}${last.evidence.maxScore ? `/${String(last.evidence.maxScore)}` : ''} · vetted ${GYM_TIER_LABEL[String(last.evidence.tier)] ?? last.evidence.tier}`
                              : 'Not visited yet'}
                            {` · listed as ${GYM_TIER_LABEL[g.gymTier ?? ''] ?? g.gymTier ?? 'no tier'}`}
                          </p>
                          {last?.note && <p className="text-xs text-[var(--color-fg-quaternary)]">{last.note}</p>}
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'site-visit', ...g })} data-testid="kyc-site-visit">
                          <MapPin className="h-4 w-4" />Record visit
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Details data={data} />
          <Timeline data={data} />
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ID, TIN and account numbers are visible only to FitFlex staff with verification access. Documents open from private storage and every view is recorded.
      </p>

      {pending?.kind === 'decision' && (
        <DecisionDialog caseId={caseId} decision={pending.decision} canOverride={!user?.portalUser}
          onClose={() => setPending(null)} onDone={d => { setData(d); setPending(null); }} />
      )}
      {pending?.kind === 'document' && (
        <NoteDialog title={pending.decision === 'accept' ? 'Accept document' : 'Reject document'}
          description={REQUIREMENT_LABEL[pending.doc.requirementKey] ?? pending.doc.requirementKey}
          noteRequired={pending.decision === 'reject'} action={pending.decision === 'accept' ? 'Accept' : 'Reject'}
          onClose={() => setPending(null)}
          onSubmit={note => api.reviewKycDocument(token!, caseId, pending.doc.id, { decision: pending.decision, note })}
          onDone={d => { setData(d); setPending(null); }} />
      )}
      {pending?.kind === 'account' && (
        <NoteDialog title={pending.decision === 'verify' ? 'Verify payout account' : 'Reject payout account'}
          description={`${pending.account.accountName} · ${pending.account.accountNumber}`}
          hint={pending.decision === 'verify' ? 'Check the account name matches the partner. A verified account can receive payouts after 48 hours.' : undefined}
          noteRequired={pending.decision === 'reject'} action={pending.decision === 'verify' ? 'Verify' : 'Reject'}
          onClose={() => setPending(null)}
          onSubmit={note => api.reviewKycSettlementAccount(token!, caseId, pending.account.id, { decision: pending.decision, note })}
          onDone={d => { setData(d); setPending(null); }} />
      )}
      {pending?.kind === 'site-visit' && (
        <SiteVisitDialog gymId={pending.gymId} gymName={pending.gymName} gymTier={pending.gymTier}
          onClose={() => setPending(null)} onDone={async () => { setPending(null); await load(); }} />
      )}
      {pending?.kind === 'view' && (
        <DocumentViewer caseId={caseId} doc={pending.doc} onClose={() => setPending(null)} />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** The document standing for each requirement (newest first, superseded hidden). */
function latestDocuments(docs: KycDocument[]) {
  const byKey = new Map<string, KycDocument>();
  for (const d of [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (d.status !== 'superseded' && !byKey.has(d.requirementKey)) byKey.set(d.requirementKey, d);
  }
  return [...byKey.values()];
}

function gymsForSiteVisits(items: KycChecklistItem[]) {
  const seen = new Map<string, { gymId: string; gymName: string; gymTier: string | null }>();
  for (const i of items) {
    if (i.gymId && !seen.has(i.gymId)) seen.set(i.gymId, { gymId: i.gymId, gymName: i.gymName ?? 'Gym', gymTier: null });
    if (i.gymId && i.key === 'operational.gym_tier') seen.get(i.gymId)!.gymTier = i.gymTier ?? null;
  }
  return [...seen.values()];
}

const providerLabel = (p: string) => ({ mpesa: 'M-Pesa', airtel_money: 'Airtel Money', mixx: 'Mixx by Yas', halopesa: 'HaloPesa' } as Record<string, string>)[p] ?? p;

function Checklist({ data }: { data: KycCaseDetail }) {
  const { checklist } = data;
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-semibold">
          {checklist.complete ? <ShieldCheck className="h-4 w-4 text-[var(--color-success-600)]" /> : <ShieldAlert className="h-4 w-4" />}
          Checklist
        </h2>
        <p className="text-sm text-[var(--color-fg-quaternary)]">
          {checklist.complete ? 'Everything is complete.'
            : `${checklist.missing.length} missing from the partner · ${checklist.awaitingReview.length} waiting for FitFlex`}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {checklist.sections.map(sec => (
          <div key={sec.key}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-tertiary)]">{SECTION_LABEL[sec.key] ?? sec.key}</h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {sec.items.map((i, n) => (
                <li key={`${i.key}-${i.gymId ?? n}`} className="flex items-start justify-between gap-2 text-sm" data-testid={`kyc-item-${i.key}`}>
                  <span>
                    {itemLabel(i.key)}{i.gymName ? <span className="text-[var(--color-fg-quaternary)]"> · {i.gymName}</span> : null}
                    {i.by === 'reviewer' && <span className="ml-1 text-xs text-[var(--color-fg-quaternary)]">(FitFlex)</span>}
                    {i.missingFields?.length ? <span className="block text-xs text-[var(--color-fg-quaternary)]">Needs: {i.missingFields.join(', ')}</span> : null}
                    {i.status === 'mismatch' && <span className="block text-xs text-[var(--color-fg-quaternary)]">Listed {GYM_TIER_LABEL[i.gymTier ?? ''] ?? i.gymTier}, vetted {GYM_TIER_LABEL[i.vettedTier ?? ''] ?? i.vettedTier}</span>}
                  </span>
                  <span className="shrink-0 whitespace-nowrap"><Badge tone={ITEM_STATUS[i.status].tone}>{ITEM_STATUS[i.status].label}</Badge></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-[var(--color-fg-tertiary)]">{label}</dt>
      <dd className="text-right font-medium">{value || '—'}</dd>
    </div>
  );
}

function Details({ data }: { data: KycCaseDetail }) {
  const c = data.case;
  const business = c.legalName || c.tradingName || c.registrationNumber || c.tin;
  return (
    <Card>
      <CardHeader><h2 className="font-semibold">Details</h2></CardHeader>
      <CardContent className="space-y-5">
        {data.people.map(p => (
          <dl key={p.id} className="space-y-1.5" data-testid={`kyc-person-${p.role}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-tertiary)]">{p.role === 'principal' ? 'Identity' : 'Representative'}</p>
            <Row label="Name" value={p.fullName} />
            <Row label={p.idType === 'passport' ? 'Passport' : p.idType === 'nida' ? 'NIDA' : 'ID'} value={p.idNumber && <span className="font-mono">{p.idNumber}</span>} />
            {p.nationality && p.nationality !== 'TZ' && <Row label="Nationality" value={p.nationality} />}
            <Row label="Phone" value={p.phone} />
            <Row label="Email" value={p.email} />
            {p.address && <Row label="Address" value={addressLine(p.address)} />}
            {p.relationship && <Row label="Relationship" value={p.relationship.replace(/_/g, ' ')} />}
            {p.position && <Row label="Position" value={p.position} />}
            {p.authority && <Row label="Authority" value={p.authority.replace(/_/g, ' ')} />}
          </dl>
        ))}
        {business && (
          <dl className="space-y-1.5" data-testid="kyc-business">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-tertiary)]">Business</p>
            <Row label="Legal name" value={c.legalName} />
            {c.tradingName && <Row label="Trading as" value={c.tradingName} />}
            {c.entityType && <Row label="Entity" value={c.entityType.replace(/_/g, ' ')} />}
            <Row label="Registration" value={c.registrationNumber && <span className="font-mono">{c.registrationNumber}</span>} />
            <Row label="TIN" value={c.tin && <span className="font-mono">{c.tin}</span>} />
            {c.businessActivity && <Row label="Activity" value={c.businessActivity} />}
            <Row label="Address" value={addressLine(c.registeredAddress)} />
          </dl>
        )}
        {data.people.length === 0 && !business && <p className="text-sm text-[var(--color-fg-quaternary)]">No details yet.</p>}
      </CardContent>
    </Card>
  );
}

function Timeline({ data }: { data: KycCaseDetail }) {
  return (
    <Card>
      <CardHeader><h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" />Timeline</h2></CardHeader>
      <CardContent>
        <ol className="space-y-3" data-testid="kyc-timeline">
          {data.events.map(e => (
            <li key={e.id} className="text-sm">
              <p>{eventLine(e)}</p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">
                {dateTime(e.at)} · {e.actorRole === 'admin' ? 'FitFlex' : e.actorRole === 'partner' ? 'Partner' : 'System'}
                {e.reasonCode ? ` · ${REASON_LABEL[e.reasonCode] ?? e.reasonCode}` : ''}
              </p>
              {e.note && <p className="text-xs text-[var(--color-fg-tertiary)]">{e.note}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function DecisionDialog({ caseId, decision, canOverride, onClose, onDone }: {
  caseId: string; decision: KycDecision; canOverride: boolean; onClose: () => void; onDone: (d: KycCaseDetail) => void;
}) {
  const { token } = useApp();
  const copy = DECISION_COPY[decision];
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [outstanding, setOutstanding] = useState<string[] | null>(null);
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.decideKycCase(token, caseId, {
        decision, reasonCode: reasonCode || undefined, reasonNote: note.trim() || undefined, ...(override ? { override: true } : {}),
      }));
    } catch (err) {
      const body = (err as { body?: { error?: string; outstanding?: string[] } }).body;
      if (body?.error === 'kyc_incomplete' && body.outstanding) setOutstanding(body.outstanding);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={copy.title} description={copy.hint} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="kyc-decision">
        {error && <Alert tone="error">{error}</Alert>}
        {outstanding && (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm">
            <p className="font-medium">Not complete yet:</p>
            <ul className="mt-1 list-disc pl-5 text-[var(--color-fg-tertiary)]">
              {outstanding.map(k => <li key={k}>{itemLabel(k.split('@')[0])}</li>)}
            </ul>
            {canOverride ? (
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} data-testid="kyc-override" className="mt-1" />
                <span>Approve anyway. Write why below; it is kept on the timeline.</span>
              </label>
            ) : <p className="mt-2 text-xs text-[var(--color-fg-quaternary)]">Only a full admin can approve an incomplete case.</p>}
          </div>
        )}
        {copy.needsReason && (
          <Field label="Reason">
            <select className="ui-input" value={reasonCode} onChange={e => setReasonCode(e.target.value)} required data-testid="kyc-reason">
              <option value="" disabled>Choose a reason</option>
              {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        {(copy.needsReason || decision === 'approve' || decision === 'reinstate') && (
          <Field label={copy.needsReason ? 'Message to the partner' : override ? 'Why approve an incomplete case' : 'Note (optional)'}>
            <textarea className="ui-input" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={2000}
              required={override} data-testid="kyc-note"
              placeholder={decision === 'request_info' ? 'e.g. Please upload a clearer photo of your NIDA card.' : ''} />
          </Field>
        )}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} variant={decision === 'reject' || decision === 'suspend' ? 'destructive' : 'primary'} data-testid="kyc-decision-save">{copy.action}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function NoteDialog({ title, description, hint, noteRequired, action, onClose, onSubmit, onDone }: {
  title: string; description: string; hint?: string; noteRequired: boolean; action: string;
  onClose: () => void; onSubmit: (note?: string) => Promise<KycCaseDetail>; onDone: (d: KycCaseDetail) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await onSubmit(note.trim() || undefined));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={title} description={description} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="kyc-note-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        {hint && <p className="text-sm text-[var(--color-fg-tertiary)]">{hint}</p>}
        <Field label={noteRequired ? 'Reason (the partner will see this)' : 'Note (optional)'}>
          <textarea className="ui-input" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} required={noteRequired} data-testid="kyc-note" />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="kyc-note-save">{action}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SiteVisitDialog({ gymId, gymName, gymTier, onClose, onDone }: {
  gymId: string; gymName: string; gymTier: string | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const { token } = useApp();
  const [result, setResult] = useState<'passed' | 'failed'>('passed');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [tier, setTier] = useState(gymTier ?? 'standard');
  const [visitedOn, setVisitedOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordKycSiteVisit(token, gymId, {
        result, score: Number(score), ...(maxScore ? { maxScore: Number(maxScore) } : {}), tier, visitedOn, notes: notes.trim() || undefined,
      });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Record site visit" description={gymName} size="sm">
      <form onSubmit={submit} className="space-y-4" data-testid="kyc-site-visit-form">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Result">
            <select className="ui-input" value={result} onChange={e => setResult(e.target.value as 'passed' | 'failed')}>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </Field>
          <Field label="Visited on">
            <input type="date" className="ui-input" value={visitedOn} onChange={e => setVisitedOn(e.target.value)} required />
          </Field>
          <Field label="Vetting score">
            <input type="number" min={0} step="any" className="ui-input" value={score} onChange={e => setScore(e.target.value)} required data-testid="kyc-visit-score" />
          </Field>
          <Field label="Out of (optional)">
            <input type="number" min={1} step="any" className="ui-input" value={maxScore} onChange={e => setMaxScore(e.target.value)} />
          </Field>
        </div>
        <Field label="Tier it merits" hint={gymTier && tier !== gymTier ? `The gym is listed as ${GYM_TIER_LABEL[gymTier] ?? gymTier}. Change its tier on the Gyms page if this is right.` : undefined}>
          <select className="ui-input" value={tier} onChange={e => setTier(e.target.value)}>
            {GYM_TIERS.map(t => <option key={t} value={t}>{GYM_TIER_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Notes (optional)">
          <textarea className="ui-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="kyc-visit-save">Record visit</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Opens a document from private storage. The file is fetched with the session, never by a public link. */
function DocumentViewer({ caseId, doc, onClose }: { caseId: string; doc: KycDocument; onClose: () => void }) {
  const { token } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    api.kycDocumentFile(token, caseId, doc.id)
      .then(blob => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(err => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, caseId, doc.id]);

  const isPdf = doc.mimeType === 'application/pdf';
  return (
    <Dialog open onClose={onClose} title={REQUIREMENT_LABEL[doc.requirementKey] ?? doc.requirementKey} description={doc.fileName ?? undefined} size="xl">
      <div className="space-y-3" data-testid="kyc-viewer">
        {error ? <Alert tone="error">{error}</Alert> : !url ? <Spinner className="h-6 w-6" /> : isPdf ? (
          <iframe src={url} title={doc.fileName ?? 'Document'} className="h-[70vh] w-full rounded-[var(--radius-md)] border border-[var(--color-border-secondary)]" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={doc.fileName ?? 'Document'} className="mx-auto max-h-[70vh] rounded-[var(--radius-md)]" />
        )}
        <p className="flex items-center gap-2 text-xs text-[var(--color-fg-quaternary)]">
          <Lock className="h-3.5 w-3.5" />This view is recorded on the case’s audit log.
        </p>
      </div>
    </Dialog>
  );
}
