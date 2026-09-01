"use client";

// =============================================
// The one durability warning a shop cannot dismiss and forget
// =============================================
// Phase 6.1's exit criterion: "the 'at risk' state is impossible to be in
// without the shop being told."
//
// A toast could not deliver that. It was shown once per device, it could be
// swiped away, and it fired on "this app is not installed" — which is true for
// weeks before it matters and therefore trains people to ignore it.
//
// So this shows for exactly one condition: **money is on this device and the
// browser is allowed to delete it** (or the disk is nearly full, which fails
// the next sale outright). It is not dismissible, because there is nothing to
// dismiss — it disappears the moment the sales sync or the grant is given, and
// until then it is describing cash at risk.
//
// The merely-not-installed case keeps its once-per-device toast on the POS
// page. That one is advice; this one is an alarm, and mixing them is how an
// alarm stops working.
// =============================================

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { logActivity } from "@/lib/activity/logger";
import { connectivity } from "@/lib/connectivity";
import { readDurability, type Durability } from "@/lib/pwa/durability";

/** Re-checked on this cadence, and on every reconnect. */
const POLL_MS = 60_000;

export default function DurabilityBanner() {
  const [state, setState] = useState<Durability | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastReported: string | null = null;

    const check = async () => {
      const next = await readDurability();
      if (cancelled) return;
      setState(next);

      // Report to the admin trail, but only when the ANSWER changes. The till
      // re-checks every minute all day; logging that would be thousands of
      // identical rows against a 3-day retention window shared with the events
      // somebody actually reads.
      const signature = `${next.level}:${next.facts.queuedSales}`;
      if (signature !== lastReported) {
        lastReported = signature;
        logActivity("sync.durability", {
          target: next.level,
          details: {
            level: next.level,
            persisted: next.facts.persisted,
            supported: next.facts.supported,
            queued_sales: next.facts.queuedSales,
            dead_lettered: next.facts.deadLettered,
            usage_ratio: Math.round(next.facts.usageRatio * 100) / 100,
            near_full: next.facts.nearFull,
          },
        });
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    // Reconnecting is the event most likely to CLEAR this, because the queue
    // drains — so re-check then rather than leaving a stale alarm up for a
    // minute after the problem has gone.
    const unsubscribe = connectivity.subscribe(() => void check(), { replay: false });

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  if (!state?.urgent) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-2.5"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" aria-hidden />
      <p className="min-w-0 flex-1 text-xs leading-snug">
        <span className="font-bold text-foreground">{state.headline}.</span>{" "}
        <span className="text-muted-foreground">{state.detail}</span>
      </p>
    </div>
  );
}
