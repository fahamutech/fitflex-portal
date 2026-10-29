'use client';
import { useEffect, useState } from 'react';
import { bannersApi } from '@/lib/shop-banners';
import { salesApi } from '@/lib/flash-sales';

// Whether the server has shop banners (SHOP_BANNERS) or flash sales (SHOP_FLASH_SALES) switched on. Off, every
// route of that kind answers 404 feature_disabled, so its nav item and tab stay hidden (S1-AC-01, S4-AC-01).
// Asked once per session, side and kind; anything but a successful answer counts as off (fails closed). A vendor's
// /vendor/me `tools.merch.banners` / `tools.merch.flashSales`, when the server sends it, is used instead of asking.
const asked = new Map<string, Promise<boolean>>();
type Kind = 'banners' | 'sales';

function probe(kind: Kind, side: 'admin' | 'vendor', token: string): Promise<boolean> {
  const key = `${kind}:${side}:${token}`;
  let hit = asked.get(key);
  if (!hit) {
    const call = kind === 'banners'
      ? (side === 'admin' ? bannersApi.adminProbe(token) : bannersApi.vendorProbe(token))
      : (side === 'admin' ? salesApi.adminProbe(token) : salesApi.vendorProbe(token));
    hit = (call as Promise<unknown>).then(() => true, () => false);
    asked.set(key, hit);
  }
  return hit;
}

/** Forget the answers (after a 404 feature_disabled on a banner or sale screen, or sign-out). */
export function forgetBannersAvailability() { asked.clear(); }

function useAvailable(kind: Kind, side: 'admin' | 'vendor', token: string | null | undefined, enabled: boolean, toolHint?: unknown): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || !token) { setOn(false); return; }
    if (typeof toolHint === 'boolean') { setOn(toolHint); return; }
    let live = true;
    void probe(kind, side, token).then(v => { if (live) setOn(v); });
    return () => { live = false; };
  }, [kind, side, token, enabled, toolHint]);
  return on;
}

export function useShopBannersAvailable(side: 'admin' | 'vendor', token: string | null | undefined, enabled: boolean, toolHint?: unknown): boolean {
  return useAvailable('banners', side, token, enabled, toolHint);
}
export function useShopFlashSalesAvailable(side: 'admin' | 'vendor', token: string | null | undefined, enabled: boolean, toolHint?: unknown): boolean {
  return useAvailable('sales', side, token, enabled, toolHint);
}
