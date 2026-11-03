'use client';
// Events S7 offline kit desk (spec §3.5, §3.14, §3.15): scanning from the saved list. Every result says "from saved list"; success says "Saved, not final";
// there is no override and no "accept unverified" button (D69). The server decides everything at sync.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Info, Search, WifiOff, XCircle } from 'lucide-react';
import { fmt } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { clockOf } from '@/lib/events-s7';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, Input, Select } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { QrScanner, type QrScannerState } from '@/components/qr-scanner';
import { checkBib, bibCount, type BibCheck, type DeskRow, type ScanDecision } from './desk-logic';
import type { KitDeskApi } from './use-kit-desk';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useApp } from '../../../../app/providers';

type Tone = 'success' | 'warning' | 'error' | 'info';
const TONE: Record<Tone, { box: string; text: string; icon: string }> = {
  success: { box: 'border-[var(--color-success-300)] bg-[var(--color-success-50)]', text: 'text-[var(--color-success-800)]', icon: 'text-[var(--color-success-600)]' },
  warning: { box: 'border-[var(--color-warning-300)] bg-[var(--color-warning-50)]', text: 'text-[var(--color-warning-800)]', icon: 'text-[var(--color-warning-600)]' },
  error: { box: 'border-[var(--color-error-300)] bg-[var(--color-error-50)]', text: 'text-[var(--color-error-800)]', icon: 'text-[var(--color-error-600)]' },
  info: { box: 'border-[var(--color-info-300)] bg-[var(--color-info-50)]', text: 'text-[var(--color-info-800)]', icon: 'text-[var(--color-info-700)]' },
};
const REASONS = ['phone_lost', 'no_signal', 'screen_damaged', 'other'] as const;
type Shown = ScanDecision | { kind: 'blocked'; why: 'clock' | 'list' | 'desk' };

/** The big masked card: name 28 px, bib 48 px (outdoor light), category, kit size, code. Never contact data. */
function Card_({ row, tone, categoryName }: { row: DeskRow; tone: Tone; categoryName: string | null }) {
  const { t } = useApp();
  return (
    <div className={`space-y-1 ${TONE[tone].text}`} data-testid="offline-card">
      <p className="text-[28px] font-semibold leading-tight [overflow-wrap:anywhere]" data-testid="offline-card-name">{row.name}</p>
      {row.bibNumber
        ? <p className="text-5xl font-bold leading-none tracking-tight [overflow-wrap:anywhere]" data-testid="offline-card-bib" aria-label={fmt(t('events.kit.bib'), { number: row.bibNumber })}>{row.bibNumber}</p>
        : <Badge tone="warning" dot>{t('events.kit.noBib')}</Badge>}
      <p className="text-sm">{categoryName ?? ''}{row.kitSize ? ` · ${fmt(t('events.kit.size'), { size: row.kitSize })}` : ''}</p>
      <p className="text-sm font-mono [overflow-wrap:anywhere]">{row.ticketCode}</p>
    </div>
  );
}

/** The bib field (§3.15). Shown only when the person has no bib yet and the desk has a block. */
function BibField({ desk, row, value, onChange, check }: { desk: KitDeskApi; row: DeskRow; value: string; onChange: (v: string) => void; check: BibCheck | null }) {
  const { t, locale } = useApp();
  const range = desk.meta?.bibRange ?? null;
  if (row.bibNumber) return <p className="text-sm" data-testid="bib-assigned">{fmt(t('organizer.kitOffline.bib.assigned'), { bib: row.bibNumber })}</p>;
  if (!range) return <p className="text-sm" data-testid="bib-no-block">{t('organizer.kitOffline.bib.noBlock')}</p>;
  const first = `${range.prefix}${range.padTo ? String(range.start).padStart(range.padTo, '0') : range.start}`;
  const last = `${range.prefix}${range.padTo ? String(range.end).padStart(range.padTo, '0') : range.end}`;
  void bibCount;
  const msg = !check || check.ok || !value.trim() ? null
    : check.code === 'invalid' ? fmt(t('organizer.kitOffline.bib.invalid'), {})
    : check.code === 'outOfRange' ? fmt(t('organizer.kitOffline.bib.outOfRange'), { bib: check.bib, from: first, to: last })
    : check.code === 'usedHere' ? fmt(t('organizer.kitOffline.bib.usedHere'), { bib: check.bib, time: clockOf(check.at, locale) })
    : check.code === 'otherPerson' ? fmt(t('organizer.kitOffline.bib.otherPerson'), { bib: check.bib })
    : t('organizer.kitOffline.bib.noBlock');
  return (
    <Field label={t('organizer.kitOffline.bib.field')} hint={fmt(t('organizer.kitOffline.bib.hint'), { from: first, to: last })} error={msg ?? undefined}>
      <Input value={value} onChange={e => onChange(e.target.value.toUpperCase())} className="font-mono text-lg" autoComplete="off" maxLength={12} data-testid="offline-bib" />
    </Field>
  );
}

