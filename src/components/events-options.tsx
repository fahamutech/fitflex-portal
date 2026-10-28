'use client';
import { useEffect, useState } from 'react';
import { api, type EventsOptions } from '@/lib/api';
import { EVENTS_MODULE } from '@/lib/flags';

/**
 * Events S3 (spec §6.1, §7.1): `GET /events/options` probed once per page load and shared by the nav and the
 * corporate pages. `undefined` while loading, `null` when the probe failed or the build flag is off. The probe is
 * public and never 404s (S2 §13), so a failure here means the network, not the flag.
 */
let cached: Promise<EventsOptions | null> | null = null;
export function probeEventsOptions(): Promise<EventsOptions | null> {
  if (!EVENTS_MODULE) return Promise.resolve(null);
  if (!cached) cached = api.eventsOptions().catch(() => { cached = null; return null; });
  return cached;
}
/** Test seam: forget the cached probe. */
export function resetEventsOptionsCache() { cached = null; }

export function useEventsOptions(enabled = true): EventsOptions | null | undefined {
  const [options, setOptions] = useState<EventsOptions | null | undefined>(() => (!enabled || !EVENTS_MODULE ? null : undefined));
  useEffect(() => {
    if (!enabled || !EVENTS_MODULE) { setOptions(null); return; }
    let live = true;
    setOptions(undefined);
    probeEventsOptions().then(o => { if (live) setOptions(o); });
    return () => { live = false; };
  }, [enabled]);
  return options;
}

/** Whether the corporate bulk registration pages may render (§7.1): build flag + server `registration && corporate`. */
export const corporateEventsOpen = (o: EventsOptions | null | undefined) => EVENTS_MODULE && !!o?.registration && !!o?.corporate;
export function useCorporateEventsAvailable(enabled: boolean) {
  const o = useEventsOptions(enabled);
  return corporateEventsOpen(o);
}
