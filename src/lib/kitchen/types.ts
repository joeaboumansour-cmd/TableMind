// =============================================
// Kitchen tickets — domain types and the status machine
// =============================================
// Shared by the API route and the board. The transition rules live HERE and
// nowhere else, so the server cannot permit a move the UI hides, or vice versa.
// =============================================

export const TICKET_STATUSES = [
  "new",
  "in_progress",
  "ready",
  "served",
  "voided",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses that leave the board.
 *
 * A served or voided ticket is done: it stops being work. The board filters on
 * this rather than on a hardcoded list in two places.
 */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["served", "voided"];

export function isLiveStatus(status: TicketStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

/**
 * Which moves are legal.
 *
 * Backwards moves are deliberately allowed (ready -> in_progress, in_progress
 * -> new): a cook who taps the wrong card must be able to undo it without an
 * admin. What is NOT allowed is coming back from served or voided — those are
 * the two that mean "this ticket is finished", and re-opening one would make
 * the timestamps lie about when the food was actually handed over.
 */
export const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ["in_progress", "ready", "voided"],
  in_progress: ["ready", "new", "voided"],
  ready: ["served", "in_progress", "voided"],
  served: [],
  voided: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * The timestamp column a transition should stamp, if any.
 *
 * Only ever set going FORWARD into a state. Moving back to in_progress does
 * not clear ready_at — the ticket really did reach ready once, and erasing
 * that would hide a mistake rather than record it.
 */
export function timestampFieldFor(to: TicketStatus): "started_at" | "ready_at" | "served_at" | null {
  if (to === "in_progress") return "started_at";
  if (to === "ready") return "ready_at";
  if (to === "served") return "served_at";
  return null;
}

/** The columns the board shows, in order. Terminal statuses are not columns. */
export const BOARD_COLUMNS: readonly {
  status: TicketStatus;
  label: string;
  /** What tapping the primary action on a card in this column does. */
  advanceTo: TicketStatus;
  advanceLabel: string;
}[] = [
  { status: "new", label: "New", advanceTo: "in_progress", advanceLabel: "Start" },
  { status: "in_progress", label: "Preparing", advanceTo: "ready", advanceLabel: "Ready" },
  { status: "ready", label: "Ready", advanceTo: "served", advanceLabel: "Hand over" },
];

export interface KitchenTicketItem {
  id: string;
  product_name: string;
  quantity: number;
  /**
   * What was changed about this line, already formatted. The whole reason
   * migration 032 put modifiers on transaction_items rather than in a child
   * table: the board reads them with no join.
   */
  modifiers?: string[];
  /** Free-text instruction for this line — "cut in half". */
  note?: string | null;
}

export interface KitchenTicket {
  transaction_id: string;
  transaction_number: string;
  /** When the SALE happened — the clock the kitchen actually cares about. */
  created_at: string;
  status: TicketStatus;
  claimed_by: string | null;
  started_at: string | null;
  ready_at: string | null;
  items: KitchenTicketItem[];
}

/**
 * How long a ticket has been waiting, in milliseconds.
 *
 * Measured from the SALE, not from when the state row appeared — a ticket
 * nobody has touched has no state row at all, and the customer has still been
 * waiting since they paid.
 */
export function waitingMs(ticket: KitchenTicket, now: number = Date.now()): number {
  const started = Date.parse(ticket.created_at);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, now - started);
}

/** Past this, a ticket is called out. Matches the till's lane WAITING marker. */
export const TICKET_LATE_MS = 10 * 60 * 1000;

export function isLate(ticket: KitchenTicket, now: number = Date.now()): boolean {
  return ticket.status !== "ready" && waitingMs(ticket, now) >= TICKET_LATE_MS;
}

/** "4m", "12m", "1h 05m" — compact enough for a card corner. */
export function formatWaiting(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** Total units on a ticket — what the cook reads at a glance. */
export function unitCount(ticket: KitchenTicket): number {
  return ticket.items.reduce((sum, item) => sum + item.quantity, 0);
}
