"use client";

// Route-level error boundary.
//
// The app previously had NO error.tsx, not-found.tsx or global-error.tsx
// anywhere, so any render-time throw dropped the cashier onto the raw Next.js
// error screen mid-shift with no way back. useAuth() in particular throws if
// used outside its provider, and nothing caught it.
//
// Recovery matters more than diagnostics here: the cart lives in localStorage
// (zustand persist) and completed sales live in IndexedDB, so neither is lost
// by re-rendering. "Try again" is genuinely safe.

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[App] Unhandled render error:", error);
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6 safe-top safe-bottom">
      <div className="max-w-sm w-full text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>

        <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your cart and any unsynced sales are saved on this device — nothing has
          been lost.
        </p>

        <div className="grid gap-2">
          <Button onClick={reset} className="h-12 text-base">
            <RotateCcw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => {
              window.location.href = "/pos";
            }}
          >
            Back to POS
          </Button>
        </div>

        {error.digest && (
          <p className="mt-6 text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
