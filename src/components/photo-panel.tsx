'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { api, heroAssetUrl } from '@/lib/api';

// A photo with a short, non-interactive text block (design spec
// photo-hero-screens §3.2, §5, §9, §12). Below 1024px it is a band across the
// top; from 1024px it is the left 55% column. The photo is clear; only the
// text block has a slate scrim (§5 decision 2026-10-20, lighter heroes). That
// scrim is drawn from inside the text block, so it always covers the text.
// The scrim and sizes live in globals.css (.photo-panel, --hero-* tokens).
//
// The photo is decorative (alt="", role="presentation"); the text is a
// <section aria-labelledby> whose headline is a <p>, so the page keeps a single
// <h1>. Nothing inside is focusable. Photos are bundled under /public. With
// `remoteSlot` (NEXT_PUBLIC_HERO_IMAGES_REMOTE) the panel may also read an
// admin-published photo at runtime; see useRemoteHeroPhoto below.

export type PhotoPanelSources = {
  /** 3:4 crop for the desktop panel (>= 1024px). */
  panel: { avif: string; webp: string; jpeg: string; width: number; height: number };
  /** 16:5 crop for the tablet / phone band (< 1024px). */
  band: { avif: string; webp: string; jpeg: string; width: number; height: number };
};

type PhotoPanelProps = {
  photo?: PhotoPanelSources;
  eyebrow?: string;
  headlineLead?: string;
  headlineAccent?: string;
  /** Shown from 640px up; phones get eyebrow and headline only. */
  subline?: string;
  className?: string;
  /**
   * Slot of GET /app/hero-images to read at runtime (plan slice 5). The bundled photo always paints
   * first; the remote one replaces it only if it has loaded within REMOTE_WINDOW_MS.
   */
  remoteSlot?: string;
  /**
   * App photos admin preview (spec §36.5): draw this photo instead of `photo`, so the preview is the
   * login's own panel (same classes, same scrim) with the photo being edited. Never set on the login.
   */
  previewImage?: { src?: string; objectPosition: string };
  'data-testid'?: string;
};

// Under reduced data or high contrast the first <source> matches and serves an
// inline 1×1 transparent GIF, so the photo is never requested (§9, AC-C4).
const NO_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const NO_PHOTO_MEDIA = '(prefers-reduced-data: reduce), (prefers-contrast: more)';
const WIDE = '(min-width: 1024px)';

/** How long a remote photo may take before this visit keeps the bundled one (no late swap). */
export const REMOTE_WINDOW_MS = 1500;

type RemotePhoto = { src: string; objectPosition: string };

/** -1..1 (Flutter Alignment) → CSS object-position. */
export const focalToObjectPosition = (focal: { x: number; y: number } | null | undefined) => {
  const pct = (v: unknown) => {
    const n = Number(v);
    return Math.round(((Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0) + 1) * 50 * 10) / 10;
  };
  return `${pct(focal?.x)}% ${pct(focal?.y)}%`;
};

/**
 * Reads `slot` from the public photo list and preloads its first photo. Returns it only if it has
 * fully loaded and decoded within REMOTE_WINDOW_MS of the page opening; otherwise the visit keeps the
 * bundled photo (the download still finishes, so the browser cache has it for the next visit).
 * Nothing is requested under reduced data, Save-Data or high contrast, or when the slot is empty.
 */
