"use client";

// =============================================
// LockScreenHost — the overlay that freezes the till.
//
// ## Why an overlay and not a route
//
// A /lock route would unmount the (shell) subtree. Zustand would persist the
// cart, but everything else locking exists to preserve is in memory: the
// scanner's MediaStream, the lane derivation done by onRehydrateStorage,
// checkout's typed amounts, open sheets, in-flight fetches. Lock must FREEZE
// the app, not navigate away from it. So this renders ON TOP of a tree that
// stays exactly where it was, and unlocking simply takes it away.
//
// It is mounted in providers.tsx — the only node that is above every app route,
// inside AuthProvider, and never remounted by navigation. AppShell would not
// do: it is not mounted on /login or /admin.
//
// ## Deep links and reloads
//
// Locked and someone pastes /pos/cash? The route mounts underneath as normal
// (it finds the session in localStorage, so it does not bounce to /login) and
// is simply covered. Unlock reveals it. Lock freezes; it does not navigate.
//
// A reload while locked comes back locked, because lockStore persists. See the
// hydration-ordering note there — the single unlocked frame during hydration is
// safe only because AuthProvider loads the user in a mount effect.
//
// ## No reload guard, deliberately
//
// This takes NO useReloadGuard hold. A locked till is the best moment in the
// day to apply a pending service-worker update: nothing is typed, nothing is
// selected, and the lock survives the reload. Holding here would starve deploys
// on exactly the tills that sit locked overnight. PWAUpdateListener still
// refuses to reload while a lane holds items, which is the part that protects
// money and is unchanged.
// =============================================

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useIsLocked, getLockContext, unlockSession } from "@/lib/auth/lockStore";
import AuthFlow from "./AuthFlow";
import OfflinePill from "./OfflinePill";

export function LockScreenHost() {
  const locked = useIsLocked();
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const container = useRef<HTMLDivElement | null>(null);

  const onLocked = locked && !isAuthRoute(pathname);

  // Move focus into the overlay so a keyboard user is not left tabbing around
  // the frozen app behind it.
  useEffect(() => {
    if (!onLocked) return;
    container.current?.focus();
  }, [onLocked]);

  // Keep Tab inside the overlay. The app underneath is still in the DOM — that
  // is the point — so without this a cashier could tab into a cart line.
  useEffect(() => {
    if (!onLocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = container.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onLocked]);

  const handleSignOut = useCallback(() => {
    // logout() clears the lock flag itself, but call it here too so the overlay
    // is gone before the navigation rather than after it.
    unlockSession();
    logout();
    router.push("/login");
  }, [logout, router]);

  if (!onLocked) return null;

  const ctx = getLockContext();

  return (
    <div
      ref={container}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Till locked"
      // z-[60] clears the dialogs at z-50 and still sits under sonner, so a
      // toast fired by the unlock stays visible.
      className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-background outline-none"
    >
      <div className="safe-top flex items-center justify-between px-5 pb-3 pt-4">
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Lock className="h-4.5 w-4.5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold">Till locked</span>
            <span className="block text-[11.5px] text-muted-foreground">
              Your sale is still here
            </span>
          </span>
        </span>
        <OfflinePill />
      </div>

      <main className="flex min-h-0 flex-1 flex-col md:items-center md:justify-center">
        <div className="flex min-h-0 w-full flex-1 flex-col md:max-w-[420px] md:flex-none md:rounded-3xl md:border md:border-white/[0.07] md:bg-card md:py-5">
          <AuthFlow
            mode="lock"
            lockedStoreUsername={ctx?.storeUsername}
            lockedUsername={ctx?.username}
            onAuthenticated={unlockSession}
            onSignOut={handleSignOut}
          />
        </div>
      </main>
    </div>
  );
}

/** A lock over the login or admin screen is a dead end nobody can get out of. */
function isAuthRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/login") || pathname.startsWith("/admin");
}

export default LockScreenHost;
