/**
 * CONFIG — shared public/client-safe configuration.
 *
 * Only values that are safe to expose to browser JavaScript may live here.
 *
 * ARCHITECTURE:
 * - SUPER_ADMIN_EMAILS is the ONLY env-var-controlled role. It is used by the
 *   intentional hidden Super Admin bridge (superAdminsBridge.ts) and must not be changed.
 * - ALL other roles (Admin, Payment Admin, Technical, Caster, Member, etc.) are managed
 *   exclusively through Firebase/Firestore via the Super Admin Console.
 * - ZERO normal-role email lists exist in env.
 */
export const CONFIG = {
  // Deployed Google Apps Script Web App URL (Referrals):
  GOOGLE_SCRIPT_REFERRAL_URL: process.env.GOOGLE_SCRIPT_REFERRAL_URL || "",

  // ID Card Form Sheets Sync URL:
  GOOGLE_SCRIPT_ID_CARD_URL: process.env.GOOGLE_SCRIPT_ID_CARD_URL || "",

  // Supabase public/anon client configuration (intentionally client-visible):
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",

  // Super Admins — used by the hidden Super Admin bridge (do NOT remove or rename):
  SUPER_ADMIN_EMAILS: (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Live Firebase client configuration (intentionally client-visible):
  FIREBASE_CONFIG: {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || "",
  },
};
