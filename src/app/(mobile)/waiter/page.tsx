"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRestaurant } from "@/app/RestaurantContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  LogOut, 
  Utensils, 
  Users, 
  Clock, 
  FileText, 
  Star,
  MessageSquare,
  Loader2,
  ChefHat,
  CheckCircle2,
  UtensilsCrossed,
  Coffee,
  Receipt,
  Sparkles,
  AlertCircle,
  Crown,
  Search,
  Plus,
  History,
  Heart,
  UserPlus,
  ArrowRight,
  Phone,
  Mail,
  MapPin,
  X,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import type { Customer, Table } from "@/lib/types";

// Service status type
type ServiceStatus = 
  | "empty" 
  | "seated" 
  | "order_taken" 
  | "appetizer_served" 
  | "main_served" 
  | "dessert_served" 
  | "check_requested" 
  | "ready_to_clear";

// Table status with details
interface TableStatus {
  id: string;
  table_id: string;
  table_name: string;
  table_capacity: number;
  room_name?: string;
  section?: string;
  status: ServiceStatus;
  reservation_id?: string;
  current_customer_name?: string;
  current_customer_id?: string;
  current_party_size?: number;
  seated_at?: string;
  minutes_seated?: number;
  server_name?: string;
  session_notes?: string;
  availability_status: "available" | "occupied" | "finishing";
  status_color: string;
  updated_at: string;
}

// Service status configuration
const STATUS_FLOW: ServiceStatus[] = [
  "empty",
  "seated",
  "order_taken",
  "appetizer_served",
  "main_served",
  "dessert_served",
  "check_requested",
  "ready_to_clear",
];

const STATUS_CONFIG: Record<ServiceStatus, {
  label: string;
  icon: React.ReactNode;
  bgColor: string;
  borderColor: string;
  textColor: string;
  description: string;
}> = {
  empty: {
    label: "Empty",
    icon: <div className="h-3 w-3 rounded-full bg-slate-300" />,
    bgColor: "bg-slate-100",
    borderColor: "border-slate-300",
    textColor: "text-slate-600",
    description: "Table available",
  },
  seated: {
    label: "Seated",
    icon: <Users className="h-4 w-4" />,
    bgColor: "bg-blue-500",
    borderColor: "border-blue-500",
    textColor: "text-blue-700",
    description: "Guests just arrived",
  },
  order_taken: {
    label: "Order Taken",
    icon: <FileText className="h-4 w-4" />,
    bgColor: "bg-amber-500",
    borderColor: "border-amber-500",
    textColor: "text-amber-700",
    description: "Waiting for kitchen",
  },
  appetizer_served: {
    label: "Appetizer",
    icon: <Utensils className="h-4 w-4" />,
    bgColor: "bg-orange-500",
    borderColor: "border-orange-500",
    textColor: "text-orange-700",
    description: "First course served",
  },
  main_served: {
    label: "Main Course",
    icon: <UtensilsCrossed className="h-4 w-4" />,
    bgColor: "bg-emerald-500",
    borderColor: "border-emerald-500",
    textColor: "text-emerald-700",
    description: "Main dish out",
  },
  dessert_served: {
    label: "Dessert",
    icon: <Coffee className="h-4 w-4" />,
    bgColor: "bg-pink-500",
    borderColor: "border-pink-500",
    textColor: "text-pink-700",
    description: "Final course",
  },
  check_requested: {
    label: "Check",
    icon: <Receipt className="h-4 w-4" />,
    bgColor: "bg-violet-500",
    borderColor: "border-violet-500",
    textColor: "text-violet-700",
    description: "Payment pending",
  },
  ready_to_clear: {
    label: "Clearing",
    icon: <CheckCircle2 className="h-4 w-4" />,
    bgColor: "bg-slate-500",
    borderColor: "border-slate-500",
    textColor: "text-slate-700",
    description: "Ready to reset",
  },
};

// API hooks
function useTableStatuses(restaurantId: string | null) {
  return useQuery<TableStatus[]>({
    queryKey: ["table-statuses", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const res = await fetch(`/api/tables/status?restaurantId=${restaurantId}`);
      if (!res.ok) throw new Error("Failed to fetch table statuses");
      const data = await res.json();
      return data.tableStatuses;
    },
    enabled: !!restaurantId,
    refetchInterval: 5000, // Refresh every 5 seconds for "live" feel
  });
}

function useUpdateTableStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      table_id: string;
      restaurant_id: string;
      status: ServiceStatus;
      [key: string]: unknown;
    }) => {
      const res = await fetch("/api/tables/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["table-statuses"] });
    },
  });
}

function useWalkIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      table_id: string;
      customer_name: string;
      customer_phone?: string;
      party_size: number;
      notes?: string;
    }) => {
      const res = await fetch("/api/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create walk-in");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["table-statuses"] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

function useCreateVisitLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      customer_id: string;
      reservation_id?: string;
      table_id?: string;
      feedback_rating?: number;
      feedback_text?: string;
      customer_notes?: string;
      party_size?: number;
      service_status?: string;
    }) => {
      const res = await fetch("/api/visit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create visit log");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-visits"] });
    },
  });
}

function useCustomers(restaurantId: string | null) {
  return useQuery<Customer[]>({
    queryKey: ["customers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClientWithAuth();
      const { data } = await supabase
        .from("customer_analytics")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });
      return data || [];
    },
    enabled: !!restaurantId,
  });
}

export default function WaiterMobilePage() {
  const { user, restaurant, isLoading: authLoading, signOut } = useRestaurant();
  const router = useRouter();
  const queryClient = useQueryClient();
  
  // State
  const [selectedTable, setSelectedTable] = useState<TableStatus | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "occupied" | "available">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Modals
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [showTableDetailModal, setShowTableDetailModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  
  // Walk-in form state
  const [walkInData, setWalkInData] = useState({
    customer_name: "",
    customer_phone: "",
    party_size: 2,
    notes: "",
  });
  
  // Feedback state
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  
  // Customer search
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  
  // Data fetching
  const { data: tableStatuses = [], isLoading: tablesLoading } = useTableStatuses(
    restaurant?.id || null
  );
  const { data: customers = [] } = useCustomers(restaurant?.id || null);
  
  // Mutations
  const updateStatus = useUpdateTableStatus();
  const walkIn = useWalkIn();
  const createVisitLog = useCreateVisitLog();
  
  // Auth check
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    const allowedRoles = ["waiter", "manager", "admin", "owner"];
    if (!allowedRoles.includes(user.role)) {
      router.push("/dashboard");
    }
  }, [authLoading, user, router]);
  
  // Filter tables
  const filteredTables = tableStatuses.filter((table) => {
    // View mode filter
    if (viewMode === "occupied" && table.status === "empty") return false;
    if (viewMode === "available" && table.status !== "empty") return false;
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        table.table_name.toLowerCase().includes(query) ||
        table.current_customer_name?.toLowerCase().includes(query) ||
        table.room_name?.toLowerCase().includes(query)
      );
    }
    return true;
  });
  
  // Stats
  const stats = {
    total: tableStatuses.length,
    occupied: tableStatuses.filter((t) => t.status !== "empty").length,
    available: tableStatuses.filter((t) => t.status === "empty").length,
    needClearing: tableStatuses.filter((t) => t.status === "ready_to_clear").length,
    guests: tableStatuses.reduce((sum, t) => sum + (t.current_party_size || 0), 0),
  };
  
  // Handlers
  const handleTableClick = (table: TableStatus) => {
    setSelectedTable(table);
    setSessionNote(table.session_notes || "");
    if (table.status === "empty") {
      setShowWalkInModal(true);
    } else {
      setShowTableDetailModal(true);
    }
  };
  
  const handleStatusAdvance = async () => {
    if (!selectedTable || !restaurant) return;
    
    const currentIndex = STATUS_FLOW.indexOf(selectedTable.status);
    if (currentIndex < STATUS_FLOW.length - 1) {
      const nextStatus = STATUS_FLOW[currentIndex + 1];
      await updateStatus.mutateAsync({
        table_id: selectedTable.table_id,
        restaurant_id: restaurant.id,
        status: nextStatus,
      });
      toast.success(`Status updated to ${STATUS_CONFIG[nextStatus].label}`);
      setSelectedTable({ ...selectedTable, status: nextStatus });
    }
  };
  
  const handleClearTable = async () => {
    if (!selectedTable || !restaurant) return;
    
    // Create visit log with feedback if provided
    if (selectedTable.current_customer_id && (feedbackRating > 0 || feedbackText || sessionNote)) {
      await createVisitLog.mutateAsync({
        restaurant_id: restaurant.id,
        customer_id: selectedTable.current_customer_id,
        reservation_id: selectedTable.reservation_id,
        table_id: selectedTable.table_id,
        feedback_rating: feedbackRating > 0 ? feedbackRating : undefined,
        feedback_text: feedbackText || undefined,
        customer_notes: sessionNote || undefined,
        party_size: selectedTable.current_party_size,
        service_status: selectedTable.status,
      });
    }
    
    // Clear table status
    await updateStatus.mutateAsync({
      table_id: selectedTable.table_id,
      restaurant_id: restaurant.id,
      status: "empty",
    });
    
    toast.success("Table cleared");
    setShowTableDetailModal(false);
    setShowFeedbackModal(false);
    setFeedbackRating(0);
    setFeedbackText("");
    setSessionNote("");
  };
  
  const handleWalkInSubmit = async () => {
    if (!selectedTable || !restaurant || !walkInData.customer_name) return;
    
    await walkIn.mutateAsync({
      restaurant_id: restaurant.id,
      table_id: selectedTable.table_id,
      customer_name: walkInData.customer_name,
      customer_phone: walkInData.customer_phone,
      party_size: walkInData.party_size,
      notes: walkInData.notes,
    });
    
    toast.success("Walk-in guest seated");
    setShowWalkInModal(false);
    setWalkInData({ customer_name: "", customer_phone: "", party_size: 2, notes: "" });
  };
  
  const handleSaveNote = async () => {
    if (!selectedTable || !restaurant) return;
    
    await updateStatus.mutateAsync({
      table_id: selectedTable.table_id,
      restaurant_id: restaurant.id,
      status: selectedTable.status,
      session_notes: sessionNote,
    });
    
    toast.success("Note saved");
    setSelectedTable({ ...selectedTable, session_notes: sessionNote });
  };
  
  // Customer search filter
  const filteredCustomers = customers.filter((c) => {
    if (!customerSearchQuery) return false;
    const query = customerSearchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(query) ||
      c.phone?.toLowerCase().includes(query) ||
      c.email?.toLowerCase().includes(query)
    );
  }).slice(0, 5);
  
  if (authLoading || tablesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="text-slate-600">Loading tables...</p>
        </div>
      </div>
    );
  }
  
  if (!user || !restaurant) return null;
  
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-md">
              <Utensils className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900">{restaurant.name}</h1>
              <p className="text-xs text-slate-500 capitalize font-medium">
                {user.display_name} • Waiter
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => signOut()}>
            <LogOut className="h-5 w-5 text-slate-500" />
          </Button>
        </div>
      </header>
      
      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-2 p-3 bg-white border-b border-slate-200">
        <div className="text-center p-2 rounded-lg bg-slate-100">
          <p className="text-xl font-bold text-slate-900">{stats.total}</p>
          <p className="text-[10px] text-slate-600 font-medium uppercase">Tables</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-emerald-50">
          <p className="text-xl font-bold text-emerald-600">{stats.available}</p>
          <p className="text-[10px] text-emerald-600 font-medium uppercase">Free</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-blue-50">
          <p className="text-xl font-bold text-blue-600">{stats.occupied}</p>
          <p className="text-[10px] text-blue-600 font-medium uppercase">Busy</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-slate-100">
          <p className="text-xl font-bold text-slate-700">{stats.guests}</p>
          <p className="text-[10px] text-slate-600 font-medium uppercase">Guests</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-amber-50">
          <p className="text-xl font-bold text-amber-600">{stats.needClearing}</p>
          <p className="text-[10px] text-amber-600 font-medium uppercase">Clear</p>
        </div>
      </div>
      
      {/* Filters */}
      <div className="px-4 py-3 space-y-3 bg-white border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search table or guest..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="occupied">Busy</TabsTrigger>
            <TabsTrigger value="available">Free</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      
      {/* Tables Grid */}
      <main className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredTables.map((table) => {
            const config = STATUS_CONFIG[table.status];
            const isOccupied = table.status !== "empty";
            
            return (
              <button
                key={table.table_id}
                onClick={() => handleTableClick(table)}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all",
                  "hover:shadow-md active:scale-95",
                  isOccupied
                    ? `${config.bgColor} ${config.borderColor} text-white`
                    : "bg-white border-slate-200 hover:border-slate-300"
                )}
              >
                {/* Table Header */}
                <div className="flex items-start justify-between mb-2">
                  <span className={cn(
                    "font-bold text-lg",
                    isOccupied ? "text-white" : "text-slate-900"
                  )}>
                    {table.table_name}
                  </span>
                  {isOccupied && (
                    <Badge variant="secondary" className="bg-white/20 text-white border-0 text-xs">
                      {table.current_party_size} <Users className="h-3 w-3 ml-1" />
                    </Badge>
                  )}
                </div>
                
                {/* Status */}
                <div className={cn(
                  "text-sm font-medium",
                  isOccupied ? "text-white/90" : "text-slate-500"
                )}>
                  {config.label}
                </div>
                
                {/* Guest Name (if occupied) */}
                {isOccupied && table.current_customer_name && (
                  <div className="mt-2 text-sm font-semibold text-white truncate">
                    {table.current_customer_name}
                  </div>
                )}
                
                {/* Time seated */}
                {isOccupied && table.minutes_seated !== undefined && (
                  <div className="mt-1 text-xs text-white/70 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {table.minutes_seated}m
                  </div>
                )}
                
                {/* Empty indicator */}
                {!isOccupied && (
                  <div className="mt-2 flex items-center gap-1 text-sm text-slate-400">
                    <Plus className="h-4 w-4" />
                    <span>Walk-in</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        
        {filteredTables.length === 0 && (
          <div className="text-center py-12">
            <ChefHat className="h-12 w-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500">No tables found</p>
          </div>
        )}
      </main>
      
      {/* Walk-In Modal */}
      <Dialog open={showWalkInModal} onOpenChange={setShowWalkInModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-600" />
              Seat Walk-in at {selectedTable?.table_name}
            </DialogTitle>
            <DialogDescription>
              Register a new walk-in guest or search for existing customer
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Customer Search Toggle */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowCustomerSearch(!showCustomerSearch)}
            >
              <Search className="h-4 w-4 mr-2" />
              {showCustomerSearch ? "Hide Customer Search" : "Search Existing Customer"}
            </Button>
            
            {/* Customer Search */}
            {showCustomerSearch && (
              <div className="space-y-2">
                <Input
                  placeholder="Search by name or phone..."
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                />
                {filteredCustomers.length > 0 && (
                  <div className="border rounded-lg divide-y">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setWalkInData({
                            ...walkInData,
                            customer_name: customer.name,
                            customer_phone: customer.phone || "",
                          });
                          setShowCustomerSearch(false);
                          toast.success(`Selected: ${customer.name}`);
                        }}
                        className="w-full p-3 text-left hover:bg-slate-50 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          <p className="text-sm text-slate-500">
                            {customer.phone} • {customer.total_visits} visits
                          </p>
                        </div>
                        {customer.tags?.includes("VIP") && (
                          <Crown className="h-4 w-4 text-amber-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Walk-in Form */}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Guest Name</label>
                <Input
                  value={walkInData.customer_name}
                  onChange={(e) =>
                    setWalkInData({ ...walkInData, customer_name: e.target.value })
                  }
                  placeholder="Enter guest name"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Phone (optional)</label>
                <Input
                  value={walkInData.customer_phone}
                  onChange={(e) =>
                    setWalkInData({ ...walkInData, customer_phone: e.target.value })
                  }
                  placeholder="Phone number"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Party Size</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setWalkInData({ ...walkInData, party_size: Math.max(1, walkInData.party_size - 1) })
                    }
                  >
                    -
                  </Button>
                  <span className="w-12 text-center font-semibold">{walkInData.party_size}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setWalkInData({ ...walkInData, party_size: walkInData.party_size + 1 })
                    }
                  >
                    +
                  </Button>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
                <Textarea
                  value={walkInData.notes}
                  onChange={(e) => setWalkInData({ ...walkInData, notes: e.target.value })}
                  placeholder="Special requests, allergies, occasion..."
                  rows={2}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWalkInModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleWalkInSubmit}
              disabled={!walkInData.customer_name || walkIn.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {walkIn.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Seat Guest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Table Detail Modal */}
      <Dialog open={showTableDetailModal} onOpenChange={setShowTableDetailModal}>
        <DialogContent className="sm:max-w-md">
          {selectedTable && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>{selectedTable.table_name}</span>
                  <Badge className={cn(STATUS_CONFIG[selectedTable.status].bgColor, "text-white")}>
                    {STATUS_CONFIG[selectedTable.status].label}
                  </Badge>
                </DialogTitle>
                {selectedTable.current_customer_name && (
                  <DialogDescription>
                    Guest: <span className="font-semibold text-slate-900">{selectedTable.current_customer_name}</span>
                    {selectedTable.current_party_size && (
                      <span className="ml-2">({selectedTable.current_party_size} guests)</span>
                    )}
                  </DialogDescription>
                )}
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                {/* Status Progress */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Service Progress</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {STATUS_FLOW.filter((s) => s !== "empty").map((status, index) => {
                      const isActive = STATUS_FLOW.indexOf(selectedTable.status) >= index + 1;
                      const isCurrent = selectedTable.status === status;
                      return (
                        <div
                          key={status}
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                            isCurrent
                              ? STATUS_CONFIG[status].bgColor + " text-white ring-2 ring-offset-2 ring-amber-500"
                              : isActive
                              ? STATUS_CONFIG[status].bgColor + " text-white"
                              : "bg-slate-100 text-slate-400"
                          )}
                        >
                          {index + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Advance Status Button */}
                {selectedTable.status !== "ready_to_clear" && (
                  <Button
                    onClick={handleStatusAdvance}
                    disabled={updateStatus.isPending}
                    className={cn(
                      "w-full",
                      STATUS_CONFIG[selectedTable.status].bgColor,
                      "text-white hover:opacity-90"
                    )}
                  >
                    {updateStatus.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Mark {STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(selectedTable.status) + 1]]?.label}
                  </Button>
                )}
                
                {/* Session Notes */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Session Notes</label>
                  <Textarea
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                    placeholder="Add notes about this table..."
                    rows={3}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveNote}
                    disabled={updateStatus.isPending}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Save Note
                  </Button>
                </div>
                
                {/* Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowFeedbackModal(true)}
                  >
                    <Star className="h-4 w-4 mr-2" />
                    Feedback
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      // View customer history
                      if (selectedTable.current_customer_id) {
                        router.push(`/customer/${selectedTable.current_customer_id}`);
                      }
                    }}
                    disabled={!selectedTable.current_customer_id}
                  >
                    <History className="h-4 w-4 mr-2" />
                    History
                  </Button>
                </div>
                
                {/* Clear Table */}
                {selectedTable.status === "ready_to_clear" && (
                  <Button
                    onClick={handleClearTable}
                    disabled={updateStatus.isPending}
                    variant="destructive"
                    className="w-full"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Clear Table
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Feedback Modal */}
      <Dialog open={showFeedbackModal} onOpenChange={setShowFeedbackModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Guest Feedback</DialogTitle>
            <DialogDescription>
              Rate the guest experience before clearing the table
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Star Rating */}
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setFeedbackRating(star)}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    feedbackRating >= star
                      ? "text-amber-500 bg-amber-50"
                      : "text-slate-300 hover:bg-slate-50"
                  )}
                >
                  <Star
                    className="h-8 w-8"
                    fill={feedbackRating >= star ? "currentColor" : "none"}
                  />
                </button>
              ))}
            </div>
            
            {/* Feedback Text */}
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Enter feedback about the visit, service notes, or guest behavior..."
              rows={4}
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFeedbackModal(false)}>
              Skip
            </Button>
            <Button
              onClick={() => {
                toast.success("Feedback saved");
                setShowFeedbackModal(false);
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Save Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
