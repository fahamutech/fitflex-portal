'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../providers';
import { api, ApiError } from '@/lib/api';
import { signInWithGoogleIdToken, signInWithEmailPasswordIdToken } from '@/lib/firebase';
import { Button, Card, CardContent, Alert, Spinner, Field } from '@/components/shared';

export default function LoginPage() {
  const { t, signIn } = useApp();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<'choose' | 'email'>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSuccess(token: string, user: { id: string; userType: string; gymId?: string; portalUser?: boolean; aclPermissions?: string[]; email?: string }) {
    signIn(token, user);
    router.replace(user.userType === 'admin' ? '/admin' : '/dashboard');
  }

  function mapError(err: unknown): string {
    if (err instanceof ApiError) {
      const body = err.body as any;
      if (body?.error === 'admin_self_registration_not_allowed')
        return 'This account is not registered as a portal user. Contact a FitFlex admin.';
      if (body?.error === 'account_suspended')
        return 'This account has been suspended.';
      if (body?.error === 'email_already_used_for_different_role')
        return `This email is registered as a ${body.existingRole} account, not a portal user.`;
      return t('login.error');
    }
    return (err as Error).message;
  }

  async function onGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      const idToken = await signInWithGoogleIdToken();
      const { token, user } = await api.firebaseSession(idToken, 'admin');
      handleSuccess(token, user);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const idToken = await signInWithEmailPasswordIdToken(email, password);
      const { token, user } = await api.firebaseSession(idToken, 'admin');
      handleSuccess(token, user);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-brand-600)] shadow-[var(--shadow-lg)]">
            <span className="text-2xl font-bold text-white">FF</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-fg-primary)]">{t('login.heading')}</h1>
          <p className="mt-1.5 text-sm text-[var(--color-fg-quaternary)]">
            Sign in with your assigned FitFlex portal account.
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}

            {method === 'choose' && (
              <>
                {/* Google sign-in */}
                <Button
                  type="button"
                  size="lg"
                  disabled={busy}
                  className="w-full"
                  data-testid="google-submit"
                  onClick={onGoogleSignIn}
                >
                  {busy ? (
                    <><Spinner className="h-4 w-4 text-white" /> Signing in…</>
                  ) : (
                    <>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="rgba(255,255,255,0.7)" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                        <path fill="rgba(255,255,255,0.7)" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Continue with Google
                    </>
                  )}
                </Button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--color-border-secondary)]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-[var(--color-bg-primary)] px-2 text-[var(--color-fg-quaternary)]">or</span>
                  </div>
                </div>

                {/* Email/password option */}
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  data-testid="email-method-btn"
                  onClick={() => setMethod('email')}
                >
                  Continue with email
                </Button>
              </>
            )}

            {method === 'email' && (
              <form onSubmit={onEmailSignIn} className="space-y-4">
                <Field label={t('login.email')}>
                  <input
                    type="email"
                    className="ui-input"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    data-testid="email-input"
                  />
                </Field>
                <Field label={t('login.password')}>
                  <input
                    type="password"
                    className="ui-input"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    data-testid="password-input"
                  />
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="email-submit">
                  {busy ? <><Spinner className="h-4 w-4 text-white" /> Signing in…</> : t('login.submit')}
                </Button>
                <button
                  type="button"
                  onClick={() => { setMethod('choose'); setError(null); }}
                  className="w-full text-center text-xs text-[var(--color-fg-quaternary)] hover:text-[var(--color-fg-secondary)] transition-colors"
                >
                  ← Back to sign-in options
                </button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--color-fg-quaternary)]">
          No self-registration — accounts are created by a FitFlex admin.
        </p>
      </div>
    </div>
  );
}
