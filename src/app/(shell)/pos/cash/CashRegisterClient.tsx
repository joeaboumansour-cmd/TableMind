"use client";

// =============================================
// Cash register page
//
// Rewritten for multi-register (migration 027). Previously this file held the
// whole feature in 797 lines and modelled exactly one drawer per store per day,
// keyed on the calendar date. That key is what produced the midnight bug: the
// page asked for today's shift, got nothing back at 00:00, and displayed
// "No Shift Open" over a shift that was still open in the database with
// uncounted cash sitting in the drawer.
//
// Now the page asks "what is every register doing", the server answers with
// shift-scoped figures, and an uncounted shift becomes the loudest thing on the
// screen instead of disappearing. Nothing here closes a shift automatically —
// a closing figure is a physical count, and inventing one destroys the variance
// it exists to catch.
//
// This file is orchestration and data loading. The rendering lives in
// src/components/cash/.
// =============================================

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Banknote,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { formatLL } from "@/lib/utils/format";
import { summariseShift } from "@/lib/cashShift";
import { connectivity } from "@/lib/connectivity";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import { logActivity } from "@/lib/activity/logger";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import {
  getActiveRegister,
  setActiveRegister,
  reconcileActiveRegister,
} from "@/lib/cash/activeRegister";
import { isOverdue } from "@/lib/cash/types";
import type {
  CashRegister,
  CashShift,
  CashAdjustment,
  RegisterState,
  RegisterRequest,
} from "@/lib/cash/types";
import { RegisterCard } from "@/components/cash/RegisterCard";
import {
  OpenShiftDialog,
  CloseShiftDialog,
  AdjustmentDialog,
  type OpenShiftValues,
  type CloseShiftValues,
  type AdjustmentValues,
} from "@/components/cash/ShiftDialogs";
import { RequestsPanel, RequestDecisionDialog } from "@/components/cash/RequestsPanel";
import type { RegisterPerformanceRow } from "@/components/cash/RegisterPerformance";

// recharts is ~90KB. Kept out of the initial chunk — this page is reachable
// from the till and must not drag a charting library into that path.
const RegisterPerformance = dynamic(() => import("@/components/cash/RegisterPerformance"), {
  ssr: false,
  loading: () => (
    <Card>
      <CardContent className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  ),
});

/** How often the approval-request poll runs while online and visible. */
const REQUEST_POLL_MS = 10_000;

/** Per-shift sales totals as returned by GET /api/cash-shifts, keyed by shift id. */
interface ShiftTotalsRow {
  amount_paid: number;
  change_given: number;
  usd_amount_paid: number;
  txn_count: number;
}

const EMPTY_OPEN: OpenShiftValues = {
  registerId: "",
  newRegisterName: "",
  label: "",
  openingLl: "",
  openingUsd: "",
};
const EMPTY_CLOSE: CloseShiftValues = { closingLl: "", closingUsd: "", notes: "" };
const EMPTY_ADJ: AdjustmentValues = {
  type: "cash_in",
  amountLl: "",
  amountUsd: "",
  reason: "",
};

