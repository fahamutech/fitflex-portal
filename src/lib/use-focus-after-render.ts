'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Focus an element once React has committed the render that the caller's state changes cause.
 * A `setTimeout` can fire before that commit in production builds, so the target is not mounted yet,
 * the focus call does nothing and focus stays on <body>. The getter runs in an effect, after the commit.
 */
export function useFocusAfterRender() {
  const target = useRef<(() => HTMLElement | null | undefined) | null>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const get = target.current;
    if (!get) return;
    target.current = null;
    get()?.focus();
  }, [request]);
  return useCallback((get: () => HTMLElement | null | undefined) => {
    target.current = get;
    setRequest(n => n + 1);
  }, []);
}
