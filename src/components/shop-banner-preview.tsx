'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { messages, type Locale } from '@/lib/i18n';
import { fmt } from '@/lib/vendor';
import { fetchBannerPhoto, publicPhoto, type Bilingual, type ShopBanner } from '@/lib/shop-banners';
import { Segmented } from './shared';
import { ScaledFrame } from './hero-image-manager';
import { useApp } from '../../app/providers';

/**
 * The address to draw a banner's photo from: its public copy once approved, else the private
 * cleaned photo fetched with the session token (drafts and pending banners have no public address).
 */
export function useBannerPhoto(banner: Pick<ShopBanner, 'image'> | null | undefined, width: 240 | 480 | 960, wide = false): string | null {
  const { token } = useApp();
  const pub = publicPhoto(banner?.image, wide);
  const preview = banner?.image?.previewUrl ?? null;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    setBlobUrl(null);
    if (pub || !preview || !token) return;
    const ctrl = new AbortController();
    let url: string | null = null;
    fetchBannerPhoto(token, preview, width, ctrl.signal)
      .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url); })
      .catch(() => setBlobUrl(null));
    return () => { ctrl.abort(); if (url) URL.revokeObjectURL(url); };
  }, [pub, preview, token, width]);
  return pub ?? blobUrl;
}

export type BannerLook = {
  imageUrl?: string | null;
  wideImageUrl?: string | null;
  headlineLead: Bilingual | null;
  headlineAccent: Bilingual | null;
  subline: Bilingual | null;
  ctaLabel: Bilingual | null;
  /** "From {vendor}" chip; null for FitFlex (staff) banners, which have none (spec §5.1). */
  vendorName: string | null;
};

const SIZE = { desktop: { w: 960, h: 320 } } as const;

/** One slide as the app draws it, in the chosen language and theme. Text never falls back to the other language here: a gap shows as a gap. */
export function BannerSlide({ look, lang, theme, layout }: { look: BannerLook; lang: Locale; theme: 'light' | 'dark'; layout: 'phone' | 'desktop' }) {
  const src = layout === 'desktop' ? look.wideImageUrl || look.imageUrl : look.imageUrl || look.wideImageUrl;
  const lead = look.headlineLead?.[lang] ?? '';
  const accent = look.headlineAccent?.[lang] ?? '';
  const sub = look.subline?.[lang] ?? '';
  const cta = look.ctaLabel?.[lang] ?? '';
  return (
    <div className={cn('banner-frame', theme === 'dark' && 'banner-frame--dark')} data-testid={`banner-preview-${layout}`} data-theme={theme} data-lang={lang}>
      <Frame layout={layout}>
        <div className={cn('banner-slide', `banner-slide--${layout}`)} lang={lang}>
          {/* Decorative: the headline carries the meaning (spec §5.1, §11.2). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt="" role="presentation" className="banner-slide__img" />}
          <div className="banner-slide__scrim" aria-hidden="true" />
          {look.vendorName && <span className="banner-slide__chip" data-testid="banner-preview-from">{fmt(messages[lang]['shop.banner.from'], { vendor: look.vendorName })}</span>}
          <div className="banner-slide__content">
            <p className="banner-slide__headline" data-testid="banner-preview-headline">
              {lead}{lead && accent ? ' ' : ''}<span className="banner-slide__accent" data-testid="banner-preview-accent">{accent}</span>
            </p>
            {sub && <p className="banner-slide__sub">{sub}</p>}
          </div>
          {cta && <span className="banner-slide__cta" aria-hidden="true">{cta}<ArrowRight className="h-4 w-4" /></span>}
        </div>
      </Frame>
    </div>
  );
}

/** The phone slide is drawn at its real width and grows with its text (P1 §6.1); the desktop crop is scaled down to fit. */
function Frame({ layout, children }: { layout: 'phone' | 'desktop'; children: React.ReactNode }) {
  if (layout === 'phone') return <FitWidth width={PHONE_W}>{children}</FitWidth>;
  return <ScaledFrame width={SIZE.desktop.w} height={SIZE.desktop.h}>{children}</ScaledFrame>;
}

const PHONE_W = 343;
/**
 * Draws the phone slide at its real width and scales it down (never up) to fit a narrower column, keeping its
 * own height (it grows with the text), so there is no hidden sideways scroll at 375 px (QA2 #5).
 */
function FitWidth({ width, children }: { width: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number | null }>({ scale: 1, height: null });
  useLayoutEffect(() => {
    const o = outer.current; const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const scale = Math.min(1, (o.clientWidth || width) / width);
      setBox({ scale, height: i.offsetHeight * scale });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={outer} className="w-full overflow-hidden" style={box.height != null ? { height: box.height } : undefined} data-testid="banner-preview-fit" data-scale={box.scale.toFixed(3)}>
      <div ref={inner} style={{ width, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}

/** Live preview with English / Kiswahili and Light / Dark toggles (spec §5.2.3 "Live preview", §5.3.2 item 1). */
export function BannerPreview({ look, layouts = ['phone'], className }: { look: BannerLook; layouts?: Array<'phone' | 'desktop'>; className?: string }) {
  const { t, locale } = useApp();
  const [lang, setLang] = useState<Locale>(locale);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    <section className={cn('space-y-3', className)} aria-label={t('merch.banner.previewA11y')} data-testid="banner-preview">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-[var(--color-fg-secondary)]">{t('merch.banner.preview')}</h3>
        <div role="group" aria-label={t('merch.preview.language')} data-testid="banner-preview-lang">
          <Segmented value={lang} onChange={v => setLang(v as Locale)} options={[['en', t('merch.field.en')], ['sw', t('merch.field.sw')]]} />
        </div>
        <div role="group" aria-label={t('merch.preview.theme')} data-testid="banner-preview-theme">
          <Segmented value={theme} onChange={v => setTheme(v as 'light' | 'dark')} options={[['light', t('merch.preview.light')], ['dark', t('merch.preview.dark')]]} />
        </div>
      </div>
      <div className="space-y-3">
        {layouts.map(l => (
          <figure key={l} className="space-y-1">
            <BannerSlide look={look} lang={lang} theme={theme} layout={l} />
            {layouts.length > 1 && <figcaption className="text-xs text-[var(--color-fg-tertiary)]">{t(l === 'phone' ? 'merchAdmin.preview.phone' : 'merchAdmin.preview.desktop')}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}
