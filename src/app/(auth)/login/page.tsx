"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { hasCachedCredentials, getCachedCredentials } from "@/lib/auth/offlineAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Eye, EyeOff, AlertTriangle, Store, User, WifiOff, Wifi } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient();

export default function LoginPage() {
  const router = useRouter();
  const { user, login, loginOffline, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [storeUsername, setStoreUsername] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Offline state tracking
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [cachedStoreUsername, setCachedStoreUsername] = useState<string | null>(null);

  // If already logged in, redirect to POS
  useEffect(() => {
    if (user) {
      router.replace("/pos");
    }
  }, [user, router]);

  // Track online/offline status and check for cached credentials
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check for cached credentials
    if (hasCachedCredentials()) {
      const cached = getCachedCredentials();
      if (cached) {
        setCachedStoreUsername(cached.storeUsername);
        // Pre-fill the store username if the form is empty
        setStoreUsername((prev) => prev || cached.storeUsername);
      }
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Main login handler — works for both store owners and employees
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!storeUsername.trim() || !username.trim() || !password.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    // If offline, use cached credentials
    if (!navigator.onLine) {
      if (!hasCachedCredentials()) {
        toast.error("You are offline and no cached credentials are available. Please connect to the internet to log in.");
        return;
      }

      const result = await loginOffline(storeUsername.trim(), password);
      if (result.success) {
        toast.success("Welcome back! (offline login)");
        setTimeout(() => {
          window.location.href = "/pos";
        }, 100);
      } else {
        toast.error(result.error || "Invalid credentials");
      }
      return;
    }

    // Online: proceed with normal Supabase login
    // Find store by store username
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, username, password_hash, license_expires_at")
      .eq("username", storeUsername.trim())
      .maybeSingle();

    if (storeError || !store) {
      toast.error("Invalid store credentials");
      return;
    }

    // Check license
    if (new Date(store.license_expires_at) < new Date()) {
      toast.error("Your license has expired. Please contact support to renew.");
      return;
    }

    // Case 1: Owner login — username matches store username
    if (username.trim() === store.username) {
      if (store.password_hash !== password) {
        toast.error("Invalid store credentials");
        return;
      }

      // Backward compatibility — also set the legacy goldensquirrel_auth
      localStorage.setItem("goldensquirrel_auth", JSON.stringify({
        store_id: store.id,
        username: store.username,
        license_expires_at: store.license_expires_at,
        timestamp: Date.now(),
      }));

      const result = await login(store.username, password);
      if (result.success) {
        toast.success("Welcome back!");
        setTimeout(() => {
          window.location.href = "/pos";
        }, 100);
      } else {
        toast.error(result.error || "Invalid credentials");
      }
      return;
    }

    // Case 2: Employee login
    const { data: employee, error: empError } = await supabase
      .from("store_users")
      .select("*")
      .eq("store_id", store.id)
      .eq("username", username.trim())
      .maybeSingle();

    if (empError || !employee) {
      toast.error("Invalid store credentials");
      return;
    }

    if (!employee.is_active) {
      toast.error("This account has been deactivated. Contact your store owner.");
      return;
    }

    if (employee.password_hash !== password) {
      toast.error("Invalid store credentials");
      return;
    }

    // Store employee data in localStorage directly (same pattern as before)
    const employeeUser = {
      id: employee.id,
      storeId: employee.store_id,
      username: employee.username,
      displayName: employee.display_name || employee.username,
      isOwner: false,
      permissions: typeof employee.permissions === "string"
        ? JSON.parse(employee.permissions)
        : employee.permissions,
    };

    localStorage.setItem("goldensquirrel_user", JSON.stringify(employeeUser));

    // Backward compatibility — also set legacy goldensquirrel_auth so existing
    // pages that read it for store_id still work
    localStorage.setItem("goldensquirrel_auth", JSON.stringify({
      store_id: employee.store_id,
      username: employee.username,
      license_expires_at: store.license_expires_at,
      timestamp: Date.now(),
    }));

    toast.success(`Welcome, ${employeeUser.displayName}!`);
    setTimeout(() => {
      window.location.href = "/pos";
    }, 100);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-amber-500 flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 32 32" className="h-7 w-7 text-white" fill="currentColor">
            {/* Side Profile Squirrel */}
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
        <div>
          <h1 className="text-3xl font-bold">GoldenSquirrel</h1>
          <p className="text-muted-foreground">Point of Sale System</p>
        </div>
      </div>

      {/* Offline Banner */}
      {isOffline && (
        <div className="mb-4 w-full max-w-md">
          <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <WifiOff className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-700 text-sm">
                You are offline
              </p>
              <p className="text-amber-600/80 text-xs mt-0.5">
                {cachedStoreUsername
                  ? `Cached credentials available for "${cachedStoreUsername}". You can log in while offline.`
                  : "No cached credentials available. Please connect to the internet to log in."}
              </p>
            </div>
            <div className="flex items-center text-amber-600">
              {isOffline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            </div>
          </div>
        </div>
      )}

      <Card className="w-full max-w-md border-2">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Store Login</CardTitle>
          <CardDescription>
            {isOffline
              ? "Offline mode — using cached credentials"
              : "Enter your store credentials to access the POS"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeUsername">Store Username</Label>
              <Input
                id="storeUsername"
                type="text"
                placeholder="e.g., downtown_store"
                value={storeUsername}
                onChange={(e) => setStoreUsername(e.target.value)}
                required
                className="h-12"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username (or store username for owner)</Label>
              <Input
                id="username"
                type="text"
                placeholder="Your username or store username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-12"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : isOffline ? (
                "Sign In (Offline)"
              ) : (
                "Sign In"
              )}
            </Button>

            {/* Cached credentials hint */}
            {isOffline && cachedStoreUsername && (
              <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium">Offline Login</p>
                  <p className="text-xs">
                    Enter your credentials to log in using cached data. Your password was securely cached during your last online session.
                  </p>
                </div>
              </div>
            )}
          </form>

          <div className="mt-6 p-4 bg-muted rounded-lg space-y-2">
            <div className="flex items-start gap-2">
              <Store className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium">Store Owner</p>
                <p className="text-xs">Use your store username in both fields or as username</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <User className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium">Employee</p>
                <p className="text-xs">Use your assigned personal username. Contact your store owner if you don't have one.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        © 2026 GoldenSquirrel. All rights reserved.
      </p>
    </div>
  );
}
