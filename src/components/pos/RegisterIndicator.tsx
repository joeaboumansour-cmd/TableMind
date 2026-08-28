"use client";

// =============================================
// Which drawer this till rings into
// =============================================
// A quiet chip on the Pro till. It exists for two reasons:
//
// 1. **To say which drawer this device belongs to.** With one register the
//    answer is obvious and the chip is nearly invisible; with several it is the
//    difference between a reconciled shift and a mystery.
//
// 2. **To close the configuration gap.** Register selection is device-local, so
//    a till that never visits the cash page would ring every sale into nothing
//    and quietly fill the Unassigned bucket. This component performs the same
//    auto-select the cash page does, on POS load, so a single-register store is
//    configured without anybody being asked.
//
// The fetch runs ONCE, only when the feature is on and nothing is selected yet.
// It is deliberately not on the sale path: a sale is never blocked, delayed or
// failed by cash-register state.
// =============================================

import { useEffect, useState } from "react";
import { Monitor, AlertTriangle } from "lucide-react";
import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { getActiveRegister, reconcileActiveRegister } from "@/lib/cash/activeRegister";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useAuth } from "@/lib/auth/AuthContext";

export default function RegisterIndicator() {
  const { user } = useAuth();
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();

  // Read the stored selection during the initial state computation rather than
  // in an effect. Setting it from an effect works, but costs a second render on
  // every till load for a value that was available synchronously all along.
  const [name, setName] = useState<string | null>(() => getActiveRegister()?.name ?? null);
  const [needsChoice, setNeedsChoice] = useState(false);

  const enabled = !flagsLoading && isEnabled("cash_register");

  useEffect(() => {
    if (!enabled || !user?.storeId) return;

    // Already configured — nothing to look up.
    if (getActiveRegister()) return;

    // Nothing selected. Ask once what registers exist so a single-register
    // store can be configured silently.
    if (!connectivity.isOnline) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cash-registers", { headers: buildAuthHeaders(user) });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const registers = data.registers || [];
        const selected = reconcileActiveRegister(registers);
        if (cancelled) return;

        if (selected) {
          setName(selected.name);
        } else if (registers.length > 1) {
          // Genuinely ambiguous — only a person standing at the till knows
          // which drawer this is. Say so rather than guessing.
          setNeedsChoice(true);
        }
      } catch {
        // Silent. The till keeps selling either way.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  if (!enabled) return null;

  if (needsChoice) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        No register selected — pick one on the Cash page
      </span>
    );
  }

  if (!name) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
      <Monitor className="h-3.5 w-3.5" />
      {name}
    </span>
  );
}
