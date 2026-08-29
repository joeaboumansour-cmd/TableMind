"use client";

// =============================================
// /kitchen — the kitchen board
// =============================================
// MOBILE FIRST. A kitchen runs on a phone or a cheap tablet propped by the
// pass, so the primary layout is one column of large cards with a status
// filter above it. Wider screens get the three columns side by side, but that
// is the enhancement, not the design.
//
// ## This screen is ONLINE ONLY, and says so
//
// Unlike the till, this cannot work offline: it is a shared view of state
// several people change. The dangerous failure is not an error, it is an EMPTY
// BOARD, which reads as "no orders" — so a disconnected board says so loudly
// and keeps showing the last tickets it had.
//
// ## No reload guard
//
// Deliberate. This is a display, not a data-entry screen; a service-worker
// update losing nothing is the correct behaviour here. Compare the till, which
// holds typed state and takes a hold via useReloadGuard.
// =============================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, WifiOff, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { PermissionGuard } from "@/lib/auth/guards";
import { FeatureFlagGuard } from "@/lib/auth/featureGuard";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { connectivity } from "@/lib/connectivity";
import { logActivity } from "@/lib/activity/logger";
import TicketCard from "@/components/kitchen/TicketCard";
import {
  BOARD_COLUMNS,
  type KitchenTicket,
  type TicketStatus,
} from "@/lib/kitchen/types";

/** How often the board asks for new tickets while it is visible and online. */
const POLL_MS = 8000;
/** How often the waiting timers re-render. Independent of the network. */
const TICK_MS = 15000;

