'use client';
// Events S7 (spec §6.3 "Event controls" and the integrations block, §6.1 H6 and H16, §6.4 payments banner): what a FitFlex admin does to ONE event during an
// incident or at approval. Pause or resume registrations (published <-> registration_closed), allow rewards, and a counts-only view of the organizer's
// integrations. Every write asks for a reason (10 to 300 characters, optional Swahili text shown to the organizer). Nothing here changes a server flag.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminEventDetail } from '@/lib/api';
import { adminS7Api } from '@/lib/events-s7-api';
import { isFeatureOff } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, useToast } from '@/components/shared';
import { ReasonTypedDialog } from '@/components/events-s7-dialogs';
import { SwitchControl } from '@/components/events-s7-switch';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../app/providers';

/** §6.4 payments-off banner: the cause in words, shown to admins and to organizer roles that can see Finance. */
export function PaymentsOffBanner() {
  const { t } = useApp();
  const options = useEventsOptions();
  const reason = options?.payments?.blockedReason;
  if (!reason) return null;
  return <div data-testid="payments-off-banner"><Alert tone="warning">{t(`events.payments.blocked.${reason}` as MessageKey)}</Alert></div>;
}

export function AdminEventControls({ doc, onChanged }: { doc: AdminEventDetail; onChanged: () => void }) {
  const { t, token } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const [dialog, setDialog] = useState<'pause' | 'resume' | 'rewards' | null>(null);
  const [rewardsNext, setRewardsNext] = useState(false);
  const [integrations, setIntegrations] = useState<{ clients: number; endpoints: number } | null>(null);
  const status = doc.status;
  const canPause = status === 'published';
  const canResume = status === 'registration_closed';
  const rewardsOn = !!options?.results?.rewards;
  const eligible = !!doc.rewardsEligible;

  const loadIntegrations = useCallback(async () => {
    if (!token) return;
    try {
      const raw = await adminS7Api.integrations(token, doc.id);
      setIntegrations({ clients: raw.activeClients ?? 0, endpoints: raw.activeEndpoints ?? 0 });
    } catch (err) { if (!isFeatureOff(err)) setIntegrations(null); }
  }, [token, doc.id]);
  useEffect(() => { void loadIntegrations(); }, [loadIntegrations]);

  return (
    <Card data-testid="admin-event-controls">
      <CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.controls.title')}</h2></CardHeader>
      <CardContent className="space-y-4">
        <PaymentsOffBanner />
        {canResume && <div data-testid="admin-paused-note"><Alert tone="warning">{t('admin.events.ops.controls.paused')}</Alert></div>}
        <div className="flex flex-wrap gap-2">
          {canPause && <Button variant="destructive" onClick={() => setDialog('pause')} data-testid="admin-pause">{t('admin.events.ops.pause')}</Button>}
          {canResume && <Button onClick={() => setDialog('resume')} data-testid="admin-resume">{t('admin.events.ops.resume')}</Button>}
        </div>
        {rewardsOn && (
          <div className="space-y-1" data-testid="admin-rewards-eligible">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.rewards.title')}</h3>
            <SwitchControl checked={eligible} onChange={v => { setRewardsNext(v); setDialog('rewards'); }} label={t('admin.events.ops.rewards.switch')} help={t('admin.events.ops.rewards.help')} testId="admin-rewards-switch" />
            <Badge tone={eligible ? 'success' : 'gray'}>{t(eligible ? 'admin.events.ops.rewards.on' : 'admin.events.ops.rewards.off')}</Badge>
          </div>
        )}
        {integrations && (
          <div className="space-y-1" data-testid="admin-integrations-block">
            <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.events.ops.integrations.title')}</h3>
            <p className="text-sm text-[var(--color-fg-secondary)]">{t('admin.events.ops.integrations.counts').replace('{clients}', String(integrations.clients)).replace('{endpoints}', String(integrations.endpoints))}</p>
            <Link href="/admin/events?tab=operations" className="inline-flex min-h-11 items-center text-sm text-[var(--color-brand-700)] underline">{t('admin.events.ops.integrations.link')}</Link>
          </div>
        )}
      </CardContent>
      <ReasonTypedDialog open={dialog === 'pause' || dialog === 'resume'} onClose={() => setDialog(null)} title={t(dialog === 'resume' ? 'admin.events.ops.resume' : 'admin.events.ops.pause')} body={t(dialog === 'resume' ? 'admin.events.ops.resumeBody' : 'admin.events.ops.pauseBody')}
        tone={dialog === 'resume' ? 'primary' : 'danger'} confirmLabel={t(dialog === 'resume' ? 'admin.events.ops.resume' : 'admin.events.ops.pause')} testId="admin-pause-dialog"
        reasonLabel={t('admin.events.ops.reason')} reasonSwLabel={t('admin.events.ops.reasonSw')} typed={[doc.title]} typedLabel={t('events.s7.devices.typedEvent')}
        onConfirm={async r => {
          if (!token) return;
          const to = dialog === 'resume' ? 'open' : 'closed';
          await adminS7Api.registrationState(token, doc.id, { state: to, reason: r.reason, ...(r.reasonSw ? { reasonSw: r.reasonSw } : {}) }, r.key);
          toast.success(t(to === 'open' ? 'admin.events.ops.resumed.done' : 'admin.events.ops.paused.done')); setDialog(null); onChanged();
        }} />
      <ReasonTypedDialog open={dialog === 'rewards'} onClose={() => setDialog(null)} title={t('admin.events.ops.rewards.title')} tone="primary" confirmLabel={t('admin.events.ops.rewards.switch')} testId="admin-rewards-dialog"
        body={t(rewardsNext ? 'admin.events.ops.rewards.on' : 'admin.events.ops.rewards.off')} reasonLabel={t('admin.events.ops.reason')} reasonSwLabel={t('admin.events.ops.reasonSw')}
        onConfirm={async r => {
          if (!token) return;
          await adminS7Api.rewardsEligible(token, doc.id, { eligible: rewardsNext, reason: r.reason, ...(r.reasonSw ? { reasonSw: r.reasonSw } : {}) }, r.key);
          toast.success(t('admin.events.ops.rewards.done')); setDialog(null); onChanged();
        }} />
    </Card>
  );
}
