'use client';
import { useEffect, useState } from 'react';
import { bannersApi } from '@/lib/shop-banners';

// Whether the server has shop banners switched on (SHOP_BANNERS). Off, every banner route answers
// 404 feature_disabled, so the nav items stay hidden (spec S1-AC-01). Asked once per session and
// side; anything but a successful answer counts as off (fails closed). A vendor's /vendor/me
// `tools.merch.banners`, when the server sends it, is used instead of asking.
const asked = new Map<string, Promise<boolean>>();

function probe(side: 'admin' | 'vendor', token: string): Promise<boolean> {
  const key = `${side}:${token}`;
  let hit = asked.get(key);
  if (!hit) {
    hit = (side === 'admin' ? bannersApi.adminProbe(token) : bannersApi.vendorProbe(token)).then(() => true, () => false);
    asked.set(key, hit);
  }
  return hit;
}

/** Forget the answer (after a 404 feature_disabled on a banner screen, or sign-out). */
export function forgetBannersAvailability() { asked.clear(); }

export function useShopBannersAvailable(side: 'admin' | 'vendor', token: string | null | undefined, enabled: boolean, toolHint?: unknown): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || !token) { setOn(false); return; }
    if (typeof toolHint === 'boolean') { setOn(toolHint); return; }
    let live = true;
    void probe(side, token).then(v => { if (live) setOn(v); });
    return () => { live = false; };
  }, [side, token, enabled, toolHint]);
  return on;
}
