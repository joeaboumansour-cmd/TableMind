"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Users, Clock, Phone, Calendar, Settings, Trash2, Bell } from "lucide-react";
import { toast } from "sonner";
import type { WaitlistEntry, WaitlistStatus, PriorityLevel, CreateWaitlistEntryRequest } from "@/lib/types/waitlist";

const supabase = createClient();

export default function WaitlistPage() {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateWaitlistEntryRequest>({
    customer_name: "",
    phone: "",
    party_size: 2,
    notes: "",
    priority: "normal",
    preferences: [],
  });

  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data } = await supabase.from("restaurants").select("id").limit(1).single();
      return data?.id || null;
    },
  });

  const { data: waitlist = [], isLoading } = useQuery({
    queryKey: ["waitlist", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("waitlist")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("status", ["waiting", "arrived", "notified"])
        .order("position", { ascending: true });
      if (error) return [];
      return (data || []) as WaitlistEntry[];
    },
    enabled: !!restaurantId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateWaitlistEntryRequest) => {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create entry");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      setIsAddDialogOpen(false);
      setFormData({ customer_name: "", phone: "", party_size: 2, notes: "", priority: "normal", preferences: [] });
      toast.success("Added to waitlist");
    },
    onError: () => toast.error("Failed to add to waitlist"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: WaitlistStatus }) => {
      const response = await fetch(`/api/waitlist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update status");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast.success("Status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/waitlist/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast.success("Removed from waitlist");
    },
    onError: () => toast.error("Failed to remove"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_name || !formData.party_size) {
      toast.error("Please fill in required fields");
      return;
    }
    createMutation.mutate(formData);
  };

  const getStatusBadgeColor = (status: WaitlistStatus) => {
    switch (status) {
      case "waiting": return "bg-blue-500";
      case "arrived": return "bg-amber-500";
      case "notified": return "bg-purple-500";
      case "seated": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold">Waitlist</h1>
          <p className="text-xl text-muted-foreground mt-1">Manage walk-in customers</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setIsAddDialogOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add to Waitlist
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="text-4xl font-bold">{waitlist.length}</div>
            <div className="text-muted-foreground">In Queue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-4xl font-bold text-blue-500">
              {waitlist.filter((e) => e.status === "waiting").length}
            </div>
            <div className="text-muted-foreground">Waiting</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-4xl font-bold text-amber-500">
              {waitlist.filter((e) => e.status === "arrived").length}
            </div>
            <div className="text-muted-foreground">Arrived</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-4xl font-bold">
              {waitlist.reduce((acc, e) => acc + e.party_size, 0)}
            </div>
            <div className="text-muted-foreground">Total Guests</div>
          </CardContent>
        </Card>
      </div>

      {/* Waitlist */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse h-32" />
          ))}
        </div>
      ) : waitlist.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-2xl font-semibold mb-2">No one waiting</h3>
          <p className="text-muted-foreground">Add walk-in customers to get started.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {waitlist.map((entry) => (
            <Card key={entry.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex">
                  <div className={`w-20 flex items-center justify-center text-white font-bold text-xl ${
                    entry.priority === "urgent" ? "bg-red-500" :
                    entry.priority === "vip" ? "bg-purple-500" : "bg-primary"
                  }`}>
                    #{entry.position}
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-bold">{entry.customer_name}</h3>
                          {entry.priority === "vip" && <Badge className="bg-purple-500">VIP</Badge>}
                          {entry.priority === "urgent" && <Badge className="bg-red-500">URGENT</Badge>}
                          <Badge className={getStatusBadgeColor(entry.status)}>{entry.status}</Badge>
                        </div>
                        <div className="flex items-center gap-6 text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <Users className="h-4 w-4" />{entry.party_size} guests
                          </span>
                          {entry.phone && (
                            <span className="flex items-center gap-2">
                              <Phone className="h-4 w-4" />{entry.phone}
                            </span>
                          )}
                          <span className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />Est: {entry.estimated_wait_minutes || 0} min
                          </span>
                        </div>
                        {entry.notes && <p className="mt-2 text-sm text-muted-foreground">Notes: {entry.notes}</p>}
                      </div>
                      <div className="flex gap-2">
                        {entry.status === "waiting" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "arrived" })}>
                            Mark Arrived
                          </Button>
                        )}
                        {entry.status === "arrived" && (
                          <Button size="sm" onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "notified" })}>
                            <Bell className="h-4 w-4 mr-1" />Notify
                          </Button>
                        )}
                        {entry.status === "notified" && (
                          <Button size="sm" className="bg-green-500 hover:bg-green-600" onClick={() => updateStatusMutation.mutate({ id: entry.id, status: "seated" })}>
                            Seat Now
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => { if (confirm("Remove from waitlist?")) deleteMutation.mutate(entry.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Waitlist</DialogTitle>
            <DialogDescription>Add a walk-in customer to the waitlist</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="customer_name">Customer Name *</Label>
              <Input id="customer_name" placeholder="John Smith" value={formData.customer_name} onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" placeholder="555-0101" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="party_size">Party Size *</Label>
                <Select value={String(formData.party_size)} onValueChange={(v) => setFormData({ ...formData, party_size: parseInt(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...Array(20)].map((_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{i + 1} guest{i !== 0 ? "s" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v as PriorityLevel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Special requests, occasion, etc." value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding..." : "Add to Waitlist"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
