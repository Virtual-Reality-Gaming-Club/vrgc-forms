import type { Metadata } from "next";
import { Orbitron, Outfit, JetBrains_Mono, Rajdhani } from 'next/font/google';
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['400', '600', '800', '900'],
  variable: '--font-orbitron',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-rajdhani',
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${orbitron.variable} ${outfit.variable} ${jetbrainsMono.variable} ${rajdhani.variable}`} suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="preconnect" href="https://fopyejijjeoumimsdgiz.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.dicebear.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body className="bg-[#05010a] text-[#e2e8f0] antialiased min-h-screen selection:bg-purple-500 selection:text-white">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
