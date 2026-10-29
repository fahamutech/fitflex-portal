'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.7): "copy it now". Shows a secret exactly once.
// The secret lives only in the props of this dialog (component state of its parent), never in storage, the URL or a log.
// Esc, the backdrop and the close button do nothing until the person ticks "I have saved the secret".
import { useEffect, useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Alert, Button, Checkbox } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../app/providers';

export function SecretOnceDialog({ open, onClose, title, secretLabel, secret, clientId, docsHref }: {
  open: boolean; onClose: () => void; title?: string; secretLabel: string; secret: string; clientId?: string; docsHref?: string;
}) {
  const { t } = useApp();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'secret' | 'id' | null>(null);
  const [nudge, setNudge] = useState(false);
  const warnId = useId();
  useEffect(() => { if (open) { setSaved(false); setCopied(null); setNudge(false); } }, [open]);
  async function copy(value: string, which: 'secret' | 'id') {
    try { await navigator.clipboard.writeText(value); setCopied(which); setTimeout(() => setCopied(c => (c === which ? null : c)), 2500); } catch { /* the value is selectable */ }
  }
  const tryClose = () => { if (saved) onClose(); else setNudge(true); };
  return (
    <Dialog open={open} onClose={tryClose} title={title ?? t('integrations.secret.title')} size="md">
      <div className="space-y-4" data-testid="secret-dialog" aria-describedby={warnId}>
        <div id={warnId}><Alert tone="warning">{t('integrations.secret.warn')}</Alert></div>
        {clientId && (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('integrations.secret.clientId')}</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-2 text-sm" data-testid="secret-client-id">{clientId}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy(clientId, 'id')} aria-label={t('integrations.action.copyId')}>{copied === 'id' ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}</Button>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{secretLabel}</p>
          <code className="block select-all break-all rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 font-mono text-sm" data-testid="secret-value">{secret}</code>
          <div className="flex items-center gap-3 pt-1">
            <Button variant="secondary" size="sm" onClick={() => void copy(secret, 'secret')} data-testid="secret-copy">{copied === 'secret' ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}{t('integrations.secret.copy')}</Button>
            <span role="status" aria-live="polite" className="text-sm text-[var(--color-success-700)]" data-testid="secret-copied">{copied === 'secret' ? t('integrations.secret.copied') : ''}</span>
          </div>
        </div>
        {docsHref && <a href={docsHref} className="text-sm font-medium text-[var(--color-brand-700)] underline-offset-4 hover:underline">{t('integrations.secret.docs')}</a>}
        <Checkbox label={t('integrations.secret.saved')} checked={saved} onChange={e => { setSaved(e.target.checked); setNudge(false); }} data-testid="secret-saved" />
        {nudge && !saved && <p role="alert" className="text-sm text-[var(--color-error-700)]" data-testid="secret-nudge">{t('integrations.secret.mustSave')}</p>}
      </div>
      <DialogFooter>
        <Button disabled={!saved} onClick={tryClose} data-testid="secret-done">{t('integrations.action.done')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
