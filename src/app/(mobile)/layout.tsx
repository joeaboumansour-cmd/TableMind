import { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TableMind Mobile - Staff App",
  description: "Mobile interface for restaurant staff",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#25D366",
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background mobile-app">
      {children}
    </div>
  );
}
