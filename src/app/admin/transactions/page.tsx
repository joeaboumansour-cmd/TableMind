"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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

export default function AdminTransactionsPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [settings, setSettings] = useState<TransactionSettings>({
    transaction_retention_days: 90,
    max_transactions: 5000,
  });
  const [health, setHealth] = useState<TransactionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; reason: string } | null>(null);

  useEffect(() => {
    const init = async () => {
      const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      if (!authData.store_id) {
        toast.error("No store found");
        return;
      }
      setStoreId(authData.store_id);
      await fetchData(authData.store_id);
    };
    init();
  }, []);

  const fetchData = async (storeId: string) => {
    try {
      const supabase = createClient();
      
      // Fetch store settings
      const { data: store, error: storeError } = await supabase
        .from("stores")
        .select("transaction_retention_days, max_transactions")
        .eq("id", storeId)
        .single();

      if (storeError) throw storeError;

      setSettings({
        transaction_retention_days: store.transaction_retention_days ?? 90,
        max_transactions: store.max_transactions ?? 5000,
      });

      // Fetch health stats
      const { data: healthData, error: healthError } = await supabase
        .from("store_transaction_health")
        .select("*")
        .eq("store_id", storeId)
        .single();

      if (!healthError && healthData) {
        setHealth({
          current_transaction_count: healthData.current_transaction_count,
          oldest_transaction: healthData.oldest_transaction,
          newest_transaction: healthData.newest_transaction,
          estimated_size: healthData.estimated_size,
          status: healthData.status,
        });
      }
    } catch (error) {
      console.error("Failed to fetch transaction data:", error);
      toast.error("Failed to load transaction settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!storeId) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("stores")
        .update({
          transaction_retention_days: settings.transaction_retention_days,
          max_transactions: settings.max_transactions,
        })
        .eq("id", storeId);

      if (error) throw error;
      toast.success("Settings saved");
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = async () => {
    if (!storeId) return;
    setCleaningUp(true);
    setCleanupResult(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("cleanup_old_transactions_for_store", {
        p_store_id: storeId,
      });

      if (error) throw error;

      const result = data as any;
      setCleanupResult({
        deleted: result?.deleted_count || 0,
        reason: result?.reason || "completed",
      });
      toast.success(`Cleaned up ${result?.deleted_count || 0} transactions`);
      
      // Refresh health stats
      await fetchData(storeId);
    } catch (error) {
      console.error("Cleanup failed:", error);
      toast.error("Cleanup failed");
    } finally {
      setCleaningUp(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <h1 className="font-bold text-lg">Transaction Settings</h1>
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