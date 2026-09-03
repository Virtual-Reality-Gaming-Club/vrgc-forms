export const CONFIG = {
  // Deployed Google Apps Script Web App URL (Referrals):
  GOOGLE_SCRIPT_REFERRAL_URL: process.env.GOOGLE_SCRIPT_REFERRAL_URL || process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL || "",
  
  // ID Card Form Sheets Sync URL:
  GOOGLE_SCRIPT_ID_CARD_URL: process.env.GOOGLE_SCRIPT_ID_CARD_URL || process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL || "",
  
  // Supabase Configuration
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",

  // Whitelisted Admins (managed dynamically via Firestore / admins collection or env variable)
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Payment Admins (managed via env variable)
  PAYMENT_ADMIN_EMAILS: (process.env.PAYMENT_ADMIN_EMAILS || process.env.NEXT_PUBLIC_PAYMENT_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Log Deletion Authorized Admins (managed via env variable)
  LOG_DELETE_ADMIN_EMAILS: (process.env.LOG_DELETE_ADMIN_EMAILS || process.env.NEXT_PUBLIC_LOG_DELETE_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Live Firebase Production Configuration
  FIREBASE_CONFIG: {
    apiKey: process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || ""
  }
};
