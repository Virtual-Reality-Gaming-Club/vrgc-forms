export const CONFIG = {
  // Deployed Google Apps Script Web App URL (Referrals):
  GOOGLE_SCRIPT_REFERRAL_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL || "",
  
  // ID Card Form Sheets Sync URL:
  GOOGLE_SCRIPT_ID_CARD_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL || "",
  
  // Supabase Configuration
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fopyejijjeoumimsdgiz.supabase.co",
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.unconfigured_dev_key",

  // Whitelisted Admins (managed dynamically via Firestore / admins collection or env variable)
  ADMIN_EMAILS: (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Live Firebase Production Configuration
  FIREBASE_CONFIG: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || ""
  }
};
