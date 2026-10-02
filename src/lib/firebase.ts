import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from 'firebase/auth';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
            error_callback?: (error: { type?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

function firebaseConfig() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId || !cfg.appId) {
    throw new Error('Firebase web config is missing. Set NEXT_PUBLIC_FIREBASE_* env values.');
  }
  return cfg;
}

function getFirebaseAuth() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig());
  return getAuth(app);
}

function googleClientId() {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    '318978253903-u6du2v8thfbdbmortdh49k1g06uv91v7.apps.googleusercontent.com'
  );
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google sign-in is only available in the browser.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  googleScriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

async function signInWithGoogleIdentityServicesIdToken(auth: ReturnType<typeof getAuth>, clientId: string) {
  await loadGoogleIdentityServices();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google sign-in is unavailable on this browser.');

  const accessToken = await new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: (response) => {
        if (response.access_token) {
          resolve(response.access_token);
          return;
        }
        reject(new Error(response.error_description || response.error || 'Google sign-in was cancelled.'));
      },
      error_callback: (error) => reject(new Error(error.type || 'Google sign-in was cancelled.')),
    });
    tokenClient.requestAccessToken();
  });

  const credential = GoogleAuthProvider.credential(null, accessToken);
  const userCredential = await signInWithCredential(auth, credential);
  return userCredential.user.getIdToken();
}

async function signInWithFirebasePopupIdToken(auth: ReturnType<typeof getAuth>) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user.getIdToken();
}

export async function signInWithGoogleIdToken() {
  const auth = getFirebaseAuth();
  const clientId = googleClientId();
  if (clientId) {
    return signInWithGoogleIdentityServicesIdToken(auth, clientId);
  }
  return signInWithFirebasePopupIdToken(auth);
}

/** The sign-in password the app derives from a PIN. */
const passwordForPin = (pin: string) => `fitflex-pin:${pin}`;
const WRONG_PASSWORD = new Set(['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials']);

export async function signInWithEmailPasswordIdToken(email: string, password: string) {
  const auth = getFirebaseAuth();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user.getIdToken();
  } catch (err) {
    // Gym owners and staff sign in with the PIN they use in the app, which
    // the app stores in its own form. Portal-only accounts use a password.
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
    if (!WRONG_PASSWORD.has(code) || !/^[0-9]{4,8}$/.test(password)) throw err;
    const credential = await signInWithEmailAndPassword(auth, email, passwordForPin(password));
    return credential.user.getIdToken();
  }
}

// ─── Email verification (Identity V2 · I0) ─────────────────────────────────
// The backend refuses a sign-in with 409 email_verification_required when an
// unverified email would claim a FitFlex account this Firebase login doesn't
// own. These keep the Firebase session so the person can verify and retry.

function requireFirebaseUser() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('No signed-in Firebase user.');
  return user;
}

/** Email of the signed-in Firebase user, if any. */
export function currentFirebaseEmail(): string | null {
  return getFirebaseAuth().currentUser?.email ?? null;
}

/** Sends Firebase's verification link to the signed-in user's email. */
export async function sendVerificationEmail() {
  await sendEmailVerification(requireFirebaseUser());
}

/**
 * Reloads the Firebase user (the link is opened elsewhere). Returns a freshly
 * minted ID token once the email is verified, otherwise null.
 */
export async function verifiedIdTokenOrNull(): Promise<string | null> {
  const user = requireFirebaseUser();
  await user.reload();
  if (!getFirebaseAuth().currentUser?.emailVerified) return null;
  // Force-refresh: the cached token still says email_verified: false.
  return user.getIdToken(true);
}

export async function signOutFirebase() {
  await signOut(getFirebaseAuth());
}
