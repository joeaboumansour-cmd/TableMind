"use client";

// =============================================
// Login
//
// A till lives on one counter, in one shop, and serves the same handful of
// people every day — so almost everything the old three-field form asked for
// was already known to the device. The store is remembered and pinned at the
// top; the people this device has seen appear as chips; four digits gets you
// back in. Typing a full credential is now the exception (a new hire, a new
// till, a cold PIN), not the daily path.
//
// The flow itself lives in AuthFlow, shared with the lock overlay, so the two
// can never drift on who is allowed in. This page is chrome plus navigation.
//
// LAYOUT: structure branches on Tailwind `md:` utilities, not useIsDesktop().
// CSS has no hydration flash and cannot drift from the breakpoint.
// AuthFlow keeps the one behavioural desktop branch (autofocus), where the
// difference is about input hardware rather than about layout.
// =============================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useLandingRoute } from "@/hooks/useLandingRoute";
import { Loader2 } from "lucide-react";
import AuthFlow from "@/components/auth/AuthFlow";
import OfflinePill from "@/components/auth/OfflinePill";

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
        <svg viewBox="0 0 32 32" className="h-6 w-6 text-primary-foreground" fill="currentColor" aria-hidden>
          <ellipse cx="18" cy="22" rx="6" ry="7" />
          <circle cx="24" cy="14" r="5" />
          <ellipse cx="28" cy="15" rx="3" ry="2.5" />
          <path d="M22 10 L24 6 L26 10 Z" />
          <circle cx="25" cy="13" r="1.2" fill="#FEF3C7" />
          <ellipse cx="22" cy="20" rx="2" ry="3" />
          <ellipse cx="14" cy="24" rx="2.5" ry="4" />
          <path d="M12 20 C 8 18, 6 14, 6 10 C 6 4, 10 2, 14 4 C 17 5, 18 8, 16 10 C 14 12, 11 10, 12 8 C 12 6, 14 6, 15 7 C 16 8, 16 10, 14 12 C 12 14, 10 16, 12 20 Z" />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="text-[17px] font-bold tracking-tight">GoldenSquirrel</p>
        <p className="text-[12px] text-muted-foreground">Point of Sale</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { href: landingHref, resolved: landingResolved } = useLandingRoute();

  // Set when AuthFlow says it is FINISHED — which is not the same moment the
  // credential is accepted. The screen keeps its own chrome up while the landing
  // route resolves, rather than flashing an empty page or dropping the cashier
  // on a screen their permissions bounce them off.
  const [navigating, setNavigating] = useState(false);

  const handleAuthenticated = useCallback(() => {
    setNavigating(true);
  }, []);

  // Was there already a session when this screen mounted?
  //
  // This distinction is load-bearing. "A user exists" is NOT the signal to
  // navigate: a password sign-in creates the session and THEN offers to set a
  // PIN, so navigating the moment `user` appears yanks the screen out from under
  // that offer mid-tap. Someone who merely lands on /login with a live session
  // has no flow to finish and should be moved on at once.
  const arrivedSignedIn = useRef<boolean | null>(null);
  if (arrivedSignedIn.current === null && !authLoading) {
    arrivedSignedIn.current = Boolean(user);
  }

  // The one navigation effect, covering both cases above.
  //
  // router.replace, NOT window.location.href. The old page did a hard navigation
  // behind a setTimeout(100), which threw away the JS context — the service
  // worker, the warm Dexie connection, the whole module graph — and rebuilt it
  // from scratch on the slowest screen transition in the app. Nothing needs the
  // delay: both localStorage writes complete before login() resolves.
  useEffect(() => {
    if (authLoading || !user) return;
    if (!arrivedSignedIn.current && !navigating) return;
    if (!landingResolved) return;
    router.replace(landingHref ?? "/pos");
  }, [authLoading, user, navigating, landingResolved, landingHref, router]);

  // Signed in, no reachable section. Navigating would drop them into a guard
  // that bounces straight back here, so say what is wrong instead.
  const strandedNoAccess = Boolean(user && landingResolved && landingHref === null);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* ---- Mobile: header, flow, footer. The pad sits in the thumb zone. ----
           ---- Desktop (md:): the same column, centred and capped.        ---- */}
      <div className="safe-top flex items-center justify-between px-5 pb-3 pt-4 md:justify-center md:pt-10">
        <BrandMark />
        <div className="md:hidden">
          <OfflinePill />
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col md:items-center md:justify-center">
        <div className="flex min-h-0 w-full flex-1 flex-col md:max-w-[420px] md:flex-none md:rounded-3xl md:border md:border-white/[0.07] md:bg-card md:py-5">
          {navigating || strandedNoAccess ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
              {strandedNoAccess ? (
                <>
                  <p className="text-[15px] font-semibold">No sections are enabled</p>
                  <p className="max-w-[20rem] text-[13px] leading-snug text-muted-foreground">
                    Your account is signed in but has nothing it can open. Ask
                    the store owner to give you access.
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-[14px] font-semibold text-muted-foreground">
                    Opening your till…
                  </p>
                </>
              )}
            </div>
          ) : (
            <AuthFlow mode="login" onAuthenticated={handleAuthenticated} />
          )}
        </div>
      </main>

      <footer className="safe-bottom flex items-center justify-center gap-3 px-5 pb-4 pt-2">
        <span className="hidden md:inline">
          <OfflinePill />
        </span>
        <span className="text-[11px] text-muted-foreground md:hidden">
          Golden Squirrel POS
        </span>
      </footer>
    </div>
  );
}
