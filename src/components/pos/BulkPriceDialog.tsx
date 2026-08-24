"use client";

// =============================================
// Bulk price dialog
//
// The confirm step for a bulk profit / discount / currency apply. It owns no
// data: the caller passes the selected products in, this renders what would
// happen, and hands a fully-resolved plan back on confirm.
//
// The preview is the point. This screen can rewrite the price of a hundred
// products at once on a live till, so the owner sees the count, the skips and
// the largest movements before anything is written.
// =============================================

import { useEffect, useMemo, useState } from "react";
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
import { SELL_RATE, formatLL, formatUSD } from "@/lib/utils/format";
import {
  countSkips,
  planBulkPricing,
  planCurrencyConversion,
  topChanges,
  type BulkChange,
  type BulkMode,
  type BulkPlan,
  type BulkTarget,
  type CurrencyDirection,
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

/**
 * The two sides of one preview row.
 *
 * Currency mode is the only mode where they are denominated differently — the
 * whole point of the row is watching `$2.07` become `186,300 LL`.
 */
function formatChange(figureMode: BulkMode, change: BulkChange) {
  return {
    before: formatFigure(figureMode, change.currency, change.before),
    after: formatFigure(figureMode, change.toCurrency ?? change.currency, change.after),
  };
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
  // The conversion rate gets its OWN state rather than sharing `rawValue`. A
  // percentage landing in the rate field — or the reverse — is exactly the
  // "wrong number applied twice" failure the comment above guards against.
  const [rawRate, setRawRate] = useState(String(SELL_RATE));
  const [direction, setDirection] = useState<CurrencyDirection>("to-LL");

  // A store can lose the discount feature while the dialog is open. Deriving
  // the mode instead of correcting it in an effect means there is never a
  // render in which a disabled feature is the selected one. Currency mode is
  // ungated, so it passes through.
  const effectiveMode: BulkMode =
    mode === "discount" && !discountEnabled ? "profit" : mode;

  const targetCurrency: "LL" | "USD" = direction === "to-LL" ? "LL" : "USD";

  const plan = useMemo(
    () =>
      effectiveMode === "currency"
        ? planCurrencyConversion(
            targets,
            direction,
            rawRate.trim() === "" ? NaN : Number(rawRate)
          )
        : planBulkPricing(
            targets,
            effectiveMode,
            rawValue.trim() === "" ? NaN : Number(rawValue)
          ),
    [targets, effectiveMode, rawValue, rawRate, direction]
  );

  const skips = useMemo(() => countSkips(plan), [plan]);
  const preview = useMemo(() => topChanges(plan, 3), [plan]);

  const touched =
    effectiveMode === "currency" ? rawRate.trim() !== "" : rawValue.trim() !== "";
  const canApply = plan.valid && plan.changes.length > 0 && !isOffline && !isApplying;

  return (
    <Dialog open={open} onOpenChange={(next) => !isApplying && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Bulk edit · {targets.length} product{targets.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Set the same profit or discount across everything you selected, or
            move it all to the other currency.
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
          <button
            type="button"
            onClick={() => setMode("currency")}
            aria-pressed={effectiveMode === "currency"}
            className={cn(
              "tap h-11 flex-1 rounded-2xl text-sm font-semibold",
              effectiveMode === "currency"
                ? "bg-foreground text-background"
                : "bg-muted/60 text-muted-foreground"
            )}
          >
            Currency
          </button>
        </div>

        {effectiveMode === "currency" ? (
          <>
            {/* ---- Direction ---- */}
            <div className="space-y-1.5">
              <Label>Convert to</Label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
                {(["to-LL", "to-USD"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDirection(option)}
                    aria-pressed={direction === option}
                    disabled={isApplying}
                    className={cn(
                      "tap h-10 rounded-lg text-sm font-semibold",
                      direction === option
                        ? "bg-background text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {option === "to-LL" ? "LL" : "USD"}
                  </button>
                ))}
              </div>
            </div>

            {/* ---- Rate ---- */}
            <div className="space-y-1.5">
              <Label htmlFor="bulkRate">Rate</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                  $1 =
                </span>
                <Input
                  id="bulkRate"
                  type="number"
                  step="1000"
                  min={1}
                  placeholder={String(SELL_RATE)}
                  value={rawRate}
                  onChange={(e) => setRawRate(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  disabled={isApplying}
                  className="h-14 pl-[4.5rem] pr-12 text-2xl font-bold tnum"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                  LL
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cost and selling price are both converted, so profit % stays the
                same. Prices are stored exactly — the 5,000 LL rounding still
                happens on the till total.
              </p>
              {/* This mode rewrites every price in the selection from a number
                  typed by hand, and unlike a percentage there is no eyeballing
                  the right answer. The preview below is the guard — say so. */}
              <p className="text-xs font-semibold text-muted-foreground">
                There is no undo. Check the preview before applying.
              </p>
            </div>
          </>
        ) : (
          /* ---- Value ---- */
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
        )}

        {/* ---- What will happen ---- */}
        <div className="rounded-2xl bg-muted/40 px-4 py-3">
          {!touched ? (
            <p className="text-sm text-muted-foreground">
              {effectiveMode === "currency"
                ? "Enter a rate to preview the conversion."
                : "Enter a percentage to preview the change."}
            </p>
          ) : plan.error ? (
            <p className="text-sm font-semibold text-destructive">{plan.error}</p>
          ) : (
            <>
              <p className="text-sm font-semibold tnum">
                {plan.changes.length} product{plan.changes.length !== 1 ? "s" : ""} will
                change
              </p>

              {plan.skipped.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground tnum">
                  {[
                    skips["no-cost"] > 0 && `${skips["no-cost"]} skipped — no cost price`,
                    skips.overflow > 0 && `${skips.overflow} skipped — price too large`,
                    skips["rounds-to-zero"] > 0 &&
                      `${skips["rounds-to-zero"]} skipped — price would round to 0`,
                    skips["already-target"] > 0 &&
                      `${skips["already-target"]} already in ${targetCurrency}`,
                    skips.unchanged > 0 && `${skips.unchanged} already at ${plan.value}%`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              {preview.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
                  {preview.map((change) => {
                    const figures = formatChange(effectiveMode, change);
                    return (
                      <li key={change.id} className="flex items-center gap-2 text-xs tnum">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {change.name}
                        </span>
                        <span className="flex-none text-muted-foreground line-through">
                          {figures.before}
                        </span>
                        <ArrowRight className="h-3 w-3 flex-none text-muted-foreground" />
                        <span className="flex-none font-bold">{figures.after}</span>
                      </li>
                    );
                  })}
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
            ) : effectiveMode === "currency" ? (
              `Convert ${plan.changes.length} product${plan.changes.length !== 1 ? "s" : ""} to ${targetCurrency}`
            ) : (
              `Apply to ${plan.changes.length} product${plan.changes.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
