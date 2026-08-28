"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Activity,
  ChevronLeft,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Store as StoreIcon,
  User as UserIcon,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils/format";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_RETENTION_DAYS,
  type ActivityCategory,
} from "@/lib/activity/types";

/**
 * The activity trail.
 *
 * Everything on this page is scoped by the signed admin cookie server-side —
 * the localStorage check below only decides whether to redirect, it is not the
 * gate. A tampered localStorage entry gets an empty list and a 401, not data.
 */

interface ActivityRow {
  id: number;
  store_id: string;
  user_id: string | null;
  user_name: string | null;
  session_id: string;
  device_id: string | null;
  category: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  route: string | null;
  is_offline: boolean;
  occurred_at: string;
  received_at: string;
}

interface StoreOption {
  id: string;
  username: string;
}

interface EmployeeOption {
  id: string;
  display_name?: string | null;
  username: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "3 days" / "1 day" — the retention window said in plain words, in one place. */
const RETENTION_LABEL = `${ACTIVITY_RETENTION_DAYS} day${ACTIVITY_RETENTION_DAYS === 1 ? "" : "s"}`;

/** The oldest timestamp that can possibly return a row. */
const retentionFloor = () => Date.now() - ACTIVITY_RETENTION_DAYS * DAY_MS;

/**
 * Quick ranges.
 *
 * Deliberately finer than the DATE_FILTERS on the transactions page, because
 * only ACTIVITY_RETENTION_DAYS of data exists here. The widest option is
 * derived from that constant rather than hardcoded — a fixed "Last 7 days"
 * button would keep returning the same rows as the real ceiling while implying
 * there is more behind it, which is exactly the kind of quiet lie a filter
 * should not tell.
 */
const QUICK_RANGES = [
  { key: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { key: "6h", label: "Last 6h", ms: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "Last 24h", ms: DAY_MS },
  { key: "all", label: `All ${RETENTION_LABEL}`, ms: ACTIVITY_RETENTION_DAYS * DAY_MS },
] as const;

const CATEGORY_TONE: Record<string, string> = {
  cart: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  catalog: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  sale: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cash: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  auth: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  nav: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  ui: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  sync: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  connectivity: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO string. */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export default function AdminActivityPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  // --- filters ---------------------------------------------------------------
  const [storeId, setStoreId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [quickRange, setQuickRange] = useState<string>("24h");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // --- data ------------------------------------------------------------------
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

  // --- guard -----------------------------------------------------------------
  useEffect(() => {
    if (!localStorage.getItem("goldensquirrel_admin")) {
      router.push("/admin/login");
      return;
    }
    setIsAdmin(true);
  }, [router]);

  // --- debounce the search box ----------------------------------------------
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // --- stores ----------------------------------------------------------------
  useEffect(() => {
    if (!isAdmin) return;
    // The stores list is not sensitive and the admin console already reads it
    // this way; no new endpoint is needed for a picker.
    let active = true;
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const result = await createClient()
        .from("stores")
        .select("id, username")
        .order("username");
      if (active) setStores((result.data as StoreOption[] | null) ?? []);
    })().catch(() => {
      if (active) setStores([]);
    });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  // --- employees for the selected store -------------------------------------
  useEffect(() => {
    if (!isAdmin || !storeId) {
      setEmployees([]);
      return;
    }
    let active = true;
    fetch(`/api/admin/store-users?store_id=${storeId}`)
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((data: { employees?: EmployeeOption[] }) => {
        if (active) setEmployees(data.employees ?? []);
      })
      .catch(() => {
        if (active) setEmployees([]);
      });
    return () => {
      active = false;
    };
  }, [isAdmin, storeId]);

  // --- the query -------------------------------------------------------------
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (storeId) params.set("store_id", storeId);
    if (userId) params.set("user_id", userId);
    if (categories.length > 0) params.set("category", categories.join(","));
    if (debouncedSearch) params.set("q", debouncedSearch);

    // Explicit from/to win over the quick range, so a hand-typed window is
    // never silently overridden by a preset that is still highlighted.
    if (from) params.set("from", new Date(from).toISOString());
    else {
      const range = QUICK_RANGES.find((r) => r.key === quickRange);
      if (range) params.set("from", new Date(Date.now() - range.ms).toISOString());
    }
    if (to) params.set("to", new Date(to).toISOString());

    return params.toString();
  }, [storeId, userId, categories, debouncedSearch, from, to, quickRange]);

  const load = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams(queryString);
      params.set("limit", "100");
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/admin/activity?${params.toString()}`);
      if (response.status === 401) {
        toast.error("Admin session expired — sign in again");
        router.push("/admin/login");
        return null;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load activity");
      }
      return response.json() as Promise<{
        events: ActivityRow[];
        nextCursor: string | null;
      }>;
    },
    [queryString, router]
  );

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoading(true);
    setExpanded(null);

    load(null)
      .then((data) => {
        if (!active || !data) return;
        setRows(data.events);
        setNextCursor(data.nextCursor);
      })
      .catch((e: Error) => {
        if (active) toast.error(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin, load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await load(nextCursor);
      if (data) {
        setRows((prev) => [...prev, ...data.events]);
        setNextCursor(data.nextCursor);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = () => {
    // A plain navigation, so the browser's own download handling applies and
    // the cookie goes with it.
    window.location.href = `/api/admin/activity?${queryString}&format=csv`;
  };

  const toggleCategory = (category: ActivityCategory) => {
    setCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const clearFilters = () => {
    setStoreId("");
    setUserId("");
    setCategories([]);
    setSearch("");
    setFrom("");
    setTo("");
    setQuickRange("24h");
  };

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    // Rows are one line until opened; an opened one grows, and measureElement
    // below corrects the estimate.
    estimateSize: (index) => (rows[index]?.id === expanded ? 260 : 56),
    overscan: 10,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [expanded, virtualizer]);

  const selectedStore = stores.find((s) => s.id === storeId);
  const selectedUserLabel =
    userId === "owner"
      ? "Owner"
      : employees.find((e) => e.id === userId)?.display_name ||
        employees.find((e) => e.id === userId)?.username ||
        "All users";

  if (!isAdmin) return null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => router.push("/admin")}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">Activity</h1>
              <p className="text-xs text-muted-foreground">
                Last {RETENTION_LABEL} across all stores
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <Button variant="outline" onClick={() => setSearch((s) => s)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4 space-y-4">
        {/* --- filters --- */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setStorePickerOpen(true)}>
                <StoreIcon className="h-4 w-4 mr-2" />
                {selectedStore ? selectedStore.username : "All stores"}
              </Button>

              <Button
                variant="outline"
                onClick={() => setUserPickerOpen(true)}
                disabled={!storeId}
                title={storeId ? undefined : "Pick a store first"}
              >
                <UserIcon className="h-4 w-4 mr-2" />
                {userId ? selectedUserLabel : "All users"}
              </Button>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search action, target or user…"
                  className="pl-9"
                />
              </div>

              {(storeId || userId || categories.length > 0 || search || from || to) && (
                <Button variant="ghost" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {QUICK_RANGES.map((range) => (
                <Button
                  key={range.key}
                  size="sm"
                  variant={!from && quickRange === range.key ? "default" : "outline"}
                  onClick={() => {
                    setQuickRange(range.key);
                    setFrom("");
                    setTo("");
                  }}
                >
                  {range.label}
                </Button>
              ))}

              <div className="flex items-center gap-2 ml-auto">
                {/* Bounded by the retention window at both ends. Picking a
                    date with no data behind it looks like a bug in the log
                    rather than a filter that reached past what is kept. */}
                <Input
                  type="datetime-local"
                  value={from}
                  min={toLocalInput(retentionFloor())}
                  max={to || toLocalInput(Date.now())}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-[210px]"
                  aria-label="From"
                />
                <span className="text-muted-foreground text-sm">→</span>
                <Input
                  type="datetime-local"
                  value={to}
                  min={from || toLocalInput(retentionFloor())}
                  max={toLocalInput(Date.now())}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-[210px]"
                  aria-label="To"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ACTIVITY_CATEGORIES.map((category) => {
                const active = categories.includes(category);
                return (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      active
                        ? CATEGORY_TONE[category] ?? "bg-primary/15 text-primary border-primary/30"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>

            {/* Says what is and is not in here. Without this an admin looking
                for a click that is not recorded concludes the log is broken,
                rather than that passive tracking is deliberately off. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Kept {RETENTION_LABEL}; older days are dropped automatically. Records actions —
              sales, cart and price changes, catalogue edits, cash movements, logins, permission
              refusals, sync failures, offline periods and errors. Passive click and typing
              tracking is off, so individual button taps are not listed.
            </p>
          </CardContent>
        </Card>

        {/* --- results --- */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading activity…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p>No activity matches these filters.</p>
                <p className="mt-1 text-xs">
                  Only the last {RETENTION_LABEL} are kept, and a store with{" "}
                  <span className="font-medium">Activity Logging</span> switched off in its feature
                  flags records nothing at all.
                </p>
              </div>
            ) : (
              <>
                <div ref={parentRef} className="max-h-[62vh] overflow-y-auto">
                  <div
                    className="relative w-full"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      const isOpen = expanded === row.id;

                      return (
                        <div
                          key={virtualRow.key}
                          ref={virtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full border-b border-border/60"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <button
                            onClick={() => setExpanded(isOpen ? null : row.id)}
                            className="w-full text-left px-4 py-2.5 hover:bg-muted/40 flex items-center gap-3"
                          >
                            <span className="text-xs text-muted-foreground tabular-nums w-[150px] shrink-0">
                              {formatDateTime(row.occurred_at)}
                            </span>

                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] ${
                                CATEGORY_TONE[row.category] ?? ""
                              }`}
                            >
                              {row.category}
                            </Badge>

