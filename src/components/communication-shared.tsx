'use client';
// Helpers shared by the Communication Center and its templates.

import { ApiError, CommsDeepLink, CommsLocale, CommsPurpose, CommsText } from '@/lib/api';

export type T = (key: string) => string;

export const PURPOSES: CommsPurpose[] = ['promotion', 'renewal', 'payment', 'announcement', 'engagement', 'general'];
export const DEEP_LINKS: CommsDeepLink[] = ['message', 'membership', 'renewal', 'payment', 'gym'];
export const VARIABLES = ['member_name', 'gym_name', 'plan_name', 'expiry_date', 'offer_name', 'discount', 'amount'];
export const SENDER_VARIABLES = ['offer_name', 'discount', 'amount'];
export const LOCALES: CommsLocale[] = ['en', 'sw'];
export const TITLE_MAX = 65;
export const BODY_MAX = 1000;

export const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), s);
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const variablesIn = (text: string) => [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]);

/** A language's text is either left empty or has both a title and a body within the limits. */
export const textOk = (x: CommsText | undefined, required: boolean) => {
  const title = x?.title.trim() ?? '';
  const body = x?.body.trim() ?? '';
  if (!title && !body) return !required;
  return Boolean(title && body) && title.length <= TITLE_MAX && body.length <= BODY_MAX;
};

export function errorText(t: T, err: unknown): string {
  const code = err instanceof ApiError ? (err.body as any)?.error : null;
  const known: Record<string, string> = {
    nobody_reachable: 'comms.warn.nobody_reachable',
    empty_audience: 'comms.audience.none',
    schedule_too_soon: 'comms.schedule.tooSoon',
    system_template_read_only: 'comms.tpl.readOnly',
    template_archived: 'comms.tpl.isArchived',
    template_not_found: 'comms.tpl.notFound',
    whatsapp_template_required: 'comms.channel.whatsappNeedsTemplate',
  };
  return code && known[code] ? t(known[code]) : `${t('comms.error.generic')}${code ? ` (${code})` : ''}`;
}

export function MessageCard({ title, body, cta }: { title: string; body: string; cta?: string | null }) {
  return (
    <div className="max-w-sm rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 whitespace-pre-line text-sm">{body}</p>
      {cta && <span className="mt-3 inline-block rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-3 py-1.5 text-xs font-semibold text-white">{cta}</span>}
    </div>
  );
}

export function PushCard({ sender, title, body }: { sender: string; title: string; body: string }) {
  return (
    <div className="max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-3">
      <p className="text-xs text-[var(--color-fg-quaternary)]">{sender}</p>
      <p className="truncate text-sm font-semibold">{title}</p>
      <p className="line-clamp-2 text-xs">{body}</p>
    </div>
  );
}
