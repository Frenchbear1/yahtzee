export type FirebaseUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type FirebaseDocumentSnapshot = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

export type FirebaseDocumentReference = {
  id: string;
  path: string;
  get: () => Promise<FirebaseDocumentSnapshot>;
  set: (data: unknown, options?: { merge?: boolean }) => Promise<void>;
  update: (data: unknown) => Promise<void>;
  delete: () => Promise<void>;
  collection: (path: string) => FirebaseCollectionReference;
};

export type FirebaseQuerySnapshot = { docs: FirebaseDocumentSnapshot[] };

export type FirebaseQuery = {
  where: (field: string, operator: 'array-contains' | '==', value: unknown) => FirebaseQuery;
  orderBy: (field: string, direction?: 'asc' | 'desc') => FirebaseQuery;
  limit: (count: number) => FirebaseQuery;
  get: () => Promise<FirebaseQuerySnapshot>;
};

export type FirebaseCollectionReference = FirebaseQuery & {
  doc: (id?: string) => FirebaseDocumentReference;
};

export type FirebaseTransaction = {
  get: (reference: FirebaseDocumentReference) => Promise<FirebaseDocumentSnapshot>;
  set: (reference: FirebaseDocumentReference, data: unknown, options?: { merge?: boolean }) => FirebaseTransaction;
  update: (reference: FirebaseDocumentReference, data: unknown) => FirebaseTransaction;
  delete: (reference: FirebaseDocumentReference) => FirebaseTransaction;
};

export type FirebaseWriteBatch = {
  set: (reference: FirebaseDocumentReference, data: unknown, options?: { merge?: boolean }) => FirebaseWriteBatch;
  update: (reference: FirebaseDocumentReference, data: unknown) => FirebaseWriteBatch;
  delete: (reference: FirebaseDocumentReference) => FirebaseWriteBatch;
  commit: () => Promise<void>;
};

export type FirebaseFirestore = {
  doc: (path: string) => FirebaseDocumentReference;
  collection: (path: string) => FirebaseCollectionReference;
  runTransaction: <T>(callback: (transaction: FirebaseTransaction) => Promise<T>) => Promise<T>;
  batch: () => FirebaseWriteBatch;
};

export type FirebaseCompat = {
  apps: unknown[];
  initializeApp: (config: typeof firebaseConfig) => unknown;
  auth: (() => {
    onAuthStateChanged: (callback: (user: FirebaseUser | null) => void) => () => void;
    signInWithPopup: (provider: unknown) => Promise<{ user: FirebaseUser }>;
    signOut: () => Promise<void>;
  }) & { GoogleAuthProvider: new () => unknown };
  firestore: () => FirebaseFirestore;
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

export async function getFirebaseFirestore() {
  return (await firebase()).firestore();
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

function scoreDocument(userId: string) {
  return `users/${userId}/yahtzee/state`;
}

export async function loadGoogleScores(userId: string) {
  const sdk = await firebase();
  const document = await sdk.firestore().doc(scoreDocument(userId)).get();
  if (!document.exists) return null;
  const value = document.data() as { state?: unknown } | undefined;
  return value?.state ?? null;
}

export async function saveGoogleScores(userId: string, state: unknown) {
  const sdk = await firebase();
  await sdk.firestore().doc(scoreDocument(userId)).set({ state, updatedAt: Date.now() });
}
