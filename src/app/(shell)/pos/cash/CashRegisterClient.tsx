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
import { isOverdue } from "@/lib/cash/types";
import {
  readCashSnapshot,
  writeCashSnapshot,
  snapshotAgeMinutes,
  type CashSnapshot,
} from "@/lib/cash/snapshot";
import type {
  CashRegister,
  CashShift,
  CashAdjustment,
  RegisterState,
  RegisterRequest,
  StoreEmployee,
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
import { RemoveRegisterDialog } from "@/components/cash/ShiftDialogs";
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
  assignedUserId: "",
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
  const { isEnabled, flagsResolved } = useFeatureFlags();

  // Read the last-known state during the FIRST render, not from an effect.
  // This is the whole difference between a spinner and an instant page: the
  // markup below has real registers in it before any network call starts.
  const seed = useRef<CashSnapshot | null>(
    typeof window === "undefined" ? null : readCashSnapshot(user?.storeId)
  ).current;

  // Only ever a blocking spinner when there is genuinely nothing to show.
  const [isLoading, setIsLoading] = useState(!seed);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(seed?.at ?? null);
  /** True until live data replaces the seeded snapshot. */
  const [isStale, setIsStale] = useState(!!seed);

  const [registers, setRegisters] = useState<CashRegister[]>(
    (seed?.registers as CashRegister[]) || []
  );
  const [shifts, setShifts] = useState<CashShift[]>((seed?.shifts as CashShift[]) || []);
  const [totals, setTotals] = useState<Record<string, ShiftTotalsRow>>(
    (seed?.totals as Record<string, ShiftTotalsRow>) || {}
  );
  const [adjustments, setAdjustments] = useState<Record<string, CashAdjustment[]>>(
    (seed?.adjustments as Record<string, CashAdjustment[]>) || {}
  );
  const [pendingByRegister, setPendingByRegister] = useState<Record<string, number>>(
    seed?.pendingByRegister || {}
  );
  const [unassigned, setUnassigned] = useState<{ count: number; total: number } | null>(
    seed?.unassigned ?? null
  );

  /** Shift opens/closes/adjustments made offline and not yet pushed. */
  const [queuedCashWrites, setQueuedCashWrites] = useState(0);

  const [requests, setRequests] = useState<RegisterRequest[]>([]);
  const [employees, setEmployees] = useState<StoreEmployee[]>(
    (seed?.employees as StoreEmployee[]) || []
  );

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

  const [removingRegister, setRemovingRegister] = useState<CashRegister | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

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
      removingRegister !== null ||
      decidingRequest !== null ||
      isOpening ||
      isClosing ||
      isAdjusting ||
      isRemoving ||
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

  /** One person, one drawer: who is already on an open shift somewhere. */
  const busyUserIds = useMemo(
    () =>
      new Set(
        openStates
          .map((s) => s.shift?.assigned_user_id)
          .filter((id): id is string => !!id)
      ),
    [openStates]
  );
  const ownerBusy = useMemo(
    () => openStates.some((s) => s.shift?.assigned_to_owner === true),
    [openStates]
  );

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
        // Offline is not an error state here. Whatever was last seen stays on
        // screen and every write below still queues, so a shift can be opened,
        // counted and closed during an outage.
        setIsOnline(false);
        setIsLoading(false);
        return;
      }
      setIsOnline(true);

      if (!opts?.silent) setIsRefreshing(true);
      try {
        const headers = buildAuthHeaders(user);
        // The unassigned-takings figure is scoped to "today", and today is the
        // shop's, not the server's — Vercel runs in UTC and the shop does not.
        // The till is the only party that knows the local day boundary.
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const res = await fetch(
          `/api/cash-shifts?from=${encodeURIComponent(dayStart.toISOString())}`,
          { headers }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to load");
        }
        const data = await res.json();

        setRegisters(data.registers || []);
        setEmployees(data.employees || []);
        setShifts(data.shifts || []);
        setTotals(data.totals || {});
        setAdjustments(data.adjustments || {});
        setPendingByRegister(data.pendingByRegister || {});
        setUnassigned(data.unassigned || null);
        setIsStale(false);
        setSnapshotAt(Date.now());

        // Paint instantly next time, and let this screen open at all offline.
        writeCashSnapshot(user.storeId, {
          registers: data.registers || [],
          employees: data.employees || [],
          shifts: data.shifts || [],
          totals: data.totals || {},
          adjustments: data.adjustments || {},
          pendingByRegister: data.pendingByRegister || {},
          unassigned: data.unassigned || null,
        });
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

  /**
   * How many cash actions are sitting in the offline queue.
   *
   * Worth showing because the drawer figures on this page come from the server
   * and therefore do NOT include anything still queued. Without this, a
   * supervisor who counted a drawer during an outage sees the shift still open
   * and reasonably concludes the count was lost.
   */
  const countQueuedCashWrites = useCallback(async () => {
    try {
      const { getPendingWrites } = await import("@/lib/db/localDB");
      const writes = await getPendingWrites();
      setQueuedCashWrites(
        writes.filter(
          (w) =>
            w.type === "cash_shift_open" ||
            w.type === "cash_shift_close" ||
            w.type === "cash_adjustment"
        ).length
      );
    } catch {
      // A queue we cannot read is reported as empty rather than as an error.
    }
  }, []);

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
    if (!user?.storeId) return;

    // The drawer figures first; the 30-day performance RPC afterwards.
    //
    // Firing all three at once made them compete for connections and for the
    // database, so the slowest one (a range scan over a month of sales) held up
    // the one people actually came here to read. Requests ride along with the
    // main payload because they are cheap and drive a badge on every card.
    Promise.all([loadData(), loadRequests(), countQueuedCashWrites()]).finally(() => {
      loadPerformance();
    });
  }, [user, loadData, loadPerformance, loadRequests, countQueuedCashWrites]);

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
  // `flagsResolved`, NOT `isLoading`. `cash_register` DEFAULTS TO FALSE, and
  // `isLoading` goes false as soon as there is something renderable — which on
  // a device that has never cached this store's flags is the optimistic
  // defaults, i.e. a guess. This guard read that guess as an answer and bounced
  // the cashier off the cash page, with a toast saying the feature was not
  // enabled, for a store that has it switched on. New device, cleared storage,
  // evicted storage, private window: the same population that hits P1-12.
  //
  // An absent answer is not a negative answer. Denying waits for a real one;
  // the PERMISSION check below is the security boundary and is unaffected.
  useEffect(() => {
    if (!authLoading && user && flagsResolved) {
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
  }, [authLoading, user, flagsResolved, isEnabled, canAccess, router]);

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
    setIsOpening(true);
    try {
      const headers = buildAuthHeaders(user);
      let registerId = openValues.registerId;

      // ── A brand-new register ─────────────────────────────────────────────
      // The id is generated HERE, not by the server, so the shift opened on it
      // below has a valid reference whether or not the register has reached the
      // server yet. That is what lets this whole flow work during an outage.
      if (!registerId) {
        const newName = openValues.newRegisterName.trim();
        registerId = crypto.randomUUID();

        if (connectivity.isOnline) {
          const res = await fetch("/api/cash-registers", {
            method: "POST",
            headers,
            body: JSON.stringify({ id: registerId, name: newName }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Failed to create register");
          registerId = data.register.id;
        } else {
          const { queueRegisterCreate } = await import("@/lib/db/localDB");
          await queueRegisterCreate({
            store_id: user!.storeId,
            register_id: registerId,
            name: newName,
          });

          // Show it immediately. The server has never heard of this drawer, so
          // the next refresh cannot return it — without this the supervisor
          // would open a shift onto a register that is not on screen.
          setRegisters((prev) => [
            ...prev,
            {
              id: registerId!,
              store_id: user!.storeId,
              name: newName,
              is_active: true,
              sort_order: prev.length,
              created_at: new Date().toISOString(),
            },
          ]);
        }

        logActivity("cash.register_create", {
          target: newName,
          details: { online: connectivity.isOnline },
        });
      }

      logActivity("cash.shift_open", {
        target: registerId,
        details: { opening_ll: ll, opening_usd: usd, online: connectivity.isOnline },
      });
      // Who was put on the drawer is the fact an audit actually needs — it is
      // what links every subsequent sale to this register.
      if (openValues.assignedUserId) {
        logActivity("cash.shift_assign", {
          target: registerId,
          details: { assigned_user_id: openValues.assignedUserId },
        });
      }

      if (!connectivity.isOnline) {
        const { queueCashShiftOpen } = await import("@/lib/db/localDB");
        await queueCashShiftOpen({
          store_id: user!.storeId,
          register_id: registerId!,
          assigned_user_id: openValues.assignedUserId || undefined,
          label: openValues.label.trim() || undefined,
          business_date: new Date().toISOString().slice(0, 10),
          opening_ll: ll,
          opening_usd: usd,
          user_id: user!.isOwner ? undefined : user!.id,
          user_name: user!.displayName || user!.username,
        });
        toast.info("Shift opening queued — will sync when online");
        countQueuedCashWrites();
      } else {
        const res = await fetch("/api/cash-shifts", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "open",
            register_id: registerId,
            assigned_user_id: openValues.assignedUserId || undefined,
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
        countQueuedCashWrites();
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
        countQueuedCashWrites();
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

  const handleRemoveRegister = async () => {
    if (!removingRegister) return;
    if (!connectivity.isOnline) {
      toast.error("Removing a register needs a connection");
      return;
    }

    setIsRemoving(true);
    try {
      const res = await fetch(
        `/api/cash-registers?register_id=${encodeURIComponent(removingRegister.id)}`,
        { method: "DELETE", headers: buildAuthHeaders(user) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove register");

      // The server decides whether history forced a retire, so report what it
      // actually did rather than what the button said.
      logActivity(data.retired ? "cash.register_deactivate" : "cash.register_delete", {
        target: removingRegister.name,
        details: { register_id: removingRegister.id, shifts: data.shifts ?? 0 },
      });

      toast.success(data.message || "Register removed");
      setRemovingRegister(null);
      loadData();
      loadPerformance();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove register"));
    } finally {
      setIsRemoving(false);
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
                  countQueuedCashWrites();
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
                    setOpenValues(EMPTY_OPEN);
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
        {/* Offline, or showing a snapshot while live figures load. Both mean
            the same thing to the reader — these numbers are not current — so
            they share one line rather than competing for attention. */}
        {(!isOnline || (isStale && snapshotAt !== null)) && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {!isOnline ? (
                <>
                  <span className="font-medium text-foreground">Offline.</span> Showing the last
                  known figures
                  {snapshotAt !== null && snapshotAgeMinutes({ at: snapshotAt } as CashSnapshot) > 0
                    ? ` from ${snapshotAgeMinutes({ at: snapshotAt } as CashSnapshot)} min ago`
                    : ""}
                  . Opening, counting and closing shifts all still work — they queue and sync
                  when the connection returns.
                </>
              ) : (
                <>Showing the last known figures while today&rsquo;s load&hellip;</>
              )}
            </div>
          </div>
        )}

        {/* Queued cash actions are NOT in the server figures above. Said plainly,
            because a supervisor who counted a drawer during an outage would
            otherwise see the shift still open and think the count was lost. */}
        {queuedCashWrites > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-medium">
                {queuedCashWrites} cash action{queuedCashWrites !== 1 ? "s" : ""} waiting to sync
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shift opens, counts and adjustments made offline. They are saved on this device
                and are not reflected in the figures below until they reach the server.
              </p>
            </div>
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
                Nobody was on a drawer when these went through — either no shift was open, or
                the person selling was not assigned to one. The money is recorded and safe; it
                just is not attributed to a register. Open a shift and assign the cashier, and
                anything they sell from then on lands on that drawer.
              </p>
            </div>
          </div>
        )}

        {/* Not the same as zero. If the figure could not be computed, saying
            "nothing unaccounted" would be the one answer that stops anybody
            looking — so say plainly that we do not know. */}
        {unassigned === null && !isLoading && !isStale && (
          <p className="px-1 text-xs text-muted-foreground">
            Unassigned takings could not be checked just now. Refresh to try again.
          </p>
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
                onViewRequests={() => {
                  const first = requests.find((r) => r.register_id === state.register.id);
                  if (first) setDecidingRequest(first);
                }}
                onRemove={() => setRemovingRegister(state.register)}
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
        employees={employees}
        busyUserIds={busyUserIds}
        ownerBusy={ownerBusy}
        values={openValues}
        onChange={setOpenValues}
        onSubmit={handleOpenShift}
        isSubmitting={isOpening}
        canCreateRegister={canEdit}
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

      <RemoveRegisterDialog
        registerName={removingRegister?.name ?? null}
        // A register showing any shift on the cash page has been used. The
        // server re-checks this properly before acting — this only decides
        // which sentence the dialog shows.
        hasHistory={
          !!removingRegister &&
          registerStates.some((s) => s.register.id === removingRegister.id && s.shift !== null)
        }
        onOpenChange={(v) => {
          if (!v) setRemovingRegister(null);
        }}
        onConfirm={handleRemoveRegister}
        isSubmitting={isRemoving}
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
