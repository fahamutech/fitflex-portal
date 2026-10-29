'use client';
// Events S6 (spec §7.7 Portal UX, D54): upload or replace a medal's own design. Steps: choose a PNG, JPEG or WebP (at least 512 x 512,
// up to 2 MB), crop to a square with a circular preview (keyboard operable, numeric fallback), optional alt text in both languages,
// the faces/brands notice, the required rights confirmation, then Upload. The server checks everything again from the bytes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorCode } from '@/lib/events';
import { newIdempotencyKey } from '@/lib/events-ops';
import { MEDAL_ART_CONFIRMATION_VERSION, resultsApi } from '@/lib/events-results-api';
import { ART_MAX_BYTES, ART_MIN_SIDE, ART_OUTPUT_SIDE, ART_TYPES, artErrorKey, retryAfterOf, type MedalTemplate } from '@/lib/events-results';
import { fmt } from '@/lib/events';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Checkbox, Field, Input, useToast } from '@/components/shared';
import { Dialog, DialogFooter } from '@/components/dialog';
import { useApp } from '../../../../app/providers';

const VIEW = 240;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Encode the cropped square: WebP when the browser can, else PNG; smaller output sides until the file fits 2 MB. */
async function encodeCrop(img: HTMLImageElement, crop: { sx: number; sy: number; side: number }): Promise<Blob | null> {
  for (const out of [ART_OUTPUT_SIDE, 768, ART_MIN_SIDE]) {
    const side = Math.min(out, Math.floor(crop.side));
    if (side < ART_MIN_SIDE) return null;
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, side, side);
    for (const type of ['image/webp', 'image/png']) {
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, type, 0.92));
      if (blob && blob.type === type && blob.size <= ART_MAX_BYTES) return blob;
    }
  }
  return null;
}

