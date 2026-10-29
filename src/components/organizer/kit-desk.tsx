'use client';
// Events S5 (design spec docs/design/events-s5-venue-api-and-webhooks.md §8.3): the kit collection desk. Desk staff scan or
// paste a ticket, read a large result card and hand the kit over. The server decides every outcome (verify is read-only, the
// collection write re-resolves the ticket itself); this component never trusts a client-side reading of a QR.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Info, Search, WifiOff, XCircle } from 'lucide-react';
import { api, ApiError, type EventDocument, type KitCard, type KitCollectionRow, type KitLookupItem, type KitSummary, type KitVerifyResult, type KitWarning, type OrganizerRole } from '@/lib/api';
import { distanceLabel, errorBody, errorCode, errorKey, eventDateTime, fmt, isFeatureOff, isForbidden } from '@/lib/events';
import { canOverrideKit, isEventTicketPayload, isRateLimited, lookupCard, newIdempotencyKey, retryAfterSeconds } from '@/lib/events-ops';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, Field, Input, Select, SkeletonCard, useToast } from '@/components/shared';
import { QrScanner, type QrScannerState } from '@/components/qr-scanner';
import { EventsUnavailable, OrganizerForbidden, PageError } from '@/components/organizer/page-states';
import { ManualHandoverDialog, ReasonDialog } from '@/components/organizer/ops-dialogs';
import { useEventsOptions } from '@/components/events-options';
import { useApp } from '../../../app/providers';

type Tone = 'success' | 'warning' | 'error' | 'info';
const TONE: Record<Tone, { box: string; text: string; icon: string }> = {
  success: { box: 'border-[var(--color-success-300)] bg-[var(--color-success-50)]', text: 'text-[var(--color-success-800)]', icon: 'text-[var(--color-success-600)]' },
  warning: { box: 'border-[var(--color-warning-300)] bg-[var(--color-warning-50)]', text: 'text-[var(--color-warning-800)]', icon: 'text-[var(--color-warning-600)]' },
  error: { box: 'border-[var(--color-error-300)] bg-[var(--color-error-50)]', text: 'text-[var(--color-error-800)]', icon: 'text-[var(--color-error-600)]' },
  info: { box: 'border-[var(--color-info-300)] bg-[var(--color-info-50)]', text: 'text-[var(--color-info-800)]', icon: 'text-[var(--color-info-700)]' },
};
const RESULT_TONE: Record<string, { tone: Tone; Icon: typeof Info }> = {
  valid: { tone: 'success', Icon: CheckCircle2 },
  already_collected: { tone: 'warning', Icon: AlertTriangle },
  wrong_event: { tone: 'warning', Icon: AlertTriangle },
  revoked: { tone: 'error', Icon: XCircle },
  unpaid: { tone: 'error', Icon: XCircle },
  unknown: { tone: 'error', Icon: XCircle },
  gym: { tone: 'info', Icon: Info },
};

type Shown = (Omit<KitVerifyResult, 'result'> & { result: KitVerifyResult['result'] | 'gym' });
type Phase = 'idle' | 'verifying' | 'result' | 'saving' | 'recorded';
const pointKey = (eventId: string) => `fitflex.kit.point.${eventId}`;
const OPEN_STATUSES = new Set(['published', 'registration_closed', 'in_progress']);

