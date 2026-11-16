'use client';
// "Gym QR": a printable entrance QR that holds the gym's WEB LINK (<portal>/g/?q=...), so a phone camera opens the
// public gym page. Opened from Manage gym (owner, or gym staff with `checkins`) and from the admin gyms page (`gyms`).
//
// - Shown only in builds with NEXT_PUBLIC_WEB_GYM_PROFILE=true (the flag of the /g page itself; no flag of its own).
// - Backend: GET /operator/gyms/:gymId/entrance-qr and GET /admin/gyms/:gymId/entrance-qr → { gymId, gymName, payload, webUrl? }.
//   Only `webUrl` is ever drawn. The app-only `payload` is never drawn here: a phone camera could not open it.
//   Without `webUrl` (server has no PORTAL_PUBLIC_URL) the dialog shows a notice and no QR.
// - The QR is drawn in the browser (no image service). Print uses the body-class pattern of the vendor receipts
//   (globals.css .ff-print-gym-qr): only the gym name, the QR and the hint are printed.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, QrCode } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api } from '@/lib/api';
import { WEB_GYM_PROFILE } from '@/lib/flags';
import { Alert, Button, Spinner } from './shared';
import { Dialog, DialogFooter } from './dialog';

export type GymQrScope = 'operator' | 'admin';
export type GymQrSubject = { id: string; name: string };

/** May this person open the Gym QR dialog? Mirrors the server: owner, gym staff with `checkins`, admin with `gyms`. */
export function useGymQrEntry(scope: GymQrScope): boolean {
  const { user, hasPermission } = useApp();
  if (!WEB_GYM_PROFILE || !user) return false;
  if (scope === 'admin') return user.userType === 'admin' && hasPermission('gyms');
  return user.userType === 'gym_operator' || (user.userType === 'gym_staff' && hasPermission('checkins'));
}

/** Admin gyms table: an icon button that opens the dialog. Renders nothing when the admin may not use it. */
export function GymQrRowAction({ gym, onOpen }: { gym: GymQrSubject; onOpen: (g: GymQrSubject) => void }) {
  const { t } = useApp();
  const allowed = useGymQrEntry('admin');
  if (!allowed) return null;
  return (
    <Button
      variant="ghost" size="sm" className="min-h-11 min-w-11"
      title={t('gymQr.action')} aria-label={`${t('gymQr.action')}: ${gym.name}`}
      onClick={(e) => { e.stopPropagation(); onOpen(gym); }}
      data-testid={`gym-qr-row-${gym.id}`}
    >
      <QrCode aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}

type View =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no_link'; name: string }
  | { kind: 'ready'; name: string; svg: string };

const isWebLink = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

export function GymQrDialog({ gym, scope, onClose }: { gym: GymQrSubject | null; scope: GymQrScope; onClose: () => void }) {
  const { token, t } = useApp();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const gymId = gym?.id;
  const fallbackName = gym?.name ?? '';

  useEffect(() => {
    if (!gymId || !token) return;
    let live = true;
    setView({ kind: 'loading' });
    (async () => {
      try {
        const res = await (scope === 'admin' ? api.adminGymEntranceQr(token, gymId) : api.operatorGymEntranceQr(token, gymId));
        const name = res.gymName || fallbackName;
        if (!isWebLink(res.webUrl)) { if (live) setView({ kind: 'no_link', name }); return; }
        const svg = await QRCode.toString(res.webUrl, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
        if (live) setView({ kind: 'ready', name, svg });
      } catch {
        if (live) setView({ kind: 'error' });
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, token, scope, attempt]);

  const print = useCallback(() => {
    document.body.classList.add('ff-print-gym-qr');
    const done = () => { document.body.classList.remove('ff-print-gym-qr'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }, []);

  const name = view.kind === 'ready' || view.kind === 'no_link' ? view.name : fallbackName;
  const alt = t('gymQr.alt').replace('{name}', name);

  return (
    <>
      <Dialog open={!!gym} onClose={onClose} title={t('gymQr.action')} description={name} size="sm" testId="gym-qr-dialog">
        {view.kind === 'loading' && (
          <div className="flex min-h-40 items-center justify-center" role="status" aria-label={t('common.loading')} data-testid="gym-qr-loading"><Spinner /></div>
        )}
        {view.kind === 'error' && (
          <div className="space-y-3" data-testid="gym-qr-error">
            <Alert tone="error">{t('gymQr.loadFailed')}</Alert>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt(n => n + 1)}>{t('common.tryAgain')}</Button>
          </div>
        )}
        {view.kind === 'no_link' && (
          <Alert tone="info"><span data-testid="gym-qr-no-link">{t('gymQr.noWebLink')}</span></Alert>
        )}
        {view.kind === 'ready' && (
          <div className="flex flex-col items-center gap-4" data-testid="gym-qr-ready">
            <div role="img" aria-label={alt} className="w-full max-w-[280px] rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              data-testid="gym-qr-code" dangerouslySetInnerHTML={{ __html: view.svg }} />
            <p className="text-center text-sm text-[var(--color-fg-tertiary)]" data-testid="gym-qr-hint">{t('gymQr.hint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.close')}</Button>
          {view.kind === 'ready' && (
            <Button type="button" onClick={print} data-testid="gym-qr-print"><Printer aria-hidden="true" className="h-4 w-4" />{t('vendor.documents.print')}</Button>
          )}
        </DialogFooter>
      </Dialog>
      {/* Printed only (globals.css .ff-print-gym-qr): gym name, QR, hint. */}
      {gym && view.kind === 'ready' && (
        <div className="ff-print-area hidden bg-white p-8 text-center text-black" data-testid="gym-qr-print-area">
          <p className="text-3xl font-semibold [overflow-wrap:anywhere]">{view.name}</p>
          <div role="img" aria-label={alt} className="mx-auto my-6 w-full max-w-[360px] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: view.svg }} />
          <p className="text-lg">{t('gymQr.hint')}</p>
        </div>
      )}
    </>
  );
}
