import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

export const viewport: Viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Essential for POS to prevent UI shifting during fast scanning
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Golden Squirrel - POS System",
  description: "Mobile Point of Sale for Golden Squirrel",
  manifest: "/manifest.json",
  icons: [
    {
      rel: "icon",
      url: "/icons/launchericon-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      rel: "icon",
      url: "/icons/launchericon-512x512.png",
      sizes: "512x512",
      type: "image/png",
    },
    {
      rel: "apple-touch-icon",
      url: "/icons/launchericon-192x192.png",
    },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Golden Squirrel",
  },
  formatDetection: {
    telephone: false,
  },
  // These "other" tags help with various Android and legacy browser PWA behaviors
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-tap-highlight': 'no',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased dark`}
      >
        <Providers>
          {children}
          <PWAInstallPrompt />
        </Providers>
      </body>
    </html>
  );
}