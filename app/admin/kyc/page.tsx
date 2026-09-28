'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../../providers';
import { api, KycCaseRow, KycCaseStatus, KycPartnerType } from '@/lib/api';
import { CASE_STATUS, PARTNER_TYPE_LABEL, QUEUE_TABS, day, errorMessage } from '@/lib/kyc';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Spinner } from '@/components/shared';
import { KycCaseView } from '@/components/kyc-case';

const TYPES: Array<KycPartnerType | 'all'> = ['all', 'gym_owner', 'trainer', 'vendor', 'corporate'];

/**
 * Partner verification: the queue of KYC/KYB cases, and one case at a time
 * (?case=<id>) to review documents, payout accounts and site visits and decide.
 */
export default function KycPage() {
  const { token, user } = useApp();
  const [rows, setRows] = useState<KycCaseRow[] | null>(null);
  const [tab, setTab] = useState<KycCaseStatus>('submitted');
  const [type, setType] = useState<KycPartnerType | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The open case lives in the URL so it survives a refresh and can be shared.
  useEffect(() => {
    const sync = () => setOpenId(new URLSearchParams(window.location.search).get('case'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const open = (id: string | null) => {
    history.pushState(null, '', id ? `?case=${encodeURIComponent(id)}` : window.location.pathname);
    setOpenId(id);
  };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setRows(await api.kycCases(token));
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (!token || user?.userType !== 'admin') return null;

  if (openId) {
    const row = rows?.find(r => r.id === openId) ?? null;
    return <KycCaseView caseId={openId} partnerName={row?.partnerName ?? null} onBack={() => { open(null); load(); }} />;
  }

  const ofType = (rows ?? []).filter(r => type === 'all' || r.partnerType === type);
  const count = (s: KycCaseStatus) => ofType.filter(r => r.status === s).length;
  const shown = ofType.filter(r => r.status === tab);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partner verification"
        description="KYC and KYB for gym owners, trainers, vendors and companies. Take a submitted case into review, check its documents and payout account, then decide."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
          {QUEUE_TABS.map(s => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} data-testid={`kyc-tab-${s}`}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === s ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
              {CASE_STATUS[s].label}
              <span className="rounded-full bg-[var(--color-bg-tertiary)] px-1.5 text-xs tabular-nums">{count(s)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-tertiary)]">
          Partner
          <select className="ui-input w-auto py-1.5" value={type} onChange={e => setType(e.target.value as KycPartnerType | 'all')} data-testid="kyc-type-filter">
            {TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All partners' : PARTNER_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-[var(--color-fg-quaternary)]">
              <ShieldCheck className="h-6 w-6" />
              {tab === 'submitted' ? 'Nothing waiting for review. Cases appear here when partners submit.' : `No ${CASE_STATUS[tab].label.toLowerCase()} cases.`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="kyc-table">
                <thead className="text-left text-xs text-[var(--color-fg-tertiary)]">
                  <tr className="border-b border-[var(--color-border-secondary)]">
                    <th className="px-4 py-2.5 font-medium">Partner</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                    <th className="px-4 py-2.5 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-secondary)]">
                  {shown.map(r => (
                    <tr key={r.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => open(r.id)} data-testid={`kyc-row-${r.id}`}>
                      <td className="px-4 py-3">
                        <button className="text-left font-medium text-[var(--color-fg-primary)] hover:underline" onClick={e => { e.stopPropagation(); open(r.id); }}>
                          {r.partnerName || r.legalName || 'Unnamed partner'}
                        </button>
                        {r.legalName && r.legalName !== r.partnerName && <p className="text-xs text-[var(--color-fg-quaternary)]">{r.legalName}</p>}
                      </td>
                      <td className="px-4 py-3">{PARTNER_TYPE_LABEL[r.partnerType]} <span className="text-xs text-[var(--color-fg-quaternary)]">· Tier {r.tier}</span></td>
                      <td className="px-4 py-3">
                        <Badge tone={CASE_STATUS[r.status].tone}>{CASE_STATUS[r.status].label}</Badge>
                        {r.round > 1 && <span className="ml-2 text-xs text-[var(--color-fg-quaternary)]">Round {r.round}</span>}
                        {!!r.documentsToReview && r.status !== 'in_review' && r.status !== 'submitted' && (
                          <span className="ml-2"><Badge tone="warning">{r.documentsToReview} to review</Badge></span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{day(r.submittedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{day(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
