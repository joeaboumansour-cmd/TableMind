"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/AuthContext";
import ViewportHeightSync from "@/components/ViewportHeightSync";

// NOTE: TanStack Query was previously mounted here but never used — there were
// zero useQuery/useMutation calls in the app. It was removed in the Aug 2026
// cleanup. Data fetching is done with plain fetch in useEffect; if you
// reintroduce a query library, re-add the provider here.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        forcedTheme="dark"
      >
        <ViewportHeightSync />
        {children}
        {/* Pushed down clear of the floating POS header (status chip, scanner
            toggle, power) — at the default offset a toast sat directly on top
            of those buttons. The offset includes the iOS safe-area inset
            because the page paints under the status bar.
            visibleToasts=2 caps the stack; combined with the group keys in
            @/lib/toast, a burst of scans updates one toast instead of piling
            up and covering the screen. */}
        <Toaster
          theme="dark"
          richColors
          position="top-center"
          visibleToasts={2}
          duration={2600}
          offset={{
            top: "calc(env(safe-area-inset-top, 0px) + 76px)",
            left: "16px",
            right: "16px",
            bottom: "16px",
          }}
          mobileOffset={{
            top: "calc(env(safe-area-inset-top, 0px) + 72px)",
            left: "12px",
            right: "12px",
            bottom: "12px",
          }}
        />
      </ThemeProvider>
    </AuthProvider>
  );
}
