"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    const handleAppInstalled = () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    setShowPrompt(false);
    setDeferredPrompt(null);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    // Offset by the tab bar's height so this banner sits ABOVE navigation
    // instead of on top of it — at `bottom-4` with z-50 it covered the tab bar
    // outright, which read as the bar having disappeared.
    <div className="fixed left-4 right-4 z-30 mx-auto max-w-md bottom-[calc(var(--tab-bar-h)+1rem)]">
      <div className="bg-card border rounded-2xl shadow-2xl p-4 flex items-center gap-3">
        <div className="bg-primary/10 p-2 rounded-full">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">Install App</p>
          <p className="text-xs text-muted-foreground">Offline access & faster loading</p>
        </div>
        <Button size="sm" onClick={handleInstall}>
          Install
        </Button>
      </div>
    </div>
  );
}