function useRemoteHeroPhoto(slot: string | undefined): RemotePhoto | null {
  const [remote, setRemote] = useState<RemotePhoto | null>(null);
  useEffect(() => {
    if (!slot || typeof window === 'undefined') return;
    if (window.matchMedia?.(NO_PHOTO_MEDIA).matches) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let cancelled = false;
    let expired = false;
    // Unmounting cancels the manifest request (the photo download itself is left to the browser cache).
    const controller = new AbortController();
    const timer = window.setTimeout(() => { expired = true; }, REMOTE_WINDOW_MS);
    (async () => {
      try {
        const manifest = await api.appHeroImages(controller.signal);
        const entry = manifest?.slots?.[slot]?.[0];
        const src = heroAssetUrl(entry?.urlWide) ?? heroAssetUrl(entry?.url);
        if (!entry || !src || cancelled) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        await img.decode();
        if (cancelled || expired || !img.naturalWidth) return;
        setRemote({ src, objectPosition: focalToObjectPosition(entry.focal) });
      } catch {
        // Any failure keeps the bundled photo.
      }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [slot]);
  return remote;
}

export const LOGIN_HERO_PHOTO: PhotoPanelSources = {
  panel: {
    avif: '/photos/hero/login-panel.avif',
    webp: '/photos/hero/login-panel.webp',
    jpeg: '/photos/hero/login-panel.jpg',
    width: 750,
    height: 1000,
  },
  band: {
    avif: '/photos/hero/login-band.avif',
    webp: '/photos/hero/login-band.webp',
    jpeg: '/photos/hero/login-band.jpg',
    width: 1440,
    height: 450,
  },
};

export function PhotoPanel({
  photo,
  eyebrow,
  headlineLead,
  headlineAccent,
  subline,
  className,
  remoteSlot,
  previewImage,
  'data-testid': testId = 'photo-panel',
}: PhotoPanelProps) {
  const remote = useRemoteHeroPhoto(remoteSlot);
  const [remoteShown, setRemoteShown] = useState(false);
  // Fade the remote photo in over the bundled one on the next frame (instant with reduced motion, via CSS).
  useEffect(() => {
    if (!remote) return;
    const id = window.requestAnimationFrame(() => setRemoteShown(true));
    return () => window.cancelAnimationFrame(id);
  }, [remote]);
  const headlineId = useId();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const hasText = Boolean(headlineLead || headlineAccent);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  const picture = previewImage ? (
    previewImage.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={previewImage.src}
        ref={imgRef}
        src={previewImage.src}
        alt=""
        role="presentation"
        decoding="async"
        className="photo-panel__img"
        style={{ objectPosition: previewImage.objectPosition }}
        data-loaded={loaded ? 'true' : 'false'}
        onLoad={() => setLoaded(true)}
        data-testid={`${testId}-img`}
      />
    ) : null
  ) : photo ? (
    <picture>
      <source media={NO_PHOTO_MEDIA} srcSet={NO_PHOTO} />
      <source media={WIDE} type="image/avif" srcSet={photo.panel.avif} width={photo.panel.width} height={photo.panel.height} />
      <source media={WIDE} type="image/webp" srcSet={photo.panel.webp} width={photo.panel.width} height={photo.panel.height} />
      <source media={WIDE} type="image/jpeg" srcSet={photo.panel.jpeg} width={photo.panel.width} height={photo.panel.height} />
      <source type="image/avif" srcSet={photo.band.avif} />
      <source type="image/webp" srcSet={photo.band.webp} />
      <img
        ref={imgRef}
        src={photo.band.jpeg}
        width={photo.band.width}
        height={photo.band.height}
        alt=""
        role="presentation"
        decoding="async"
        fetchPriority="high"
        className="photo-panel__img"
        data-loaded={loaded ? 'true' : 'false'}
        onLoad={() => setLoaded(true)}
        data-testid={`${testId}-img`}
      />
    </picture>
  ) : null;

  // Already decoded, so it never paints half-loaded; it sits over the bundled photo.
  const remotePicture = photo && remote ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={remote.src}
      alt=""
      role="presentation"
      decoding="async"
      className="photo-panel__img"
      style={{ objectPosition: remote.objectPosition }}
      data-loaded={remoteShown ? 'true' : 'false'}
      data-testid={`${testId}-remote-img`}
    />
  ) : null;

  // Without text (session restoring): the navy ground only, same size, so
  // nothing jumps when the page becomes ready (AC-C7).
  if (!hasText) {
    return (
      <div className={cn('photo-panel', className)} aria-hidden="true" data-testid={testId}>
        {picture}
        {remotePicture}
      </div>
    );
  }

  return (
    <section className={cn('photo-panel', className)} aria-labelledby={headlineId} data-testid={testId}>
      {picture}
      {remotePicture}
      <div className="photo-panel__content" data-testid={`${testId}-content`}>
        <div className="photo-panel__text-scrim" aria-hidden="true" data-testid={`${testId}-text-scrim`} />
        {eyebrow && <p className="photo-panel__eyebrow">{eyebrow}</p>}
        <p id={headlineId} className="photo-panel__headline">
          {headlineLead}
          {headlineLead && headlineAccent ? ' ' : null}
          {headlineAccent && <span className="photo-panel__accent">{headlineAccent}</span>}
        </p>
        {subline && <p className="photo-panel__sub">{subline}</p>}
      </div>
    </section>
  );
}
