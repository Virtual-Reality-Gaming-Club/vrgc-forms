import type { Metadata, Viewport } from 'next';
import { Orbitron, Share_Tech_Mono, Rajdhani } from 'next/font/google';
import './globals.css';

const orbitron = Orbitron({ 
  subsets: ['latin'], 
  weight: ['400', '700', '900'],
  variable: '--font-orbitron'
});

const shareTechMono = Share_Tech_Mono({ 
  subsets: ['latin'], 
  weight: ['400'],
  variable: '--font-share-tech-mono'
});

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-rajdhani'
});

export const metadata: Metadata = {
  title: 'VRGC NEXUS — Member Profile',
  description: 'Virtual Reality & Gaming Club — QR profile reveal experience',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0118',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} ${shareTechMono.variable} ${rajdhani.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