export function MedalArtDialog({ open, onClose, eventId, template, medalName, onDone }: {
  open: boolean; onClose: () => void; eventId: string; template: MedalTemplate | null; medalName: string; onDone: () => void;
}) {
  const { t, token } = useApp();
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<{ key: MessageKey; wait?: number | null } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const [altEn, setAltEn] = useState('');
  const [altSw, setAltSw] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const prepared = useRef<{ sig: string; blob: Blob; key: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setSrc(null); setError(null); setZoom(1); setPx(0); setPy(0); setAltEn(''); setAltSw(''); setRights(false); setBusy(false); prepared.current = null;
  }, [open]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => abort.current?.abort(), []);

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  async function pick(file: File | undefined) {
    setError(null); setDims(null); setSrc(null); prepared.current = null;
    if (!file) return;
    // Friendly pre-checks only: the server decides from the bytes (an SVG renamed .png is caught there).
    if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name)) { setError({ key: 'organizer.results.art.error.svg_not_allowed' }); return; }
    if (!ART_TYPES.includes(file.type)) { setError({ key: 'organizer.results.art.error.unsupported_file_type' }); return; }
    if (file.size > ART_MAX_BYTES) { setError({ key: 'organizer.results.art.error.payload_too_large' }); return; }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      if (Math.min(probe.naturalWidth, probe.naturalHeight) < ART_MIN_SIDE) { URL.revokeObjectURL(url); setError({ key: 'organizer.results.art.error.image_too_small' }); return; }
      setDims({ w: probe.naturalWidth, h: probe.naturalHeight }); setSrc(url); setZoom(1); setPx(0); setPy(0);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); setError({ key: 'organizer.results.art.error.corrupt_image' }); };
    probe.src = url;
  }

  // Crop geometry (display px inside the VIEW square; offsets are percentages of the free travel on each axis).
  const geo = useMemo(() => {
    if (!dims) return null;
    const scale = (VIEW / Math.min(dims.w, dims.h)) * zoom;
    const dw = dims.w * scale; const dh = dims.h * scale;
    const maxX = Math.max(0, (dw - VIEW) / 2); const maxY = Math.max(0, (dh - VIEW) / 2);
    const ox = (px / 100) * maxX; const oy = (py / 100) * maxY;
    const side = VIEW / scale;
    const sx = clamp((dw / 2 - VIEW / 2 - ox) / scale, 0, dims.w - side);
    const sy = clamp((dh / 2 - VIEW / 2 - oy) / scale, 0, dims.h - side);
    return { dw, dh, ox, oy, sx, sy, side };
  }, [dims, zoom, px, py]);

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft') setPx(v => clamp(v + step, -100, 100));
    else if (e.key === 'ArrowRight') setPx(v => clamp(v - step, -100, 100));
    else if (e.key === 'ArrowUp') setPy(v => clamp(v + step, -100, 100));
    else if (e.key === 'ArrowDown') setPy(v => clamp(v - step, -100, 100));
    else if (e.key === '+' || e.key === '=') setZoom(v => clamp(Math.round((v + 0.1) * 10) / 10, 1, 3));
    else if (e.key === '-') setZoom(v => clamp(Math.round((v - 0.1) * 10) / 10, 1, 3));
    else return;
    e.preventDefault();
  };

  async function upload() {
    if (!token || !template || !geo || !imgRef.current) return;
    setBusy(true); setError(null);
    try {
      const sig = [zoom, px, py, src].join('|');
      if (prepared.current?.sig !== sig) {
        const blob = await encodeCrop(imgRef.current, { sx: geo.sx, sy: geo.sy, side: geo.side });
        if (!blob) { setError({ key: 'organizer.results.art.error.payload_too_large' }); return; }
        prepared.current = { sig, blob, key: newIdempotencyKey() };
      }
      abort.current = new AbortController();
      await resultsApi.uploadArt(token, eventId, template.id, prepared.current.blob, { key: prepared.current.key, confirmationVersion: MEDAL_ART_CONFIRMATION_VERSION, signal: abort.current.signal });
      if (altEn.trim() || altSw.trim()) {
        try { await resultsApi.setArtAlt(token, eventId, template.id, { ...(altEn.trim() ? { en: altEn.trim() } : {}), ...(altSw.trim() ? { sw: altSw.trim() } : {}) }, newIdempotencyKey()); }
        catch { toast.error(t('organizer.results.art.altFailed')); }
      }
      toast.success(t('organizer.results.art.liveNow'));
      onDone();
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const code = errorCode(err);
      setError({ key: code === 'confirmation_outdated' ? 'organizer.results.art.error.confirmation_outdated' : artErrorKey(err), wait: code === 'rate_limited' ? retryAfterOf(err) : null });
    } finally { setBusy(false); }
  }

  const alt = (t('organizer.results.art.previewAlt') as string).replace('{name}', medalName);
  const ready = !!src && !!geo && rights && !busy;
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('organizer.results.art.upload')} description={medalName} size="lg">
      <div className="space-y-4" data-testid="art-dialog">
        {error && <div data-testid="art-error"><Alert tone="error">{error.wait ? fmt(t('organizer.results.error.rate_limited_wait'), { seconds: error.wait }) : t(error.key)}</Alert></div>}
        <p className="text-sm text-[var(--color-fg-secondary)]">{t('organizer.results.art.help')}</p>
        <Field label={t('organizer.results.art.file')}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void pick(e.target.files?.[0])} className="block w-full text-sm" data-testid="art-file" />
        </Field>
        {src && geo && dims && (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="art-crop">
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.results.art.crop')}</p>
              <div tabIndex={0} role="group" aria-label={t('organizer.results.art.cropLabel')} onKeyDown={onKey}
                className="relative overflow-hidden rounded-full bg-[var(--color-bg-tertiary)] outline-none ring-2 ring-[var(--color-border-secondary)] focus-visible:ring-[var(--color-brand-600)]" style={{ width: VIEW, height: VIEW }} data-testid="art-viewport">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgRef} src={src} alt={alt} draggable={false} className="absolute max-w-none select-none"
                  style={{ width: geo.dw, height: geo.dh, left: VIEW / 2 - geo.dw / 2 + geo.ox, top: VIEW / 2 - geo.dh / 2 + geo.oy }} />
              </div>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{t('organizer.results.art.circleNote')}</p>
            </div>
            <div className="space-y-3">
              <Field label={t('organizer.results.art.zoom')}><Input type="number" min={1} max={3} step={0.1} value={zoom} onChange={e => setZoom(clamp(Number(e.target.value) || 1, 1, 3))} data-testid="art-zoom" /></Field>
              <Field label={t('organizer.results.art.posX')}><Input type="number" min={-100} max={100} step={5} value={px} onChange={e => setPx(clamp(Number(e.target.value) || 0, -100, 100))} data-testid="art-x" /></Field>
              <Field label={t('organizer.results.art.posY')}><Input type="number" min={-100} max={100} step={5} value={py} onChange={e => setPy(clamp(Number(e.target.value) || 0, -100, 100))} data-testid="art-y" /></Field>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{t('organizer.results.art.cropKeys')}</p>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('organizer.results.art.alt')} (EN)`} hint="≤ 120"><Input maxLength={120} value={altEn} onChange={e => setAltEn(e.target.value)} data-testid="art-alt-en" /></Field>
          <Field label={`${t('organizer.results.art.alt')} (SW)`} hint="≤ 120"><Input maxLength={120} value={altSw} onChange={e => setAltSw(e.target.value)} data-testid="art-alt-sw" /></Field>
        </div>
        <p className="text-sm text-[var(--color-fg-secondary)]" data-testid="art-notice">{t('organizer.results.art.notice')}</p>
        <Checkbox label={t('organizer.results.art.confirm')} checked={rights} onChange={e => setRights(e.target.checked)} data-testid="art-rights" />
        <p className="text-xs text-[var(--color-fg-quaternary)]">{t('organizer.results.art.confirmDraft')}</p>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!ready} onClick={() => void upload()} data-testid="art-upload">{t('organizer.results.art.upload')}</Button>
      </DialogFooter>
    </Dialog>
  );
}
