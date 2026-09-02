"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils/format";

type TransactionSettings = {
  transaction_retention_days: number | null;
  max_transactions: number | null;
};

type TransactionHealth = {
  current_transaction_count: number;
  oldest_transaction: string | null;
  newest_transaction: string | null;
  estimated_size: string;
  status: string;
};

/**
 * Transaction retention, per store, from the admin console.
 *
 * Two things were wrong here and they compound:
 *
 * 1. Every read and write went through a browser Supabase client, including
 *    the `cleanup_old_transactions_for_store` RPC — a DELETE over a store's
 *    sales history, callable by anyone holding the public key. All of it is
 *    now behind /api/admin/stores*, which is `requireAdmin()`-gated.
 *
 * 2. It took its store from `goldensquirrel_auth` — the TILL's login — while
 *    /admin links here as `/admin/transactions?store=<id>`. The query
 *    parameter was ignored, so an admin who clicked "Transactions" on store B
 *    was shown, and could clean up, whichever store happened to be logged in
 *    on that browser. It reads the parameter now, and refuses to guess.
 */
export default function AdminTransactionsPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string>("");
  const [settings, setSettings] = useState<TransactionSettings>({
    transaction_retention_days: 90,
    max_transactions: 5000,
  });
  const [health, setHealth] = useState<TransactionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; reason: string } | null>(null);

  /** Same contract as the console's helper: a 401 means sign in again. */
  const adminFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const response = await fetch(input, init);
      if (response.status === 401) {
        localStorage.removeItem("goldensquirrel_admin");
        router.push("/admin/login");
        throw new Error("Admin session expired — sign in again");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Request failed");
      }
      return response.json();
    },
    [router]
  );

  const fetchData = useCallback(
    async (id: string) => {
      try {
        const data = await adminFetch(
          `/api/admin/stores/transactions?store_id=${encodeURIComponent(id)}`
        );
        setStoreName(data.store?.username ?? "");
        setSettings({
          transaction_retention_days: data.settings?.transaction_retention_days ?? 90,
          max_transactions: data.settings?.max_transactions ?? 5000,
        });
        setHealth(data.health ?? null);
      } catch (error) {
        console.error("Failed to fetch transaction data:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to load transaction settings"
        );
      } finally {
        setLoading(false);
      }
    },
    [adminFetch]
  );

  useEffect(() => {
    if (!localStorage.getItem("goldensquirrel_admin")) {
      router.push("/admin/login");
      return;
    }
    setIsAdmin(true);

    // Read from location rather than useSearchParams: no route in this app uses
    // that hook, and it would need a Suspense boundary the other admin pages
    // do not have.
    const store = new URLSearchParams(window.location.search).get("store");
    if (!store) {
      setLoading(false);
      return;
    }
    setStoreId(store);
    fetchData(store);
  }, [router, fetchData]);

  const handleSaveSettings = async () => {
    if (!storeId) return;
    setSaving(true);
    try {
      await adminFetch("/api/admin/stores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          transaction_retention_days: settings.transaction_retention_days,
          max_transactions: settings.max_transactions,
        }),
      });
      toast.success("Settings saved");
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    if (!storeId) return;
    setCleaningUp(true);
    setCleanupResult(null);
    try {
      const result = await adminFetch("/api/admin/stores/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId }),
      });

      setCleanupResult({
        deleted: result.deleted ?? 0,
        reason: result.reason ?? "completed",
      });
      toast.success(`Cleaned up ${result.deleted ?? 0} transactions`);

      // Refresh health stats
      await fetchData(storeId);
    } catch (error) {
      console.error("Cleanup failed:", error);
      toast.error(error instanceof Error ? error.message : "Cleanup failed");
    } finally {
      setCleaningUp(false);
    }
  };

  if (!isAdmin) return null;

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  // No ?store= means this page was opened directly. Guessing a store would mean
  // pointing a delete button at whichever one it guessed.
  if (!storeId) {
    return (
      <div className="min-h-dvh bg-background p-6">
        <p className="text-muted-foreground">
          No store selected. Open this page from the Transactions button on a store row in the{" "}
          <button className="underline" onClick={() => router.push("/admin")}>
            admin panel
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <h1 className="font-bold text-lg">
            Transaction Settings{storeName ? ` — ${storeName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage retention and cleanup policies
          </p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Health Status */}
        <Card>
          <CardHeader>
            <CardTitle>Transaction Health</CardTitle>
            <CardDescription>Current storage usage and limits</CardDescription>
          </CardHeader>
          <CardContent>
            {health ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Transactions</p>
                  <p className="text-2xl font-bold">{health.current_transaction_count}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Oldest Transaction</p>
                  <p className="text-sm font-medium">
                    {health.oldest_transaction ? formatDateTime(health.oldest_transaction) : "None"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Newest Transaction</p>
                  <p className="text-sm font-medium">
                    {health.newest_transaction ? formatDateTime(health.newest_transaction) : "None"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Size</p>
                  <p className="text-2xl font-bold">{health.estimated_size}</p>
                </div>
                <div className="col-span-2 md:col-span-4">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                    health.status === "healthy" ? "bg-green-100 text-green-800" :
                    health.status === "over_limit" ? "bg-red-100 text-red-800" :
                    health.status === "expired" ? "bg-amber-100 text-amber-800" :
                    "bg-gray-100 text-gray-800"
                  }`}>
                    {health.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No transaction data available</p>
            )}
          </CardContent>
        </Card>

        {/* Retention Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Retention Settings</CardTitle>
            <CardDescription>
              Configure how long transactions are kept. Oldest data is automatically removed when limits are exceeded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="retentionDays">Retention Period (days)</Label>
                <Input
                  id="retentionDays"
                  type="number"
                  min="0"
                  value={settings.transaction_retention_days ?? ""}
                  onChange={(e) => setSettings({ ...settings, transaction_retention_days: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="90"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Set to 0 for unlimited time, or enter number of days
                </p>
              </div>
              <div>
                <Label htmlFor="maxTransactions">Max Transactions</Label>
                <Input
                  id="maxTransactions"
                  type="number"
                  min="0"
                  value={settings.max_transactions ?? ""}
                  onChange={(e) => setSettings({ ...settings, max_transactions: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="5000"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Set to 0 for unlimited count, or enter max number
                </p>
              </div>
            </div>
            <Button onClick={handleSaveSettings} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* Manual Cleanup */}
        <Card>
          <CardHeader>
            <CardTitle>Manual Cleanup</CardTitle>
            <CardDescription>
              Manually remove old transactions based on your retention settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              variant="destructive" 
              onClick={handleCleanup} 
              disabled={cleaningUp || !health || health.current_transaction_count === 0}
            >
              {cleaningUp ? "Cleaning up..." : "Run Cleanup Now"}
            </Button>
            {cleanupResult && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">Cleanup Result:</p>
                <p>Deleted: {cleanupResult.deleted} transactions</p>
                <p>Reason: {cleanupResult.reason}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}