function KitchenBoard() {
  const { user } = useAuth();
  const storeId = user?.storeId;

  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [activeColumn, setActiveColumn] = useState<TicketStatus>("new");
  const [now, setNow] = useState(() => Date.now());

  // Guards against a slow poll landing after a newer one, which would make the
  // board flicker back to stale content.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!storeId) return;
    const seq = ++requestSeq.current;
    try {
      const response = await fetch("/api/kitchen/tickets", {
        headers: buildAuthHeaders(user),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const body = (await response.json()) as { tickets?: KitchenTicket[] };
      if (seq !== requestSeq.current) return; // a newer poll already answered
      setTickets(Array.isArray(body.tickets) ? body.tickets : []);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // Keep whatever is on screen. An empty board reads as "no orders", which
      // is the one thing this failure must never look like.
      setError(err instanceof Error ? err.message : "Could not reach the server");
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [storeId, user]);

  // Poll while online. Pauses when the tab is hidden so a board left on a
  // counter overnight is not hammering the API.
  useEffect(() => {
    if (!storeId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void load();
      timer = setInterval(() => {
        if (document.visibilityState === "visible" && connectivity.isOnline) void load();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // The listener is handed a "online" | "offline" status, not a boolean.
    const unsubscribe = connectivity.subscribe((status) => {
      const online = status === "online";
      setIsOnline(online);
      if (online) void load();
    });
    setIsOnline(connectivity.isOnline);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [storeId, load]);

  // The waiting badges must keep counting even when nothing is fetched.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const byStatus = useMemo(() => {
    const grouped: Record<string, KitchenTicket[]> = {};
    for (const column of BOARD_COLUMNS) grouped[column.status] = [];
    for (const ticket of tickets) {
      if (grouped[ticket.status]) grouped[ticket.status].push(ticket);
    }
    return grouped;
  }, [tickets]);

  const move = useCallback(
    async (ticket: KitchenTicket, to: TicketStatus) => {
      const id = ticket.transaction_id;
      setBusyIds((prev) => new Set(prev).add(id));

      // Optimistic: a cook tapping "Start" must see it move immediately, on a
      // connection that is often poor. Rolled back below if the server refuses.
      const previous = ticket.status;
      setTickets((prev) =>
        to === "served" || to === "voided"
          ? prev.filter((t) => t.transaction_id !== id)
          : prev.map((t) => (t.transaction_id === id ? { ...t, status: to } : t))
      );

      try {
        const response = await fetch("/api/kitchen/tickets", {
          method: "PATCH",
          headers: buildAuthHeaders(user),
          body: JSON.stringify({ transaction_id: id, from: previous, to }),
        });

        if (response.status === 409) {
          // Another station got there first. Their move is the real one.
          setError("That ticket was already moved by someone else");
          await load();
          return;
        }
        if (!response.ok) throw new Error(`API error ${response.status}`);

        setError(null);
        logActivity("kitchen.ticket_move", {
          target: ticket.transaction_number,
          details: { transaction_id: id, from: previous, to },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the ticket");
        await load(); // the server is the truth; re-read rather than guess
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [load, user]
  );

  const activeTickets = byStatus[activeColumn] || [];

  return (
    <div className="min-h-full bg-background pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <ChefHat className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="flex-1 text-lg font-semibold">Kitchen</h1>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh"
            className="min-h-11 min-w-11 rounded-xl border border-border p-2 text-muted-foreground"
          >
            <RefreshCw className="mx-auto h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Status filter — the mobile substitute for three columns. */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
          {BOARD_COLUMNS.map((column) => {
            const count = (byStatus[column.status] || []).length;
            const selected = activeColumn === column.status;
            return (
              <button
                key={column.status}
                type="button"
                onClick={() => setActiveColumn(column.status)}
                aria-pressed={selected}
                className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {column.label}
                <span className="ml-2 tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {!isOnline && (
        <div
          role="status"
          className="mx-4 mt-4 flex items-center gap-2 rounded-xl border border-destructive bg-destructive/10 p-3 text-sm"
        >
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Kitchen is offline — this board is not updating. Orders are still being taken.
          </span>
        </div>
      )}

      {error && isOnline && (
        <div role="status" className="mx-4 mt-4 rounded-xl border border-border p-3 text-sm text-muted-foreground">
          {error}
        </div>
      )}

      {/* Mobile: the selected column only. */}
      <div className="md:hidden">
        <TicketList
          tickets={activeTickets}
          column={BOARD_COLUMNS.find((c) => c.status === activeColumn)!}
          isLoading={isLoading}
          now={now}
          busyIds={busyIds}
          onMove={move}
        />
      </div>

      {/* Wider screens: all three at once. */}
      <div className="hidden gap-4 p-4 md:grid md:grid-cols-3">
        {BOARD_COLUMNS.map((column) => (
          <section key={column.status} className="min-w-0">
            <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
              {column.label}
              <span className="ml-2 tabular-nums">{(byStatus[column.status] || []).length}</span>
            </h2>
            <TicketList
              tickets={byStatus[column.status] || []}
              column={column}
              isLoading={isLoading}
              now={now}
              busyIds={busyIds}
              onMove={move}
              flush
            />
          </section>
        ))}
      </div>
    </div>
  );
}

function TicketList({
  tickets,
  column,
  isLoading,
  now,
  busyIds,
  onMove,
  flush = false,
}: {
  tickets: KitchenTicket[];
  column: (typeof BOARD_COLUMNS)[number];
  isLoading: boolean;
  now: number;
  busyIds: Set<string>;
  onMove: (ticket: KitchenTicket, to: TicketStatus) => void;
  flush?: boolean;
}) {
  // Going back means the previous column; the first column has nowhere to go.
  const index = BOARD_COLUMNS.findIndex((c) => c.status === column.status);
  const backTo = index > 0 ? BOARD_COLUMNS[index - 1].status : null;

  if (isLoading && tickets.length === 0) {
    return <p className={`text-sm text-muted-foreground ${flush ? "px-1" : "p-4"}`}>Loading…</p>;
  }

  if (tickets.length === 0) {
    return (
      <p className={`text-sm text-muted-foreground ${flush ? "px-1" : "p-4"}`}>
        Nothing {column.label.toLowerCase()}.
      </p>
    );
  }

  return (
    <ul className={`space-y-3 ${flush ? "" : "p-4"}`}>
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.transaction_id}
          ticket={ticket}
          now={now}
          advanceTo={column.advanceTo}
          advanceLabel={column.advanceLabel}
          backTo={backTo}
          busy={busyIds.has(ticket.transaction_id)}
          onMove={onMove}
        />
      ))}
    </ul>
  );
}

export default function KitchenPage() {
  return (
    <PermissionGuard section="kitchen">
      <FeatureFlagGuard feature="kitchen_display">
        <KitchenBoard />
      </FeatureFlagGuard>
    </PermissionGuard>
  );
}
