'use client';
// Events S5 §8.7: the overlap choice shared by "Rotate" on an API client and "Rotate secret" on a webhook endpoint.
import { useEffect, useState } from 'react';
import { errorKey } from '@/lib/events';
import { GRACE_HOURS } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Radio } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../../app/providers';

export function RotateDialog({ name, onClose, rotate }: { name: string | null; onClose: () => void; /** Calls the API and hands the new secret on; throws on a refusal. */ rotate: (graceHours: 0 | 24 | 72) => Promise<void> }) {
  const { t } = useApp();
  const [grace, setGrace] = useState<0 | 24 | 72>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => { if (name !== null) { setGrace(24); setError(null); setBusy(false); } }, [name]);
  async function go() {
    setBusy(true); setError(null);
    try { await rotate(grace); }
    catch (err) { setError(errorKey(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={name !== null} onClose={() => { if (!busy) onClose(); }} title={t('integrations.rotate.title')} description={name ?? ''} size="md">
      <div className="space-y-3" data-testid="rotate-dialog">
        {error && <Alert tone="error">{t(error)}</Alert>}
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('integrations.rotate.body')}</p>
        <fieldset className="space-y-1">
          {GRACE_HOURS.map(h => <div key={h} className="min-h-11"><Radio name="grace" label={t(`integrations.rotate.grace.${h}` as MessageKey)} checked={grace === h} onChange={() => setGrace(h)} data-testid={`rotate-grace-${h}`} /></div>)}
        </fieldset>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('integrations.action.cancel')}</Button>
        <Button loading={busy} onClick={() => void go()} data-testid="rotate-confirm">{t('integrations.rotate.confirm')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
