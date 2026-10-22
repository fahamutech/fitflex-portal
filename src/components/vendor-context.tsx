'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, VENDOR_USER_TYPES, type VendorMe } from '@/lib/api';
import { countsOf, errorCode, isOpenOrder } from '@/lib/vendor';
import { useToast } from './ui/toast';
import { useApp } from '../../app/providers';

/**
 * none: not a vendor session · loading: asking /vendor/me · ready: the vendor area opens ·
 * off: portal switched off (or /vendor/me unreachable on first load; fails closed) ·
 * inactive: staff turned off by the business owner · suspended: the business account is suspended.
 */
export type VendorStatus = 'none' | 'loading' | 'ready' | 'off' | 'inactive' | 'suspended';

interface VendorCtx {
  status: VendorStatus;
  me: VendorMe | null;
  /** Low-stock units (null = not shown). */
  lowCount: number | null;
  /** Paid orders whose own status is still pending (null = not shown). */
  waitingCount: number | null;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  refreshCounts: () => void;
  /**
   * The shared answer to an error inside the area: turned-off staff, permission refusals and a
   * switched-off feature. Returns true when it was handled (the caller shows nothing more).
   */
  handleError: (err: unknown) => boolean;
}

const Ctx = createContext<VendorCtx | null>(null);

export function useVendor(): VendorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useVendor must be inside <VendorProvider>');
  return c;
}

const FORBIDDEN = new Set(['vendor_permission_forbidden', 'acl_forbidden', 'forbidden', 'vendor_suspended']);

export function VendorProvider({ children }: { children: ReactNode }) {
  const { token, user, t } = useApp();
  const toast = useToast();
  const isVendor = !!token && VENDOR_USER_TYPES.has(user?.userType ?? '');
  const [status, setStatus] = useState<VendorStatus>('none');
  const [me, setMe] = useState<VendorMe | null>(null);
  const [lowCount, setLowCount] = useState<number | null>(null);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const statusRef = useRef<VendorStatus>('none');
  statusRef.current = status;

  const closedFor = useCallback((code: string | null): VendorStatus | null => {
    if (code === 'vendor_staff_inactive') return 'inactive';
    if (code === 'account_suspended') return user?.userType === 'vendor_staff' ? 'inactive' : 'suspended';
    return null;
  }, [user?.userType]);

  const refresh = useCallback(async () => {
    if (!token || !isVendor) return;
    try {
      const next = await api.vendorMe(token);
      setMe(next);
      setStatus(next?.tools?.portal === true ? 'ready' : 'off');
    } catch (err) {
      const code = errorCode(err);
      // Suspended while signed in: keep the area, show the banner (§2.4).
      if (code === 'account_suspended' && user?.userType === 'vendor' && statusRef.current === 'ready') {
        setMe(current => (current ? { ...current, accountStatus: 'suspended' } : current));
        return;
      }
      const closed = closedFor(code);
      if (closed) { setStatus(closed); return; }
      // Fail closed on the first answer (404 feature_disabled, 403, network); later, only a switched-off portal closes it.
      if (statusRef.current !== 'ready' || code === 'feature_disabled') setStatus('off');
    }
  }, [token, isVendor, closedFor, user?.userType]);

  useEffect(() => {
    setMe(null); setLowCount(null); setWaitingCount(null);
    if (!isVendor) { setStatus('none'); return; }
    setStatus('loading');
    void refresh();
  }, [isVendor, token, refresh]);

  const can = useCallback((permission: string) => !!me?.permissions?.includes(permission), [me]);

  const refreshCounts = useCallback(() => {
    if (!token || status !== 'ready' || !me) return;
    if (me.tools.stockLedger && me.permissions.includes('products')) {
      api.vendorLowStock(token).then(rows => setLowCount(Array.isArray(rows) ? rows.length : null)).catch(() => setLowCount(null));
    } else setLowCount(null);
    if (me.permissions.includes('orders')) {
      api.vendorOrders(token, { limit: 50 })
        // The server's count covers every order; older servers: count the newest page.
        .then(r => setWaitingCount(countsOf(r.counts)?.waitingAccept ?? r.orders.filter(o => isOpenOrder(o) && o.status === 'pending').length))
        .catch(() => setWaitingCount(null));
    } else setWaitingCount(null);
  }, [token, status, me]);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // Several requests can be refused at once: say "no access" once, not once per request.
  const lastNoAccess = useRef(0);
  const handleError = useCallback((err: unknown) => {
    const code = errorCode(err);
    // A business suspended while signed in keeps its area with the suspended banner (§2.4); moves are disabled.
    // S3: staff of a suspended business get vendor_suspended (e.g. on /vendor/sales): the same banner.
    if (((code === 'account_suspended' && user?.userType === 'vendor') || code === 'vendor_suspended') && statusRef.current === 'ready') {
      setMe(current => (current ? { ...current, accountStatus: 'suspended' } : current));
      return true;
    }
    const closed = closedFor(code);
    if (closed) { setStatus(closed); return true; }
    if (code && (FORBIDDEN.has(code) || code.startsWith('not_your_'))) {
      if (Date.now() - lastNoAccess.current > 4000) toast.error(t('vendor.noAccess'));
      lastNoAccess.current = Date.now();
      void refresh();
      return true;
    }
    if (code === 'feature_disabled') { void refresh(); return true; }
    return false;
  }, [closedFor, refresh, t, toast, user?.userType]);

  const value = useMemo(() => ({ status, me, lowCount, waitingCount, can, refresh, refreshCounts, handleError }),
    [status, me, lowCount, waitingCount, can, refresh, refreshCounts, handleError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
