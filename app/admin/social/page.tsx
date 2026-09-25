'use client';
import { useEffect, useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { useApp } from '../../providers';
import { api, SocialReport, SocialReportStatus } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, PageHeader, Spinner } from '@/components/shared';

const TABS: { value: SocialReportStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'actioned', label: 'Removed' },
  { value: 'dismissed', label: 'Dismissed' },
];
const REMOVE_LABEL: Record<SocialReport['targetType'], string> = {
  comment: 'Remove comment',
  group: 'Close group',
  activity: 'Stop sharing it',
  user: 'Noted',
};

function describe(r: SocialReport) {
  const t = r.target;
  if (!t) return 'No longer exists';
  switch (r.targetType) {
    case 'comment': return `“${t.text ?? ''}” by ${t.author ?? 'a member'}${t.removed ? ' (removed)' : ''}`;
    case 'group': return `Group “${t.name ?? ''}”${t.archived ? ' (closed)' : ''}`;
    case 'activity': return `${t.owner ?? 'A member'}'s ${t.type ?? 'activity'}${t.title ? ` “${t.title}”` : ''}`;
    default: return `Member ${t.displayName ?? ''}`;
  }
}

/** Admin: reports members made about comments, activities, people and groups. */
export default function AdminSocialPage() {
  const { token } = useApp();
  const [tab, setTab] = useState<SocialReportStatus>('open');
  const [rows, setRows] = useState<SocialReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setError(null);
    try { setRows((await api.socialReports(token, tab)).reports); } catch { setError('Could not load reports.'); setRows([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, tab]);

  const resolve = async (r: SocialReport, action: 'remove' | 'dismiss') => {
    if (!token) return;
    if (action === 'remove' && !window.confirm(`${REMOVE_LABEL[r.targetType]}? This is logged.`)) return;
    try { await api.resolveSocialReport(token, r.id, action); await load(); } catch { setError('Could not update that report.'); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moderation"
        description="Reports from members about comments, shared activities, people and groups."
        actions={<Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <div role="tablist" className="flex gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-1">
        {TABS.map(t => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.value ? 'bg-[var(--color-bg-primary)] font-semibold shadow-sm' : 'text-[var(--color-fg-tertiary)]'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows == null ? <div className="p-6"><Spinner className="h-6 w-6" /></div> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-[var(--color-fg-quaternary)]">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-secondary)]" data-testid="report-list">
              {rows.map(r => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2"><Badge tone="gray">{r.targetType}</Badge><span className="font-medium">{describe(r)}</span></p>
                    <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">
                      Reported by {r.reporter ?? 'a member'} · {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      {r.reason ? ` · “${r.reason}”` : ''}
                    </p>
                  </div>
                  {r.status === 'open' && (
                    <div className="flex gap-2">
                      {r.targetType !== 'user' && <Button size="sm" onClick={() => resolve(r, 'remove')}>{REMOVE_LABEL[r.targetType]}</Button>}
                      <Button size="sm" variant="secondary" onClick={() => resolve(r, 'dismiss')}>Dismiss</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="flex items-start gap-2 text-xs text-[var(--color-fg-quaternary)]">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Reports show only what was reported. Routes, calories and other members’ activity are never shown here.
      </p>
    </div>
  );
}
