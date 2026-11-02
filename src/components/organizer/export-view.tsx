'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.6): the participants export. A fixed column list,
// never any contact data (D36); the file is fetched with the bearer and saved from a Blob.
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, type EventDocument } from '@/lib/api';
import { clockTime, errorKey, fmt, isFeatureOff, isForbidden } from '@/lib/events';
import { EXPORT_COLUMNS, exportFilename, isRateLimited, retryAfterSeconds, saveBlob } from '@/lib/events-ops';
import { Alert, Badge, Button, Card, CardContent, SkeletonCard, useToast } from '@/components/shared';
import { EventsUnavailable, OrganizerForbidden } from '@/components/organizer/page-states';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../../app/providers';

export function ExportView({ doc, readOnly }: { doc: EventDocument; readOnly: boolean }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<'ok' | 'off' | 'forbidden'>('ok');
  useEffect(() => {
    if (!token) return;
    api.organizerEventRegistrationsSummary(token, doc.id).then(s => setConfirmed(s.byStatus.confirmed)).catch(() => setConfirmed(null)); // partial: the row count hides
  }, [token, doc.id]);

  async function download() {
    if (!token) return;
    setBusy(true); setMessage(null);
    try {
      const blob = await api.exportEventRegistrations(token, doc.id);
      saveBlob(blob, exportFilename(doc.slug));
      toast.success(t('events.export.started'));
    } catch (err) {
      if (isFeatureOff(err)) setState('off');
      else if (isForbidden(err)) setState('forbidden');
      else if (isRateLimited(err)) {
        const secs = retryAfterSeconds(err);
        setMessage(secs ? fmt(t('events.export.limited'), { time: clockTime(new Date(Date.now() + secs * 1000), locale) }) : t('errors.events.rate_limited'));
      } else setMessage(t(errorKey(err)) === t('common.somethingWrong') ? t('events.export.failed') : t(errorKey(err)));
    } finally { setBusy(false); }
  }

  if (options === undefined) return <div aria-busy="true"><SkeletonCard /></div>;
  if (!options?.ops?.kit || state === 'off') return <EventsUnavailable />;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  return (
    <div className="space-y-4" data-testid="export-view">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('events.export.title')}</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">{t('events.export.purpose')}</p>
          {confirmed != null && <p className="text-sm font-medium text-[var(--color-fg-primary)]" data-testid="export-rows">{fmt(t('events.export.rows'), { count: confirmed.toLocaleString() })}</p>}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.export.columns')}</h3>
            <ul className="flex flex-wrap gap-2" data-testid="export-columns">
              {EXPORT_COLUMNS.map(c => <li key={c}><Badge tone="gray"><span className="font-mono">{c}</span></Badge></li>)}
            </ul>
          </div>
          <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="export-privacy">{t('events.export.privacy')}</p>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.export.audit')}</p>
          {message && <div role="alert" data-testid="export-message"><Alert tone="warning">{message}</Alert></div>}
          <Button loading={busy} disabled={readOnly} onClick={() => void download()} data-testid="export-download"><Download aria-hidden="true" className="h-4 w-4" />{t('events.export.download')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
