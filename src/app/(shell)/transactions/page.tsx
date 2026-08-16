"use client";

// =============================================
// History
//
// Today's takings pinned above a date-grouped feed. One row per sale: time,
// item count, tender, amount. Refunds read red, and anything still sitting in
// the offline queue is flagged inline rather than in a banner nobody reads.
//
// The takings card shows PROFIT, not a cash/card split — profit needs cost
// prices, which transaction rows do not carry, so it comes from the analytics
// endpoint (the one place that joins products and converts USD costs into LL).
// Everything else on this screen is computed locally and works offline.
// =============================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronLeft,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Undo2,
  User,
  WifiOff,
  X,
} from "lucide-react";
import {
  formatLL,
  formatDateTime,
  formatUSD,
  convertLlToUsdForSale,
  formatLLParts,
} from "@/lib/utils/format";
import { toast } from "@/lib/toast";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { cn } from "@/lib/utils";
import { vibrate } from "@/lib/feedback";
import {
  cacheTransactions,
  getCachedTransactions,
} from "@/lib/db";
import type { CachedTransaction } from "@/lib/db";
import dynamic from "next/dynamic";
import { connectivity } from "@/lib/connectivity";
import { analyticsQuery, getFilterCutoff, type DateFilter } from "@/lib/dateFilter";

// Helper: check if user auth exists in localStorage (works offline)
function hasAuthInStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!localStorage.getItem("goldensquirrel_user") ||
           !!localStorage.getItem("goldensquirrel_auth");
  } catch { return false; }
}

// Helper: get storeId from localStorage (works offline)
function getStoreIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const user = localStorage.getItem("goldensquirrel_user");
    if (user) {
      const parsed = JSON.parse(user);
      if (parsed.storeId) return parsed.storeId;
    }
    const auth = localStorage.getItem("goldensquirrel_auth");
    if (auth) {
      const parsed = JSON.parse(auth);
      return parsed.store_id || null;
    }
  } catch {}
  return null;
}

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
}

interface Transaction {
  id: string;
  transaction_number: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
  user_id?: string;
  user_name?: string;
  transaction_items: TransactionItem[];
}

interface TransactionWithChange extends Transaction {
  calculated_change: number;
  /**
   * Where the sale sits relative to the server.
   *   queued — still in the offline queue, will go up on its own
   *   failed — dead-lettered: retries exhausted, needs a human
   * Absent means it is on the server.
   */
  syncState?: "queued" | "failed";
}

const DATE_FILTERS: { key: DateFilter; short: string; long: string }[] = [
  { key: "today", short: "Today", long: "Today" },
  { key: "hour", short: "1h", long: "Last hour" },
  { key: "week", short: "7d", long: "Last 7 days" },
  { key: "month", short: "30d", long: "Last 30 days" },
  { key: "90days", short: "90d", long: "Last 90 days" },
  { key: "all", short: "All", long: "All time" },
];

// Transactions fetched per request. Matches the API's default.
const PAGE_SIZE = 50;

// TransactionAnalytics pulls in recharts (~390KB) via three chart components.
// The analytics panel is behind a toggle and starts collapsed, so it should
// not be part of this route's first paint.
const TransactionAnalytics = dynamic(
  () => import("@/components/TransactionAnalytics").then((m) => m.TransactionAnalytics),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading analytics…
      </div>
    ),
  }
);

