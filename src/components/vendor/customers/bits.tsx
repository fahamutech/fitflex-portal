'use client';
// Small pieces shared by the vendor customers screens (S4). Every label is an i18n key.
import { type ReactNode, useEffect, useState } from 'react';
import type { AgingBucket, VendorAging, VendorSaleRow } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import type { MessageKey } from '@/lib/i18n';
import { AGING_BUCKETS, agingKey, errorBody, errorCode, fmt } from '@/lib/vendor';
import { Badge, Card } from '@/components/shared';
import { useApp } from '../../../../app/providers';

/** "Shop customer" (walk-in, the vendor's own record) or "App customer" (FitFlex buyer). */
export function SourceBadge({ source }: { source: 'manual' | 'marketplace' }) {
  const { t } = useApp();
  return <Badge tone="gray">{t(source === 'manual' ? 'vendor.customers.badge.shop' : 'vendor.customers.badge.app')}</Badge>;
}

/**
 * A figure tile that never cuts anything off: the label wraps; money stays on one line ("TSh 1,234") and the
 * grid gives each tile room for it (S3 UAT D3).
 */
export function MoneyTile({ label, value, testId, muted = false, sub }: { label: string; value: ReactNode; testId?: string; muted?: boolean; sub?: ReactNode }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-sm font-medium text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums ${muted ? 'text-[var(--color-fg-quaternary)]' : 'text-[var(--color-fg-primary)]'}`} data-testid={testId}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]">{sub}</p>}
    </Card>
  );
}
export const TILE_GRID = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]';

/** The five aging buckets as tiles; zero buckets are muted, never hidden, so positions stay put. */
export function AgingTiles({ aging, testId }: { aging: VendorAging; testId: string }) {
  const { t } = useApp();
  return (
    <div className={TILE_GRID} data-testid={testId}>
      {AGING_BUCKETS.map(b => (
        <MoneyTile key={b} label={t(agingKey(b))} value={money(aging[b])} muted={!aging[b]} testId={`${testId}-${b}`} />
      ))}
    </div>
  );
}

/** "Overdue" in words as well as colour. */
export function OverdueBadge({ days }: { days?: number }) {
  const { t } = useApp();
  return <Badge tone="warning">{days && days > 0 ? fmt(t('vendor.customers.daysOverdue'), { n: days }) : t('vendor.customers.overdueBadge')}</Badge>;
}

/** navigator.onLine, kept up to date. Recording or voiding a payment and saving a customer are online only. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

/** 429 rate_limited → "wait n seconds" text, else null. */
export function rateLimitText(err: unknown, t: (k: MessageKey) => string) {
  if (errorCode(err) !== 'rate_limited') return null;
  const n = Number(errorBody<{ retryAfterSeconds?: number }>(err)?.retryAfterSeconds) || 60;
  return fmt(t('vendor.customers.rateLimited'), { n });
}

export const isBucket = (b: string): b is AgingBucket => (AGING_BUCKETS as readonly string[]).includes(b);
export const linkCls = 'inline-flex min-h-11 items-center font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline';

/** Pay later / owes / paid off / voided badges of a sale row. */
export function CreditBadges({ sale }: { sale: Pick<VendorSaleRow, 'status' | 'kind' | 'balanceTzs'> }) {
  const { t } = useApp();
  if (sale.kind !== 'credit') return null;
  return (
    <>
      <Badge tone="info">{t('vendor.sales.payLaterBadge')}</Badge>
      {sale.status === 'completed' && (Number(sale.balanceTzs) > 0
        ? <Badge tone="warning"><span className="whitespace-nowrap">{fmt(t('vendor.sales.owesBadge'), { amount: money(sale.balanceTzs) })}</span></Badge>
        : <Badge tone="success">{t('vendor.sales.paidOffBadge')}</Badge>)}
    </>
  );
}

