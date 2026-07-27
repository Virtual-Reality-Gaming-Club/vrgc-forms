export const CONFIG = {
  // Deployed Google Apps Script Web App URL (Referrals):
  GOOGLE_SCRIPT_REFERRAL_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL || "",
  
  // ID Card Form Sheets Sync URL:
  GOOGLE_SCRIPT_ID_CARD_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL || "",
  
  // Supabase Configuration
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",

  // ID Card Form Whitelisted Admins
  ADMIN_EMAILS: [
    "aayush.23mim10104@vitbhopal.ac.in",
    "abhinav.25bcy10254@vitbhopal.ac.in",
    "admin@vrgc.club",
    "alex.dev@gmail.com",
    "anmol.25bai10263@vitbhopal.ac.in",
    "haardik.24bcg10051@vitbhopal.ac.in",
    "jaiyansh.25bcy10268@vitbhopal.ac.in",
    "lokesh.23bcg10015@vitbhopal.ac.in",
    "mohit.25bcg10008@vitbhopal.ac.in",
    "parardha.24bcg10003@vitbhopal.ac.in",
    "rishav.24bsa10096@vitbhopal.ac.in",
    "riya.24bcg10082@vitbhopal.ac.in",
    "shivansh.23bce11158@vitbhopal.ac.in"
  ],

  // Live Firebase Primary Configuration (Firestore + Payments)
  FIREBASE_CONFIG: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || ""
  },

  // Firebase Secondary Configuration (Auth / Analytics - vrgc-form project)
  FIREBASE_AUTH_CONFIG: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_AUTH_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_AUTH_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_AUTH_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_AUTH_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_AUTH_APP_ID || "",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_AUTH_MEASUREMENT_ID || ""
  }
};