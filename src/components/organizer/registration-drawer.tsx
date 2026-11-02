'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.5): the ticket detail for staff, opened with
// `&registration=<id>`. It shows the masked card only: never a phone, email, date of birth or emergency contact (D36, D37).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BibRow, type EventDocument, type KitCard, type KitCollectionRow, type OrganizerRole } from '@/lib/api';
import { errorKey, eventDateTime, fmt, isForbidden } from '@/lib/events';
import { canOverrideKit, lookupCard } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, SkeletonCard, useToast } from '@/components/shared';
import { Dialog } from '@/components/dialog';
import { BibDialog, ManualHandoverDialog, ReasonDialog } from '@/components/organizer/ops-dialogs';
import { distanceLabel } from '@/lib/events';
import { useApp } from '../../../app/providers';

export function RegistrationDrawer({ doc, registrationId, role, readOnly, onClose }: { doc: EventDocument; registrationId: string; role: OrganizerRole | null; readOnly: boolean; onClose: () => void }) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const eventId = doc.id;
  const [card, setCard] = useState<KitCard | null>(null);
  const [kitRows, setKitRows] = useState<KitCollectionRow[]>([]);
  const [bib, setBib] = useState<BibRow | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');
  const [bibOpen, setBibOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [voidFor, setVoidFor] = useState<{ row: KitCollectionRow; action: 'void' | 'recollect' } | null>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const owner = canOverrideKit(role);
  const writable = !readOnly && (role === 'owner' || role === 'admin' || role === 'ops');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // The exact registration id is the one lookup the server allows for any status (§4.4): it answers the masked card or nothing.
      const hit = (await api.eventKitLookup(token, eventId, registrationId)).items ?? [];
      const found = hit.map(lookupCard).find(h => h.card && (!h.registrationId || h.registrationId === registrationId));
      if (!found?.card) { setState('notfound'); return; }
      setCard(found.card);
      // Kit history of this person from the event history, and the bib row (its assignment id) from the bib list.
      const rows: KitCollectionRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page: { items: KitCollectionRow[]; nextCursor: string | null } = await api.eventKitCollections(token, eventId, { cursor, limit: 100 });
        rows.push(...(page.items ?? []).filter(r => r.registrationId === registrationId));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      setKitRows(rows);
      if (found.card.bibNumber) {
        const bibs = await api.eventBibs(token, eventId, { q: found.card.bibNumber, limit: 20 }).catch(() => null);
        setBib(bibs?.items.find(b => b.registrationId === registrationId) ?? null);
      } else setBib(null);
      setState('ok');
    } catch (err) { setState(isForbidden(err) || (err as { status?: number })?.status === 404 ? 'notfound' : 'error'); }
  }, [token, eventId, registrationId]);
  useEffect(() => { setState('loading'); void load(); }, [load]);

  function announce(text: string) { if (live.current) live.current.textContent = text; }
  const collected = kitRows.find(r => r.status === 'collected');
  let pointId: string | undefined;
  try { pointId = sessionStorage.getItem(`fitflex.kit.point.${eventId}`) ?? undefined; } catch { /* private mode */ }

  return (
    <Dialog open onClose={onClose} title={t('events.reg.drawer.title')} description={card ? card.displayName : undefined} size="lg">
      <div className="space-y-5" data-testid="registration-drawer">
        <p ref={live} role="status" aria-live="polite" className="sr-only" />
        {state === 'loading' && <div aria-busy="true"><SkeletonCard /></div>}
        {state === 'error' && <Alert tone="error">{t('common.somethingWrong')}</Alert>}
        {state === 'notfound' && <div data-testid="drawer-notfound"><Alert tone="warning">{t('events.reg.drawer.notFound')}</Alert></div>}
        {state === 'ok' && card && (
          <>
            <section aria-label={card.displayName} className="space-y-1" data-testid="drawer-card">
              <p className="text-xl font-semibold text-[var(--color-fg-primary)]">{card.displayName}</p>
              <p className="text-sm text-[var(--color-fg-secondary)]">{card.categoryName} · {distanceLabel(card.distanceM)} · {card.ticketTypeName}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{card.ticketCode}</span>
                <Badge tone={card.payment === 'paid' ? 'success' : card.payment === 'refunded' ? 'gray' : 'warning'}>{t(`events.reg.drawer.pay.${card.payment}` as MessageKey)}</Badge>
                <Badge tone="info">{t(`events.kit.state.${card.kit?.state ?? 'not_ready'}` as MessageKey)}</Badge>
              </p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.reg.drawer.ticketNote')}</p>
            </section>

            <section className="space-y-2" aria-labelledby="drawer-bib-h">
              <h3 id="drawer-bib-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.reg.drawer.bibHistory')}</h3>
              <p className="text-sm" data-testid="drawer-bib">{card.bibNumber ? <span className="font-mono text-lg font-semibold">{card.bibNumber}</span> : t('events.reg.drawer.bibNone')}</p>
            </section>

            <section className="space-y-2" aria-labelledby="drawer-kit-h">
              <h3 id="drawer-kit-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.reg.drawer.kitHistory')}</h3>
              {kitRows.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]">{t('events.reg.drawer.kitNone')}</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)] text-sm" data-testid="drawer-kit-rows">
                  {kitRows.map(r => (
                    <li key={r.id} className="space-y-1 py-2">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.status === 'collected' ? 'success' : r.status === 'corrected' ? 'gray' : 'warning'}>{t(`events.kit.history.status.${r.status}` as MessageKey)}</Badge>
                        {eventDateTime(r.collectedAt, doc.timezone, locale, doc.timezoneAbbr)} · {r.collectionPointName ?? '—'} · {r.byFirstName ?? '—'}
                      </p>
                      {(r.correctionReason || r.manualReason) && <p className="text-[var(--color-fg-quaternary)]">{r.correctionReason ?? t(`events.kit.manual.reason.${r.manualReason}` as MessageKey)}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {writable && (
              <section className="space-y-2" aria-labelledby="drawer-actions-h">
                <h3 id="drawer-actions-h" className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.reg.drawer.actions')}</h3>
                <div className="flex flex-wrap gap-2">
                  {(!card.bibNumber || owner) && card.payment === 'paid' && <Button variant="secondary" size="sm" onClick={() => setBibOpen(true)} data-testid="drawer-bib-btn">{card.bibNumber ? t('events.bibs.change') : t('events.bibs.assign')}</Button>}
                  {owner && card.bibNumber && bib?.assignmentId && <Button variant="secondary" size="sm" onClick={() => setReleaseOpen(true)} data-testid="drawer-release">{t('events.bibs.release')}</Button>}
                  {owner && card.payment === 'paid' && !collected && <Button variant="secondary" size="sm" onClick={() => setManualOpen(true)} data-testid="drawer-manual">{t('events.kit.manual.title')}</Button>}
                  {owner && collected && <Button variant="secondary" size="sm" onClick={() => setVoidFor({ row: collected, action: 'void' })} data-testid="drawer-void">{t('events.kit.void')}</Button>}
                  {owner && collected && <Button variant="secondary" size="sm" onClick={() => setVoidFor({ row: collected, action: 'recollect' })} data-testid="drawer-recollect">{t('events.reg.drawer.recordAgain')}</Button>}
                </div>
                {!owner && collected && <p className="text-sm text-[var(--color-fg-quaternary)]">{t('events.kit.override.ask')}</p>}
              </section>
            )}
          </>
        )}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose} data-testid="drawer-close">{t('events.reg.drawer.close')}</Button></div>
      </div>

      <BibDialog open={bibOpen} onClose={() => setBibOpen(false)} name={card?.displayName ?? ''} current={card?.bibNumber ?? null}
        onSave={async (body, key) => { if (!token) return; await api.assignEventBib(token, eventId, { registrationId, ...body }, key); setBibOpen(false); toast.success(t('events.bibs.saved')); announce(t('events.bibs.saved')); await load(); }} />
      <ReasonDialog open={releaseOpen} onClose={() => setReleaseOpen(false)} testId="drawer-release-dialog" tone="danger" title={t('events.bibs.release.title')} body={card?.bibNumber ?? undefined}
        label={t('events.bibs.releaseReason')} confirmLabel={t('events.bibs.release')}
        onConfirm={async (reason, key) => { if (!token || !bib?.assignmentId) return; await api.releaseEventBib(token, eventId, bib.assignmentId, reason, key); setReleaseOpen(false); toast.success(t('events.bibs.released')); announce(t('events.bibs.released')); await load(); }} />
      <ReasonDialog open={!!voidFor} onClose={() => setVoidFor(null)} testId="drawer-void-dialog" tone={voidFor?.action === 'void' ? 'danger' : 'primary'}
        title={voidFor?.action === 'void' ? t('events.kit.void.title') : t('events.kit.override.title')} body={voidFor?.action === 'void' ? t('events.kit.void.body') : t('events.kit.override.body')}
        label={t('events.kit.reason.label')} confirmLabel={voidFor?.action === 'void' ? t('events.kit.void') : t('events.kit.override.button')}
        onConfirm={async (reason, key) => { if (!token || !voidFor) return; await api.correctEventKit(token, eventId, voidFor.row.id, { action: voidFor.action, reason }, key); setVoidFor(null); toast.success(fmt(t('events.kit.recorded'), { name: card?.displayName ?? '' })); announce(t('events.kit.void')); await load(); }} />
      <ManualHandoverDialog open={manualOpen} onClose={() => setManualOpen(false)} name={card?.displayName ?? ''} registrationId={registrationId} collectionPointId={pointId} points={doc.collectionPoints}
        collect={(body, key) => api.collectEventKit(token ?? '', eventId, body, key)} onDone={() => { setManualOpen(false); toast.success(fmt(t('events.kit.recorded'), { name: card?.displayName ?? '' })); void load(); }} />
    </Dialog>
  );
}