/** The masked card block: name, bib, category, kit size, ticket code. Never contact data. */
export function KitCardBody({ card, tone }: { card: KitCard; tone: Tone }) {
  const { t } = useApp();
  const c = TONE[tone];
  return (
    <div className={`space-y-1 ${c.text}`} data-testid="kit-card">
      <p className="text-[28px] font-semibold leading-tight [overflow-wrap:anywhere]" data-testid="kit-card-name">{card.displayName}</p>
      {card.bibNumber
        ? <p className="text-5xl font-bold leading-none tracking-tight [overflow-wrap:anywhere]" data-testid="kit-card-bib" aria-label={fmt(t('events.kit.bib'), { number: card.bibNumber })}>{card.bibNumber}</p>
        : <Badge tone="warning" dot>{t('events.kit.noBib')}</Badge>}
      <p className="text-sm">{card.categoryName} · {distanceLabel(card.distanceM)} · {card.ticketTypeName}</p>
      <p className="text-sm">
        {card.kitSize ? <span data-testid="kit-card-size">{fmt(t('events.kit.size'), { size: card.kitSize })}</span> : null}
        {card.kitSize ? ' · ' : null}<span className="font-mono" data-testid="kit-card-code">{card.ticketCode}</span>
      </p>
    </div>
  );
}

