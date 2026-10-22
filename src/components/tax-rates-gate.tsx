'use client';
import { useEffect, useState } from 'react';
import { adminTaxApi } from '@/lib/vendor-documents';

// Whether the server has VAT switched on (VENDOR_TOOLS + VENDOR_VAT). Off, GET /admin/tax-rates answers 404
// feature_disabled, so the admin "Tax rates" nav item stays hidden. Asked once per session; anything but a
// well-formed answer counts as off (fails closed).
const asked = new Map<string, Promise<boolean>>();

export function forgetTaxRatesAvailability() { asked.clear(); }

export function useTaxRatesAvailable(token: string | null | undefined, enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || !token) { setOn(false); return; }
    let hit = asked.get(token);
    if (!hit) {
      hit = adminTaxApi.rates(token).then(r => Array.isArray(r?.rates) && Array.isArray(r?.codes), () => false);
      asked.set(token, hit);
    }
    let live = true;
    void hit.then(v => { if (live) setOn(v); });
    return () => { live = false; };
  }, [token, enabled]);
  return on;
}
