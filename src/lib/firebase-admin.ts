import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

if (typeof window !== 'undefined') {
  throw new Error('Firebase Admin SDK must only be used in server-side environments.');
}

function initAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (clientEmail && rawPrivateKey) {
    const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return initializeApp({
    projectId,
  });
}

export const adminApp: App = initAdminApp();
export const adminAuth: Auth = getAuth(adminApp);
