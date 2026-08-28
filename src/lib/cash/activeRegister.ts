// =============================================
// The device's register selection
// =============================================
// Which physical drawer THIS device rings sales into.
//
// This is deliberately device-local and never synced. Two tills in the same
// store are two different drawers, and they share a store_id, a login and a
// product cache — the only thing that distinguishes them is which machine you
// are standing at. Putting this on the user or the store would make both tills
// claim the same drawer.
//
// It is read at checkout and sent as `register_id` with every sale. The SERVER
// resolves which shift that belongs to, by matching the sale's created_at
// against the register's shift windows — see POST /api/transactions. That is
// what keeps offline sales correct: a sale rung during shift A and synced after
// shift B opened still lands on A, because resolution is by time rather than by
// "what happens to be open at sync time".
// =============================================

const STORAGE_KEY = "goldensquirrel_register";

export interface ActiveRegister {
  id: string;
  name: string;
}

/**
 * The register this device is assigned to, or null.
 *
 * Null is a normal, supported state — it means sales go into the Unassigned
 * bucket on the cash page. It must never block a sale.
 */
export function getActiveRegister(): ActiveRegister | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.id !== "string" || !parsed.id) return null;
    return { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : "" };
  } catch {
    return null;
  }
}

/** Convenience for the sale payload — the id alone, or undefined. */
export function getActiveRegisterId(): string | undefined {
  return getActiveRegister()?.id ?? undefined;
}

export function setActiveRegister(register: ActiveRegister | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!register) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: register.id, name: register.name }));
  } catch {
    // A full or disabled storage must not break the till.
  }
}

/**
 * Keep the stored selection honest against the registers that actually exist.
 *
 * Two jobs, both about not making the user configure anything they shouldn't
 * have to:
 *
 *  - **Auto-select when there is exactly one register.** Almost every store has
 *    one drawer. Those stores should never see a picker, and their sales must
 *    be attributed without anyone opting in — otherwise this feature silently
 *    breaks reconciliation for the majority to serve the minority.
 *  - **Drop a stale selection.** A register that was renamed gets its name
 *    refreshed; one that was deleted or deactivated is cleared rather than left
 *    pointing at nothing.
 *
 * Returns the resulting selection.
 */
export function reconcileActiveRegister(
  registers: Array<{ id: string; name: string; is_active?: boolean }>
): ActiveRegister | null {
  const live = registers.filter((r) => r.is_active !== false);
  const current = getActiveRegister();

  if (current) {
    const match = live.find((r) => r.id === current.id);
    if (match) {
      // Pick up a rename so the till header does not show a dead name.
      if (match.name !== current.name) {
        const updated = { id: match.id, name: match.name };
        setActiveRegister(updated);
        return updated;
      }
      return current;
    }
    // Selection points at a register that is gone or deactivated.
    setActiveRegister(null);
  }

  if (live.length === 1) {
    const only = { id: live[0].id, name: live[0].name };
    setActiveRegister(only);
    return only;
  }

  return null;
}
