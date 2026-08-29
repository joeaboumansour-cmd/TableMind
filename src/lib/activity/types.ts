/**
 * The vocabulary of the activity trail.
 *
 * Every event the app can emit is named here, once. The emitters, the admin
 * filter dropdown and the server-side validation all read this file, so they
 * cannot drift apart — an action the client invents but never declares is
 * rejected at ingest rather than quietly polluting the log.
 *
 * Adding an event = add a string to ACTIVITY_ACTIONS. No migration needed;
 * `category` and `action` are plain TEXT in Postgres deliberately.
 */

export const ACTIVITY_CATEGORIES = [
  "cart",
  "catalog",
  "sale",
  "cash",
  "kitchen",
  "auth",
  "nav",
  "ui",
  "sync",
  "connectivity",
  "error",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/**
 * Every action name is `<category>.<verb>`, so the category is derivable and
 * can never disagree with the action. See categoryForAction().
 */
export const ACTIVITY_ACTIONS = [
  // --- Cart (emitted from cartStore, so nothing can mutate the cart unlogged)
  "cart.add",
  "cart.add_one_off",
  "cart.remove",
  "cart.quantity",
  "cart.line_edit",
  // Made-to-order: a line built from a recipe, and any later change to it.
  // Both carry what was removed and what was added, because "no pickles" is
  // exactly the kind of thing a customer later disputes.
  "cart.configure",
  "cart.modifiers_changed",
  "cart.clear",
  "cart.lane_open",
  "cart.lane_close",
  "cart.lane_switch",

  // --- Catalogue
  "catalog.product_create",
  "catalog.product_update",
  "catalog.product_reprice",
  "catalog.product_delete",
  "catalog.bulk_apply",
  "catalog.export",
  "catalog.favorite_toggle",
  "catalog.scan_hit",
  "catalog.scan_miss",

  // --- Sale
  "sale.checkout_open",
  "sale.payment",
  "sale.cleared",
  "sale.new",
  "sale.receipt_share",
  "sale.receipt_print",

  // --- Cash register
  "cash.shift_open",
  "cash.shift_close",
  "cash.adjustment",
  "cash.register_create",
  "cash.register_rename",
  "cash.register_deactivate",
  "cash.register_delete",
  "cash.shift_assign",
  // Emitted once per page load when a register is showing an overdue shift, so
  // the trail records that somebody was told the drawer still needs counting.
  "cash.shift_overdue_seen",
  "cash.request_approve",
  "cash.request_reject",

  // --- Kitchen display
  // One row per ticket move. The board is a shared surface several people
  // touch, so who advanced which order is the whole point of logging it.
  "kitchen.ticket_move",

  // --- Auth
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.permission_denied",

  // --- Navigation
  "nav.route",

  // --- UI
  // ui.click and ui.field_commit come from the passive trail in domTracker.ts,
  // which is currently switched OFF (see UI_TRAIL there) — they were ~60-70% of
  // all rows. They stay in the vocabulary so flipping that switch back on needs
  // no server or admin-UI change. Everything below them is emitted explicitly
  // and is still live.
  "ui.click",
  "ui.field_commit",
  "ui.shortcut",
  "ui.modal_open",
  "ui.modal_submit",
  "ui.modal_discard",
  "ui.app_hidden",
  "ui.app_visible",
  "ui.filter_change",
  "ui.view_change",
  "ui.detail_open",
  "ui.load_more",

  // --- Sync engine
  "sync.start",
  "sync.finish",
  "sync.dead_letter",
  "sync.write_dropped",
  "sync.retry_requested",
  "sync.dismissed",

  // --- Connectivity
  "connectivity.offline",
  "connectivity.online",

  // --- Errors
  "error.uncaught",
  "error.handled",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(ACTIVITY_ACTIONS);
const CATEGORY_SET: ReadonlySet<string> = new Set(ACTIVITY_CATEGORIES);

export function isKnownAction(value: unknown): value is ActivityAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

export function isKnownCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

/** The category is the part of the action before the dot — never stored separately by hand. */
export function categoryForAction(action: ActivityAction): ActivityCategory {
  return action.slice(0, action.indexOf(".")) as ActivityCategory;
}

/**
 * One recorded event, exactly as it is buffered locally and posted to the
 * server. `store_id` and the user fields are baked in at the moment the event
 * happens, NOT looked up at flush time: logout() clears goldensquirrel_auth,
 * so a buffered event that tried to reconstruct them later would be sent with
 * an empty auth header and rejected.
 */
export interface ActivityEvent {
  client_event_id: string;
  store_id: string;
  user_id?: string;
  user_name?: string;
  session_id: string;
  device_id?: string;
  category: ActivityCategory;
  action: ActivityAction;
  target?: string;
  details: Record<string, unknown>;
  route?: string;
  is_offline: boolean;
  /** ISO string, client clock, captured when the action happened. */
  occurred_at: string;
}

/**
 * Retention window, in whole UTC days including today.
 *
 * This constant is the ONE place retention is decided: POST /api/activity
 * passes it to maintain_activity_log_partitions() explicitly on every call, so
 * the SQL default only ever applies to a manual invocation.
 *
 * Consequence worth knowing before lowering it further: a device that has been
 * offline for longer than this window has its buffered events DROPPED at
 * ingest, because there is no partition for them to land in. At 3 days a till
 * that is offline over a long weekend still loses the earliest of it.
 */
// Annotated as `number`, not left to infer the literal 3: it is a tunable
// setting, and a literal type makes ordinary comparisons against it (pluralising
// a label, bounds checks) fail to compile at every call site.
export const ACTIVITY_RETENTION_DAYS: number = 3;

/** Caps, shared by the client (before buffering) and the server (before insert). */
export const ACTIVITY_LIMITS = {
  /** Longest any single string field is allowed to be. */
  maxStringLength: 200,
  /** Longest a serialised `details` object is allowed to be. */
  maxDetailsBytes: 2048,
  /** Most events one POST /api/activity request may carry. */
  maxEventsPerRequest: 200,
  /** Largest acceptable request body. */
  maxRequestBytes: 256 * 1024,
} as const;