/** Local midnight for the day a timestamp falls in — the grouping key. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function TransactionHistoryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isEnabled } = useFeatureFlags();

  // Only redirect to login if there's truly no auth data in localStorage.
  // Never redirect during the brief mount cycle when user state hasn't resolved yet.
  useEffect(() => {
    if (!user) {
      if (hasAuthInStorage()) return;
      router.replace("/login");
    }
  }, [user, router]);

  const [transactions, setTransactions] = useState<TransactionWithChange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Defaults to today: a cashier opening History wants this shift, not the
  // store's whole lifetime. Every other range is one tap away.
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isShowingCached, setIsShowingCached] = useState(false);
  const [viewMode, setViewMode] = useState<"transactions" | "analytics">("transactions");
  // Keyset cursor for the next page, or null when the history is fully loaded.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Profit for the active range. null = not loaded (offline, or flag off).
  const [rangeProfit, setRangeProfit] = useState<number | null>(null);

  // fetchTransactions is a useCallback that must not depend on `transactions`
  // (that would rebuild it on every load and re-fire the effects that call
  // it). It previously read `transactions.length` directly from the closure,
  // which always saw the initial [] — so its "do I already have data?"
  // fallbacks never worked. A ref gives it the current value safely.
  const transactionsRef = useRef<TransactionWithChange[]>([]);
  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get store_id from ALL possible sources (user object, auth storage, user storage)
      // Never redirect to /login when offline — just load from cache silently
      const store_id: string | null = user?.storeId || getStoreIdFromStorage();

      if (!store_id) {
        // No auth data anywhere — only then redirect
        if (!hasAuthInStorage()) {
          router.replace("/login");
          return;
        }
      }

      // ALWAYS load cached transactions first for instant display
      if (store_id) {
        const cached = await getCachedTransactions(store_id);
        if (cached.length > 0) {
          const withChange = cached.map((t) => ({
            ...t,
            calculated_change: t.amount_paid && t.total_amount ? t.amount_paid - t.total_amount : 0,
          }));
          setTransactions(withChange);
          setIsShowingCached(true);
        }
      }

      // Then try to fetch fresh data from API if online AND we have a store_id
      if (connectivity.isOnline && store_id) {
        const authData = localStorage.getItem("goldensquirrel_auth");

        if (authData) {
          try {
            // First page only. Older history is loaded on demand via
            // loadMoreTransactions() — the endpoint used to return the store's
            // entire history (and was silently truncated at 1000 rows).
            const response = await fetch(`/api/transactions?limit=${PAGE_SIZE}`, {
              headers: { "x-auth-data": authData },
            });

            if (!response.ok) {
              throw new Error(`Failed to fetch transactions: ${response.status}`);
            }

            const data = await response.json();

            const transactionsWithChange = (data.transactions || []).map((t: Transaction) => ({
              ...t,
              calculated_change: t.amount_paid && t.total_amount ? t.amount_paid - t.total_amount : 0
            }));
            setTransactions(transactionsWithChange);
            setIsShowingCached(false);
            setNextCursor(data.nextCursor ?? null);

            // Cache transactions locally for offline use
            if (data.transactions && data.transactions.length > 0) {
              const toCache: CachedTransaction[] = data.transactions.map((t: any) => ({
                id: t.id,
                store_id: store_id,
                transaction_number: t.transaction_number,
                receipt_token: t.receipt_token,
                subtotal: t.subtotal,
                total_amount: t.total_amount,
                amount_paid: t.amount_paid,
                change_given: t.change_given || 0,
                created_at: t.created_at,
                user_id: t.user_id,
                user_name: t.user_name,
                transaction_items: (t.transaction_items || []).map((item: any) => ({
                  id: item.id,
                  product_name: item.product_name,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  total_price: item.total_price,
                  currency: item.currency,
                })),
              }));
              cacheTransactions(toCache).catch((err) =>
                console.error("[Transactions] Failed to cache transactions:", err)
              );
            }
          } catch (apiError) {
            console.error("[Transactions] API fetch failed:", apiError);
            // If we already have cached data from earlier, keep showing it
            if (transactionsRef.current.length === 0) {
              setIsShowingCached(false);
              setIsOffline(true);
            }
          }
        }
      } else {
        setIsOffline(true);
      }
    } catch (err: any) {
      console.error("Error fetching transactions:", err);
      // If we already loaded from cache, don't show error
      if (transactionsRef.current.length === 0) {
        setError("Could not load transactions. Please check your connection.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, router]);

  /**
   * Merge anything still sitting in the offline queue into the feed.
   *
   * A sale made with no internet is real money already taken — leaving it out
   * of History until it syncs makes the day's takings read low and the cashier
   * think a sale was lost. Queued sales are flagged NOT SYNCED; dead-lettered
   * ones (retries exhausted) are flagged SYNC FAILED, which is the first time
   * that queue has been visible anywhere in the UI.
   */
  const loadPendingTransactions = useCallback(async () => {
    try {
      const { getQueuedTransactions, getDeadLetterTransactions } = await import(
        "@/lib/db/localDB"
      );
      const [queued, deadLettered] = await Promise.all([
        getQueuedTransactions(),
        getDeadLetterTransactions(),
      ]);
      if (queued.length === 0 && deadLettered.length === 0) return;

      const toRow = (
        q: (typeof queued)[number],
        syncState: "queued" | "failed"
      ): TransactionWithChange => ({
        id: q.id,
        transaction_number: q.transaction_number,
        subtotal: q.subtotal ?? q.total_amount ?? 0,
        total_amount: q.total_amount ?? 0,
        amount_paid: q.amount_paid ?? 0,
        change_given: q.change_given ?? 0,
        created_at: q.created_at,
        user_name: q.user_name,
        transaction_items: (q.items || []).map((it, i) => ({
          id: `${q.id}-${i}`,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: it.total_price,
          currency: it.currency,
        })),
        calculated_change: (q.amount_paid ?? 0) - (q.total_amount ?? 0),
        syncState,
      });

      const pending: TransactionWithChange[] = [
        ...deadLettered.map((q) => toRow(q, "failed")),
        ...queued.map((q) => toRow(q, "queued")),
      ];

      setTransactions((prev) => {
        const seen = new Set(prev.map((t) => t.transaction_number));
        const extra = pending.filter((p) => !seen.has(p.transaction_number));
        if (extra.length === 0) return prev;
        return [...extra, ...prev].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
    } catch (e) {
      console.warn("[Transactions] Could not read the offline queue:", e);
    }
  }, []);

  /** Profit for the active range. Server-side because it needs cost prices. */
  const fetchRangeProfit = useCallback(async () => {
    if (!isEnabled("transaction_analytics") || !connectivity.isOnline) {
      setRangeProfit(null);
      return;
    }
    const authData = localStorage.getItem("goldensquirrel_auth");
    if (!authData) return;
    try {
      // analyticsQuery carries the window start resolved in THIS device's
      // timezone, so "today" means the shop's midnight rather than the
      // server's.
      const res = await fetch(`/api/transactions/analytics?${analyticsQuery(dateFilter)}`, {
        headers: { "x-auth-data": authData },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRangeProfit(Number(data?.summary?.totalProfit) || 0);
    } catch {
      // Profit is supplementary — the feed and takings still stand without it.
      setRangeProfit(null);
    }
  }, [dateFilter, isEnabled]);

  /**
   * Append the next page of older transactions.
   * Only the first page is written to the offline cache — the cache exists to
   * make recent history available with no internet, not to mirror the store's
   * entire lifetime into IndexedDB.
   */
  const loadMoreTransactions = useCallback(async () => {
    if (!nextCursor || isLoadingMore || !connectivity.isOnline) return;

    const authData = localStorage.getItem("goldensquirrel_auth");
    if (!authData) return;

    setIsLoadingMore(true);
    try {
      const response = await fetch(
        `/api/transactions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { "x-auth-data": authData } }
      );
      if (!response.ok) throw new Error(`Failed to load more: ${response.status}`);

      const data = await response.json();
      const older = (data.transactions || []).map((t: Transaction) => ({
        ...t,
        calculated_change:
          t.amount_paid && t.total_amount ? t.amount_paid - t.total_amount : 0,
      }));

      setTransactions((prev) => {
        // Guard against a duplicate append if this fires twice.
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...older.filter((t: TransactionWithChange) => !seen.has(t.id))];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      console.error("[Transactions] Failed to load more:", e);
      toast.error("Could not load older transactions");
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  useEffect(() => {
    fetchTransactions().then(loadPendingTransactions);
  }, [fetchTransactions, loadPendingTransactions]);

  useEffect(() => {
    fetchRangeProfit();
  }, [fetchRangeProfit]);

  // Track online/offline status and refresh transactions when coming back online
  useEffect(() => {
    setIsOffline(!connectivity.isOnline);

    const unsubscribe = connectivity.subscribe((status) => {
      if (status === "online") {
        setIsOffline(false);
        // Small delay to ensure auth state has settled
        setTimeout(() => {
          fetchTransactions().then(loadPendingTransactions);
        }, 500);
      } else {
        setIsOffline(true);
      }
    });

    return unsubscribe;
  }, [fetchTransactions, loadPendingTransactions]);

  // Apply date filter and search.
  // Derived state belongs in a memo, not in state — this used to be a
  // useEffect + setState, which forced a second render pass over the whole
  // list on every keystroke.
  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    // Same helper the profit request uses, so the figure in the takings card
    // and the sales listed under it can never cover different windows.
    const cutoff = getFilterCutoff(dateFilter);
    if (cutoff) {
      filtered = filtered.filter((t) => new Date(t.created_at) >= cutoff);
    }

    // Search by transaction #, user, or amount
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const numericQuery = parseFloat(searchQuery.replace(/[^0-9.]/g, ""));

      filtered = filtered.filter(t => {
        if (t.transaction_number.toLowerCase().includes(query)) return true;
        if (t.user_name && t.user_name.toLowerCase().includes(query)) return true;
        if (!isNaN(numericQuery) && t.total_amount === numericQuery) return true;
        if (!isNaN(numericQuery) && t.amount_paid === numericQuery) return true;
        return false;
      });
    }

    return filtered;
  }, [searchQuery, dateFilter, transactions]);

  // Takings for the visible range, plus the same figures per day for the
  // group headers. One pass, not four.
  const { rangeTotal, rangeCount, avgSale, itemsSold, groups } = useMemo(() => {
    let total = 0;
    let items = 0;
    const byDay = new Map<string, { label: string; total: number; rows: TransactionWithChange[] }>();

    for (const t of filteredTransactions) {
      total += t.total_amount;
      items += t.transaction_items.reduce((n, i) => n + i.quantity, 0);

      const key = dayKey(t.created_at);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { label: dayLabel(t.created_at), total: 0, rows: [] };
        byDay.set(key, bucket);
      }
      bucket.total += t.total_amount;
      bucket.rows.push(t);
    }

    return {
      rangeTotal: total,
      rangeCount: filteredTransactions.length,
      avgSale: filteredTransactions.length > 0 ? total / filteredTransactions.length : 0,
      itemsSold: items,
      groups: Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)),
    };
  }, [filteredTransactions]);

  const detail = useMemo(
    () => filteredTransactions.find((t) => t.id === detailId) ?? null,
    [filteredTransactions, detailId]
  );

  const activeFilter = DATE_FILTERS.find((f) => f.key === dateFilter) ?? DATE_FILTERS[0];
  const showAnalytics = isEnabled("transaction_analytics");
  const isEmpty = filteredTransactions.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ---- Header ---- */}
      <header className="safe-top flex-shrink-0 px-4 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/pos")}
            aria-label="Back to sale"
            className="tap -ml-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground md:hidden"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="flex-1 text-[26px] font-bold leading-none">
            {viewMode === "analytics" ? "Analytics" : "History"}
          </h1>

          <button
            type="button"
            onClick={() => {
              setShowSearch((v) => !v);
              if (showSearch) setSearchQuery("");
            }}
            aria-label="Search sales"
            aria-pressed={showSearch}
            className={cn(
              "tap flex h-10 w-10 items-center justify-center rounded-full bg-muted/60",
              showSearch && "bg-primary/20 text-primary"
            )}
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            aria-label="Filter by date"
            className="tap flex h-10 w-10 items-center justify-center rounded-full bg-muted/60"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
          </button>
          {showAnalytics && (
            <button
              type="button"
              onClick={() =>
                setViewMode(viewMode === "analytics" ? "transactions" : "analytics")
              }
              aria-label="Toggle analytics"
              aria-pressed={viewMode === "analytics"}
              className={cn(
                "tap flex h-10 w-10 items-center justify-center rounded-full bg-muted/60",
                viewMode === "analytics" && "bg-primary/20 text-primary"
              )}
            >
              <BarChart3 className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>

        {showSearch && (
          <div className="animate-fade-in relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              type="text"
              placeholder="Search by #, cashier, or amount"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="tap absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* ---- Analytics takes the whole body ---- */}
      {viewMode === "analytics" && showAnalytics ? (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TransactionAnalytics dateFilter={dateFilter} storeId={user?.storeId || ""} />
        </div>
      ) : (
        <>
          {/* ---- Takings — pinned. The day's number is the reason the screen
                 exists; it must not scroll away behind the feed. ---- */}
          <div className="flex-shrink-0 px-4 pt-4">
              <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-primary/[0.09] to-transparent px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {activeFilter.long} · {rangeCount} sale{rangeCount !== 1 ? "s" : ""}
                </p>

                <div className="mt-1 flex items-baseline justify-between gap-3">
                  {isLoading && transactions.length === 0 ? (
                    <div className="skeleton mt-1 h-9 w-48" />
                  ) : (
                    <p className="text-[32px] font-extrabold leading-none text-primary tnum">
                      {formatLLParts(rangeTotal).value}
                      <span className="ml-1.5 text-base font-bold">
                        {formatLLParts(rangeTotal).unit}
                      </span>
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground tnum">
                    {formatUSD(convertLlToUsdForSale(rangeTotal))}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Profit</p>
                    {rangeProfit === null ? (
                      <p className="text-sm font-bold text-muted-foreground tnum">—</p>
                    ) : (
                      <p
                        className={cn(
                          "text-sm font-bold tnum",
                          rangeProfit >= 0 ? "text-emerald-400" : "text-destructive"
                        )}
                      >
                        {formatLLParts(rangeProfit).value}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Items</p>
                    <p className="text-sm font-bold tnum">{itemsSold}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Avg. sale</p>
                    <p className="text-sm font-bold tnum">{formatLLParts(avgSale).value}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ---- Notices ---- */}
            {isOffline && (
              <div className="mx-4 mt-3 flex flex-shrink-0 items-start gap-3 rounded-2xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs text-muted-foreground">
                  {isShowingCached
                    ? "You're offline — showing your last synced history. New sales still appear below."
                    : "You're offline. Connect to load the full history."}
                </p>
              </div>
            )}

            {error && !isShowingCached && (
              <div className="mx-4 mt-3 flex flex-shrink-0 items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/[0.07] px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* ---- Feed — the only part of this screen that scrolls ---- */}
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            {isLoading && transactions.length === 0 ? (
              <div className="mt-4 space-y-px">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="skeleton h-9 w-9 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-32" />
                      <div className="skeleton h-3 w-20" />
                    </div>
                    <div className="skeleton h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
                <Receipt className="mb-4 h-12 w-12 text-muted-foreground/30" />
                <h3 className="text-lg font-semibold">No sales here</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {searchQuery || dateFilter !== "all"
                    ? "Try a wider date range or a different search."
                    : "Completed sales will show up here."}
                </p>
                {!searchQuery && dateFilter === "all" && (
                  <Button className="mt-5 rounded-2xl" onClick={() => router.push("/pos")}>
                    Start a sale
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-4">
                {groups.map(([key, group]) => (
                  <section key={key}>
                    {/* Sticky so the day you are scrolling through is always named. */}
                    <header className="sticky top-0 z-10 flex items-baseline justify-between bg-background/95 px-4 py-2 backdrop-blur">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {group.label}
                      </h2>
                      <span className="text-[11px] font-semibold text-muted-foreground tnum">
                        {group.rows.length === 1 ? "1 sale" : `${group.rows.length} sales`} ·{" "}
                        {formatLLParts(group.total).value}
                      </span>
                    </header>

                    <ul>
                      {group.rows.map((t) => {
                        // A negative total is a refund — money going back out.
                        const isRefund = t.total_amount < 0;
                        const itemCount = t.transaction_items.reduce(
                          (n, i) => n + i.quantity,
                          0
                        );
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => {
                                vibrate(8);
                                setDetailId(t.id);
                              }}
                              className="tap flex w-full items-center gap-3 border-b border-white/[0.05] px-4 py-3 text-left active:bg-muted/40"
                            >
                              <span
                                className={cn(
                                  "flex h-9 w-9 flex-none items-center justify-center rounded-xl",
                                  isRefund
                                    ? "bg-destructive/15 text-destructive"
                                    : "bg-muted/70 text-muted-foreground"
                                )}
                              >
                                {isRefund ? (
                                  <Undo2 className="h-4 w-4" />
                                ) : (
                                  <Receipt className="h-4 w-4" />
                                )}
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold">
                                  <span className="tnum">{timeLabel(t.created_at)}</span>
                                  <span className="text-muted-foreground"> · </span>
                                  {isRefund
                                    ? "Refund"
                                    : `${itemCount} item${itemCount !== 1 ? "s" : ""}`}
                                </span>
                                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="truncate tnum">
                                    #{t.transaction_number}
                                  </span>
                                  {t.syncState && (
                                    <span
                                      className={cn(
                                        "flex-none rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                        t.syncState === "failed"
                                          ? "bg-destructive/20 text-destructive"
                                          : "bg-primary/20 text-primary"
                                      )}
                                    >
                                      {t.syncState === "failed" ? "Sync failed" : "Not synced"}
                                    </span>
                                  )}
                                </span>
                              </span>

                              <span className="flex-none text-right">
                                <span
                                  className={cn(
                                    "block text-[15px] font-bold tnum",
                                    isRefund ? "text-destructive" : ""
                                  )}
                                >
                                  {formatLLParts(t.total_amount).value}
                                </span>
                                <span className="block text-xs text-muted-foreground tnum">
                                  {formatUSD(convertLlToUsdForSale(t.total_amount))}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}

                {/* Older history is fetched on demand — the endpoint returns one
                    page at a time instead of the store's entire history. */}
                {nextCursor && !isOffline && (
                  <div className="flex justify-center px-4 py-5">
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={loadMoreTransactions}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading…
                        </>
                      ) : (
                        "Load older sales"
                      )}
                    </Button>
                  </div>
                )}
                <div className="h-4" />
              </div>
            )}
            </div>
          </>
        )}

      {/* ---- Date range ---- */}
      <Dialog open={showFilters} onOpenChange={setShowFilters}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Date range</DialogTitle>
            <DialogDescription>Which sales should the feed show?</DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            {DATE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setDateFilter(f.key);
                  setShowFilters(false);
                }}
                className={cn(
                  "tap flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] font-semibold",
                  dateFilter === f.key ? "bg-primary/15 text-primary" : "hover:bg-muted/50"
                )}
              >
                {f.long}
                {dateFilter === f.key && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            className="w-full rounded-2xl"
            onClick={() => {
              fetchTransactions().then(loadPendingTransactions);
              fetchRangeProfit();
              setShowFilters(false);
            }}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </DialogContent>
      </Dialog>

      {/* ---- Sale detail ---- */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-sm">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detail.total_amount < 0 ? "Refund" : "Sale"} ·{" "}
                  <span className="tnum">{formatLLParts(detail.total_amount).value}</span>
                </DialogTitle>
                <DialogDescription className="tnum">
                  #{detail.transaction_number} · {formatDateTime(detail.created_at)}
                </DialogDescription>
              </DialogHeader>

              {detail.syncState === "queued" && (
                <div className="flex items-center gap-2 rounded-xl bg-primary/15 px-3 py-2 text-xs font-semibold text-primary">
                  <WifiOff className="h-3.5 w-3.5" />
                  Waiting to sync — the money was taken, the record is queued.
                </div>
              )}
              {detail.syncState === "failed" && (
                <div className="flex items-start gap-2 rounded-xl bg-destructive/15 px-3 py-2 text-xs font-semibold text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  <span>
                    This sale could not be sent to the server after repeated attempts. It
                    has NOT been discarded — take a note of the number above and contact
                    support so it can be entered manually.
                  </span>
                </div>
              )}

              <div className="no-scrollbar max-h-[40vh] space-y-2.5 overflow-y-auto">
                {detail.transaction_items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{item.product_name}</span>
                      <span className="text-muted-foreground tnum"> × {item.quantity}</span>
                    </span>
                    <span className="flex-none text-right">
                      {/* total_price is stored in LL for every line, whatever the
                          product's own display currency — so it is formatted as
                          LL and the USD figure is derived, never the reverse. */}
                      <span className="block font-semibold tnum">
                        {formatLL(item.total_price)}
                      </span>
                      {item.quantity > 1 && (
                        <span className="block text-xs text-muted-foreground tnum">
                          {formatLL(item.unit_price)} each
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t pt-4 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tnum">{formatLL(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-primary tnum">{formatLL(detail.total_amount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid</span>
                  <span className="tnum">{formatLL(detail.amount_paid)}</span>
                </div>
                {detail.calculated_change > 0 && (
                  <div className="flex justify-between font-medium text-emerald-400">
                    <span>Change given</span>
                    <span className="tnum">{formatLL(detail.calculated_change)}</span>
                  </div>
                )}
                {detail.user_name && (
                  <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {detail.user_name}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
