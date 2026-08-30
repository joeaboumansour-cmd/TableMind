"use client";

// =============================================
// One kitchen ticket
// =============================================
// Sized for a phone held in a kitchen, by someone whose hands are full: the
// primary action is a full-width button, not an icon.
// =============================================

import { Badge } from "@/components/ui/badge";
import {
  formatWaiting,
  isLate,
  unitCount,
  waitingMs,
  type KitchenTicket,
  type TicketStatus,
} from "@/lib/kitchen/types";

interface TicketCardProps {
  ticket: KitchenTicket;
  /** Re-rendered by the parent's clock so the waiting time actually ticks. */
  now: number;
  advanceTo: TicketStatus;
  advanceLabel: string;
  /** Null in the first column — there is nothing to go back to. */
  backTo: TicketStatus | null;
  busy: boolean;
  onMove: (ticket: KitchenTicket, to: TicketStatus) => void;
}

export default function TicketCard({
  ticket,
  now,
  advanceTo,
  advanceLabel,
  backTo,
  busy,
  onMove,
}: TicketCardProps) {
  const late = isLate(ticket, now);
  const waited = formatWaiting(waitingMs(ticket, now));
  const units = unitCount(ticket);

  return (
    <li
      className={`rounded-2xl border bg-card p-4 transition-opacity ${
        busy ? "opacity-60" : ""
      } ${late ? "border-destructive" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold tabular-nums">#{ticket.transaction_number}</p>
          <p className="text-xs text-muted-foreground">
            {units} {units === 1 ? "item" : "items"}
            {ticket.claimed_by ? ` · ${ticket.claimed_by}` : ""}
          </p>
        </div>
        <Badge variant={late ? "destructive" : "secondary"} className="shrink-0 tabular-nums">
          {waited}
        </Badge>
      </div>

      <ul className="mt-3 space-y-1">
        {ticket.items.map((item) => (
          <li key={item.id} className="flex gap-2 text-sm">
            <span className="w-7 shrink-0 font-semibold tabular-nums text-primary">
              {item.quantity}&times;
            </span>
            <span className="min-w-0 break-words">
              {item.product_name}
              {/* The changes are the part a cook can get wrong, so they are
                  called out rather than tucked in with the name. */}
              {item.combo_children && item.combo_children.length > 0 && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {item.combo_children.map((label) => (
                    <span
                      key={label}
                      className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary"
                    >
                      {label}
                    </span>
                  ))}
                </span>
              )}
              {item.modifiers && item.modifiers.length > 0 && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {item.modifiers.map((label) => (
                    <span
                      key={label}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                        label.startsWith("No ")
                          ? "bg-destructive/20 text-destructive"
                          : "bg-primary/20 text-primary"
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </span>
              )}
              {/* A note is an instruction, not an ingredient — it gets its own
                  line so a cook cannot mistake it for one. */}
              {item.note && (
                <span className="mt-0.5 block text-xs italic text-muted-foreground">
                  “{item.note}”
                </span>
              )}
            </span>
          </li>
        ))}
        {ticket.items.length === 0 && (
          <li className="text-sm text-muted-foreground">No line items recorded</li>
        )}
      </ul>

      <div className="mt-4 flex gap-2">
        {backTo && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(ticket, backTo)}
            aria-label="Move back"
            className="min-h-12 rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground disabled:opacity-50"
          >
            Back
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onMove(ticket, advanceTo)}
          className="min-h-12 flex-1 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {advanceLabel}
        </button>
      </div>
    </li>
  );
}