export function KitDesk({ doc, role, readOnly, onOpenRegistration }: {
  doc: EventDocument; role: OrganizerRole | null; /** Suspended organizer: the desk reads but never writes (AC-B17). */ readOnly: boolean; onOpenRegistration: (registrationId: string) => void;
}) {
  const { t, token, locale } = useApp();
  const toast = useToast();
  const options = useEventsOptions();
  const eventId = doc.id;
  const points = (doc.collectionPoints ?? []).filter(p => !!p.id);
  const [pointId, setPointId] = useState('');
  const [summary, setSummary] = useState<KitSummary | null>(null);
  const [recent, setRecent] = useState<KitCollectionRow[] | null>(null);
  const [state, setState] = useState<'ok' | 'off' | 'forbidden' | 'error'>('ok');
  const [scanning, setScanning] = useState(false);
  const [camera, setCamera] = useState<QrScannerState>('idle');
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState<Shown | null>(null);
  const [payload, setPayload] = useState('');
  const [manual, setManual] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<KitLookupItem[] | null>(null);
  const [online, setOnline] = useState(true);
  const [wait, setWait] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideMissing, setOverrideMissing] = useState(false);
  const [manualFor, setManualFor] = useState<{ registrationId: string; name: string } | null>(null);
  const [recorded, setRecorded] = useState('');
  const keyRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = doc.status;
  const open = OPEN_STATUSES.has(status);
  const closedForWrites = !open || readOnly || !online;
  const pointRequired = points.length > 0;
  const missingPoint = pointRequired && !pointId;

  useEffect(() => {
    try { const v = sessionStorage.getItem(pointKey(eventId)); if (v && points.some(p => p.id === v)) setPointId(v); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  const choosePoint = (v: string) => { setPointId(v); try { sessionStorage.setItem(pointKey(eventId), v); } catch { /* private mode */ } };

  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !open) return;
    api.eventKitSummary(token, eventId).then(setSummary).catch(() => setSummary(null)); // partial: the chip just hides
    try {
      setRecent((await api.eventKitCollections(token, eventId, { limit: 10 })).items ?? []);
    } catch (err) {
      if (isFeatureOff(err)) setState('off'); else if (isForbidden(err)) setState('forbidden'); else if (!recent) setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId, open]);
  useEffect(() => {
    void refresh();
    if (!token || !open) return;
    const h = setInterval(() => { void api.eventKitSummary(token, eventId).then(setSummary).catch(() => undefined); }, 60_000);
    return () => clearInterval(h);
  }, [refresh, token, eventId, open]);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait(w => Math.max(0, w - 1)), 1000);
    return () => clearTimeout(h);
  }, [wait]);

  function reset(focusManual = true) {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setPhase('idle'); setShown(null); setPayload(''); setSaveFailed(false); setOverrideMissing(false); keyRef.current = null;
    if (focusManual) setTimeout(() => manualRef.current?.focus(), 0);
  }
  // Esc cancels the current result (§8.3 keyboard).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && (phaseRef.current === 'result') && !overrideOpen && !manualFor) reset(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideOpen, manualFor]);

  function show(next: Shown) {
    setShown(next); setPhase('result'); setSaveFailed(false); setOverrideMissing(false); keyRef.current = null;
    setTimeout(() => (next.result === 'valid' && next.canCollect ? confirmRef.current : headingRef.current)?.focus(), 60);
  }

  /** Verify a payload. `fromCamera`: anything that is not an event ticket is refused locally (§4.7, AC-B5). */
  async function verify(text: string, fromCamera: boolean) {
    const value = text.trim();
    if (!value || !token || closedForWrites || missingPoint || phaseRef.current !== 'idle') return;
    const eventish = isEventTicketPayload(value) || value.startsWith('ev1.');
    if (!eventish && (fromCamera || /^usr_/i.test(value))) { setPayload(''); show({ result: 'gym', warnings: [], canCollect: false, canOverride: false }); return; }
    setPhase('verifying'); setPayload(value);
    try {
      const out = await api.verifyEventTicket(token, eventId, { payload: value, ...(pointId ? { collectionPointId: pointId } : {}) });
      show(out);
    } catch (err) {
      if (errorCode(err) === 'not_event_ticket' || errorCode(err) === 'invalid_payload') { show({ result: 'unknown', warnings: [], canCollect: false, canOverride: false }); return; }
      if (isRateLimited(err)) { setWait(retryAfterSeconds(err) ?? 30); setPhase('idle'); return; }
      if (isFeatureOff(err)) { setState('off'); return; }
      if (isForbidden(err)) { setState('forbidden'); return; }
      setPhase('idle'); toast.error(t(errorKey(err)));
    }
  }
  const onDecode = (text: string) => { if (phaseRef.current === 'idle') void verify(text, true); };
  const onCameraState = (s: QrScannerState) => {
    // The scanner reports 'idle' right after it stops itself on a failure: keep the failure's message on screen.
    setCamera(prev => (s === 'idle' && (prev === 'denied' || prev === 'unsupported' || prev === 'insecure' || prev === 'no_camera' || prev === 'error') ? prev : s));
    if (s === 'idle') setScanning(false);
    else if (s !== 'requesting' && s !== 'active') setScanning(false);
  };

  function afterRecorded(name: string) {
    setRecorded(fmt(t('events.kit.recorded'), { name }));
    setPhase('recorded'); setShown(null); keyRef.current = null;
    void refresh();
    clearTimer.current = setTimeout(() => reset(), 2000);
  }

  async function confirm() {
    if (!token || !shown || shown.result !== 'valid' || !shown.canCollect) return;
    if (!keyRef.current) keyRef.current = newIdempotencyKey(); // reused when this attempt is retried
    setPhase('saving'); setSaveFailed(false);
    try {
      const out = await api.collectEventKit(token, eventId, { method: 'scan', payload, ...(pointId ? { collectionPointId: pointId } : {}) }, keyRef.current);
      afterRecorded(out.card?.displayName ?? shown.card?.displayName ?? '');
    } catch (err) {
      const body = errorBody<{ collectionId?: string; collectedAt?: string; collectionPointName?: string | null; byFirstName?: string | null; canOverride?: boolean; reason?: KitVerifyResult['revokedReason'] }>(err);
      const code = errorCode(err);
      if (code === 'already_collected') { show({ ...shown, result: 'already_collected', collectionId: body?.collectionId ?? shown.collectionId, collectedAt: body?.collectedAt, collectionPointName: body?.collectionPointName, byFirstName: body?.byFirstName, canCollect: false, canOverride: !!body?.canOverride && canOverrideKit(role) }); return; }
      if (code === 'ticket_revoked') { show({ ...shown, result: 'revoked', revokedReason: body?.reason, canCollect: false, canOverride: false }); return; }
      if (code === 'registration_unpaid') { show({ ...shown, result: 'unpaid', canCollect: false, canOverride: false }); return; }
      if (isRateLimited(err)) { setWait(retryAfterSeconds(err) ?? 30); setPhase('result'); return; }
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && code !== 'request_in_progress') { setPhase('result'); keyRef.current = null; toast.error(t(errorKey(err))); return; }
      setPhase('result'); setSaveFailed(true); // network / 5xx: keep the card, retry with the same key
    }
  }

  async function collectManual(body: Parameters<typeof api.collectEventKit>[2], key: string) {
    if (!token) return;
    return api.collectEventKit(token, eventId, body, key);
  }

  /** The override needs the earlier collection's id, which the verify answer does not carry: read it from the history. */
  async function findCollection(registrationId: string): Promise<KitCollectionRow | null> {
    if (!token) return null;
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: { items: KitCollectionRow[]; nextCursor: string | null } = await api.eventKitCollections(token, eventId, { status: 'collected', cursor, limit: 100 });
      const hit = (page.items ?? []).find(r => r.registrationId === registrationId && r.status === 'collected');
      if (hit) return hit;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return null;
  }
  async function startOverride() {
    if (!shown?.registrationId) return;
    try {
      // The backend names the handover to correct (collectionId); the history paging is only the fallback while it does not.
      if (shown.collectionId) { overrideRow.current = { id: shown.collectionId, registrationId: shown.registrationId, displayName: shown.card?.displayName ?? '' } as KitCollectionRow; setOverrideOpen(true); return; }
      const row = await findCollection(shown.registrationId);
      if (!row) { setOverrideMissing(true); return; }
      overrideRow.current = row; setOverrideOpen(true);
    } catch (err) { toast.error(t(errorKey(err))); }
  }
  const overrideRow = useRef<KitCollectionRow | null>(null);

  async function doSearch() {
    if (!token || search.trim().length < 3) return;
    try { setHits((await api.eventKitLookup(token, eventId, search.trim())).items ?? []); }
    catch (err) { if (isRateLimited(err)) setWait(retryAfterSeconds(err) ?? 30); else toast.error(t(errorKey(err))); }
  }

  if (options === undefined) return <div aria-busy="true"><SkeletonCard /></div>;
  if (!options?.ops?.kit || state === 'off') return <EventsUnavailable />;
  if (state === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  if (state === 'error') return <PageError onRetry={() => { setState('ok'); void refresh(); }} />;
  if (!open && status !== 'completed' && status !== 'cancelled') return <div data-testid="kit-not-open"><EmptyState title={t('events.kit.notOpen')} /></div>;

  const cameraMsg: MessageKey | null = camera === 'denied' ? 'events.kit.camera.denied' : camera === 'unsupported' ? 'events.kit.camera.unsupported' : camera === 'insecure' ? 'events.kit.camera.insecure' : camera === 'no_camera' ? 'events.kit.camera.none' : camera === 'error' ? 'events.kit.camera.error' : null;
  const scannerDisabled = closedForWrites || missingPoint;
  const view = shown ? RESULT_TONE[shown.result] : null;
  const tone = view ? TONE[view.tone] : null;
  const card = shown?.card;
  const warnings: KitWarning[] = shown?.warnings ?? [];
  const canManual = !closedForWrites;

  return (
    <div className="space-y-4" data-testid="kit-desk">
      {/* Banners */}
      {status === 'completed' && <div data-testid="kit-completed"><Alert tone="info">{t('events.kit.completed')}</Alert></div>}
      {status === 'cancelled' && <div data-testid="kit-cancelled"><Alert tone="error">{t('events.kit.cancelled')}</Alert></div>}
      {readOnly && <div data-testid="kit-suspended"><Alert tone="warning">{t('events.kit.suspended')}</Alert></div>}
      {!online && (
        <div data-testid="kit-offline" role="status" className="sticky top-0 z-10">
          <Alert tone="warning"><span className="flex items-start gap-2"><WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t('events.kit.offline')}</span></Alert>
        </div>
      )}
      {wait > 0 && <div data-testid="kit-rate-limited" role="status"><Alert tone="warning">{fmt(t('events.kit.rateLimited'), { seconds: wait })}</Alert></div>}

      {/* Top bar */}
      <div className="flex flex-wrap items-end gap-3" data-testid="kit-topbar">
        {points.length > 0
          ? (
            <div className="min-w-[220px] flex-1 sm:flex-none">
              <Field label={t('events.kit.point.label')} hint={missingPoint ? <span data-testid="kit-point-hint">{t('events.kit.point.required')}</span> : undefined} required>
                <Select value={pointId} onChange={e => choosePoint(e.target.value)} data-testid="kit-point">
                  <option value="">—</option>
                  {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            </div>
          )
          : <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="kit-no-points">{t('events.kit.noPoints')}</p>}
        {summary && (
          <span className="inline-flex min-h-11 items-center rounded-full bg-[var(--color-bg-tertiary)] px-4 text-sm font-medium text-[var(--color-fg-primary)]" data-testid="kit-progress">
            {fmt(t('events.kit.progress'), { done: summary.collected.toLocaleString(), total: summary.confirmed.toLocaleString() })}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Camera, manual box, search */}
        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.kit.camera.preview')}</h2>
              {scanning
                ? <Button variant="secondary" size="sm" onClick={() => setScanning(false)} data-testid="kit-camera-stop"><CameraOff aria-hidden="true" className="h-4 w-4" />{t('events.kit.camera.stop')}</Button>
                : <Button size="sm" onClick={() => { setCamera('idle'); setScanning(true); }} disabled={scannerDisabled} data-testid="kit-camera-start"><Camera aria-hidden="true" className="h-4 w-4" />{t('events.kit.camera.start')}</Button>}
            </CardHeader>
            <CardContent className="space-y-3">
              <QrScanner active={scanning && !scannerDisabled} onDecode={onDecode} onState={onCameraState} previewLabel={t('events.kit.camera.preview')} offLabel={t('events.kit.camera.off')} className="max-h-[40vh]" />
              <p role="status" className="min-h-5 text-sm text-[var(--color-fg-secondary)]" data-testid="kit-camera-status">{cameraMsg ? t(cameraMsg) : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4">
              <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); void verify(v, false); }} className="space-y-2">
                <Field label={t('events.kit.manual.label')}>
                  <div className="flex gap-2">
                    <Input ref={manualRef} value={manual} onChange={e => setManual(e.target.value)} className="font-mono" autoComplete="off" disabled={closedForWrites} data-testid="kit-manual" />
                    <Button type="submit" disabled={!manual.trim() || scannerDisabled || phase !== 'idle'} data-testid="kit-manual-submit">{t('events.kit.manual.submit')}</Button>
                  </div>
                </Field>
              </form>
              <form onSubmit={e => { e.preventDefault(); void doSearch(); }} className="space-y-2">
                <Field label={t('events.kit.search.label')} hint={t('events.kit.search.hint')}>
                  <div className="flex gap-2">
                    <Input type="search" value={search} onChange={e => { setSearch(e.target.value); setHits(null); }} disabled={closedForWrites} data-testid="kit-search" />
                    <Button type="submit" variant="secondary" disabled={search.trim().length < 3 || closedForWrites} data-testid="kit-search-submit"><Search aria-hidden="true" className="h-4 w-4" />{t('events.kit.search.go')}</Button>
                  </div>
                </Field>
              </form>
              {hits && (hits.length === 0
                ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="kit-search-none">{t('events.kit.search.none')}</p>
                : (
                  <ul className="divide-y divide-[var(--color-border-secondary)] rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)]" data-testid="kit-hits">
                    {hits.map((h, i) => {
                      const { registrationId, card: c } = lookupCard(h);
                      if (!c) return null;
                      return (
                        <li key={registrationId ?? i} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="kit-hit">
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-[var(--color-fg-primary)]">{c.displayName}{c.bibNumber ? ` · ${c.bibNumber}` : ''}</p>
                            <p className="text-[var(--color-fg-quaternary)]">{c.categoryName} · <span className="font-mono">{c.ticketCode}</span> · {t(`events.kit.state.${c.kit?.state ?? 'not_ready'}` as MessageKey)}</p>
                          </div>
                          {registrationId && c.payment !== 'unpaid' && c.kit?.state !== 'collected' && (
                            <Button size="sm" variant="secondary" disabled={!canManual || missingPoint} onClick={() => setManualFor({ registrationId, name: c.displayName })} data-testid="kit-hit-handover">{t('events.kit.manual.pick')}</Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </CardContent>
          </Card>
        </div>

        {/* Result card */}
        <div className="space-y-4 lg:col-span-7">
          {phase === 'verifying' && (
            <div aria-busy="true" data-testid="kit-verifying" role="status" className="rounded-[var(--radius-xl)] border-2 border-[var(--color-border-secondary)] p-5"><span className="sr-only">{t('events.kit.checking')}</span><SkeletonCard /></div>
          )}
          {phase === 'recorded' && (
            <div role="status" aria-live="polite" data-testid="kit-recorded" className={`rounded-[var(--radius-xl)] border-2 p-5 ${TONE.success.box}`}>
              <div className="flex items-center gap-3"><CheckCircle2 aria-hidden="true" className={`h-8 w-8 ${TONE.success.icon}`} /><p className={`text-2xl font-semibold ${TONE.success.text}`}>{recorded}</p></div>
              <div className="mt-3"><Button variant="secondary" onClick={() => reset()} data-testid="kit-next">{t('events.kit.next')}</Button></div>
            </div>
          )}
          {(phase === 'result' || phase === 'saving') && shown && view && tone && (
            <div className={`rounded-[var(--radius-xl)] border-2 p-5 ${tone.box}`} data-testid="kit-result" data-result={shown.result}>
              <div className="flex items-start gap-4">
                <view.Icon aria-hidden="true" className={`mt-1 h-8 w-8 shrink-0 ${tone.icon}`} />
                <div className="min-w-0 flex-1 space-y-3">
                  <h2 ref={headingRef} tabIndex={-1} className={`text-2xl font-semibold outline-none ${tone.text}`} data-testid="kit-result-heading">
                    <span role="status" aria-live="assertive">{t(shown.result === 'gym' ? 'events.kit.result.gymPass' : (`events.kit.result.${shown.result}` as MessageKey))}</span>
                  </h2>
                  {shown.result === 'wrong_event' && <p className={tone.text}>{fmt(t('events.kit.result.wrong_event.body'), { title: shown.otherEvent?.title ?? '' })}</p>}
                  {shown.result === 'revoked' && shown.revokedReason && <p className={tone.text} data-testid="kit-revoked-reason">{t(`events.kit.result.revoked.${shown.revokedReason}` as MessageKey)}</p>}
                  {shown.result === 'unknown' && <p className={tone.text}>{t('events.kit.result.unknown.body')}</p>}
                  {shown.result === 'already_collected' && (
                    <p className={tone.text} data-testid="kit-already-body">
                      {fmt(t('events.kit.already.body'), { time: shown.collectedAt ? eventDateTime(shown.collectedAt, doc.timezone, locale, doc.timezoneAbbr) : '—', point: shown.collectionPointName ?? '—', name: shown.byFirstName ?? '—' })}
                    </p>
                  )}
                  {card && (shown.result === 'valid' || shown.result === 'already_collected') && <KitCardBody card={card} tone={view.tone} />}
                  {warnings.length > 0 && (
                    <ul className="flex flex-wrap gap-2" data-testid="kit-warnings">
                      {warnings.map(w => <li key={w}><Badge tone="warning" dot>{t(`events.kit.warn.${w}` as MessageKey)}</Badge></li>)}
                    </ul>
                  )}
                  {saveFailed && (
                    <div data-testid="kit-save-failed"><Alert tone="error"><span className="flex flex-wrap items-center gap-3">{t('events.kit.saveFailed')}<Button size="sm" variant="secondary" onClick={() => void confirm()} data-testid="kit-retry">{t('events.kit.retry')}</Button></span></Alert></div>
                  )}
                  {overrideMissing && <div data-testid="kit-override-missing"><Alert tone="warning">{t('events.kit.overrideMissing')}</Alert></div>}
                  <div className="flex flex-wrap items-center gap-3">
                    {shown.result === 'valid' && shown.canCollect && (
                      <Button ref={confirmRef} size="lg" className="min-h-14 w-full sm:w-auto" loading={phase === 'saving'} disabled={closedForWrites || missingPoint || wait > 0} onClick={() => void confirm()} data-testid="kit-confirm">{t('events.kit.confirm')}</Button>
                    )}
                    {shown.result === 'already_collected' && (shown.canOverride && canOverrideKit(role)
                      ? <Button className="min-h-11" variant="secondary" disabled={closedForWrites} onClick={() => void startOverride()} data-testid="kit-override">{t('events.kit.override.button')}</Button>
                      : <p className={`text-sm font-medium ${tone.text}`} data-testid="kit-override-ask">{t('events.kit.override.ask')}</p>)}
                    {shown.registrationId && shown.result !== 'unknown' && shown.result !== 'gym' && (
                      <Button variant="ghost" size="sm" onClick={() => onOpenRegistration(shown.registrationId!)} data-testid="kit-open-registration">{t('events.kit.open')}</Button>
                    )}
                    <Button variant="ghost" onClick={() => reset()} disabled={phase === 'saving'} data-testid="kit-cancel">{t('events.kit.cancel')}</Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Card>
            <CardHeader><h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.kit.history')}</h2></CardHeader>
            <CardContent>
              {!recent ? <SkeletonCard lines={2} /> : recent.length === 0 ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="kit-history-empty">{t('events.kit.history.empty')}</p> : (
                <ul className="divide-y divide-[var(--color-border-secondary)]" aria-label={t('events.kit.history.label')} data-testid="kit-history">
                  {recent.map(r => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium text-[var(--color-fg-primary)]">{r.displayName}{r.bibNumber ? ` · ${r.bibNumber}` : ''}</span>
                      <span className="flex items-center gap-2 text-[var(--color-fg-quaternary)]">
                        <Badge tone={r.status === 'collected' ? 'success' : r.status === 'corrected' ? 'gray' : 'warning'}>{t(`events.kit.history.status.${r.status}` as MessageKey)}</Badge>
                        {eventDateTime(r.collectedAt, doc.timezone, locale, doc.timezoneAbbr)}
                        <Button variant="ghost" size="sm" onClick={() => onOpenRegistration(r.registrationId)}>{t('events.reg.open')}</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ReasonDialog open={overrideOpen} onClose={() => setOverrideOpen(false)} testId="kit-override-dialog" title={t('events.kit.override.title')} body={t('events.kit.override.body')}
        label={t('events.kit.reason.label')} confirmLabel={t('events.kit.override.button')}
        onConfirm={async (reason, key) => {
          const row = overrideRow.current; if (!token || !row) return;
          await api.correctEventKit(token, eventId, row.id, { action: 'recollect', reason }, key);
          setOverrideOpen(false); afterRecorded(shown?.card?.displayName ?? row.displayName);
        }} />
      <ManualHandoverDialog open={!!manualFor} onClose={() => setManualFor(null)} name={manualFor?.name ?? ''} registrationId={manualFor?.registrationId ?? ''} collectionPointId={pointId || undefined} points={points}
        collect={collectManual} onDone={() => { const n = manualFor?.name ?? ''; setManualFor(null); setHits(null); setSearch(''); afterRecorded(n); }} />
    </div>
  );
}

