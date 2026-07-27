import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { CONFIG } from "./config";

// Primary app — used for Firestore (Payments, Invoices)
const primaryApp = !getApps().find(a => a.name === '[DEFAULT]')
  ? initializeApp(CONFIG.FIREBASE_CONFIG)
  : getApp();

// Secondary app — used for Auth (Google Sign-In via vrgc-form project)
// If no secondary config is provided, fall back to the primary app.
const hasAuthConfig = !!CONFIG.FIREBASE_AUTH_CONFIG.apiKey;
const authApp = hasAuthConfig
  ? (getApps().find(a => a.name === 'auth-app') || initializeApp(CONFIG.FIREBASE_AUTH_CONFIG, 'auth-app'))
  : primaryApp;

export const auth = getAuth(authApp);

// Firestore is always on the primary app
export const db = getFirestore(primaryApp);

// Export a secondary Firestore instance for the newer app (ID Cards & Referrals)
export const authDb = getFirestore(authApp);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const isFirebaseConfigured = () => true;