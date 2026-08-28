// =============================================
// Cash register domain types
// =============================================
// Mirrors supabase/migrations/027_multi_register.sql. The vocabularies here are
// CLOSED — the database has matching CHECK constraints, so adding a value in
// one place without the other produces a runtime insert failure, not a type
// error. Change both.
// =============================================

export type ShiftStatus = "open" | "closed";

export type RequestKind =
  | "refund_sold_item"
  | "price_override"
  | "void_line"
  | "discount_override"
  | "cash_out";

export type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

/** Human labels for the request vocabulary, used by the decision modal. */
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  refund_sold_item: "Refund a sold item",
  price_override: "Override a price",
  void_line: "Void a cart line",
  discount_override: "Apply a discount",
  cash_out: "Take cash out of the drawer",
};

export interface CashRegister {
  id: string;
  store_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface CashShift {
  id: string;
  store_id: string;
  register_id: string;
  /** The day the shift was OPENED. A label, not the shift's identity or bounds. */
  business_date: string;
  label: string | null;
  status: ShiftStatus;
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

export interface CashAdjustment {
  id: string;
  shift_id: string;
  adjustment_type: "cash_in" | "cash_out";
  amount_ll: number;
  amount_usd: number;
  reason: string;
  created_by_name: string | null;
  created_at: string;
}

/** Per-shift money figures, computed once in lib/cashShift.ts. */
export interface ShiftSummary {
  openingTotal: number;
  /** Cash that physically entered the drawer, net of change already given. */
  cashReceived: number;
  adjustmentsIn: number;
  adjustmentsOut: number;
  expectedTotal: number;
  closingTotal: number | null;
  /** Positive = overage, negative = shortage, null until the shift is counted. */
  variance: number | null;
  transactionCount: number;
  /** Display only. NEVER added back into the LL totals — see summariseShift(). */
  usdCashReceived: number;
}

/** A register plus its current shift and that shift's figures. */
export interface RegisterState {
  register: CashRegister;
  shift: CashShift | null;
  summary: ShiftSummary | null;
  adjustments: CashAdjustment[];
  pendingRequestCount: number;
}

export interface RegisterRequest {
  id: string;
  store_id: string;
  register_id: string;
  register_name?: string;
  shift_id: string | null;
  kind: RequestKind;
  status: RequestStatus;
  requested_by: string | null;
  requested_by_name: string;
  reason: string | null;
  payload: Record<string, unknown>;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  created_at: string;
}

// ── Shift age ────────────────────────────────────────────────────────────────

/** Whole hours a shift has been open. Returns 0 for a closed or missing shift. */
export function shiftAgeHours(shift: CashShift | null | undefined): number {
  if (!shift || shift.status !== "open") return 0;
  const opened = new Date(shift.opened_at).getTime();
  if (!Number.isFinite(opened)) return 0;
  return Math.max(0, Math.floor((Date.now() - opened) / 3_600_000));
}

/**
 * A shift is overdue when it is still open and was opened before today began.
 *
 * This is the single definition of "should have been counted by now". It is
 * deliberately calendar-based rather than a fixed hour count: a shift opened at
 * 22:00 and still open at 02:00 is only four hours old but has already crossed
 * the day the responsible person will be reconciling against.
 *
 * Overdue NEVER means the shift gets closed. Nothing in this codebase closes a
 * shift — a closing figure is a physical count, and a machine inventing one is
 * how a drawer's variance silently disappears.
 */
export function isOverdue(shift: CashShift | null | undefined): boolean {
  if (!shift || shift.status !== "open") return false;
  const opened = new Date(shift.opened_at);
  if (Number.isNaN(opened.getTime())) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return opened.getTime() < startOfToday.getTime();
}
