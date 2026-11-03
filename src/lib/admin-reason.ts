import { ApiError } from './api';
import type { MessageKey } from './i18n';

/** Longest reason the server keeps (functions src/shared/admin-reason.mjs). */
export const REASON_MAX = 500;

/** The reason to send: trimmed, or undefined when blank (the server decides whether one is required: flag ADMIN_REASONS_REQUIRED). */
export const reasonOf = (raw: string): string | undefined => raw.trim() || undefined;

/** 400 { error: 'reason_required' }: nothing was changed. */
export function isReasonRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && (err.body as { error?: string } | null)?.error === 'reason_required';
}

export const REASON_REQUIRED_KEY: MessageKey = 'adminReason.required';
