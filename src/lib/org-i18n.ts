'use client';
import { useMemo } from 'react';
import { useApp } from '../../app/providers';
import { ApiError } from '@/lib/api';
import { Locale, MessageKey, messages, t as translate } from '@/lib/i18n';

type Vars = Record<string, string | number | null | undefined>;

const fill = (text: string, vars?: Vars) =>
  (vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name] ?? '') : whole)) : text);
const known = (key: string): key is MessageKey => key in messages.en;
const asDate = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00` : v);

/** The translation helpers the HR and organisation screens share, for one language. */
export function makeOrgT(locale: Locale) {
  const tag = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  const t = (key: MessageKey, vars?: Vars) => fill(translate(locale, key), vars);
  /** The label of an enum value (`prefix.value`), or the fallback when there is none. */
  const label = (prefix: string, value: string | null | undefined, fallback?: string) => {
    const key = `${prefix}.${value ?? ''}`;
    return known(key) ? t(key) : fallback ?? value ?? '';
  };
  return {
    locale,
    t,
    label,
    /** `base.one` for exactly one, otherwise `base.other`; {n} is the count. */
    n: (base: string, count: number, vars?: Vars) => {
      const key = `${base}.${count === 1 ? 'one' : 'other'}`;
      return known(key) ? t(key, { n: count, ...vars }) : String(count);
    },
    /** Text the server sends in English: shown as sent in English, translated when a label is known. */
    server: (prefix: string, value: string | null | undefined, sent: string | null | undefined) =>
      (locale === 'en' && sent ? sent : label(prefix, value, sent ?? value ?? '')),
    /** The message for an error code the server answered with, or the fallback. */
    err: (prefix: string, e: unknown, fallback: MessageKey) => {
      const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
      const key = `${prefix}.${code ?? ''}`;
      return t(code && known(key) ? key : fallback);
    },
    day: (v?: string | null) => (v ? asDate(v).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
    /** A calendar day (YYYY-MM-DD) without the year. */
    shortDay: (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    dateTime: (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: 'medium', timeStyle: 'short' }),
  };
}
export type OrgT = ReturnType<typeof makeOrgT>;

export function useOrgT(): OrgT {
  const { locale } = useApp();
  return useMemo(() => makeOrgT(locale), [locale]);
}
