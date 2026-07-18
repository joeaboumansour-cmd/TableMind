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
import { Switch } from "@/components/ui/switch";
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
  Users,
  UserPlus,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils/format";
import { SECTIONS, SectionKey } from "@/lib/auth/permissions";

const supabase = createClient();

interface Store {
  id: string;
  username: string;
  license_expires_at: string;
  created_at: string;
}

interface Employee {
  id: string;
  store_id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  permissions: Record<string, boolean>;
  created_at: string;
}

// Section toggle order for display
const SECTION_KEYS: SectionKey[] = ["pos", "inventory", "transactions", "receipts"];

export default function AdminPage() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Store creation dialog
  const [isStoreDialogOpen, setIsStoreDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [storeUsername, setStoreUsername] = useState("");
  const [storePassword, setStorePassword] = useState("");
  const [licenseDate, setLicenseDate] = useState("");

  // Employee management
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedStoreName, setSelectedStoreName] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);

  // Employee form
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [empUsername, setEmpUsername] = useState("");
  const [empDisplayName, setEmpDisplayName] = useState("");
  const [empPassword, setEmpPassword] = useState("");
  const [showEmpPassword, setShowEmpPassword] = useState(false);
  const [empPermissions, setEmpPermissions] = useState<Record<string, boolean>>({});
  const [isSavingEmployee, setIsSavingEmployee] = useState(false);

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

  // ------ Store CRUD ------
  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("stores")
        .insert({
          username: storeUsername,
          password_hash: storePassword,
          license_expires_at: new Date(licenseDate).toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Store "${storeUsername}" created successfully!`);
      setIsStoreDialogOpen(false);
      setStoreUsername("");
      setStorePassword("");
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

  // ------ Employee Management ------
  const openEmployeeDialog = async (storeId: string, storeName: string) => {
    setSelectedStoreId(storeId);
    setSelectedStoreName(storeName);
    setIsEmployeeDialogOpen(true);
    setEditingEmployee(null);
    resetEmployeeForm();
    await fetchEmployees(storeId);
  };

  const fetchEmployees = async (storeId: string) => {
    setIsLoadingEmployees(true);
    try {
      const response = await fetch(`/api/admin/store-users?store_id=${storeId}`);
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setEmployees(data.employees || []);
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast.error("Failed to load employees");
    } finally {
      setIsLoadingEmployees(false);
    }
  };

  const resetEmployeeForm = () => {
    setEmpUsername("");
    setEmpDisplayName("");
    setEmpPassword("");
    setShowEmpPassword(false);
    setEditingEmployee(null);
    setEmpPermissions({
      pos: false,
      inventory: false,
      transactions: false,
      receipts: false,
    });
  };

  const openAddEmployeeForm = () => {
    setEditingEmployee(null);
    resetEmployeeForm();
  };

  const openEditEmployeeForm = (employee: Employee) => {
    setEditingEmployee(employee);
    setEmpUsername(employee.username);
    setEmpDisplayName(employee.display_name);
    setEmpPassword("");
    setEmpPermissions({ ...employee.permissions });
  };

  const togglePermission = (key: string) => {
    setEmpPermissions(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSaveEmployee = async () => {
    if (!selectedStoreId) return;

    if (!empUsername.trim()) {
      toast.error("Username is required");
      return;
    }

    if (!editingEmployee && !empPassword.trim()) {
      toast.error("Password is required for new employees");
      return;
    }

    setIsSavingEmployee(true);

    try {
      if (editingEmployee) {
        // Update existing employee
        const body: Record<string, any> = {
          id: editingEmployee.id,
          username: empUsername.trim(),
          display_name: empDisplayName.trim() || empUsername.trim(),
          permissions: empPermissions,
        };
        if (empPassword.trim()) {
          body.password = empPassword;
        }

        const response = await fetch("/api/admin/store-users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to update");
        }

        toast.success("Employee updated successfully!");
      } else {
        // Create new employee
        const response = await fetch("/api/admin/store-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_id: selectedStoreId,
            username: empUsername.trim(),
            password: empPassword,
            display_name: empDisplayName.trim() || empUsername.trim(),
            permissions: empPermissions,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to create");
        }

        toast.success("Employee created successfully!");
      }

      resetEmployeeForm();
      await fetchEmployees(selectedStoreId);
    } catch (error: any) {
      toast.error(error.message || "Failed to save employee");
    } finally {
      setIsSavingEmployee(false);
    }
  };

  const handleToggleEmployeeActive = async (employee: Employee) => {
    try {
      const response = await fetch("/api/admin/store-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: employee.id,
          is_active: !employee.is_active,
        }),
      });

      if (!response.ok) throw new Error("Failed to update");

      toast.success(`Employee ${employee.is_active ? "deactivated" : "activated"}`);
      if (selectedStoreId) await fetchEmployees(selectedStoreId);
    } catch (error) {
      toast.error("Failed to update employee");
    }
  };

  const handleDeleteEmployee = async (employee: Employee) => {
    if (!confirm(`Delete employee "${employee.display_name || employee.username}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/store-users?id=${employee.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete");

      toast.success("Employee deleted");
      if (selectedStoreId) await fetchEmployees(selectedStoreId);
    } catch (error) {
      toast.error("Failed to delete employee");
    }
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
                <p className="text-xs text-muted-foreground">Store & Employee Management</p>
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
                  <p className="text-sm text-muted-foreground">Active Licenses</p>
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

        {/* Create Store Button */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Stores</h2>
          <Dialog open={isStoreDialogOpen} onOpenChange={setIsStoreDialogOpen}>
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
                    <Label htmlFor="store-username">Username</Label>
                    <Input
                      id="store-username"
                      placeholder="e.g., downtown_store"
                      value={storeUsername}
                      onChange={(e) => setStoreUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="store-password">Password</Label>
                    <Input
                      id="store-password"
                      type="password"
                      placeholder="••••••••"
                      value={storePassword}
                      onChange={(e) => setStorePassword(e.target.value)}
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
                  <Button type="button" variant="outline" onClick={() => setIsStoreDialogOpen(false)}>
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
                        <TableCell className="font-mono font-medium">{store.username}</TableCell>
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
                              onClick={() => router.push(`/admin/transactions?store=${store.id}`)}
                              title="Transaction settings"
                            >
                              <span className="text-xs">Transactions</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEmployeeDialog(store.id, store.username)}
                              title="Manage employees"
                            >
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRenewLicense(store.id, store.username)}
                              title="Renew license"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteStore(store.id, store.username)}
                              title="Delete store"
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

      {/* Employee Management Dialog */}
      <Dialog open={isEmployeeDialogOpen} onOpenChange={(open) => {
        setIsEmployeeDialogOpen(open);
        if (!open) resetEmployeeForm();
      }}>
        <DialogContent className="max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Employees — {selectedStoreName}</DialogTitle>
            <DialogDescription>
              Manage employees for this store. Each employee gets per-section access toggles.
            </DialogDescription>
          </DialogHeader>

          {/* Employee List */}
          <div className="space-y-3">
            {isLoadingEmployees ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : employees.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No employees yet. Add one to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {employees.map((emp) => (
                  <Card key={emp.id} className={`p-3 ${!emp.is_active ? "opacity-50" : ""}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{emp.display_name || emp.username}</span>
                          <Badge variant="outline" className="text-xs">
                            {emp.username}
                          </Badge>
                          {!emp.is_active && (
                            <Badge variant="destructive" className="text-xs">Inactive</Badge>
                          )}
                        </div>
                        {/* Permission badges */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {SECTION_KEYS.map(key => (
                            <Badge
                              key={key}
                              variant={emp.permissions[key] ? "default" : "secondary"}
                              className={`text-xs ${emp.permissions[key] ? "bg-green-500" : ""}`}
                            >
                              {SECTIONS[key].label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEditEmployeeForm(emp)}
                          title="Edit employee"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleToggleEmployeeActive(emp)}
                          title={emp.is_active ? "Deactivate" : "Activate"}
                        >
                          {emp.is_active ? <X className="h-4 w-4 text-red-500" /> : <Check className="h-4 w-4 text-green-500" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleDeleteEmployee(emp)}
                          title="Delete employee"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Add/Edit Employee Form */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">
                {editingEmployee ? "Edit Employee" : "Add New Employee"}
              </h3>
              {!editingEmployee && (
                <Button variant="outline" size="sm" onClick={openAddEmployeeForm}>
                  <UserPlus className="h-4 w-4 mr-1" />
                  New
                </Button>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Username</Label>
                  <Input
                    placeholder="e.g., john"
                    value={empUsername}
                    onChange={(e) => setEmpUsername(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Display Name</Label>
                  <Input
                    placeholder="e.g., John"
                    value={empDisplayName}
                    onChange={(e) => setEmpDisplayName(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  {editingEmployee ? "New Password (leave empty to keep current)" : "Password"}
                </Label>
                <div className="relative">
                  <Input
                    type={showEmpPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={empPassword}
                    onChange={(e) => setEmpPassword(e.target.value)}
                    className="h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmpPassword(!showEmpPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showEmpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Permission Toggles */}
              <div>
                <Label className="text-xs mb-2 block">Section Access</Label>
                <div className="space-y-1.5">
                  {SECTION_KEYS.map(key => (
                    <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50">
                      <div>
                        <span className="text-sm font-medium">{SECTIONS[key].label}</span>
                        <p className="text-xs text-muted-foreground">{SECTIONS[key].description}</p>
                      </div>
                      <Switch
                        checked={empPermissions[key] === true}
                        onCheckedChange={() => togglePermission(key)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetEmployeeForm()}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEmployee}
                  disabled={isSavingEmployee}
                >
                  {isSavingEmployee ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    editingEmployee ? "Update Employee" : "Create Employee"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}