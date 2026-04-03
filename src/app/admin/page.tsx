"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Loader2,
  Store,
  Calendar,
  Check,
  X,
  Edit,
  Trash2,
  RefreshCw,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils/format";

const supabase = createClient();

interface Store {
  id: string;
  username: string;
  license_expires_at: string;
  created_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [licenseDate, setLicenseDate] = useState("");

  // Check admin auth
  useEffect(() => {
    const adminAuth = localStorage.getItem("goldensquirrel_admin");
    if (!adminAuth) {
      router.push("/admin/login");
      return;
    }
    setIsAdmin(true);
    fetchStores();
  }, [router]);

  const fetchStores = async () => {
    try {
      const { data, error } = await supabase
        .from("stores")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setStores(data || []);
    } catch (error) {
      console.error("Error fetching stores:", error);
      toast.error("Failed to load stores");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("stores")
        .insert({
          username: username,
          password_hash: password, // In production, hash this properly
          license_expires_at: new Date(licenseDate).toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Store "${username}" created successfully!`);
      setIsDialogOpen(false);
      setUsername("");
      setPassword("");
      setLicenseDate("");
      fetchStores();
    } catch (error: any) {
      console.error("Error creating store:", error);
      if (error.code === "23505") {
        toast.error("Username already exists");
      } else {
        toast.error("Failed to create store");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (storeId: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from("stores")
        .update({ is_active: !currentActive })
        .eq("id", storeId);

      if (error) throw error;

      toast.success(`Store ${currentActive ? "deactivated" : "activated"}`);
      fetchStores();
    } catch (error) {
      console.error("Error toggling store:", error);
      toast.error("Failed to update store");
    }
  };

  const handleRenewLicense = async (storeId: string, username: string) => {
    const newDate = prompt(`Enter new license expiry date for "${username}" (YYYY-MM-DD):`);
    if (!newDate) return;

    try {
      const { error } = await supabase
        .from("stores")
        .update({ 
          license_expires_at: new Date(newDate).toISOString()
        })
        .eq("id", storeId);

      if (error) throw error;

      toast.success("License renewed successfully!");
      fetchStores();
    } catch (error) {
      console.error("Error renewing license:", error);
      toast.error("Failed to renew license");
    }
  };

  const handleDeleteStore = async (storeId: string, username: string) => {
    if (!confirm(`Are you sure you want to delete "${username}"? This will delete all associated data.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("stores")
        .delete()
        .eq("id", storeId);

      if (error) throw error;

      toast.success(`Store "${username}" deleted`);
      fetchStores();
    } catch (error) {
      console.error("Error deleting store:", error);
      toast.error("Failed to delete store");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("goldensquirrel_admin");
    router.push("/admin/login");
  };

  if (!isAdmin) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center">
                <Store className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg">Admin Panel</h1>
                <p className="text-xs text-muted-foreground">Store Management</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={fetchStores}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="ghost" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Stores</p>
                  <p className="text-2xl font-bold">{stores.length}</p>
                </div>
                <Store className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Stores</p>
                  <p className="text-2xl font-bold text-green-500">
                    {stores.filter(s => new Date(s.license_expires_at) > new Date()).length}
                  </p>
                </div>
                <Check className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Expired Licenses</p>
                  <p className="text-2xl font-bold text-red-500">
                    {stores.filter(s => new Date(s.license_expires_at) <= new Date()).length}
                  </p>
                </div>
                <X className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Create Store Dialog */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Stores</h2>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Store
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Store</DialogTitle>
                <DialogDescription>
                  Create a new store account with login credentials and license date.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateStore}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      placeholder="e.g., downtown_store"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="licenseDate">License Expiry Date</Label>
                    <Input
                      id="licenseDate"
                      type="date"
                      value={licenseDate}
                      onChange={(e) => setLicenseDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Store"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stores Table */}
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>License Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No stores found. Create your first store to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  stores.map((store) => {
                    const licenseExpired = new Date(store.license_expires_at) < new Date();
                    return (
                      <TableRow key={store.id}>
                        <TableCell className="font-mono">{store.username}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className={licenseExpired ? "text-red-500" : ""}>
                              {formatDateTime(store.license_expires_at)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {licenseExpired ? (
                            <Badge variant="destructive">Expired</Badge>
                          ) : (
                            <Badge variant="default" className="bg-green-500">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(store.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRenewLicense(store.id, store.username)}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteStore(store.id, store.username)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}