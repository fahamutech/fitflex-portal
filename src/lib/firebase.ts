import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithEmailAndPassword,
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

export async function signInWithEmailPasswordIdToken(email: string, password: string) {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user.getIdToken();
}
