"use client";

// =============================================
// The three cash dialogs: open, close, adjust
//
// Grouped in one file because they share the amount-entry pattern and are
// always mounted together by the cash page. Each is a controlled component —
// the page owns the state so it can hold the service-worker reload guard while
// any of them is open. A counted-cash figure exists nowhere but this form until
// it is submitted, and a reload mid-count throws away a physical count.
// =============================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, TrendingDown, TrendingUp, Plus } from "lucide-react";
import { formatLL } from "@/lib/utils/format";
import { combineCurrencyTotals } from "@/lib/cashShift";
import type { CashRegister, ShiftSummary } from "@/lib/cash/types";

const num = (v: string) => parseFloat(v) || 0;

// ── Open shift ───────────────────────────────────────────────────────────────

export interface OpenShiftValues {
  registerId: string;
  newRegisterName: string;
  label: string;
  openingLl: string;
  openingUsd: string;
}

export function OpenShiftDialog({
  open,
  onOpenChange,
  registers,
  blockedRegisterIds,
  values,
  onChange,
  onSubmit,
  isSubmitting,
  canCreateRegister,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  registers: CashRegister[];
  /** Registers with an uncounted shift — cannot take a new one. */
  blockedRegisterIds: Set<string>;
  values: OpenShiftValues;
  onChange: (v: OpenShiftValues) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  canCreateRegister: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const set = (patch: Partial<OpenShiftValues>) => onChange({ ...values, ...patch });

  const available = registers.filter((r) => !blockedRegisterIds.has(r.id));
  const total = combineCurrencyTotals(num(values.openingLl), num(values.openingUsd));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open a shift</DialogTitle>
          <DialogDescription>
            Choose the drawer and count the float going into it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Which register ──────────────────────────────────────────── */}
          {!creating ? (
            <div className="space-y-2">
              <Label>Register</Label>
              {available.length === 0 ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  Every register already has an open shift. Count and close one first, or add
                  another register.
                </p>
              ) : (
                <div className="grid gap-1.5">
                  {available.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      data-log="open-shift-register"
                      onClick={() => set({ registerId: r.id, newRegisterName: "" })}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        values.registerId === r.id
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}

              {canCreateRegister && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setCreating(true);
                    set({ registerId: "" });
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add a new register
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="new-register-name">New register name</Label>
              <Input
                id="new-register-name"
                value={values.newRegisterName}
                onChange={(e) => set({ newRegisterName: e.target.value })}
                placeholder="e.g. Front Counter"
                maxLength={40}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The name stays with the drawer — you will not have to type it again tomorrow.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreating(false);
                  set({ newRegisterName: "" });
                }}
              >
                Choose an existing register instead
              </Button>
            </div>
          )}

          {/* ── Float ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="opening-ll">Opening float (LL)</Label>
              <Input
                id="opening-ll"
                type="number"
                inputMode="numeric"
                value={values.openingLl}
                onChange={(e) => set({ openingLl: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-usd">Opening float (USD)</Label>
              <Input
                id="opening-usd"
                type="number"
                inputMode="decimal"
                value={values.openingUsd}
                onChange={(e) => set({ openingUsd: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shift-label">Shift note (optional)</Label>
            <Input
              id="shift-label"
              value={values.label}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="e.g. Morning — Ali"
              maxLength={60}
            />
          </div>

          {total > 0 && (
            <div className="flex justify-between rounded-lg bg-muted/50 p-2 text-sm">
              <span>Total float</span>
              <span className="tnum font-bold">{formatLL(total)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Open shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Close shift ──────────────────────────────────────────────────────────────

export interface CloseShiftValues {
  closingLl: string;
  closingUsd: string;
  notes: string;
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  registerName,
  summary,
  values,
  onChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  registerName: string;
  summary: ShiftSummary | null;
  values: CloseShiftValues;
  onChange: (v: CloseShiftValues) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const set = (patch: Partial<CloseShiftValues>) => onChange({ ...values, ...patch });

  const counted = combineCurrencyTotals(num(values.closingLl), num(values.closingUsd));
  const expected = summary?.expectedTotal ?? 0;
  const entered = values.closingLl !== "" || values.closingUsd !== "";
  const variance = entered ? counted - expected : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Count &amp; close {registerName}</DialogTitle>
          <DialogDescription>
            Count the physical money in the drawer and enter what is actually there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {summary && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm font-medium">
                Expected: <span className="tnum">{formatLL(expected)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Float {formatLL(summary.openingTotal)} + sales {formatLL(summary.cashReceived)}
                {summary.adjustmentsIn > 0 && ` + in ${formatLL(summary.adjustmentsIn)}`}
                {summary.adjustmentsOut > 0 && ` − out ${formatLL(summary.adjustmentsOut)}`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="closing-ll">Counted (LL)</Label>
              <Input
                id="closing-ll"
                type="number"
                inputMode="numeric"
                value={values.closingLl}
                onChange={(e) => set({ closingLl: e.target.value })}
                placeholder="0"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closing-usd">Counted (USD)</Label>
              <Input
                id="closing-usd"
                type="number"
                inputMode="decimal"
                value={values.closingUsd}
                onChange={(e) => set({ closingUsd: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          {/* The variance is shown BEFORE submitting, so a miscount is caught
              while the drawer is still open and the money still countable. */}
          {variance !== null && (
            <div
              className={`rounded-lg p-3 ${
                variance === 0
                  ? "bg-muted/50"
                  : variance > 0
                    ? "bg-emerald-500/10"
                    : "bg-destructive/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {variance === 0 ? "Balanced" : variance > 0 ? "Over by" : "Short by"}
                </span>
                <span
                  className={`tnum font-bold ${
                    variance === 0
                      ? "text-foreground"
                      : variance > 0
                        ? "text-emerald-500"
                        : "text-destructive"
                  }`}
                >
                  {formatLL(Math.abs(variance))}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="closing-notes">Notes (optional)</Label>
            <Input
              id="closing-notes"
              value={values.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="e.g. drawer was short $1"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Close shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Adjustment ───────────────────────────────────────────────────────────────

export interface AdjustmentValues {
  type: "cash_in" | "cash_out";
  amountLl: string;
  amountUsd: string;
  reason: string;
}

export function AdjustmentDialog({
  open,
  onOpenChange,
  registerName,
  values,
  onChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  registerName: string;
  values: AdjustmentValues;
  onChange: (v: AdjustmentValues) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const set = (patch: Partial<AdjustmentValues>) => onChange({ ...values, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cash in / out — {registerName}</DialogTitle>
          <DialogDescription>
            Record money added to or taken from the drawer outside of a sale.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Button
              variant={values.type === "cash_in" ? "default" : "outline"}
              className="flex-1"
              onClick={() => set({ type: "cash_in" })}
            >
              <TrendingUp className="mr-1.5 h-4 w-4" /> Cash in
            </Button>
            <Button
              variant={values.type === "cash_out" ? "default" : "outline"}
              className="flex-1"
              onClick={() => set({ type: "cash_out" })}
            >
              <TrendingDown className="mr-1.5 h-4 w-4" /> Cash out
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="adj-ll">Amount (LL)</Label>
              <Input
                id="adj-ll"
                type="number"
                inputMode="numeric"
                value={values.amountLl}
                onChange={(e) => set({ amountLl: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-usd">Amount (USD)</Label>
              <Input
                id="adj-usd"
                type="number"
                inputMode="decimal"
                value={values.amountUsd}
                onChange={(e) => set({ amountUsd: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-reason">Reason (required)</Label>
            <Input
              id="adj-reason"
              value={values.reason}
              onChange={(e) => set({ reason: e.target.value })}
              placeholder="e.g. supplies purchase, cash top-up"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting}
            variant={values.type === "cash_in" ? "default" : "destructive"}
          >
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
