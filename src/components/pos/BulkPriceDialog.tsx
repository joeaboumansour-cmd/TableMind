"use client";

// =============================================
// Bulk price dialog
//
// The confirm step for a bulk profit / discount apply. It owns no data: the
// caller passes the selected products in, this renders what would happen, and
// hands a fully-resolved plan back on confirm.
//
// The preview is the point. This screen can rewrite the price of a hundred
// products at once on a live till, so the owner sees the count, the skips and
// the largest movements before anything is written.
// =============================================

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeatureFlagGuard, useFeatureFlag } from "@/lib/auth/featureGuard";
import { formatLL, formatUSD } from "@/lib/utils/format";
import {
  countSkips,
  planBulkPricing,
  topChanges,
  type BulkMode,
  type BulkPlan,
  type BulkTarget,
} from "@/lib/products/bulkPricing";

interface BulkPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected products, already filtered to what is actually editable. */
  targets: BulkTarget[];
  isOffline: boolean;
  isApplying: boolean;
  /** Request progress while applying, so a long run is legible. */
  progress: { done: number; total: number } | null;
  onApply: (plan: BulkPlan) => void;
}

/** Prices render in their own currency; percentages render as percentages. */
function formatFigure(figureMode: BulkMode, currency: "LL" | "USD", value: number): string {
  if (figureMode === "discount") return `${value}%`;
  return currency === "USD" ? formatUSD(value) : formatLL(value);
}

export default function BulkPriceDialog({
  open,
  onOpenChange,
  targets,
  isOffline,
  isApplying,
  progress,
  onApply,
}: BulkPriceDialogProps) {
  const discountEnabled = useFeatureFlag("product_discount");

  // The caller mounts this only while it is open, so both of these start fresh
  // on every open. Carrying the previous percentage over is how the wrong
  // number gets applied twice.
  const [mode, setMode] = useState<BulkMode>("profit");
  // Held as a string so a half-typed value is not normalised away mid-keystroke.
  const [rawValue, setRawValue] = useState("");

  // A store can lose the discount feature while the dialog is open. Deriving
  // the mode instead of correcting it in an effect means there is never a
  // render in which a disabled feature is the selected one.
  const effectiveMode: BulkMode = discountEnabled ? mode : "profit";

  const plan = useMemo(
    () =>
      planBulkPricing(
        targets,
        effectiveMode,
        rawValue.trim() === "" ? NaN : Number(rawValue)
      ),
    [targets, effectiveMode, rawValue]
  );

  const skips = useMemo(() => countSkips(plan), [plan]);
  const preview = useMemo(() => topChanges(plan, 3), [plan]);

  const touched = rawValue.trim() !== "";
  const canApply = plan.valid && plan.changes.length > 0 && !isOffline && !isApplying;

  return (
    <Dialog open={open} onOpenChange={(next) => !isApplying && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Bulk edit · {targets.length} product{targets.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Set the same profit or discount across everything you selected.
          </DialogDescription>
        </DialogHeader>

        {/* ---- Mode ---- */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("profit")}
            aria-pressed={effectiveMode === "profit"}
            className={cn(
              "tap h-11 flex-1 rounded-2xl text-sm font-semibold",
              effectiveMode === "profit"
                ? "bg-foreground text-background"
                : "bg-muted/60 text-muted-foreground"
            )}
          >
            Profit %
          </button>
          <FeatureFlagGuard feature="product_discount">
            <button
              type="button"
              onClick={() => setMode("discount")}
              aria-pressed={effectiveMode === "discount"}
              className={cn(
                "tap h-11 flex-1 rounded-2xl text-sm font-semibold",
                effectiveMode === "discount"
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-muted-foreground"
              )}
            >
              Discount %
            </button>
          </FeatureFlagGuard>
        </div>

        {/* ---- Value ---- */}
        <div className="space-y-1.5">
          <Label htmlFor="bulkValue">
            {effectiveMode === "profit" ? "Set profit to" : "Set discount to"}
          </Label>
          <div className="relative">
            <Input
              id="bulkValue"
              type="number"
              step="0.1"
              min="0"
              max={effectiveMode === "profit" ? 999 : 100}
              placeholder="0"
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              inputMode="decimal"
              autoFocus
              disabled={isApplying}
              className="h-14 pr-10 text-2xl font-bold tnum"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
              %
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {effectiveMode === "profit"
              ? "New selling price = cost × (1 + profit ÷ 100). Cost is left untouched."
              : "Applied automatically at the till on every one of these products."}
          </p>
        </div>

        {/* ---- What will happen ---- */}
        <div className="rounded-2xl bg-muted/40 px-4 py-3">
          {!touched ? (
            <p className="text-sm text-muted-foreground">
              Enter a percentage to preview the change.
            </p>
          ) : plan.error ? (
            <p className="text-sm font-semibold text-destructive">{plan.error}</p>
          ) : (
            <>
              <p className="text-sm font-semibold tnum">
                {plan.changes.length} product{plan.changes.length !== 1 ? "s" : ""} will
                change
              </p>

              {(skips["no-cost"] > 0 || skips.unchanged > 0 || skips.overflow > 0) && (
                <p className="mt-1 text-xs text-muted-foreground tnum">
                  {[
                    skips["no-cost"] > 0 && `${skips["no-cost"]} skipped — no cost price`,
                    skips.overflow > 0 && `${skips.overflow} skipped — price too large`,
                    skips.unchanged > 0 && `${skips.unchanged} already at ${plan.value}%`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              {preview.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
                  {preview.map((change) => (
                    <li key={change.id} className="flex items-center gap-2 text-xs tnum">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {change.name}
                      </span>
                      <span className="flex-none text-muted-foreground line-through">
                        {formatFigure(effectiveMode, change.currency, change.before)}
                      </span>
                      <ArrowRight className="h-3 w-3 flex-none text-muted-foreground" />
                      <span className="flex-none font-bold">
                        {formatFigure(effectiveMode, change.currency, change.after)}
                      </span>
                    </li>
                  ))}
                  {plan.changes.length > preview.length && (
                    <li className="pt-0.5 text-[11px] text-muted-foreground tnum">
                      + {plan.changes.length - preview.length} more
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>

        {isOffline && (
          <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
            <WifiOff className="mt-0.5 h-4 w-4 flex-none text-primary" />
            <p className="text-xs text-muted-foreground">
              You&rsquo;re offline. Bulk changes need a connection — your selection is kept.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            className="w-full rounded-2xl"
            disabled={!canApply}
            onClick={() => onApply(plan)}
          >
            {isApplying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress ? `Applying ${progress.done}/${progress.total}` : "Applying…"}
              </>
            ) : (
              `Apply to ${plan.changes.length} product${plan.changes.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