                            <span className="font-mono text-xs shrink-0 w-[170px] truncate">
                              {row.action}
                            </span>

                            <span className="text-sm truncate flex-1 min-w-0">
                              {row.target ?? "—"}
                            </span>

                            <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[140px]">
                              {row.user_name ?? "Owner"}
                            </span>

                            {row.is_offline && (
                              <WifiOff
                                className="h-3.5 w-3.5 text-orange-400 shrink-0"
                                aria-label="Recorded while offline"
                              />
                            )}
                          </button>

                          {isOpen && (
                            <div className="px-4 pb-3 pt-1 bg-muted/20 text-xs space-y-2">
                              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <Meta label="Route" value={row.route} />
                                <Meta label="Store" value={
                                  stores.find((s) => s.id === row.store_id)?.username ?? row.store_id
                                } />
                                <Meta label="Session" value={row.session_id} mono />
                                <Meta label="Device" value={row.device_id} mono />
                                <Meta
                                  label="Received"
                                  value={formatDateTime(row.received_at)}
                                />
                                <Meta
                                  label="Delay"
                                  value={`${Math.max(
                                    0,
                                    Math.round(
                                      (Date.parse(row.received_at) -
                                        Date.parse(row.occurred_at)) /
                                        1000
                                    )
                                  )}s`}
                                />
                              </dl>
                              <pre className="bg-background/60 rounded p-2 overflow-x-auto">
                                {JSON.stringify(row.details ?? {}, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    {rows.length} event{rows.length === 1 ? "" : "s"}
                  </p>
                  {nextCursor && (
                    <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Load more
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- store picker --- */}
      <Dialog open={storePickerOpen} onOpenChange={setStorePickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter by store</DialogTitle>
            <DialogDescription>Choose a single store, or show all.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            <PickerRow
              label="All stores"
              active={storeId === ""}
              onClick={() => {
                setStoreId("");
                setUserId("");
                setStorePickerOpen(false);
              }}
            />
            {stores.map((store) => (
              <PickerRow
                key={store.id}
                label={store.username}
                active={storeId === store.id}
                onClick={() => {
                  setStoreId(store.id);
                  setUserId("");
                  setStorePickerOpen(false);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- user picker --- */}
      <Dialog open={userPickerOpen} onOpenChange={setUserPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter by user</DialogTitle>
            <DialogDescription>
              The owner has no employee record, so their events are listed separately.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-1">
            <PickerRow
              label="All users"
              active={userId === ""}
              onClick={() => {
                setUserId("");
                setUserPickerOpen(false);
              }}
            />
            <PickerRow
              label="Owner"
              active={userId === "owner"}
              onClick={() => {
                setUserId("owner");
                setUserPickerOpen(false);
              }}
            />
            {employees.map((employee) => (
              <PickerRow
                key={employee.id}
                label={employee.display_name || employee.username}
                active={userId === employee.id}
                onClick={() => {
                  setUserId(employee.id);
                  setUserPickerOpen(false);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PickerRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-[11px]" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
