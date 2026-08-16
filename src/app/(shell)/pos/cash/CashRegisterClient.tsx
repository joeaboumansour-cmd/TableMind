"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Banknote,
  Check,
  Loader2,
  Lock,
  TrendingDown,
  TrendingUp,
  Scale,
  CalendarDays,
  Users,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { formatLL, formatUSD, formatDateTime } from "@/lib/utils/format";
import { combineCurrencyTotals, computeExpectedDrawer, computeVariance } from "@/lib/cashShift";
import { connectivity } from "@/lib/connectivity";

// ── Types ────────────────────────────────────────────────────────────────────
interface CashShift {
  id: string;
  store_id: string;
  business_date: string;
  status: "open" | "closed";
  opened_by: string | null;
  opened_by_name: string;
  opened_at: string;
  opening_ll: number;
  opening_usd: number;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  closing_ll: number | null;
  closing_usd: number | null;
  verified: boolean;
  notes: string | null;
}

interface CashAdjustment {
  id: string;
  shift_id: string;
  adjustment_type: "cash_in" | "cash_out";
  amount_ll: number;
  amount_usd: number;
  reason: string;
  created_by_name: string;
  created_at: string;
}

interface PerUserSummary {
  name: string;
  count: number;
  total: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build auth header payload with user info for API calls
function buildAuthHeaders(currentUser: any): Record<string, string> {
  const authData = localStorage.getItem("goldensquirrel_auth") || "{}";
  let storeId = "";
  try {
    storeId = JSON.parse(authData)?.store_id || "";
  } catch {}
  if (currentUser?.storeId) storeId = currentUser.storeId;

  const headerPayload: any = { store_id: storeId };
  if (currentUser?.id && !currentUser?.isOwner) headerPayload.user_id = currentUser.id;

  return {
    "Content-Type": "application/json",
    "x-auth-data": JSON.stringify(headerPayload),
  };
}

// ── Page component ──────────────────────────────────────────────────────────
export function CashRegisterPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, canAccess } = useAuth();
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();

  const [isLoading, setIsLoading] = useState(true);
  const [shift, setShift] = useState<CashShift | null>(null);
  const [adjustments, setAdjustments] = useState<CashAdjustment[]>([]);
  const [perUser, setPerUser] = useState<PerUserSummary[]>([]);
  const [businessDate, setBusinessDate] = useState(() => toDateString(new Date()));

  // Open shift dialog state
  const [isOpenDialogOpen, setIsOpenDialogOpen] = useState(false);
  const [openingLl, setOpeningLl] = useState("");
  const [openingUsd, setOpeningUsd] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  // Close shift dialog state
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closingLl, setClosingLl] = useState("");
  const [closingUsd, setClosingUsd] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  // Adjustment dialog state
  const [isAdjDialogOpen, setIsAdjDialogOpen] = useState(false);
  const [adjType, setAdjType] = useState<"cash_in" | "cash_out">("cash_in");
  const [adjLl, setAdjLl] = useState("");
  const [adjUsd, setAdjUsd] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [isAddingAdj, setIsAddingAdj] = useState(false);

  // Compute expected totals
  const openingTotal = combineCurrencyTotals(shift?.opening_ll || 0, shift?.opening_usd || 0);
  const closingTotal = shift?.closing_ll != null ? combineCurrencyTotals(shift.closing_ll, shift.closing_usd || 0) : null;
  const adjInTotal = combineCurrencyTotals(
    adjustments.filter(a => a.adjustment_type === "cash_in").reduce((s, a) => s + a.amount_ll, 0),
    adjustments.filter(a => a.adjustment_type === "cash_in").reduce((s, a) => s + a.amount_usd, 0)
  );
  const adjOutTotal = combineCurrencyTotals(
    adjustments.filter(a => a.adjustment_type === "cash_out").reduce((s, a) => s + a.amount_ll, 0),
    adjustments.filter(a => a.adjustment_type === "cash_out").reduce((s, a) => s + a.amount_usd, 0)
  );

  // Daily cash received from sales — perUser totals are already in LL-equivalent
  // (Σ of each transaction's amount_paid, which itself blends LL + USD).
  const cashReceived = perUser.reduce((s, u) => s + u.total, 0);
  const changeOut = 0; // change is already netted into amount_paid per transaction

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user?.storeId) return;
    if (!connectivity.isOnline) {
      setIsLoading(false);
      toast.info("Offline mode — shift data may be stale");
      return;
    }

    try {
      const headers = buildAuthHeaders(user);
      const res = await fetch(`/api/cash-shifts?date=${businessDate}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load");
      }
      const data = await res.json();
      setShift(data.shift);
      setAdjustments(data.adjustments || []);
      setPerUser(data.perUser || []);
    } catch (error: any) {
      console.error("Cash register load error:", error);
      toast.error(error.message || "Failed to load cash register data");
    } finally {
      setIsLoading(false);
    }
  }, [user, businessDate]);

  useEffect(() => {
    if (user?.storeId) loadData();
  }, [user, loadData]);

  // Feature flag + permission guard
  // Only redirect after both auth AND feature flags have finished loading.
  // Otherwise isEnabled() returns false during initial load and causes a false redirect.
  useEffect(() => {
    if (!authLoading && user && !flagsLoading) {
      if (!isEnabled("cash_register")) {
        toast.error("Cash Register is not enabled for this store");
        router.replace("/pos");
        return;
      }
      if (!canAccess("cash_register")) {
        toast.error("You don't have access to the Cash Register");
        router.replace("/pos");
        return;
      }
    }
  }, [authLoading, user, flagsLoading, isEnabled, canAccess, router]);

  const canEdit = user?.isOwner || (user?.permissions.cash_register === true);

  // ── Open shift ─────────────────────────────────────────────────────────────
  const handleOpenShift = async () => {
    const ll = parseFloat(openingLl) || 0;
    const usd = parseFloat(openingUsd) || 0;
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter the opening float amount");
      return;
    }

    setIsOpening(true);
    try {
      const headers = buildAuthHeaders(user);
      if (!connectivity.isOnline) {
        const { queueCashShiftOpen } = await import("@/lib/db/localDB");
        await queueCashShiftOpen({
          store_id: user!.storeId,
          business_date: businessDate,
          opening_ll: ll,
          opening_usd: usd,
          user_id: user!.isOwner ? undefined : user!.id,
          user_name: user!.displayName || user!.username,
        });
        toast.info("Shift opening queued — will sync when online");
      } else {
        const res = await fetch("/api/cash-shifts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "open",
            business_date: businessDate,
            opening_ll: ll,
            opening_usd: usd,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to open shift");
        }
        toast.success("Shift opened successfully!");
      }
      setIsOpenDialogOpen(false);
      setOpeningLl("");
      setOpeningUsd("");
      loadData();
    } catch (error: any) {
      toast.error(error.message || "Failed to open shift");
    } finally {
      setIsOpening(false);
    }
  };

  // ── Close shift ────────────────────────────────────────────────────────────
  const handleCloseShift = async () => {
    const ll = parseFloat(closingLl) || 0;
    const usd = parseFloat(closingUsd) || 0;
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter the counted closing amount");
      return;
    }
    if (!shift?.id) return;

    setIsClosing(true);
    try {
      const headers = buildAuthHeaders(user);
      if (!connectivity.isOnline) {
        const { queueCashShiftClose } = await import("@/lib/db/localDB");
        await queueCashShiftClose({
          shift_id: shift.id,
          store_id: user!.storeId,
          closing_ll: ll,
          closing_usd: usd,
          notes: closingNotes || undefined,
          user_id: user!.isOwner ? undefined : user!.id,
          user_name: user!.displayName || user!.username,
        });
        toast.info("Shift closing queued — will sync when online");
      } else {
        const res = await fetch("/api/cash-shifts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "close",
            shift_id: shift.id,
            closing_ll: ll,
            closing_usd: usd,
            notes: closingNotes || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to close shift");
        }
        toast.success("Shift closed successfully!");
      }
      setIsCloseDialogOpen(false);
      setClosingLl("");
      setClosingUsd("");
      setClosingNotes("");
      loadData();
    } catch (error: any) {
      toast.error(error.message || "Failed to close shift");
    } finally {
      setIsClosing(false);
    }
  };

  // ── Adjustment ─────────────────────────────────────────────────────────────
  const handleAddAdjustment = async () => {
    const ll = parseFloat(adjLl) || 0;
    const usd = parseFloat(adjUsd) || 0;
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter an amount");
      return;
    }
    if (!adjReason.trim()) {
      toast.error("A reason is required");
      return;
    }
    if (!user?.isOwner) {
      toast.error("Only the store owner can record adjustments");
      return;
    }
    if (!shift?.id) return;

    setIsAddingAdj(true);
    try {
      const headers = buildAuthHeaders(user);
      if (!connectivity.isOnline) {
        const { queueCashAdjustment } = await import("@/lib/db/localDB");
        await queueCashAdjustment({
          store_id: user.storeId,
          shift_id: shift.id,
          adjustment_type: adjType,
          amount_ll: ll,
          amount_usd: usd,
          reason: adjReason.trim(),
        });
        toast.info("Adjustment queued — will sync when online");
      } else {
        const res = await fetch("/api/cash-adjustments", {
          method: "POST",
          headers,
          body: JSON.stringify({
            shift_id: shift.id,
            adjustment_type: adjType,
            amount_ll: ll,
            amount_usd: usd,
            reason: adjReason.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to add adjustment");
        }
        toast.success("Adjustment recorded");
      }
      setIsAdjDialogOpen(false);
      setAdjLl("");
      setAdjUsd("");
      setAdjReason("");
      loadData();
    } catch (error: any) {
      toast.error(error.message || "Failed to add adjustment");
    } finally {
      setIsAddingAdj(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const expectedTotal = computeExpectedDrawer({
    openingTotal,
    cashInTotal: cashReceived,
    changeOutTotal: changeOut,
    adjustmentsIn: adjInTotal,
    adjustmentsOut: adjOutTotal,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const variance = computeVariance(closingTotal, expectedTotal);

  return (
    // h-full + an internal scroller, not min-h-dvh: this screen sits inside the
    // app shell, which is exactly the viewport minus the tab bar and clips its
    // child. A min-h-dvh child was taller than that box and simply had its
    // bottom cut off with no way to reach it.
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="safe-top flex-shrink-0 border-b bg-background">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-amber-500" />
              <h1 className="font-bold text-lg">Cash Register</h1>
            </div>
            {shift && (
              <Badge variant={shift.status === "open" ? "default" : "secondary"} className={shift.status === "open" ? "bg-green-500" : ""}>
                {shift.status === "open" ? "Open" : "Closed"}
              </Badge>
            )}
            {shift && !shift.verified && (
              <Badge variant="destructive">Requires Owner Verification</Badge>
            )}
            {!canEdit && <Badge variant="outline"><Lock className="h-3 w-3 mr-1" /> Read Only</Badge>}
          </div>
        </div>
      </header>

      <div className="no-scrollbar container mx-auto min-h-0 flex-1 max-w-3xl space-y-4 overflow-y-auto px-4 py-6">
        {/* Date display */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          Business date: <span className="font-medium">{businessDate}</span>
        </div>

        {!shift ? (
          /* ── No shift yet / need to open ── */
          <Card>
            <CardHeader>
              <CardTitle>No Shift Open</CardTitle>
              <CardDescription>
                Open today's cash register to record the starting float.
              </CardDescription>
            </CardHeader>
            {canEdit ? (
              <CardContent>
                <Button onClick={() => setIsOpenDialogOpen(true)}>
                  <Banknote className="h-4 w-4 mr-2" />
                  Open Shift
                </Button>
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Only the store owner or a user with Cash Register permission can open a shift.
                </p>
              </CardContent>
            )}
          </Card>
        ) : (
          <>
            {/* ── Shift summary ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Shift Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">Opened By</p>
                    <p className="font-semibold">{shift.opened_by_name || "Store Owner"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{shift.opened_at ? formatDateTime(shift.opened_at) : ""}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">Opening Float (Total)</p>
                    <p className="font-semibold text-lg">
                      {formatLL(openingTotal)}
                      {(shift.opening_usd > 0 || shift.opening_ll > 0) && (
                        <span className="text-xs text-muted-foreground block">
                          {shift.opening_ll > 0 ? `${formatLL(shift.opening_ll)} + ` : ""}
                          {shift.opening_usd > 0 ? `${formatUSD(shift.opening_usd)}` : "0"}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Per-user transaction summary */}
                <div>
                  <p className="text-sm font-medium flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4" />
                    Today's Sales by User
                  </p>
                  {perUser.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No transactions yet today.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {perUser.map((u) => (
                        <div key={u.name} className="flex justify-between text-sm">
                          <span>{u.name}</span>
                          <span className="font-medium">
                            {u.count} sale{u.count !== 1 ? "s" : ""} · {formatLL(u.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Expected drawer ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  Expected Drawer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Opening Float</span>
                  <span>{formatLL(openingTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cash Received (sales)</span>
                  <span>{formatLL(cashReceived)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Adjustments In</span>
                  <span className="text-green-600">+{formatLL(adjInTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Adjustments Out</span>
                  <span className="text-red-500">-{formatLL(adjOutTotal)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Expected End-of-Day Total</span>
                  <span className="text-lg">{formatLL(expectedTotal)}</span>
                </div>

                {variance !== null && (
                  <>
                    <Separator />
                    <div className={`p-3 rounded-lg ${variance >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <p className={`font-semibold ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {variance >= 0 ? "Overage" : "Shortage"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Counted: {formatLL(closingTotal || 0)} vs Expected: {formatLL(expectedTotal)}
                          </p>
                        </div>
                        <span className={`text-xl font-bold ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {variance >= 0 ? "+" : ""}{formatLL(variance)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Adjustments list ── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Adjustments</CardTitle>
                  {user?.isOwner && shift.status === "open" && (
                    <Button variant="outline" size="sm" onClick={() => setIsAdjDialogOpen(true)}>
                      <Banknote className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {adjustments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No adjustments recorded for this shift.</p>
                ) : (
                  <div className="space-y-2">
                    {adjustments.map((a) => (
                      <div key={a.id} className="flex justify-between items-center text-sm p-2 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-2">
                          {a.adjustment_type === "cash_in" ? (
                            <TrendingUp className="h-4 w-4 text-green-500" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium">
                              {a.adjustment_type === "cash_in" ? "Cash In" : "Cash Out"}: 
                              {" "}{formatLL(combineCurrencyTotals(a.amount_ll, a.amount_usd))}
                            </p>
                            <p className="text-xs text-muted-foreground">{a.reason} — {a.created_by_name}</p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Close shift button ── */}
            {shift.status === "open" && canEdit && (
              <Button
                variant="default"
                className="w-full h-12"
                onClick={() => setIsCloseDialogOpen(true)}
              >
                <Check className="h-5 w-5 mr-2" />
                Close Shift
              </Button>
            )}
            {shift.status === "closed" && (
              <div className="text-center text-sm text-muted-foreground">
                Shift closed by {shift.closed_by_name || "Store Owner"} on{" "}
                {shift.closed_at ? formatDateTime(shift.closed_at) : ""}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Open Shift Dialog ── */}
      <Dialog open={isOpenDialogOpen} onOpenChange={setIsOpenDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Open Cash Register</DialogTitle>
            <DialogDescription>
              Enter the starting float for {businessDate}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Opening Float (LL)</Label>
              <Input type="number" inputMode="numeric" value={openingLl} onChange={(e) => setOpeningLl(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Opening Float (USD)</Label>
              <Input type="number" inputMode="numeric" value={openingUsd} onChange={(e) => setOpeningUsd(e.target.value)} placeholder="0" />
            </div>
            {(parseFloat(openingLl) > 0 || parseFloat(openingUsd) > 0) && (
              <div className="flex justify-between text-sm p-2 bg-muted/50 rounded-lg">
                <span>Total</span>
                <span className="font-bold">{formatLL(combineCurrencyTotals(parseFloat(openingLl) || 0, parseFloat(openingUsd) || 0))}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpenDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleOpenShift} disabled={isOpening}>
              {isOpening ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Open Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Close Shift Dialog ── */}
      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close Cash Register</DialogTitle>
            <DialogDescription>
              Count the physical money in the drawer and enter the totals below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {(expectedTotal > 0) && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium">Expected total: {formatLL(expectedTotal)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Opening {formatLL(openingTotal)} + Cash received {formatLL(cashReceived)} 
                  {" "}+ In {formatLL(adjInTotal)} - Out {formatLL(adjOutTotal)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Counted Amount (LL)</Label>
              <Input type="number" inputMode="numeric" value={closingLl} onChange={(e) => setClosingLl(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Counted Amount (USD)</Label>
              <Input type="number" inputMode="numeric" value={closingUsd} onChange={(e) => setClosingUsd(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder="e.g., drawer was short $1" />
            </div>
            {(parseFloat(closingLl) > 0 || parseFloat(closingUsd) > 0) && (
              <div className="flex justify-between text-sm p-2 bg-muted/50 rounded-lg">
                <span>Counted Total</span>
                <span className="font-bold">{formatLL(combineCurrencyTotals(parseFloat(closingLl) || 0, parseFloat(closingUsd) || 0))}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloseDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCloseShift} disabled={isClosing}>
              {isClosing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Close Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Adjustment Dialog ── */}
      <Dialog open={isAdjDialogOpen} onOpenChange={setIsAdjDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Cash Adjustment</DialogTitle>
            <DialogDescription>
              Record money added to or removed from the drawer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button
                variant={adjType === "cash_in" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAdjType("cash_in")}
              >
                <TrendingUp className="h-4 w-4 mr-1" /> Cash In
              </Button>
              <Button
                variant={adjType === "cash_out" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAdjType("cash_out")}
              >
                <TrendingDown className="h-4 w-4 mr-1" /> Cash Out
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount (LL)</Label>
                <Input type="number" inputMode="numeric" value={adjLl} onChange={(e) => setAdjLl(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Amount (USD)</Label>
                <Input type="number" inputMode="numeric" value={adjUsd} onChange={(e) => setAdjUsd(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason (required)</Label>
              <Input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g., supplies purchase, cash top-up" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAdjDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAdjustment} disabled={isAddingAdj} variant={adjType === "cash_in" ? "default" : "destructive"}>
              {isAddingAdj ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}