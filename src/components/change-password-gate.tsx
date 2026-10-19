'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ApiError, PORTAL_PASSWORD_MIN_LENGTH } from '@/lib/api';
import { signOutFirebase } from '@/lib/firebase';
import { fmt } from '@/lib/vendor';
import type { MessageKey } from '@/lib/i18n';
import { Alert, Button, Card, CardContent, Field, Input, useToast } from '@/components/shared';

// What each refusal of POST /auth/portal/password means for the person.
const ERROR_KEYS: Record<string, MessageKey> = {
  password_too_short: 'pwc.err.tooShort',
  password_unchanged: 'pwc.err.unchanged',
  password_change_not_required: 'pwc.err.notRequired',
  firebase_update_failed: 'pwc.err.saveFailed',
};

/**
 * Full-page step for a session that still has the start password an admin set (token `pwc: true`
 * or a 403 password_change_required). Nothing else in the portal opens until it is done; on success
 * the new session is stored as sign-in stores one, and the page they were going to opens.
 */
export function ChangePasswordGate() {
  const { t, token, user, signIn, signOut } = useApp();
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const tooShort = fmt(t('pwc.err.tooShort'), { min: PORTAL_PASSWORD_MIN_LENGTH });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setPasswordError(null); setConfirmError(null);
    if (password.length < PORTAL_PASSWORD_MIN_LENGTH) { setPasswordError(tooShort); passwordRef.current?.focus(); return; }
    if (password !== confirm) { setConfirmError(t('pwc.err.mismatch')); confirmRef.current?.focus(); return; }
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.changePortalPassword(token, password);
      // The server ended the Firebase session too (password changed): drop the client's copy so the
      // next sign-in starts fresh with the new password. Failing here must not undo the change.
      await signOutFirebase().catch(() => undefined);
      // Keep what sign-in learned about organisations; the response carries the user as sign-in does.
      const org = user?.organizationUser ? { organizationUser: true, organizationRoles: user.organizationRoles } : {};
      signIn(res.token, { ...org, ...res.user });
      toast.success(t('pwc.done'));
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      const key = code ? ERROR_KEYS[code] : undefined;
      if (code === 'password_too_short') { setPasswordError(tooShort); passwordRef.current?.focus(); }
      else if (code === 'password_unchanged') { setPasswordError(t('pwc.err.unchanged')); passwordRef.current?.focus(); }
      else setError(key ? t(key) : t('pwc.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await signOutFirebase().catch(() => undefined);
    signOut();
    router.replace('/login');
  }

  return (
    <Card className="w-full max-w-sm" data-testid="change-password-gate">
      <CardContent className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('pwc.title')}</h1>
          <p className="mt-1.5 text-sm text-[var(--color-fg-tertiary)]">{t('pwc.body')}</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {/* Lets a password manager file the new password under the right account. */}
          <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
          <Field label={t('pwc.new')} hint={fmt(t('pwc.hint'), { min: PORTAL_PASSWORD_MIN_LENGTH })} error={passwordError ?? undefined} required>
            <Input
              ref={passwordRef}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError(null); }}
              data-testid="pwc-new"
            />
          </Field>
          <Field label={t('pwc.confirm')} error={confirmError ?? undefined} required>
            <Input
              ref={confirmRef}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setConfirmError(null); }}
              data-testid="pwc-confirm"
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShow(v => !v)}
            aria-pressed={show}
            data-testid="pwc-toggle"
          >
            {show ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
            {show ? t('pwc.hide') : t('pwc.show')}
          </Button>
          <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="pwc-submit">
            {busy ? t('pwc.saving') : t('pwc.submit')}
          </Button>
        </form>
        <Button
          type="button"
          variant="link"
          onClick={onSignOut}
          className="h-auto w-full px-0 text-sm font-medium"
          data-testid="pwc-signout"
        >
          {t('nav.signout')}
        </Button>
      </CardContent>
    </Card>
  );
}
