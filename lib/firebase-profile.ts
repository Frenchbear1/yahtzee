type FirebaseUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
};

type FirebaseCompat = {
  apps: unknown[];
  initializeApp: (config: typeof firebaseConfig) => unknown;
  auth: (() => {
    onAuthStateChanged: (callback: (user: FirebaseUser | null) => void) => () => void;
    signInWithPopup: (provider: unknown) => Promise<{ user: FirebaseUser }>;
    signOut: () => Promise<void>;
  }) & { GoogleAuthProvider: new () => unknown };
  firestore: (() => {
    collection: (name: string) => {
      doc: (id: string) => {
        get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
        set: (data: Record<string, unknown>, options?: { merge: boolean }) => Promise<void>;
      };
    };
  }) & { FieldValue: { serverTimestamp: () => unknown } };
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
      await loadScript(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-firestore-compat.js`);
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

export async function syncGoogleProfile(user: GoogleAccount, currentToken: string) {
  const sdk = await firebase();
  const ref = sdk.firestore().collection('users').doc(user.uid);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() : {};
  const savedToken = typeof existing.playerToken === 'string' && /^[a-f0-9]{64}$/.test(existing.playerToken)
    ? existing.playerToken
    : currentToken;

  await ref.set({
    playerToken: savedToken,
    displayName: (user.displayName || 'Player').slice(0, 32),
    email: user.email || '',
    updatedAt: sdk.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return savedToken;
}
