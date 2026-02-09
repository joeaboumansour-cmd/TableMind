"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { Search, User, Phone, Calendar, X, Plus, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const supabase = createClient();

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags: string[];
  total_visits: number;
  no_show_count: number;
  cancellation_count: number;
  last_visit_date?: string;
  notes?: string;
}


export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  
  // Add customer dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    tags: [] as string[],
  });
  const [newCustomerTag, setNewCustomerTag] = useState("");

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").limit(1).single();
      if (error) return null;
      return data?.id || null;
    },
  });

  // Fetch customers
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: true,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (customer: Customer) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("customers")
        .update({ notes: customer.notes, tags: customer.tags })
        .eq("id", customer.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (customer: Omit<Customer, "id" | "total_visits" | "no_show_count">) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("customers")
        .insert({ ...customer, restaurant_id: restaurantId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsAddDialogOpen(false);
      setNewCustomer({ name: "", phone: "", email: "", notes: "", tags: [] });
    },
  });

  // Filter customers by search
  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const query = searchQuery.toLowerCase();
    return customers.filter(
      (c: Customer) =>
        c.name.toLowerCase().includes(query) ||
        c.phone.includes(query)
    );
  }, [customers, searchQuery]);

  // Open customer profile
  const openProfile = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditedNotes(customer.notes || "");
    setEditedTags([...customer.tags]);
    setIsSheetOpen(true);
  };

  // Save changes
  const handleSave = () => {
    if (selectedCustomer) {
      updateMutation.mutate({
        ...selectedCustomer,
        notes: editedNotes,
        tags: editedTags,
      });
    }
  };

  // Add tag
  const handleAddTag = () => {
    if (newTag.trim() && !editedTags.includes(newTag.trim())) {
      setEditedTags([...editedTags, newTag.trim()]);
      setNewTag("");
    }
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove: string) => {
    setEditedTags(editedTags.filter((t) => t !== tagToRemove));
  };

  // Calculate stats
  const totalCustomers = customers.length;
  const vipCustomers = customers.filter((c: Customer) => c.tags.includes("VIP")).length;

  // Add customer tag handlers
  const handleAddNewCustomerTag = () => {
    if (newCustomerTag.trim() && !newCustomer.tags.includes(newCustomerTag.trim())) {
      setNewCustomer({ ...newCustomer, tags: [...newCustomer.tags, newCustomerTag.trim()] });
      setNewCustomerTag("");
    }
  };

  const handleRemoveNewCustomerTag = (tagToRemove: string) => {
    setNewCustomer({ ...newCustomer, tags: newCustomer.tags.filter((t) => t !== tagToRemove) });
  };

  const handleCreateCustomer = () => {
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) return;
    createMutation.mutate({
      name: newCustomer.name,
      phone: newCustomer.phone,
      email: newCustomer.email || undefined,
      notes: newCustomer.notes,
      tags: newCustomer.tags,
      cancellation_count: 0,
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2">Customers</h1>
          <p className="text-xl text-muted-foreground">
            Manage guest profiles and preferences
          </p>
        </div>
        <Button 
          size="lg" 
          className="gap-2 text-lg px-6 py-6"
          onClick={() => setIsAddDialogOpen(true)}
        >
          <Plus className="h-5 w-5" />
          Add Customer
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2">{totalCustomers}</div>
            <div className="text-xl text-muted-foreground">Total Customers</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2 text-primary">{vipCustomers}</div>
            <div className="text-xl text-muted-foreground">VIP Guests</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-2">
          <CardContent className="p-6">
            <div className="text-5xl font-bold mb-2">
              {Math.round(
                customers.reduce((acc: number, c: Customer) => acc + c.total_visits, 0) /
                  (customers.length || 1)
              )}
            </div>
            <div className="text-xl text-muted-foreground">Avg Visits</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-14 py-6 text-xl bg-background border-2"
          />
        </div>
      </div>

      {/* Customer List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse h-24" />
          ))}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <Card className="p-12 text-center border-2">
          <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-2xl font-semibold mb-2">No customers found</h3>
          <p className="text-lg text-muted-foreground">
            Try adjusting your search
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredCustomers.map((customer: Customer) => (
            <Card
              key={customer.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors border-2"
              onClick={() => openProfile(customer)}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold">{customer.name}</h3>
                      <div className="flex items-center gap-4 mt-2 text-lg text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <Phone className="h-5 w-5" />
                          {customer.phone}
                        </span>
                        <span className="flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          {customer.total_visits} visits
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end max-w-xs">
                    {customer.tags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        variant={tag === "VIP" ? "default" : "secondary"}
                        className="text-base px-4 py-2"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {customer.tags.length > 3 && (
                      <Badge variant="outline" className="text-base px-4 py-2">
                        +{customer.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Profile Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:max-w-xl bg-background border-l-4">
          {selectedCustomer && (
            <>
              <SheetHeader className="pb-6 border-b">
                <SheetTitle className="text-3xl font-bold">
                  {selectedCustomer.name}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-8 space-y-8">
                {/* Vital Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-primary/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-primary">
                      {selectedCustomer.total_visits}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Visits
                    </div>
                  </div>
                  <div className="bg-destructive/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-destructive">
                      {selectedCustomer.no_show_count}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      No-Shows
                    </div>
                  </div>
                  <div className="bg-amber-500/10 rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold text-amber-600">
                      {selectedCustomer.cancellation_count}
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Cancelled
                    </div>
                  </div>
                  <div className="bg-secondary rounded-xl p-6 text-center">
                    <div className="text-4xl font-bold">
                      {(() => {
                        const total = selectedCustomer.total_visits + 
                          selectedCustomer.no_show_count + 
                          selectedCustomer.cancellation_count;
                        return total > 0 
                          ? Math.round((selectedCustomer.total_visits / total) * 100)
                          : 100;
                      })()}
                      %
                    </div>
                    <div className="text-lg text-muted-foreground mt-1">
                      Reliability
                    </div>
                  </div>
                </div>

                {/* Last Visit */}
                {selectedCustomer.last_visit_date && (
                  <div className="flex items-center gap-3 text-lg bg-muted/50 p-4 rounded-lg">
                    <Calendar className="h-6 w-6 text-muted-foreground" />
                    <span className="text-muted-foreground">Last visit:</span>
                    <span className="font-medium">
                      {new Date(selectedCustomer.last_visit_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </span>
                  </div>
                )}

                {/* Contact Info */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Contact</h3>
                  <div className="text-xl space-y-2">
                    <div className="flex items-center gap-3">
                      <Phone className="h-6 w-6 text-muted-foreground" />
                      <span className="font-medium">{selectedCustomer.phone}</span>
                    </div>
                    {selectedCustomer.email && (
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">@</span>
                        <span className="font-medium">
                          {selectedCustomer.email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Tags</h3>
                  <div className="flex flex-wrap gap-3">
                    {editedTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant={tag === "VIP" ? "default" : "secondary"}
                        className="text-lg px-4 py-2 gap-2"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <Input
                      placeholder="Add new tag..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                      className="text-lg py-6"
                    />
                    <Button
                      onClick={handleAddTag}
                      disabled={!newTag.trim()}
                      className="px-6"
                    >
                      <Plus className="h-6 w-6" />
                    </Button>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold">Notes</h3>
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes about this customer..."
                    className="min-h-[150px] text-lg leading-relaxed"
                  />
                </div>

                {/* Save Button */}
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="w-full py-6 text-xl font-bold"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Customer Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Name *</Label>
              <Input
                id="new-name"
                placeholder="Customer name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-phone">Phone *</Label>
              <Input
                id="new-phone"
                placeholder="555-0101"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-email">Email (optional)</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="customer@email.com"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                className="h-12"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {newCustomer.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveNewCustomerTag(tag)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add tag..."
                  value={newCustomerTag}
                  onChange={(e) => setNewCustomerTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNewCustomerTag()}
                  className="h-10"
                />
                <Button
                  type="button"
                  onClick={handleAddNewCustomerTag}
                  disabled={!newCustomerTag.trim()}
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-notes">Notes</Label>
              <Textarea
                id="new-notes"
                placeholder="Any notes about this customer..."
                value={newCustomer.notes}
                onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                className="min-h-[80px]"
              />
            </div>

            <Button
              onClick={handleCreateCustomer}
              disabled={createMutation.isPending || !newCustomer.name.trim() || !newCustomer.phone.trim()}
              className="w-full h-12 text-lg font-bold"
            >
              {createMutation.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
