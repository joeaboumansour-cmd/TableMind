"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/AuthContext";

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
        {children}
        <Toaster theme="dark" richColors position="top-center" />
      </ThemeProvider>
    </AuthProvider>
  );
}