export function ScanPanel({ desk, timezone, readOnly }: { desk: KitDeskApi; timezone: string; readOnly: boolean }) {
  const { t, locale } = useApp();
  const meta = desk.meta!;
  const points = meta.points ?? [];
  const [scanning, setScanning] = useState(false);
  const [camera, setCamera] = useState<QrScannerState>('idle');
  const [shown, setShown] = useState<Shown | null>(null);
  const [saved, setSaved] = useState<{ name: string; bib: string | null } | null>(null);
  const [manual, setManual] = useState('');
  const [bib, setBib] = useState('');
  const [search, setSearch] = useState('');
  const [manualFor, setManualFor] = useState<DeskRow | null>(null);
  const [mReason, setMReason] = useState('');
  const [mId, setMId] = useState(false);
  const [mBib, setMBib] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusAfterRender = useFocusAfterRender();
  const textRef = useRef('');

  const pointId = meta.pointId;
  const missingPoint = points.length > 0 && !pointId;
  const blocked = readOnly || desk.deskEnded || desk.listExpired || !desk.clock.ok || missingPoint;
  const byReg = useMemo(() => new Map(desk.scans.filter(s => s.state !== 'rejected').map(s => [s.registrationId, s])), [desk.scans]);
  const categoryOf = (r: DeskRow) => r.categoryName ?? meta.categories.find(c => c.id === r.categoryId)?.name ?? null;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function reset(focus = true) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setShown(null); setSaved(null); setBib(''); textRef.current = '';
    if (focus) focusAfterRender(() => manualRef.current);
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && shown && !manualFor) reset(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, manualFor]);

  async function check(text: string, fromCamera: boolean) {
    const v = text.trim();
    if (!v || busyRef.current || saved || (shown && shown.kind === 'valid')) return;
    busyRef.current = true;
    try {
      const out = await desk.decide(v, fromCamera);
      textRef.current = v; setBib(''); setShown(out);
      focusAfterRender(() => (out.kind === 'valid' ? confirmRef.current : headingRef.current));
    } finally { busyRef.current = false; }
  }
  const onCameraState = (s: QrScannerState) => {
    setCamera(prev => (s === 'idle' && (prev === 'denied' || prev === 'unsupported' || prev === 'insecure' || prev === 'no_camera' || prev === 'error') ? prev : s));
    if (s === 'idle' || (s !== 'requesting' && s !== 'active')) setScanning(false);
  };
  const cameraMsg: MessageKey | null = camera === 'denied' ? 'events.kit.camera.denied' : camera === 'unsupported' ? 'events.kit.camera.unsupported' : camera === 'insecure' ? 'events.kit.camera.insecure'
    : camera === 'no_camera' ? 'events.kit.camera.none' : camera === 'error' ? 'events.kit.camera.error' : null;

  const row = shown && shown.kind === 'valid' ? shown.row : null;
  const bibCheck: BibCheck | null = row && !row.bibNumber && meta.bibRange && bib.trim() ? checkBib(bib, meta.bibRange, row.registrationId, byReg, desk.rows) : null;
  const bibHardStop = !!bibCheck && !bibCheck.ok && bibCheck.code !== 'outOfRange';
  const bibOut = !!bibCheck && !bibCheck.ok && bibCheck.code === 'outOfRange';

  async function handOver(flag = false) {
    if (!row || shown?.kind !== 'valid') return;
    setBusy(true);
    try {
      const claim = bibCheck?.ok ? bibCheck.bib : flag && bibCheck ? bibCheck.bib : undefined;
      await desk.handOver({ row, method: 'scan', payload: shown.tokenText, pointId: pointId || undefined, ...(claim ? { bib: claim, flagBib: flag } : {}) });
      setShown(null); setSaved({ name: row.name, bib: claim && bibCheck?.ok ? claim : null });
      timer.current = setTimeout(() => reset(), 2000);
    } finally { setBusy(false); }
  }

  // Manual handover from the saved list (D67).
  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return null;
    return desk.rows.filter(r => r.name.toLowerCase().includes(q) || (r.bibNumber ?? '').toLowerCase() === q || r.ticketCode.toLowerCase().includes(q)).slice(0, 20);
  }, [desk.rows, search]);
  const mCheck: BibCheck | null = manualFor && !manualFor.bibNumber && meta.bibRange && mBib.trim() ? checkBib(mBib, meta.bibRange, manualFor.registrationId, byReg, desk.rows) : null;
  const mHard = !!mCheck && !mCheck.ok && mCheck.code !== 'outOfRange';
  async function manualHandOver() {
    if (!manualFor) return;
    setBusy(true);
    try {
      const claim = mCheck ? mCheck.bib : undefined;
      await desk.handOver({ row: manualFor, method: 'manual', manualReason: mReason, pointId: pointId || undefined, ...(claim ? { bib: claim, flagBib: !mCheck?.ok } : {}) });
      setSaved({ name: manualFor.name, bib: mCheck?.ok ? mCheck.bib : null }); setManualFor(null); setSearch('');
      timer.current = setTimeout(() => reset(), 2000);
    } finally { setBusy(false); }
  }
  function openManual(r: DeskRow) { setMReason(''); setMId(false); setMBib(''); setManualFor(r); }

  const view: { tone: Tone; Icon: typeof Info; title: string; body?: string } | null = !shown ? null
    : shown.kind === 'blocked' ? { tone: 'error', Icon: XCircle, title: t(shown.why === 'list' ? 'organizer.kitOffline.list.expired' : shown.why === 'clock' ? 'organizer.kitOffline.clock.title' : 'organizer.kitOffline.removed.banner') }
    : shown.kind === 'gym' ? { tone: 'info', Icon: Info, title: t('events.kit.result.gymPass') }
    : shown.kind === 'unrecognised' ? { tone: 'error', Icon: XCircle, title: t('events.kit.result.unknown'), body: t('events.kit.result.unknown.body') }
    : shown.kind === 'unknown' ? { tone: 'error', Icon: XCircle, title: t('organizer.kitOffline.result.unknown'), body: t('organizer.kitOffline.result.unknownBody') }
    : shown.kind === 'revoked' ? { tone: 'error', Icon: XCircle, title: fmt(t('organizer.kitOffline.result.revoked'), { time: clockOf(meta.clock?.serverTimeMs, locale) }), body: shown.row.revokeReason ? t(`events.kit.result.revoked.${shown.row.revokeReason}` as MessageKey) : undefined }
    : shown.kind === 'already_list' ? { tone: 'warning', Icon: AlertTriangle, title: fmt(t('organizer.kitOffline.result.already'), { time: clockOf(shown.row.collectedAt, locale) }), body: t('organizer.kitOffline.result.noOverride') }
    : shown.kind === 'already_local' ? { tone: 'warning', Icon: AlertTriangle, title: fmt(t('organizer.kitOffline.result.alreadyHere'), { time: clockOf(shown.scan.createdAt, locale) }), body: t('organizer.kitOffline.result.noOverride') }
    : { tone: 'success', Icon: CheckCircle2, title: t('organizer.kitOffline.result.valid') };
  const tone = view ? TONE[view.tone] : null;
  void timezone;

  return (
    <div className="grid gap-4 lg:grid-cols-12" data-testid="offline-scan-panel">
      <div className="space-y-4 lg:col-span-5">
        {points.length > 0 && (
          <Field label={t('events.kit.point.label')} hint={missingPoint ? t('events.kit.point.required') : undefined} required>
            <Select value={pointId} onChange={e => desk.setPoint(e.target.value)} data-testid="offline-point">
              <option value="">—</option>
              {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('events.kit.camera.preview')}</h2>
            {scanning
              ? <Button variant="secondary" size="sm" onClick={() => setScanning(false)} data-testid="offline-camera-stop"><CameraOff aria-hidden="true" className="h-4 w-4" />{t('events.kit.camera.stop')}</Button>
              : <Button size="sm" onClick={() => { setCamera('idle'); setScanning(true); }} disabled={blocked} data-testid="offline-camera-start"><Camera aria-hidden="true" className="h-4 w-4" />{t('events.kit.camera.start')}</Button>}
          </CardHeader>
          <CardContent className="space-y-3">
            <QrScanner active={scanning && !blocked} onDecode={text => void check(text, true)} onState={onCameraState} previewLabel={t('events.kit.camera.preview')} offLabel={t('events.kit.camera.off')} className="max-h-[40vh]" />
            <p role="status" className="min-h-5 text-sm text-[var(--color-fg-secondary)]">{cameraMsg ? t(cameraMsg) : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4">
            <form onSubmit={e => { e.preventDefault(); const v = manual; setManual(''); void check(v, false); }} className="space-y-2">
              <Field label={t('events.kit.manual.label')}>
                <div className="flex gap-2">
                  <Input ref={manualRef} value={manual} onChange={e => setManual(e.target.value)} className="font-mono" autoComplete="off" disabled={blocked} data-testid="offline-manual" />
                  <Button type="submit" disabled={!manual.trim() || blocked} data-testid="offline-manual-submit">{t('events.kit.manual.submit')}</Button>
                </div>
              </Field>
            </form>
            <Field label={t('organizer.kitOffline.manual.search')} hint={t('events.kit.search.hint')}>
              <div className="flex gap-2">
                <Input type="search" value={search} onChange={e => setSearch(e.target.value)} disabled={desk.deskEnded || desk.listExpired || readOnly} data-testid="offline-search" />
                <span className="inline-flex min-h-11 items-center text-[var(--color-fg-quaternary)]"><Search aria-hidden="true" className="h-4 w-4" /></span>
              </div>
            </Field>
            {hits && (hits.length === 0
              ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="offline-search-none">{t('events.kit.search.none')}</p>
              : (
                <ul className="divide-y divide-[var(--color-border-secondary)] rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)]" data-testid="offline-hits">
                  {hits.map(h => {
                    const local = byReg.get(h.registrationId);
                    const free = h.ticketActive && !h.collected && !local;
                    return (
                      <li key={h.registrationId} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="offline-hit">
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{h.name}{h.bibNumber ? ` · ${h.bibNumber}` : ''}</p>
                          <p className="text-[var(--color-fg-quaternary)]"><span className="font-mono">{h.ticketCode}</span> · {!h.ticketActive ? t('events.kit.result.revoked') : h.collected || local ? t('events.kit.state.collected') : t('events.kit.state.ready')}</p>
                        </div>
                        {free && <Button size="sm" variant="secondary" disabled={blocked} onClick={() => openManual(h)} data-testid="offline-hit-handover">{t('organizer.kitOffline.manual.title')}</Button>}
                      </li>
                    );
                  })}
                </ul>
              ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-7">
        {saved && (
          <div role="status" aria-live="assertive" data-testid="offline-saved" className={`rounded-[var(--radius-xl)] border-2 p-5 ${TONE.success.box}`}>
            <div className="flex items-center gap-3"><CheckCircle2 aria-hidden="true" className={`h-8 w-8 ${TONE.success.icon}`} /><p className={`text-2xl font-semibold ${TONE.success.text}`}>{t('organizer.kitOffline.result.saved')}</p></div>
            <p className={`mt-2 ${TONE.success.text}`}>{fmt(t('organizer.kitOffline.result.savedBody'), { name: saved.name })}</p>
            {saved.bib && <p className={`mt-1 ${TONE.success.text}`} data-testid="offline-saved-bib">{fmt(t('organizer.kitOffline.bib.savedNote'), { bib: saved.bib })}</p>}
            <div className="mt-3"><Button variant="secondary" onClick={() => reset()} data-testid="offline-next">{t('events.kit.next')}</Button></div>
          </div>
        )}
        {shown && view && tone && (
          <div className={`rounded-[var(--radius-xl)] border-2 p-5 ${tone.box}`} data-testid="offline-result" data-result={shown.kind}>
            <div className="flex items-start gap-4">
              <view.Icon aria-hidden="true" className={`mt-1 h-8 w-8 shrink-0 ${tone.icon}`} />
              <div className="min-w-0 flex-1 space-y-3">
                <h2 ref={headingRef} tabIndex={-1} className={`text-2xl font-semibold outline-none ${tone.text}`} data-testid="offline-result-heading">
                  <span role="status" aria-live="assertive">{view.title}</span>
                </h2>
                {view.body && <p className={tone.text}>{view.body}</p>}
                {(shown.kind === 'valid' || shown.kind === 'already_list' || shown.kind === 'already_local') && <Card_ row={shown.row} tone={view.tone} categoryName={categoryOf(shown.row)} />}
                {shown.kind === 'valid' && (
                  <div className="space-y-3">
                    <p className={`text-sm ${tone.text}`}>{fmt(t('organizer.kitOffline.list.from'), { time: clockOf(meta.snapshotTakenAt, locale) })}</p>
                    <BibField desk={desk} row={shown.row} value={bib} onChange={setBib} check={bibCheck} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {shown.kind === 'valid' && !bibOut && (
                    <Button ref={confirmRef} size="lg" className="min-h-14 w-full sm:w-auto" loading={busy} disabled={blocked || bibHardStop} onClick={() => void handOver(false)} data-testid="offline-confirm">{t('organizer.kitOffline.result.handOver')}</Button>
                  )}
                  {shown.kind === 'valid' && bibOut && (
                    <Button ref={confirmRef} size="lg" variant="secondary" className="min-h-14 w-full sm:w-auto" loading={busy} disabled={blocked} onClick={() => void handOver(true)} data-testid="offline-confirm-flag">{t('organizer.kitOffline.bib.outOfRange.flag')}</Button>
                  )}
                  <Button variant="ghost" className="min-h-11" onClick={() => reset()} disabled={busy} data-testid="offline-cancel">{t('events.kit.cancel')}</Button>
                </div>
              </div>
            </div>
          </div>
        )}
        {!shown && !saved && (
          <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-secondary)] p-5 text-sm text-[var(--color-fg-quaternary)]" data-testid="offline-idle">
            <p className="flex items-start gap-2"><WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t('organizer.kitOffline.banner.offline')}</p>
          </div>
        )}
      </div>

      <Dialog open={!!manualFor} onClose={() => { if (!busy) setManualFor(null); }} title={t('organizer.kitOffline.manual.title')} description={manualFor?.name} size="md">
        <div className="space-y-3" data-testid="offline-manual-dialog">
          <Field label={t('events.kit.manual.reason.label')} required>
            <Select value={mReason} onChange={e => setMReason(e.target.value)} data-testid="offline-manual-reason">
              <option value="">—</option>
              {REASONS.map(r => <option key={r} value={r}>{t(`organizer.kitOffline.manual.reason.${r}` as MessageKey)}</option>)}
            </Select>
          </Field>
          <Checkbox label={t('organizer.kitOffline.manual.idCheck')} checked={mId} onChange={e => setMId(e.target.checked)} data-testid="offline-manual-id" />
          {manualFor && <BibField desk={desk} row={manualFor} value={mBib} onChange={setMBib} check={mCheck} />}
          {manualFor && !manualFor.bibNumber && mCheck && !mCheck.ok && mCheck.code === 'outOfRange' && <Alert tone="warning">{t('organizer.kitOffline.bib.outOfRange.flag')}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setManualFor(null)} disabled={busy}>{t('events.kit.cancel')}</Button>
          <Button loading={busy} disabled={!mReason || !mId || mHard || blocked} onClick={() => void manualHandOver()} data-testid="offline-manual-confirm">{t('organizer.kitOffline.result.handOver')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
