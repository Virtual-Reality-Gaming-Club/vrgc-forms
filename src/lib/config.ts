export const CONFIG = {
  // Deployed Google Apps Script Web App URL (Referrals):
  GOOGLE_SCRIPT_REFERRAL_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL || "https://script.google.com/macros/s/AKfycbxuT5zFYuGtq82pThzfCpleVt_6aoLfA4zuaxHCqz6fGO7BLb4U3QIzxn46tz4Xyce9/exec",
  
  // ID Card Form Sheets Sync URL:
  GOOGLE_SCRIPT_ID_CARD_URL: process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL || "https://script.google.com/macros/s/AKfycbz-TxnI2WRVEDRWXML_FDKp2FwxuXvSIYQ8lxg0DZlepEGkJoxtTl8nmMoLzlLH1FMt/exec",
  
  // Supabase Configuration
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fopyejijjeoumimsdgiz.supabase.co",
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcHllamlqamVvdW1pbXNkZ2l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Mjg4NDMsImV4cCI6MjEwMDMwNDg0M30.NQVEJKOzJnNoFGs8tgDTkbMrc4OgE_w9bhSpsZ4Cxm4",

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

  // Live Firebase Production Configuration
  FIREBASE_CONFIG: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyANu9lQsIX2JXGoViJ_Oag66Cltd0YzXI0",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "vrgc-form.firebaseapp.com",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "vrgc-form",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "vrgc-form.firebasestorage.app",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "830392164988",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:830392164988:web:9613ae484e4ab64d281ff9",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-F24JMF4K6Q"
  }
};
