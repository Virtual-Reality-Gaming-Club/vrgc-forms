/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },

  env: {
    NEXT_PUBLIC_FORMSPREE_URL: process.env.FORMSPREE_URL || process.env.NEXT_PUBLIC_FORMSPREE_URL,
    NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL: process.env.GOOGLE_SCRIPT_REFERRAL_URL || process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_REFERRAL_URL,
    NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL: process.env.GOOGLE_SCRIPT_ID_CARD_URL || process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_ID_CARD_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.FIREBASE_MEASUREMENT_ID || process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    NEXT_PUBLIC_ADMIN_EMAILS: process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS,
    NEXT_PUBLIC_PAYMENT_ADMIN_EMAILS: process.env.PAYMENT_ADMIN_EMAILS || process.env.NEXT_PUBLIC_PAYMENT_ADMIN_EMAILS,
    NEXT_PUBLIC_LOG_DELETE_ADMIN_EMAILS: process.env.LOG_DELETE_ADMIN_EMAILS || process.env.NEXT_PUBLIC_LOG_DELETE_ADMIN_EMAILS,
    NEXT_PUBLIC_DEFAULT_FACULTY_EMAIL: process.env.DEFAULT_FACULTY_EMAIL || process.env.NEXT_PUBLIC_DEFAULT_FACULTY_EMAIL,
    NEXT_PUBLIC_DEFAULT_FACULTY_NAME: process.env.DEFAULT_FACULTY_NAME || process.env.NEXT_PUBLIC_DEFAULT_FACULTY_NAME,
    NEXT_PUBLIC_DEFAULT_FACULTY_ID: process.env.DEFAULT_FACULTY_ID || process.env.NEXT_PUBLIC_DEFAULT_FACULTY_ID,
    NEXT_PUBLIC_DEFAULT_FACULTY_DEPT: process.env.DEFAULT_FACULTY_DEPT || process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DEPT,
    NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION: process.env.DEFAULT_FACULTY_DESIGNATION || process.env.NEXT_PUBLIC_DEFAULT_FACULTY_DESIGNATION,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'fopyejijjeoumimsdgiz.supabase.co' },
      { protocol: 'https', hostname: 'media.giphy.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
    formats: ['image/webp'],
    minimumCacheTTL: 3600,
  },

  async redirects() {
    return [
      {
        source: '/members.csv',
        destination: '/',
        permanent: true,
      },
      {
        source: '/admins.csv',
        destination: '/',
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/(.*)\\.(png|jpg|jpeg|gif|svg|webp|ico)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
