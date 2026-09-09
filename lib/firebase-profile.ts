type FirebaseUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type FirebaseCompat = {
  apps: unknown[];
  initializeApp: (config: typeof firebaseConfig) => unknown;
  auth: (() => {
    onAuthStateChanged: (callback: (user: FirebaseUser | null) => void) => () => void;
    signInWithPopup: (provider: unknown) => Promise<{ user: FirebaseUser }>;
    signOut: () => Promise<void>;
  }) & { GoogleAuthProvider: new () => unknown };
};

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

export type GoogleAccount = FirebaseUser;

const firebaseConfig = {
  apiKey: 'AIzaSyCQb1EQ32wfUlWDwoRTsito_sKZ9RwozYg',
  authDomain: 'yahtzee-78e13.firebaseapp.com',
  projectId: 'yahtzee-78e13',
  storageBucket: 'yahtzee-78e13.firebasestorage.app',
  messagingSenderId: '793956284747',
  appId: '1:793956284747:web:5945d257e569f1f4bd10ce',
  measurementId: 'G-3M40L033YZ',
};

const sdkVersion = '12.2.1';
let loading: Promise<FirebaseCompat> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') return resolve();
    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection.'));
    if (!existing) document.head.appendChild(script);
  });
}

async function firebase() {
  if (window.firebase) return window.firebase;
  if (!loading) {
    loading = (async () => {
      await loadScript(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth-compat.js`);
      if (!window.firebase) throw new Error('Google sign-in could not start.');
      if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
      return window.firebase;
    })();
  }
  return loading;
}

export async function watchGoogleAccount(callback: (user: GoogleAccount | null) => void) {
  const sdk = await firebase();
  return sdk.auth().onAuthStateChanged(callback);
}

export async function signInWithGoogle() {
  const sdk = await firebase();
  const provider = new sdk.auth.GoogleAuthProvider();
  return (await sdk.auth().signInWithPopup(provider)).user;
}

export async function signOutGoogle() {
  const sdk = await firebase();
  await sdk.auth().signOut();
}

export async function getGoogleIdToken(user: GoogleAccount, forceRefresh = false) {
  return user.getIdToken(forceRefresh);
}