export function CashRegisterPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, canAccess } = useAuth();
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [totals, setTotals] = useState<Record<string, ShiftTotalsRow>>({});
  const [adjustments, setAdjustments] = useState<Record<string, CashAdjustment[]>>({});
  const [pendingByRegister, setPendingByRegister] = useState<Record<string, number>>({});
  const [unassigned, setUnassigned] = useState<{ count: number; total: number } | null>(null);

  const [requests, setRequests] = useState<RegisterRequest[]>([]);
  const [activeRegisterId, setActiveRegisterId] = useState<string | null>(null);

  const [performance, setPerformance] = useState<{
    registers: RegisterPerformanceRow[];
    storeRevenue: number;
    busiestRegisterId: string | null;
  } | null>(null);

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [openDialog, setOpenDialog] = useState(false);
  const [openValues, setOpenValues] = useState<OpenShiftValues>(EMPTY_OPEN);
  const [isOpening, setIsOpening] = useState(false);

  const [closeShiftId, setCloseShiftId] = useState<string | null>(null);
  const [closeValues, setCloseValues] = useState<CloseShiftValues>(EMPTY_CLOSE);
  const [isClosing, setIsClosing] = useState(false);

  const [adjShiftId, setAdjShiftId] = useState<string | null>(null);
  const [adjValues, setAdjValues] = useState<AdjustmentValues>(EMPTY_ADJ);
  const [isAdjusting, setIsAdjusting] = useState(false);

  const [decidingRequest, setDecidingRequest] = useState<RegisterRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [isDeciding, setIsDeciding] = useState(false);

  // Every counted figure on this screen is typed by hand and exists nowhere
  // else until submitted. A service-worker reload mid-count throws away a
  // physical count of a drawer, so hold the update until the form is done.
  useReloadGuard(
    openDialog ||
      closeShiftId !== null ||
      adjShiftId !== null ||
      decidingRequest !== null ||
      isOpening ||
      isClosing ||
      isAdjusting ||
      isDeciding,
    "cash-register-busy"
  );

  // ── Derived state ──────────────────────────────────────────────────────────

  const shiftByRegister = useMemo(() => {
    const map = new Map<string, CashShift>();
    for (const s of shifts) {
      const existing = map.get(s.register_id);
      // An open shift always wins over a closed one for the same register.
      if (!existing || (s.status === "open" && existing.status !== "open")) {
        map.set(s.register_id, s);
      }
    }
    return map;
  }, [shifts]);

  const registerStates: RegisterState[] = useMemo(
    () =>
      registers.map((register) => {
        const shift = shiftByRegister.get(register.id) || null;
        const shiftAdjustments = shift ? adjustments[shift.id] || [] : [];
        const t = shift ? totals[shift.id] : null;

        return {
          register,
          shift,
          adjustments: shiftAdjustments,
          pendingRequestCount: pendingByRegister[register.id] || 0,
          summary: shift
            ? summariseShift(shift, shiftAdjustments, {
                amountPaid: Number(t?.amount_paid) || 0,
                changeGiven: Number(t?.change_given) || 0,
                usdAmountPaid: Number(t?.usd_amount_paid) || 0,
                count: Number(t?.txn_count) || 0,
              })
            : null,
        };
      }),
    [registers, shiftByRegister, adjustments, totals, pendingByRegister]
  );

  const overdueStates = registerStates.filter((s) => isOverdue(s.shift));
  const openStates = registerStates.filter((s) => s.shift?.status === "open");
  const totalExpected = openStates.reduce((sum, s) => sum + (s.summary?.expectedTotal || 0), 0);

  /** Registers that cannot take a new shift because one is already open. */
  const blockedRegisterIds = useMemo(
    () => new Set(openStates.map((s) => s.register.id)),
    [openStates]
  );

  const canEdit = !!(user?.isOwner || user?.permissions?.cash_register === true);

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user?.storeId) return;

      if (!connectivity.isOnline) {
        setIsOnline(false);
        setIsLoading(false);
        return;
      }
      setIsOnline(true);

      if (!opts?.silent) setIsRefreshing(true);
      try {
        const headers = buildAuthHeaders(user);
        const res = await fetch("/api/cash-shifts", { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to load");
        }
        const data = await res.json();

        setRegisters(data.registers || []);
        setShifts(data.shifts || []);
        setTotals(data.totals || {});
        setAdjustments(data.adjustments || {});
        setPendingByRegister(data.pendingByRegister || {});
        setUnassigned(data.unassigned || null);

        // Keep this device's selection honest, and auto-select when the store
        // has exactly one register so single-drawer shops never see a picker.
        const selected = reconcileActiveRegister(data.registers || []);
        setActiveRegisterId(selected?.id ?? null);
      } catch (error) {
        console.error("Cash register load error:", error);
        if (!opts?.silent) toast.error(errorMessage(error, "Failed to load cash registers"));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user]
  );

  const loadPerformance = useCallback(async () => {
    if (!user?.storeId || !connectivity.isOnline) return;
    try {
      const headers = buildAuthHeaders(user);
      // Last 30 days: enough to see a pattern, well inside the route's cap.
      const to = new Date();
      const from = new Date(to.getTime() - 29 * 86_400_000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const res = await fetch(
        `/api/cash-registers/analytics?from=${iso(from)}&to=${iso(to)}`,
        { headers }
      );
      if (!res.ok) return; // performance is supplementary — never block the page
      const data = await res.json();
      setPerformance({
        registers: data.registers || [],
        storeRevenue: data.storeRevenue || 0,
        busiestRegisterId: data.busiestRegisterId ?? null,
      });
    } catch {
      // Silent: a missing chart must not obscure the drawer figures.
    }
  }, [user]);

  const loadRequests = useCallback(async () => {
    if (!user?.storeId || !connectivity.isOnline) return;
    try {
      const headers = buildAuthHeaders(user);
      const res = await fetch("/api/register-requests?status=pending", { headers });
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.requests || []);
    } catch {
      // Silent: the poll retries on its own interval.
    }
  }, [user]);

  useEffect(() => {
    if (user?.storeId) {
      setActiveRegisterId(getActiveRegister()?.id ?? null);
      loadData();
      loadPerformance();
      loadRequests();
    }
  }, [user, loadData, loadPerformance, loadRequests]);

  // ── Approval-request poll ──────────────────────────────────────────────────
  // Plain polling. There is no Supabase realtime anywhere in this app and this
  // is not the place to introduce it. Paused while the tab is hidden so a
  // backgrounded till does not keep hitting the API.
  const requestsRef = useRef(loadRequests);
  requestsRef.current = loadRequests;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible" && connectivity.isOnline) {
          requestsRef.current();
        }
      }, REQUEST_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        requestsRef.current();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ── Guards ─────────────────────────────────────────────────────────────────
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
      }
    }
  }, [authLoading, user, flagsLoading, isEnabled, canAccess, router]);

  // Record that somebody was shown the "this drawer still needs counting"
  // state, so the admin trail can tell an unnoticed overdue shift from an
  // ignored one. Fires once per register per page load.
  const seenOverdue = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of overdueStates) {
      if (seenOverdue.current.has(s.register.id)) continue;
      seenOverdue.current.add(s.register.id);
      logActivity("cash.shift_overdue_seen", {
        target: s.register.name,
        details: { shift_id: s.shift!.id, business_date: s.shift!.business_date },
      });
    }
  }, [overdueStates]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleOpenShift = async () => {
    const ll = parseFloat(openValues.openingLl) || 0;
    const usd = parseFloat(openValues.openingUsd) || 0;

    if (!openValues.registerId && !openValues.newRegisterName.trim()) {
      toast.error("Choose a register, or name a new one");
      return;
    }
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter the opening float");
      return;
    }
    if (!connectivity.isOnline && !openValues.registerId) {
      toast.error("Creating a register needs a connection. Pick an existing one.");
      return;
    }

    setIsOpening(true);
    try {
      const headers = buildAuthHeaders(user);
      let registerId = openValues.registerId;

      // A brand-new register is created first, online only: two offline devices
      // both inventing "Front Counter" would produce two drawers to merge later.
      if (!registerId) {
        const res = await fetch("/api/cash-registers", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: openValues.newRegisterName.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to create register");
        registerId = data.register.id;
        logActivity("cash.register_create", { target: data.register.name });
      }

      logActivity("cash.shift_open", {
        target: registerId,
        details: { opening_ll: ll, opening_usd: usd, online: connectivity.isOnline },
      });

      if (!connectivity.isOnline) {
        const { queueCashShiftOpen } = await import("@/lib/db/localDB");
        await queueCashShiftOpen({
          store_id: user!.storeId,
          register_id: registerId!,
          label: openValues.label.trim() || undefined,
          business_date: new Date().toISOString().slice(0, 10),
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
            register_id: registerId,
            label: openValues.label.trim() || undefined,
            opening_ll: ll,
            opening_usd: usd,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to open shift");
        toast.success("Shift opened");
      }

      setOpenDialog(false);
      setOpenValues(EMPTY_OPEN);
      loadData();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to open shift"));
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async () => {
    const ll = parseFloat(closeValues.closingLl) || 0;
    const usd = parseFloat(closeValues.closingUsd) || 0;
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter the counted amount");
      return;
    }
    if (!closeShiftId) return;

    setIsClosing(true);
    logActivity("cash.shift_close", {
      target: closeShiftId,
      details: {
        closing_ll: ll,
        closing_usd: usd,
        has_notes: closeValues.notes.trim().length > 0,
        online: connectivity.isOnline,
      },
    });
    try {
      const headers = buildAuthHeaders(user);
      if (!connectivity.isOnline) {
        const { queueCashShiftClose } = await import("@/lib/db/localDB");
        await queueCashShiftClose({
          shift_id: closeShiftId,
          store_id: user!.storeId,
          closing_ll: ll,
          closing_usd: usd,
          notes: closeValues.notes || undefined,
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
            shift_id: closeShiftId,
            closing_ll: ll,
            closing_usd: usd,
            notes: closeValues.notes || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to close shift");
        toast.success("Shift closed");
      }
      setCloseShiftId(null);
      setCloseValues(EMPTY_CLOSE);
      loadData();
      loadPerformance();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to close shift"));
    } finally {
      setIsClosing(false);
    }
  };

  const handleAddAdjustment = async () => {
    const ll = parseFloat(adjValues.amountLl) || 0;
    const usd = parseFloat(adjValues.amountUsd) || 0;
    if (ll <= 0 && usd <= 0) {
      toast.error("Enter an amount");
      return;
    }
    if (!adjValues.reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    if (!user?.isOwner) {
      toast.error("Only the store owner can record adjustments");
      logActivity("auth.permission_denied", {
        target: "record cash adjustment",
        details: { permission: "owner" },
      });
      return;
    }
    if (!adjShiftId) return;

    setIsAdjusting(true);
    logActivity("cash.adjustment", {
      target: adjValues.type,
      details: {
        shift_id: adjShiftId,
        amount_ll: ll,
        amount_usd: usd,
        reason: adjValues.reason.trim(),
        online: connectivity.isOnline,
      },
    });
    try {
      const headers = buildAuthHeaders(user);
      if (!connectivity.isOnline) {
        const { queueCashAdjustment } = await import("@/lib/db/localDB");
        await queueCashAdjustment({
          store_id: user.storeId,
          shift_id: adjShiftId,
          adjustment_type: adjValues.type,
          amount_ll: ll,
          amount_usd: usd,
          reason: adjValues.reason.trim(),
        });
        toast.info("Adjustment queued — will sync when online");
      } else {
        const res = await fetch("/api/cash-adjustments", {
          method: "POST",
          headers,
          body: JSON.stringify({
            shift_id: adjShiftId,
            adjustment_type: adjValues.type,
            amount_ll: ll,
            amount_usd: usd,
            reason: adjValues.reason.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to add adjustment");
        toast.success("Adjustment recorded");
      }
      setAdjShiftId(null);
      setAdjValues(EMPTY_ADJ);
      loadData();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add adjustment"));
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleDecide = async (decision: "approved" | "rejected") => {
    if (!decidingRequest) return;
    if (!connectivity.isOnline) {
      toast.error("Deciding a request needs a connection");
      return;
    }

    setIsDeciding(true);
    try {
      const headers = buildAuthHeaders(user);
      const res = await fetch("/api/register-requests", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          request_id: decidingRequest.id,
          decision,
          note: decisionNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to record the decision");

      logActivity(decision === "approved" ? "cash.request_approve" : "cash.request_reject", {
        target: decidingRequest.kind,
        details: {
          request_id: decidingRequest.id,
          register_id: decidingRequest.register_id,
          requested_by: decidingRequest.requested_by_name,
        },
      });

      toast.success(decision === "approved" ? "Approved" : "Rejected");
      setDecidingRequest(null);
      setDecisionNote("");
      loadRequests();
      loadData();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to record the decision"));
    } finally {
      setIsDeciding(false);
    }
  };

  const handleUseOnThisDevice = (register: CashRegister) => {
    setActiveRegister({ id: register.id, name: register.name });
    setActiveRegisterId(register.id);
    logActivity("cash.register_select", { target: register.name });
    toast.success(`This device now rings into ${register.name}`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="safe-top flex-shrink-0 border-b bg-background">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/pos")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold">Cash Registers</h1>
            </div>

            {overdueStates.length > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {overdueStates.length} to count
              </Badge>
            )}
            {!canEdit && (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" /> Read only
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  loadData();
                  loadPerformance();
                  loadRequests();
                }}
                disabled={isRefreshing}
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => {
                    setOpenValues({ ...EMPTY_OPEN, registerId: activeRegisterId || "" });
                    setOpenDialog(true);
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Open shift
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="no-scrollbar container mx-auto min-h-0 max-w-5xl flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {!isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4 shrink-0" />
            Offline — register figures below may be stale. Opening and closing shifts still
            works and will sync when the connection returns.
          </div>
        )}

        {/* ── Store-level strip ────────────────────────────────────────── */}
        {registers.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Registers open</p>
              <p className="tnum mt-1 text-lg font-semibold">
                {openStates.length}
                <span className="text-sm text-muted-foreground">/{registers.length}</span>
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Expected in drawers</p>
              <p className="tnum mt-1 text-lg font-semibold">{formatLL(totalExpected)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Awaiting count</p>
              <p
                className={`tnum mt-1 text-lg font-semibold ${
                  overdueStates.length > 0 ? "text-destructive" : ""
                }`}
              >
                {overdueStates.length}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Requests waiting</p>
              <p className="tnum mt-1 text-lg font-semibold">{requests.length}</p>
            </div>
          </div>
        )}

        {/* Sales that reached no drawer. Shown only when non-zero, because a
            non-zero figure means a till is misconfigured — not that money is
            missing. */}
        {unassigned && unassigned.count > 0 && (
          <div className="flex gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">
                {unassigned.count} sale{unassigned.count !== 1 ? "s" : ""} today reached no
                register · {formatLL(unassigned.total)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A till has no register selected, or was selling while its register had no shift
                open. The money is recorded — it just is not attributed to a drawer. Use
                &ldquo;Use on this device&rdquo; on the till in question.
              </p>
            </div>
          </div>
        )}

        {/* ── Registers ────────────────────────────────────────────────── */}
        {registers.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-8 text-center">
              <Banknote className="mx-auto h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">No registers yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add a register for each physical drawer. The name stays with it, so you only
                  type it once.
                </p>
              </div>
              {canEdit && (
                <Button
                  onClick={() => {
                    setOpenValues(EMPTY_OPEN);
                    setOpenDialog(true);
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add the first register
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {registerStates.map((state) => (
              <RegisterCard
                key={state.register.id}
                state={state}
                isThisDevice={state.register.id === activeRegisterId}
                canEdit={canEdit}
                isOwner={!!user?.isOwner}
                onOpenShift={() => {
                  setOpenValues({ ...EMPTY_OPEN, registerId: state.register.id });
                  setOpenDialog(true);
                }}
                onCloseShift={() => {
                  setCloseValues(EMPTY_CLOSE);
                  setCloseShiftId(state.shift?.id ?? null);
                }}
                onAddAdjustment={() => {
                  setAdjValues(EMPTY_ADJ);
                  setAdjShiftId(state.shift?.id ?? null);
                }}
                onUseOnThisDevice={() => handleUseOnThisDevice(state.register)}
                onViewRequests={() => {
                  const first = requests.find((r) => r.register_id === state.register.id);
                  if (first) setDecidingRequest(first);
                }}
              />
            ))}
          </div>
        )}

        {/* ── Requests ─────────────────────────────────────────────────── */}
        <RequestsPanel
          requests={requests}
          canDecide={canEdit}
          onSelect={(r) => {
            setDecisionNote("");
            setDecidingRequest(r);
          }}
        />

        {/* ── Performance ──────────────────────────────────────────────── */}
        {performance && registers.length > 0 && (
          <RegisterPerformance
            registers={performance.registers}
            storeRevenue={performance.storeRevenue}
            busiestRegisterId={performance.busiestRegisterId}
            rangeLabel="over the last 30 days"
          />
        )}
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <OpenShiftDialog
        open={openDialog}
        onOpenChange={(v) => {
          setOpenDialog(v);
          if (!v) setOpenValues(EMPTY_OPEN);
        }}
        registers={registers}
        blockedRegisterIds={blockedRegisterIds}
        values={openValues}
        onChange={setOpenValues}
        onSubmit={handleOpenShift}
        isSubmitting={isOpening}
        canCreateRegister={canEdit && isOnline}
      />

      <CloseShiftDialog
        open={closeShiftId !== null}
        onOpenChange={(v) => {
          if (!v) {
            setCloseShiftId(null);
            setCloseValues(EMPTY_CLOSE);
          }
        }}
        registerName={
          registerStates.find((s) => s.shift?.id === closeShiftId)?.register.name || "register"
        }
        summary={registerStates.find((s) => s.shift?.id === closeShiftId)?.summary ?? null}
        values={closeValues}
        onChange={setCloseValues}
        onSubmit={handleCloseShift}
        isSubmitting={isClosing}
      />

      <AdjustmentDialog
        open={adjShiftId !== null}
        onOpenChange={(v) => {
          if (!v) {
            setAdjShiftId(null);
            setAdjValues(EMPTY_ADJ);
          }
        }}
        registerName={
          registerStates.find((s) => s.shift?.id === adjShiftId)?.register.name || "register"
        }
        values={adjValues}
        onChange={setAdjValues}
        onSubmit={handleAddAdjustment}
        isSubmitting={isAdjusting}
      />

      <RequestDecisionDialog
        request={decidingRequest}
        onOpenChange={(v) => {
          if (!v) {
            setDecidingRequest(null);
            setDecisionNote("");
          }
        }}
        note={decisionNote}
        onNoteChange={setDecisionNote}
        onDecide={handleDecide}
        isSubmitting={isDeciding}
      />
    </div>
  );
}
