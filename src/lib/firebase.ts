import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { CONFIG } from "./config";

const app = !getApps().length
  ? initializeApp(CONFIG.FIREBASE_CONFIG)
  : getApp();

export const auth = getAuth(app);

// 👇 Add this
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const isFirebaseConfigured = () => true;