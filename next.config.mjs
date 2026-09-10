/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },

  env: {
    FORMSPREE_URL: process.env.FORMSPREE_URL,
    GOOGLE_SCRIPT_REFERRAL_URL: process.env.GOOGLE_SCRIPT_REFERRAL_URL,
    GOOGLE_SCRIPT_ID_CARD_URL: process.env.GOOGLE_SCRIPT_ID_CARD_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
    FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
    FIREBASE_MEASUREMENT_ID: process.env.FIREBASE_MEASUREMENT_ID,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    PAYMENT_ADMIN_EMAILS: process.env.PAYMENT_ADMIN_EMAILS,
    LOG_DELETE_ADMIN_EMAILS: process.env.LOG_DELETE_ADMIN_EMAILS,
    DEFAULT_FACULTY_EMAIL: process.env.DEFAULT_FACULTY_EMAIL,
    DEFAULT_FACULTY_NAME: process.env.DEFAULT_FACULTY_NAME,
    DEFAULT_FACULTY_ID: process.env.DEFAULT_FACULTY_ID,
    DEFAULT_FACULTY_DEPT: process.env.DEFAULT_FACULTY_DEPT,
    DEFAULT_FACULTY_DESIGNATION: process.env.DEFAULT_FACULTY_DESIGNATION,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
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
