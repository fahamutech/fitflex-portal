'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

// A photo with a slate scrim and a short, non-interactive text block
// (design spec photo-hero-screens §3.2, §5, §9, §12). Below 1024px it is a
// band across the top; from 1024px it is the left 55% column. The scrim and
// sizes live in globals.css (.photo-panel, --hero-* tokens).
//
// The photo is decorative (alt="", role="presentation"); the text is a
// <section aria-labelledby> whose headline is a <p>, so the page keeps a single
// <h1>. Nothing inside is focusable. Photos are bundled under /public; there is
// no remote image request.

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
  'data-testid'?: string;
};

// Under reduced data or high contrast the first <source> matches and serves an
// inline 1×1 transparent GIF, so the photo is never requested (§9, AC-C4).
const NO_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const NO_PHOTO_MEDIA = '(prefers-reduced-data: reduce), (prefers-contrast: more)';
const WIDE = '(min-width: 1024px)';

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
  'data-testid': testId = 'photo-panel',
}: PhotoPanelProps) {
  const headlineId = useId();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const hasText = Boolean(headlineLead || headlineAccent);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  const picture = photo ? (
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

  const scrim = <div className="photo-panel__scrim" aria-hidden="true" />;

  // Without text (session restoring): the navy ground only, same size, so
  // nothing jumps when the page becomes ready (AC-C7).
  if (!hasText) {
    return (
      <div className={cn('photo-panel', className)} aria-hidden="true" data-testid={testId}>
        {picture}
        {scrim}
      </div>
    );
  }

  return (
    <section className={cn('photo-panel', className)} aria-labelledby={headlineId} data-testid={testId}>
      {picture}
      {scrim}
      <div className="photo-panel__content">
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
