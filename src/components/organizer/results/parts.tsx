'use client';
// Events S6 (spec §9): small pieces shared by the Results tab, the Medals panel and the admin screens.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Ban, Check, CircleDashed, Clock, Eye, Medal, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchAuthedBlob } from '@/lib/events-results-api';
import { STAGE_TONE, STATUS_TONE, defaultArtKey, isBuiltinArt, rowStatus, stageKey, statusKey, type MedalArtInfo, type MedalTier, type ResultRow, type RowStatus } from '@/lib/events-results';
import { Badge } from '@/components/shared';
import { useApp } from '../../../../app/providers';

const STATUS_ICON: Record<RowStatus, ReactNode> = {
  pending: <Clock aria-hidden="true" className="h-3.5 w-3.5" />, finished: <Check aria-hidden="true" className="h-3.5 w-3.5" />, dnf: <X aria-hidden="true" className="h-3.5 w-3.5" />,
  dns: <CircleDashed aria-hidden="true" className="h-3.5 w-3.5" />, dq: <Ban aria-hidden="true" className="h-3.5 w-3.5" />, rejected: <X aria-hidden="true" className="h-3.5 w-3.5" />, noResult: <CircleDashed aria-hidden="true" className="h-3.5 w-3.5" />,
};

/** Status = text + icon + tone, never colour alone (§9.5). */
export function StatusBadge({ row }: { row: Pick<ResultRow, 'resultId' | 'finishStatus' | 'verificationStatus'> }) {
  const { t } = useApp();
  const s = rowStatus(row);
  return <Badge tone={STATUS_TONE[s]}><span className="inline-flex items-center gap-1">{STATUS_ICON[s]}{t(statusKey(s))}</span></Badge>;
}
export function StageBadge({ stage }: { stage: string | null | undefined }) {
  const { t } = useApp();
  const s = stage ?? 'none';
  return <Badge tone={STAGE_TONE[s] ?? 'gray'}><span className="inline-flex items-center gap-1">{s === 'disputed' ? <Eye aria-hidden="true" className="h-3.5 w-3.5" /> : s === 'disqualified' ? <Ban aria-hidden="true" className="h-3.5 w-3.5" /> : s === 'official' ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Clock aria-hidden="true" className="h-3.5 w-3.5" />}{t(stageKey(s))}</span></Badge>;
}
export function FlagChip({ label }: { label: string }) {
  return <Badge tone="warning"><span className="inline-flex items-center gap-1"><AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />{label}</span></Badge>;
}

/** An authenticated image as an object URL (the bearer cannot ride an <img src>). Failure leaves `failed` so the built-in design shows (AC-G9). */
export function useAuthedImage(path: string | null | undefined, enabled = true): { url: string | null; failed: boolean } {
  const { token } = useApp();
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!path || !token || !enabled) return;
    const ctl = new AbortController();
    let made: string | null = null;
    fetchAuthedBlob(token, path, ctl.signal)
      .then(b => { made = URL.createObjectURL(b); setState({ path, url: made, failed: false }); })
      .catch(() => { if (!ctl.signal.aborted) setState({ path, url: null, failed: true }); });
    return () => { ctl.abort(); if (made) URL.revokeObjectURL(made); };
  }, [path, token, enabled]);
  if (!path || !enabled) return { url: null, failed: false };
  return state?.path === path ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}

const ART_FILL: Record<string, { ring: string; core: string }> = {
  finisher_green: { ring: 'fill-[var(--color-brand-700)]', core: 'fill-[var(--color-brand-400)]' },
  finisher_gold: { ring: 'fill-[var(--color-warning-700)]', core: 'fill-[var(--color-warning-300)]' },
  podium_gold: { ring: 'fill-[var(--color-warning-600)]', core: 'fill-[var(--color-warning-300)]' },
  podium_silver: { ring: 'fill-[var(--color-gray-500)]', core: 'fill-[var(--color-gray-200)]' },
  podium_bronze: { ring: 'fill-[var(--color-fuel)]', core: 'fill-[var(--color-fuel-200)]' },
  time_blue: { ring: 'fill-[var(--color-info-700)]', core: 'fill-[var(--color-info-300)]' },
  charity_red: { ring: 'fill-[var(--color-error-700)]', core: 'fill-[var(--color-error-300)]' },
  virtual_teal: { ring: 'fill-[var(--color-success-700)]', core: 'fill-[var(--color-success-300)]' },
};
/** One of the 8 FitFlex designs (§7.7), drawn with design tokens so no colour is hard-coded. */
export function BuiltinMedal({ artKey, className, label }: { artKey: string; className?: string; label?: string }) {
  const f = ART_FILL[artKey] ?? ART_FILL.finisher_gold;
  return (
    <svg viewBox="0 0 64 64" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('h-full w-full', className)} data-art={artKey}>
      <circle cx="32" cy="32" r="30" className={f.ring} />
      <circle cx="32" cy="32" r="22" className={f.core} />
      <circle cx="32" cy="32" r="22" className="fill-none stroke-[var(--color-bg-primary)]" strokeWidth="1.5" />
      <path d="M32 18l4.4 9 9.9 1.4-7.2 7 1.7 9.8L32 40.5l-8.8 4.7 1.7-9.8-7.2-7 9.9-1.4z" className="fill-[var(--color-bg-primary)]" />
    </svg>
  );
}

/**
 * A medal: the organizer's own design (live, circular, `object-cover`) or the built-in one. A failed or missing image falls back to the
 * built-in design so a medal is never blank (AC-G9). `alt` is the organizer's text for the viewer's language or the generated one (AC-G8).
 */
export function MedalArtImage({ art, tier, virtual = false, path, alt, size = 'md', customEnabled = true }: {
  art?: MedalArtInfo | null; tier?: MedalTier | string | null; virtual?: boolean; path?: string | null; alt: string; size?: 'sm' | 'md' | 'lg'; customEnabled?: boolean;
}) {
  const wantCustom = customEnabled && art?.source === 'custom' && !!art.artId && !!path;
  const img = useAuthedImage(path, wantCustom);
  const dim = size === 'lg' ? 'h-32 w-32' : size === 'sm' ? 'h-12 w-12' : 'h-20 w-20';
  const key = isBuiltinArt(art?.artKey) ? art!.artKey! : defaultArtKey(tier, virtual);
  return (
    <span className={cn('relative inline-flex shrink-0 overflow-hidden rounded-full bg-[var(--color-bg-secondary)]', dim)} data-testid="medal-art" data-art-source={wantCustom && img.url ? 'custom' : 'builtin'}>
      {wantCustom && img.url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img.url} alt={alt} className="h-full w-full object-cover" />
        : <BuiltinMedal artKey={key} label={alt} />}
    </span>
  );
}

export { Medal as MedalIcon };
