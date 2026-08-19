"use client";

import { useEffect } from "react";
import { holdReload } from "./reloadGuard";

/**
 * Hold off a pending service-worker reload while `active` is true.
 *
 * One line at the call site:
 *   useReloadGuard(selectMode || isDialogOpen, "inventory-busy");
 *
 * The hold is released on cleanup, so unmounting mid-task cannot strand it.
 */
export function useReloadGuard(active: boolean, reason: string): void {
  useEffect(() => {
    if (!active) return;
    return holdReload(reason);
  }, [active, reason]);
}
