import type { Metadata } from "next";
import { Bebas_Neue, Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import GlobalBackground from "@/components/GlobalBackground";
import SessionTracker from "@/components/SessionTracker";

const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  fallback: ['Impact', 'Space Grotesk', 'sans-serif'],
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-head',
  fallback: ['-apple-system', 'sans-serif'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  fallback: ['monospace'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "VRGC | Forms Portal",
  description: "Virtual Reality & Gaming Club Direct Access Command Center and Digital ID Card System.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  other: {
    'google-adsense-account': 'ca-pub-9955321741781874',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${bebasNeue.variable} ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="google-adsense-account" content="ca-pub-9955321741781874" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.qrserver.com" />
        <link rel="preconnect" href="https://fopyejijjeoumimsdgiz.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.dicebear.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body
        suppressHydrationWarning
        className="bg-[#03010A] text-[#e2e8f0] antialiased min-h-screen selection:bg-purple-500 selection:text-white relative overflow-x-clip max-w-full w-full"
      >
        <GlobalBackground />
        <div className="relative z-10 min-h-screen flex flex-col w-full max-w-full overflow-x-clip">
          <AuthProvider>
            <SessionTracker />
            {children}
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}

