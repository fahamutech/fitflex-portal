'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.7): /organizer/integrations. Owner and admin only.
// API clients, webhook endpoints, the delivery log and the docs, each shown only while the server says it is on.
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plug } from 'lucide-react';
import { api, type WebhookEndpointRow } from '@/lib/api';
import { opsOf } from '@/lib/events-ops';
import { Alert, Button, EmptyState, PageHeader, Segmented, SkeletonTable } from '@/components/shared';
import { useOrganizer } from '@/components/organizer-context';
import { useEventsOptions } from '@/components/events-options';
import { OrganizerPage, useDocumentTitle } from '@/components/organizer/page-states';
import { ApiClientsTab } from '@/components/organizer/integrations/api-clients';
import { WebhooksTab } from '@/components/organizer/integrations/webhooks';
import { DeliveriesTab } from '@/components/organizer/integrations/deliveries';
import { DocsTab } from '@/components/organizer/integrations/docs';
import { useApp } from '../../providers';

type Tab = 'clients' | 'webhooks' | 'deliveries' | 'docs';

function IntegrationsInner() {
  const { t, token } = useApp();
  const org = useOrganizer();
  const options = useEventsOptions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useDocumentTitle(t('integrations.title'));
  const ops = opsOf(options);
  const readOnly = org.organizer?.status === 'suspended';
  const tabs: Tab[] = [...(ops.api ? ['clients' as const] : []), ...(ops.webhooks ? ['webhooks' as const, 'deliveries' as const] : []), 'docs'];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : tabs[0];
  const [createClient, setCreateClient] = useState(0);
  const [createEndpoint, setCreateEndpoint] = useState(0);
  const [unavailable, setUnavailable] = useState<Partial<Record<Tab, boolean>>>({});
  const [endpoints, setEndpoints] = useState<WebhookEndpointRow[]>([]);
  const offClients = useCallback(() => setUnavailable(u => ({ ...u, clients: true })), []);
  const offWebhooks = useCallback(() => setUnavailable(u => ({ ...u, webhooks: true })), []);
  const offDeliveries = useCallback(() => setUnavailable(u => ({ ...u, deliveries: true })), []);

  // The delivery log filters by endpoint host, so it needs the endpoint list.
  useEffect(() => {
    if (!token || !ops.webhooks || (tab !== 'deliveries')) return;
    api.webhookEndpoints(token).then(p => setEndpoints(p.items ?? [])).catch(() => setEndpoints([]));
  }, [token, ops.webhooks, tab]);

  const go = (next: Tab) => {
    const q = new URLSearchParams(params.toString());
    q.set('tab', next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  if (options === undefined) return <div aria-busy="true"><SkeletonTable /></div>;
  if (!ops.api && !ops.webhooks) return <div data-testid="integrations-unavailable"><EmptyState icon={<Plug />} title={t('integrations.unavailable')} /></div>;

  const labels: Record<Tab, string> = { clients: t('integrations.tab.clients'), webhooks: t('integrations.tab.webhooks'), deliveries: t('integrations.tab.deliveries'), docs: t('integrations.tab.docs') };
  return (
    <div className="space-y-4" data-testid="integrations-page">
      <PageHeader title={t('integrations.title')} description={t('integrations.subtitle')}
        actions={!readOnly && tab === 'clients' && !unavailable.clients ? <Button onClick={() => setCreateClient(n => n + 1)} data-testid="clients-new">{t('integrations.clients.new')}</Button>
          : !readOnly && tab === 'webhooks' && !unavailable.webhooks ? <Button onClick={() => setCreateEndpoint(n => n + 1)} data-testid="webhooks-new">{t('integrations.webhooks.new')}</Button> : undefined} />
      {readOnly && <div data-testid="integrations-suspended"><Alert tone="warning">{t('integrations.suspended')}</Alert></div>}
      <div className="max-w-full overflow-x-auto" data-testid="integrations-tabs"><Segmented className="w-fit" value={tab} options={tabs.map(x => [x, labels[x]] as [string, string])} onChange={v => go(v as Tab)} /></div>
      {tab === 'clients' && (unavailable.clients ? <div data-testid="clients-unavailable"><EmptyState title={t('integrations.clientsUnavailable')} /></div> : <ApiClientsTab role={org.role} readOnly={readOnly} createRequest={createClient} onUnavailable={offClients} />)}
      {tab === 'webhooks' && (unavailable.webhooks ? <div data-testid="webhooks-unavailable"><EmptyState title={t('integrations.webhooksUnavailable')} /></div> : <WebhooksTab readOnly={readOnly} createRequest={createEndpoint} onUnavailable={offWebhooks} focusId={params.get('endpoint')} />)}
      {tab === 'deliveries' && (unavailable.deliveries ? <div data-testid="deliveries-unavailable"><EmptyState title={t('integrations.webhooksUnavailable')} /></div> : <DeliveriesTab endpoints={endpoints} initialEndpoint={params.get('endpoint')} onUnavailable={offDeliveries} />)}
      {tab === 'docs' && <DocsTab />}
    </div>
  );
}

export default function OrganizerIntegrationsPage() {
  return <OrganizerPage area="integrations"><Suspense fallback={null}><IntegrationsInner /></Suspense></OrganizerPage>;
}
