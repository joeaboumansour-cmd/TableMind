import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import PWAUpdateListener from "@/components/PWAUpdateListener";

export const viewport: Viewport = {
  // The EXACT hex of --background (oklch(0.141 0.005 285.823)), so the Android
  // status bar in the installed PWA blends into the app instead of sitting
  // above it as an amber band. The app forces dark mode, so one value is
  // correct in every condition — there is no light theme to answer for.
  // Amber stays the accent colour; it was never meant to be system chrome.
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Essential for POS to prevent UI shifting during fast scanning
  // Required for env(safe-area-inset-*) to report real values. Without it the
  // insets are all 0, and because appleWebApp.statusBarStyle below is
  // "black-translucent" (which extends the page under the iOS status bar and
  // home indicator), content rendered under the notch with nothing to
  // compensate for it.
  viewportFit: 'cover',
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
      // iOS expects 180x180 for the home-screen icon. This was pointing at
      // the 192 launcher icon, which iOS downscales.
      rel: "apple-touch-icon",
      url: "/icons/apple-touch-icon-180x180.png",
      sizes: "180x180",
      type: "image/png",
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
          <PWAUpdateListener />
        </Providers>
      </body>
    </html>
  );
}