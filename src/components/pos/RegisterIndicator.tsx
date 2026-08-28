"use client";

// =============================================
// Which drawer this cashier is on
// =============================================
// A quiet chip on the Pro till showing the register the supervisor assigned the
// signed-in user to. It is the one fact a cashier needs from the cash-register
// feature and the only part of it a POS-only account can see.
//
// It reads /api/my-shift, which returns the caller's OWN assignment and nothing
// else — no amounts, no other registers, no other people. A cashier has no
// business seeing the store's drawer figures.
//
// When nothing is assigned it stays deliberately neutral rather than alarming.
// Those sales are still recorded and surface in the supervisor's Unassigned
// bucket; nagging the cashier about a setup decision they cannot make
// themselves would be noise on the one screen that has to stay calm.
// =============================================

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useAuth } from "@/lib/auth/AuthContext";

export default function RegisterIndicator() {
  const { user } = useAuth();
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();

  const [registerName, setRegisterName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const enabled = !flagsLoading && isEnabled("cash_register");

  useEffect(() => {
    if (!enabled || !user?.storeId || !connectivity.isOnline) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/my-shift", { headers: buildAuthHeaders(user) });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setRegisterName(data.register?.name ?? null);
        setLoaded(true);
      } catch {
        // Silent. The till keeps selling whatever this says.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  if (!enabled || !loaded) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
      <Monitor className="h-3.5 w-3.5" />
      {registerName ?? "No register assigned"}
    </span>
  );
}
