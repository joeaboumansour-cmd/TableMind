/**
 * The passive UI trail.
 *
 * Explicit `logActivity()` calls record what the app MEANT to do. This records
 * what the person actually touched — every click, every field they changed,
 * every shortcut — without needing a call site for each one.
 *
 * What it deliberately does not do:
 *  - record individual keypresses. Only named shortcuts (ALT+n, F-keys,
 *    Ctrl/Cmd combos) are logged; a barcode wedge alone would otherwise
 *    produce thirteen rows per scan.
 *  - read the value of anything that looks like a credential. See shouldRedact().
 *  - infer modal dismissal from a click. Open/submit/discard are logged
 *    explicitly at the dialogs, because "discarded" and "confirmed" have to be
 *    distinguishable and a click on a backdrop cannot tell you which happened.
 *
 * All listeners are passive and in the capture phase, so nothing here can
 * interfere with the app's own handlers or with scrolling.
 */

import { logActivity } from "./logger";

/** Elements that count as "the thing that was clicked", nearest first. */
const ACTIONABLE_SELECTOR =
  "[data-log],button,a,input,select,textarea,[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='switch'],label";

const SENSITIVE_FIELD = /pass|secret|token|credential|pin|otp|cvv|card/i;

let started = false;

// The value a field had when it received focus, so blur can tell whether it
// actually changed. Keyed by element to survive concurrent focus in odd cases.
const focusValues = new WeakMap<Element, string>();

function nearestActionable(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(ACTIONABLE_SELECTOR) ?? target;
}

/**
 * A stable, human-readable name for an element.
 *
 * `data-log` wins, so anything worth naming precisely can be named in the JSX
 * without this file knowing about it.
 */
function describe(el: Element | null): string {
  if (!el) return "unknown";

  const explicit = el.getAttribute("data-log");
  if (explicit && explicit !== "redact") return explicit;

  const aria = el.getAttribute("aria-label");
  if (aria) return aria;

  const title = el.getAttribute("title");
  if (title) return title;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
    if (el.name) return el.name;
    if (el.id) return el.id;
  }

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 80);

  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  return role ? `${tag}[${role}]` : tag;
}

/**
 * Should this field's value never be recorded?
 *
 * Errs towards yes. A field wrongly redacted costs a little detail in the
 * trail; a password written into a table the admin console renders is a
 * different kind of problem entirely.
 */
function shouldRedact(el: Element): boolean {
  if (el.closest('[data-log="redact"]')) return true;

  if (el instanceof HTMLInputElement) {
    if (el.type === "password") return true;
    const autocomplete = el.getAttribute("autocomplete") ?? "";
    if (/password|cc-|one-time-code/.test(autocomplete)) return true;
    if (SENSITIVE_FIELD.test(`${el.name} ${el.id} ${el.getAttribute("placeholder") ?? ""}`)) {
      return true;
    }
  }
  return false;
}

function readValue(el: Element): string | null {
  if (shouldRedact(el)) return null;

  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return String(el.checked);
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) {
    return el.selectedOptions[0]?.textContent?.trim() ?? el.value;
  }
  return null;
}

function isTrackedField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

// ---- handlers ---------------------------------------------------------------

function onClick(event: Event): void {
  const el = nearestActionable(event.target);
  if (!el) return;

  logActivity("ui.click", {
    target: describe(el),
    details: {
      tag: el.tagName.toLowerCase(),
      // Disabled controls still emit clicks on their wrapper; knowing the
      // control was inert explains "they clicked and nothing happened".
      disabled: el instanceof HTMLButtonElement ? el.disabled : undefined,
    },
  });
}

function onFocusIn(event: FocusEvent): void {
  const el = event.target;
  if (!isTrackedField(el)) return;
  const value = readValue(el);
  focusValues.set(el, value ?? "");
}

function onFocusOut(event: FocusEvent): void {
  const el = event.target;
  if (!isTrackedField(el)) return;

  const before = focusValues.get(el);
  focusValues.delete(el);

  const redacted = shouldRedact(el);
  const after = readValue(el) ?? "";

  // Nothing changed — a focus that went nowhere is not worth a row.
  if (!redacted && before === after) return;
  // A redacted field can only report *that* it was edited, never what to.
  if (redacted && before === "") return;

  logActivity("ui.field_commit", {
    target: describe(el),
    details: redacted
      ? { redacted: true }
      : {
          value: after,
          // The previous value is what makes a price edit auditable.
          previous: before,
          field_type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        },
  });
}

function onKeyDown(event: KeyboardEvent): void {
  // Named shortcuts only. Plain typing is captured once, on commit, by
  // onFocusOut — never key by key.
  let combo: string | null = null;

  if (event.altKey && /^[1-9]$/.test(event.key)) {
    combo = `ALT+${event.key}`;
  } else if (/^F([1-9]|1[0-2])$/.test(event.key)) {
    combo = event.key;
  } else if ((event.ctrlKey || event.metaKey) && event.key.length === 1) {
    combo = `${event.ctrlKey ? "CTRL" : "CMD"}+${event.key.toUpperCase()}`;
  } else if (event.key === "Escape") {
    combo = "ESC";
  }

  if (!combo) return;

  logActivity("ui.shortcut", {
    target: combo,
    details: { on: describe(nearestActionable(event.target)) },
  });
}

function onError(event: ErrorEvent): void {
  logActivity("error.uncaught", {
    target: event.message,
    details: {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    },
  });
}

function onRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  logActivity("error.uncaught", {
    target: reason instanceof Error ? reason.message : String(reason),
    details: { kind: "unhandledrejection" },
  });
}

// ---- lifecycle --------------------------------------------------------------

export function startDomTracking(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("focusin", onFocusIn, { capture: true, passive: true });
  document.addEventListener("focusout", onFocusOut, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
}

export function stopDomTracking(): void {
  if (!started || typeof window === "undefined") return;
  started = false;

  document.removeEventListener("click", onClick, true);
  document.removeEventListener("focusin", onFocusIn, true);
  document.removeEventListener("focusout", onFocusOut, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
}
