"use client";

// =============================================
// Totals + checkout (desktop Pro till)
//
// The one number the customer asks for, at the size you can read across a
// counter, and the single action that ends the sale. There is no "Done"
// shortcut beside it any more: two ways to finish a sale meant two payment
// paths to keep correct, and only one of them calculated change.
// =============================================

import { CreditCard } from "lucide-react";
import { formatLL, formatUSD } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface ProTotalsPanelProps {
  total: number;
  totalUsd: number;
  unitCount: number;
  totalDiscount: number;
  roundingAdjustment: number;
  isEmpty: boolean;
  onCheckout: () => void;
}

export default function ProTotalsPanel({
  total,
  totalUsd,
  unitCount,
  totalDiscount,
  roundingAdjustment,
  isEmpty,
  onCheckout,
}: ProTotalsPanelProps) {
  const rounded = Math.round(roundingAdjustment);

  return (
    <div className="flex-shrink-0 px-4 pb-3 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Total
          <span className="tnum">
            {" · "}
            {unitCount} unit{unitCount !== 1 ? "s" : ""}
          </span>
          {rounded !== 0 && (
            <span className="tnum">
              {" · Rounded "}
              {rounded > 0 ? "+" : "−"}
              {Math.abs(rounded).toLocaleString("en-US")}
            </span>
          )}
        </p>
        <p className="flex-none text-sm font-semibold text-muted-foreground tnum">
          {formatUSD(totalUsd)}
        </p>
      </div>

      {totalDiscount > 0 && (
        <p className="mt-1 text-xs font-semibold text-emerald-400 tnum">
          Saved {formatLL(totalDiscount)}
        </p>
      )}

      {/* key={total} restarts the bump animation on every change, so the
          number visibly reacts when an item lands. */}
      <p
        key={total}
        className="animate-value-bump mt-1 text-[44px] font-extrabold leading-none text-primary tnum"
      >
        {Math.round(total).toLocaleString("en-US")}
        <span className="ml-2 align-baseline text-lg font-bold text-primary/60">LL</span>
      </p>

      <button
        type="button"
        onClick={onCheckout}
        disabled={isEmpty}
        className={cn(
          "tap mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-colors",
          isEmpty
            ? "cursor-not-allowed bg-muted/40 text-muted-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        <CreditCard className="h-5 w-5" />
        Checkout
        <kbd className="ml-1 rounded bg-black/15 px-1.5 py-0.5 text-[11px] font-bold">
          F4
        </kbd>
      </button>
    </div>
  );
}
