'use client';
import { useEffect } from 'react';
import { Spinner } from '@/components/shared';
import { useApp } from '../../providers';

/** Where the banners live; notification links (spec §4.3 "/vendor/merch?item=<id>") point at the old address. */
const TARGET = '/vendor/promotions/';

/** Keep only the parts the banners page reads (item, tab); anything else, or nothing, opens the list. */
function promotionsHref(search: string) {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  const item = from.get('item');
  if (item) to.set('item', item);
  const tab = from.get('tab');
  if (tab) to.set('tab', tab);
  const qs = to.toString();
  return qs ? `${TARGET}?${qs}` : TARGET;
}

/**
 * /vendor/merch → /vendor/promotions (QA1 #8). A full page replace on mount, not the client router, so it
 * never waits on the session or vendor state; a plain link stays as a fallback if the browser does not move.
 */
export default function VendorMerchRedirect() {
  const { t } = useApp();
  useEffect(() => { window.location.replace(promotionsHref(window.location.search)); }, []);
  return (
    <div className="flex flex-col items-start gap-3" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-[var(--color-fg-tertiary)]"><Spinner className="h-5 w-5" />{t('merch.redirecting')}</p>
      <a href={TARGET} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline-offset-4 hover:underline" data-testid="merch-redirect-link">{t('merch.openBanners')}</a>
    </div>
  );
}
