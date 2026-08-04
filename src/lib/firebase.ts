import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { CONFIG } from './config';

let app: any = null;
try {
  app = !getApps().length ? initializeApp(CONFIG.FIREBASE_CONFIG) : getApp();
} catch (err) {
  console.warn('Firebase initializeApp warning:', err);
}

let auth: any = null;
try {
  if (app && CONFIG.FIREBASE_CONFIG.apiKey) {
    auth = getAuth(app);
  }
} catch (err) {
  console.warn('Firebase getAuth warning (invalid or missing API key):', err);
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let db: any = null;
try {
  if (app) {
    db = getFirestore(app);
  }
} catch (err) {
  console.warn('Firebase getFirestore warning:', err);
}

export { auth, db };
export const authDb = db;

export const isFirebaseConfigured = () => {
  return Boolean(CONFIG.FIREBASE_CONFIG?.apiKey);
};

