"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRestaurant } from "@/app/RestaurantContext";
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
  DollarSign,
  TrendingUp,
  Calendar,
  ArrowLeft,
  Timer,
  MoreVertical,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import type { Customer, Table } from "@/lib/types";

// Service status type - Simplified 4-step flow
export type ServiceStatus = 
  | "empty" 
  | "seated" 
  | "order_taken" 
  | "check_requested" 
  | "ready_to_clear";

// Table status with details
interface TableStatus {
  id?: string;
  table_id: string;
  table_name: string;
  table_capacity: number;
  room_name?: string;
  section?: string;
  status: ServiceStatus;
  current_status: ServiceStatus;
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
  updated_at?: string;
  // Guest source indicator
  guest_source?: "empty" | "reservation" | "walk-in" | "reserved-soon";
  // Upcoming reservation info
  upcoming_reservation_id?: string;
  upcoming_customer_name?: string;
  upcoming_party_size?: number;
  upcoming_time?: string;
  upcoming_status?: string;
  minutes_until?: number;
  urgency?: "overdue" | "arriving_soon" | "upcoming" | "later";
  // Revenue tracking
  current_order_value?: number;
}

// Active reservation for seating
interface ActiveReservation {
  id: string;
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  start_time: string;
  status: string;
  table_id: string;
  table_name?: string;
  notes?: string;
}

// Service status configuration - Simplified 4-step flow
const STATUS_FLOW: ServiceStatus[] = [
  "empty",
  "seated",
  "order_taken",
  "check_requested",
  "ready_to_clear",
];

const STATUS_CONFIG: Record<ServiceStatus, {
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  bgColor: string;
  borderColor: string;
  textColor: string;
  lightBg: string;
  description: string;
  stepNumber: number;
}> = {
  empty: {
    label: "Empty & Available",
    shortLabel: "Empty",
    icon: <div className="h-3 w-3 rounded-full bg-slate-400" />,
    bgColor: "bg-slate-500",
    borderColor: "border-slate-400",
    textColor: "text-slate-700",
    lightBg: "bg-slate-50",
    description: "Table ready for guests",
    stepNumber: 0,
  },
  seated: {
    label: "Guests Seated",
    shortLabel: "Seated",
    icon: <Users className="h-4 w-4" />,
    bgColor: "bg-blue-500",
    borderColor: "border-blue-500",
    textColor: "text-blue-700",
    lightBg: "bg-blue-50",
    description: "Guests just arrived",
    stepNumber: 1,
  },
  order_taken: {
    label: "Order Taken",
    shortLabel: "Ordered",
    icon: <FileText className="h-4 w-4" />,
    bgColor: "bg-amber-500",
    borderColor: "border-amber-500",
    textColor: "text-amber-700",
    lightBg: "bg-amber-50",
    description: "Order with kitchen",
    stepNumber: 2,
  },
  check_requested: {
    label: "Check Requested",
    shortLabel: "Check",
    icon: <Receipt className="h-4 w-4" />,
    bgColor: "bg-violet-500",
    borderColor: "border-violet-500",
    textColor: "text-violet-700",
    lightBg: "bg-violet-50",
    description: "Payment pending",
    stepNumber: 3,
  },
  ready_to_clear: {
    label: "Ready to Clear",
    shortLabel: "Clearing",
    icon: <CheckCircle2 className="h-4 w-4" />,
    bgColor: "bg-slate-600",
    borderColor: "border-slate-600",
    textColor: "text-slate-700",
    lightBg: "bg-slate-100",
    description: "Ready to reset table",
    stepNumber: 4,
  },
};

// API hooks
function useTableStatuses(restaurantId: string | null) {
  return useQuery<TableStatus[]>({
    queryKey: ["table-statuses", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const res = await fetch(`/api/tables/waiter-status?restaurantId=${restaurantId}`);
      if (!res.ok) throw new Error("Failed to fetch table statuses");
      const data = await res.json();
      return data.tables;
    },
    enabled: !!restaurantId,
    refetchInterval: 3000, // Refresh every 3 seconds for "live" feel
  });
}

function useActiveReservations(restaurantId: string | null) {
  return useQuery<ActiveReservation[]>({
    queryKey: ["active-reservations", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClientWithAuth();
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("reservations")
        .select(`
          id,
          customer_name,
          customer_phone,
          party_size,
          start_time,
          status,
          table_id,
          notes,
          tables:table_id (name)
        `)
        .eq("restaurant_id", restaurantId)
        .in("status", ["booked", "confirmed", "seated"])
        .gte("start_time", `${today}T00:00:00`)
        .lte("start_time", `${today}T23:59:59`)
        .order("start_time", { ascending: true });
      
      if (error) throw error;
      
      return (data || []).map((r: any) => ({
        ...r,
        table_name: r.tables?.name || "Unknown",
      }));
    },
    enabled: !!restaurantId,
    refetchInterval: 5000,
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
      queryClient.invalidateQueries({ queryKey: ["active-reservations"] });
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
      queryClient.invalidateQueries({ queryKey: ["active-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

function useSeatReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      reservation_id: string;
      table_id: string;
      restaurant_id: string;
    }) => {
      const res = await fetch("/api/reservations/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: payload.reservation_id,
          table_id: payload.table_id,
          restaurant_id: payload.restaurant_id,
          action: "seat",
        }),
      });
      if (!res.ok) throw new Error("Failed to seat reservation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["table-statuses"] });
      queryClient.invalidateQueries({ queryKey: ["active-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
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
      total_spend?: number;
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
      queryClient.invalidateQueries({ queryKey: ["customers"] });
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

// Main component
export default function WaiterMobilePage() {
  const { user, restaurant, isLoading: authLoading, signOut } = useRestaurant();
  const router = useRouter();
  const queryClient = useQueryClient();
  
  // State
  const [selectedTable, setSelectedTable] = useState<TableStatus | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "occupied" | "available" | "reservations">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Modals
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [showTableDetailSheet, setShowTableDetailSheet] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showReservationsSheet, setShowReservationsSheet] = useState(false);
  
  // Walk-in form state
  const [walkInData, setWalkInData] = useState({
    customer_name: "",
    customer_phone: "",
    party_size: 2,
    notes: "",
  });
  
  // Feedback & revenue state
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [orderValue, setOrderValue] = useState<string>("");
  
  // Customer search
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  
  // Data fetching
  const { data: tableStatuses = [], isLoading: tablesLoading } = useTableStatuses(
    restaurant?.id || null
  );
  const { data: activeReservations = [], isLoading: reservationsLoading } = useActiveReservations(
    restaurant?.id || null
  );
  const { data: customers = [] } = useCustomers(restaurant?.id || null);
  
  // Mutations
  const updateStatus = useUpdateTableStatus();
  const walkIn = useWalkIn();
  const seatReservation = useSeatReservation();
  const createVisitLog = useCreateVisitLog();
  
  // Real-time subscription for table status updates
  useEffect(() => {
    if (!restaurant?.id) return;
    
    const supabase = createClientWithAuth();
    
    // Subscribe to table_service_status changes
    const subscription = supabase
      .channel(`table-status-${restaurant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "table_service_status",
          filter: `restaurant_id=eq.${restaurant.id}`,
        },
        () => {
          // Invalidate and refetch table statuses
          queryClient.invalidateQueries({ queryKey: ["table-statuses"] });
        }
      )
      .subscribe();
    
    return () => {
      subscription.unsubscribe();
    };
  }, [restaurant?.id, queryClient]);
  
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
    const status = table.current_status || table.status || "empty";
    
    // View mode filter
    if (viewMode === "occupied" && status === "empty") return false;
    if (viewMode === "available" && status !== "empty") return false;
    
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
    occupied: tableStatuses.filter((t) => (t.current_status || t.status || "empty") !== "empty").length,
    available: tableStatuses.filter((t) => (t.current_status || t.status || "empty") === "empty").length,
    needClearing: tableStatuses.filter((t) => (t.current_status || t.status) === "ready_to_clear").length,
    guests: tableStatuses.reduce((sum, t) => sum + (t.current_party_size || 0), 0),
    activeReservations: activeReservations.length,
    totalRevenue: tableStatuses.reduce((sum, t) => sum + (t.current_order_value || 0), 0),
  };
  
  // Get tables with upcoming reservations
  const tablesWithUpcomingReservations = tableStatuses.filter(
    (t) => t.upcoming_reservation_id && t.upcoming_status !== "seated"
  );
  
  // Handlers
  const handleTableClick = (table: TableStatus) => {
    setSelectedTable(table);
    setSessionNote(table.session_notes || "");
    setOrderValue(table.current_order_value?.toString() || "");
    
    if (table.status === "empty") {
      // Check if there's an upcoming reservation for this table
      if (table.upcoming_reservation_id && table.upcoming_status !== "seated") {
        // Show option to seat reservation or walk-in
        setShowReservationsSheet(true);
      } else {
        setShowWalkInModal(true);
      }
    } else {
      setShowTableDetailSheet(true);
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
      setSelectedTable({ ...selectedTable, status: nextStatus, current_status: nextStatus });
    }
  };
  
  const handleStatusRevert = async () => {
    if (!selectedTable || !restaurant) return;
    
    const currentIndex = STATUS_FLOW.indexOf(selectedTable.status);
    if (currentIndex > 1) { // Don't go below "seated"
      const prevStatus = STATUS_FLOW[currentIndex - 1];
      await updateStatus.mutateAsync({
        table_id: selectedTable.table_id,
        restaurant_id: restaurant.id,
        status: prevStatus,
      });
      toast.success(`Status reverted to ${STATUS_CONFIG[prevStatus].label}`);
      setSelectedTable({ ...selectedTable, status: prevStatus, current_status: prevStatus });
    }
  };
  
  const handleClearTable = async () => {
    if (!selectedTable || !restaurant) return;
    
    const totalSpend = parseFloat(orderValue) || 0;
    
    // Create visit log with feedback and revenue
    if (selectedTable.current_customer_id) {
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
        total_spend: totalSpend > 0 ? totalSpend : undefined,
      });
    }
    
    // Clear table status
    await updateStatus.mutateAsync({
      table_id: selectedTable.table_id,
      restaurant_id: restaurant.id,
      status: "empty",
    });
    
    toast.success("Table cleared");
    setShowTableDetailSheet(false);
    setShowFeedbackModal(false);
    setFeedbackRating(0);
    setFeedbackText("");
    setSessionNote("");
    setOrderValue("");
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
  
  const handleSeatReservation = async (reservation: ActiveReservation) => {
    if (!restaurant) return;
    
    await seatReservation.mutateAsync({
      reservation_id: reservation.id,
      table_id: reservation.table_id,
      restaurant_id: restaurant.id,
    });
    
    toast.success(`Seated ${reservation.customer_name}`);
    setShowReservationsSheet(false);
    setShowWalkInModal(false);
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
  
  const handleSaveOrderValue = async () => {
    if (!selectedTable || !restaurant) return;
    
    const value = parseFloat(orderValue) || 0;
    
    await updateStatus.mutateAsync({
      table_id: selectedTable.table_id,
      restaurant_id: restaurant.id,
      status: selectedTable.status,
      current_order_value: value,
    });
    
    toast.success("Order value saved");
    setSelectedTable({ ...selectedTable, current_order_value: value });
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
  
  // Format minutes seated
  const formatTimeSeated = (minutes?: number) => {
    if (!minutes) return "0m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };
  
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
  
  const currentStatus = selectedTable?.current_status || selectedTable?.status || "empty";
  const currentConfig = STATUS_CONFIG[currentStatus];
  const currentStep = STATUS_FLOW.indexOf(currentStatus);
  
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
      <div className="grid grid-cols-3 gap-2 p-3 bg-white border-b border-slate-200">
        <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <p className="text-xl font-bold text-emerald-600">{stats.available}</p>
          <p className="text-[10px] text-emerald-600 font-medium uppercase">Available</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-blue-50 border border-blue-100">
          <p className="text-xl font-bold text-blue-600">{stats.occupied}</p>
          <p className="text-[10px] text-blue-600 font-medium uppercase">Occupied</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-amber-50 border border-amber-100">
          <p className="text-xl font-bold text-amber-600">{stats.activeReservations}</p>
          <p className="text-[10px] text-amber-600 font-medium uppercase">Reservations</p>
        </div>
      </div>
      
      {/* Secondary Stats */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-100 text-xs">
        <div className="flex items-center gap-4">
          <span className="text-slate-600">
            <Users className="h-3 w-3 inline mr-1" />
            {stats.guests} guests
          </span>
          <span className="text-slate-600">
            <CheckCircle2 className="h-3 w-3 inline mr-1" />
            {stats.needClearing} to clear
          </span>
        </div>
        <span className="font-medium text-slate-700">
          {stats.total} tables total
        </span>
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="occupied">Busy</TabsTrigger>
            <TabsTrigger value="available">Free</TabsTrigger>
            <TabsTrigger value="reservations">📅</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      
      {/* Tables Grid */}
      <main className="p-4">
        {viewMode === "reservations" ? (
          // Reservations View
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              Today's Reservations
            </h2>
            {reservationsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : activeReservations.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No reservations for today</p>
              </div>
            ) : (
              activeReservations.map((res) => (
                <Card key={res.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900">{res.customer_name}</h3>
                        <p className="text-sm text-slate-500">
                          {res.party_size} guests • Table {res.table_name}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {new Date(res.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge 
                          variant={res.status === "seated" ? "default" : "secondary"}
                          className={res.status === "seated" ? "bg-green-500" : ""}
                        >
                          {res.status}
                        </Badge>
                        {res.status !== "seated" && (
                          <Button 
                            size="sm" 
                            className="h-8"
                            onClick={() => handleSeatReservation(res)}
                            disabled={seatReservation.isPending}
                          >
                            {seatReservation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Users className="h-3 w-3 mr-1" />
                                Seat
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          // Tables Grid View
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredTables.map((table) => {
              const status = table.current_status || table.status || "empty";
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.empty;
              const isOccupied = status !== "empty";
              const hasUpcoming = table.upcoming_reservation_id && table.upcoming_status !== "seated";
              
              return (
                <button
                  key={table.table_id}
                  onClick={() => handleTableClick(table)}
                  className={cn(
                    "relative p-4 rounded-xl border-2 text-left transition-all",
                    "hover:shadow-md active:scale-95",
                    isOccupied
                      ? `${config.bgColor} ${config.borderColor} text-white shadow-lg`
                      : hasUpcoming
                      ? "bg-amber-50 border-amber-300 hover:border-amber-400 text-slate-900"
                      : "bg-white border-slate-200 hover:border-slate-300 text-slate-900"
                  )}
                >
                  {/* Guest Source Indicator */}
                  {table.guest_source && table.guest_source !== "empty" && (
                    <div className="absolute top-2 right-2">
                      {table.guest_source === "reservation" && (
                        <span className="text-lg" title="Reservation">📅</span>
                      )}
                      {table.guest_source === "walk-in" && (
                        <span className="text-lg" title="Walk-in">👤</span>
                      )}
                      {table.guest_source === "reserved-soon" && (
                        <span className="text-lg" title="Reserved soon">⏰</span>
                      )}
                    </div>
                  )}
                  
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
                  
                  {/* Status Badge */}
                  <div className={cn(
                    "text-xs font-medium px-2 py-1 rounded-full inline-flex items-center gap-1",
                    isOccupied 
                      ? "bg-white/20 text-white" 
                      : "bg-slate-100 text-slate-600"
                  )}>
                    {config.icon}
                    {config.shortLabel}
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
                      <Timer className="h-3 w-3" />
                      {formatTimeSeated(table.minutes_seated)}
                    </div>
                  )}
                  
                  {/* Upcoming Reservation Info */}
                  {!isOccupied && hasUpcoming && (
                    <div className="mt-2 text-xs text-amber-700">
                      <div className="flex items-center gap-1 font-medium">
                        <Clock className="h-3 w-3" />
                        <span>{table.minutes_until}m</span>
                      </div>
                      <div className="truncate">{table.upcoming_customer_name}</div>
                      <div className="text-amber-600">{table.upcoming_party_size} guests</div>
                    </div>
                  )}
                  
                  {/* Empty indicator */}
                  {!isOccupied && !hasUpcoming && (
                    <div className="mt-2 flex items-center gap-1 text-sm text-slate-500">
                      <Plus className="h-4 w-4" />
                      <span>Walk-in</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
        
        {filteredTables.length === 0 && viewMode !== "reservations" && (
          <div className="text-center py-12">
            <ChefHat className="h-12 w-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500">No tables found</p>
          </div>
        )}
      </main>
      
      {/* Reservations Sheet (when clicking empty table with reservation) */}
      <Sheet open={showReservationsSheet} onOpenChange={setShowReservationsSheet}>
        <SheetContent side="bottom" className="h-auto max-h-[70vh]">
          <SheetHeader>
            <SheetTitle>Seat Guest at {selectedTable?.table_name}</SheetTitle>
            <SheetDescription>
              Choose to seat a reservation or add a walk-in guest
            </SheetDescription>
          </SheetHeader>
          
          <div className="py-4 space-y-4">
            {/* Upcoming reservation for this table */}
            {selectedTable?.upcoming_reservation_id && (
              <Card className="border-amber-200 bg-amber-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Reserved Guest
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{selectedTable.upcoming_customer_name}</p>
                      <p className="text-sm text-slate-600">
                        {selectedTable.upcoming_party_size} guests • 
                        {selectedTable.minutes_until && selectedTable.minutes_until < 0 
                          ? ` ${Math.abs(selectedTable.minutes_until)}m late`
                          : ` in ${selectedTable.minutes_until}m`
                        }
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        const reservation = activeReservations.find(
                          r => r.id === selectedTable.upcoming_reservation_id
                        );
                        if (reservation) handleSeatReservation(reservation);
                      }}
                      disabled={seatReservation.isPending}
                    >
                      {seatReservation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Seat Guest"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <Separator />
            
            {/* Walk-in option */}
            <Button
              variant="outline"
              className="w-full h-auto py-4"
              onClick={() => {
                setShowReservationsSheet(false);
                setShowWalkInModal(true);
              }}
            >
              <UserPlus className="h-5 w-5 mr-2" />
              <div className="text-left">
                <p className="font-medium">Walk-in Guest</p>
                <p className="text-xs text-slate-500">Add a guest without reservation</p>
              </div>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      
      {/* Walk-In Modal */}
      <Dialog open={showWalkInModal} onOpenChange={setShowWalkInModal}>
        <DialogContent className="sm:max-w-md max-h-[95vh] overflow-y-auto">
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
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
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
                <label className="text-sm font-medium text-slate-700">Guest Name *</label>
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
      
      {/* Table Detail Sheet */}
      <Sheet open={showTableDetailSheet} onOpenChange={setShowTableDetailSheet}>
        <SheetContent side="bottom" className="h-auto max-h-[90vh] overflow-y-auto">
          {selectedTable && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-2xl">{selectedTable.table_name}</SheetTitle>
                  <Badge className={cn(currentConfig.bgColor, "text-white text-sm px-3 py-1")}>
                    {currentConfig.label}
                  </Badge>
                </div>
                {selectedTable.current_customer_name && (
                  <SheetDescription className="text-base">
                    <span className="font-semibold text-slate-900">{selectedTable.current_customer_name}</span>
                    {selectedTable.current_party_size && (
                      <span className="ml-2 text-slate-600">
                        ({selectedTable.current_party_size} guests)
                      </span>
                    )}
                  </SheetDescription>
                )}
              </SheetHeader>
              
              <div className="space-y-6 py-4">
                {/* Service Progress Steps */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-700">Service Progress</label>
                  <div className="flex items-center gap-1 overflow-x-auto pb-2">
                    {STATUS_FLOW.filter((s) => s !== "empty").map((status, index) => {
                      const isActive = currentStep >= index + 1;
                      const isCurrent = currentStatus === status;
                      const statusConfig = STATUS_CONFIG[status];
                      
                      return (
                        <div key={status} className="flex items-center">
                          <button
                            onClick={async () => {
                              if (!restaurant) return;
                              await updateStatus.mutateAsync({
                                table_id: selectedTable.table_id,
                                restaurant_id: restaurant.id,
                                status: status,
                              });
                              setSelectedTable({ ...selectedTable, status, current_status: status });
                              toast.success(`Status: ${statusConfig.label}`);
                            }}
                            disabled={updateStatus.isPending}
                            className={cn(
                              "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                              isCurrent
                                ? `${statusConfig.bgColor} text-white ring-2 ring-offset-2 ring-amber-500 scale-110`
                                : isActive
                                ? `${statusConfig.bgColor} text-white`
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                            )}
                            title={statusConfig.label}
                          >
                            {index + 1}
                          </button>
                          {index < STATUS_FLOW.length - 2 && (
                            <div className={cn(
                              "w-2 h-0.5 flex-shrink-0",
                              currentStep > index + 1 ? "bg-emerald-400" : "bg-slate-200"
                            )} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-sm text-slate-500">{currentConfig.description}</p>
                </div>
                
                {/* Quick Actions */}
                <div className="flex gap-2">
                  {currentStatus !== "ready_to_clear" && (
                    <Button
                      onClick={handleStatusAdvance}
                      disabled={updateStatus.isPending}
                      className={cn("flex-1", currentConfig.bgColor, "text-white hover:opacity-90")}
                    >
                      {updateStatus.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <ArrowRight className="h-4 w-4 mr-2" />
                          {STATUS_FLOW[STATUS_FLOW.indexOf(currentStatus) + 1] 
                            ? STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(currentStatus) + 1]].shortLabel 
                            : "Next"}
                        </>
                      )}
                    </Button>
                  )}
                  
                  {currentStatus !== "seated" && currentStatus !== "empty" && (
                    <Button
                      variant="outline"
                      onClick={handleStatusRevert}
                      disabled={updateStatus.isPending}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                
                {/* Order Value */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Order Value
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={orderValue}
                      onChange={(e) => setOrderValue(e.target.value)}
                      className="flex-1"
                    />
                    <Button 
                      variant="outline" 
                      onClick={handleSaveOrderValue}
                      disabled={updateStatus.isPending}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                
                {/* Session Notes */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Session Notes
                  </label>
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
                    className="w-full"
                  >
                    Save Note
                  </Button>
                </div>
                
                {/* Actions Grid */}
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
                {currentStatus === "ready_to_clear" && (
                  <Button
                    onClick={handleClearTable}
                    disabled={updateStatus.isPending}
                    variant="destructive"
                    className="w-full"
                  >
                    {updateStatus.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-2" />
                    )}
                    Clear Table
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      
      {/* Feedback Modal */}
      <Dialog open={showFeedbackModal} onOpenChange={setShowFeedbackModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Guest Feedback & Finalize</DialogTitle>
            <DialogDescription>
              Rate the guest experience and enter final order value
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Star Rating */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Rating</label>
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
            </div>
            
            {/* Final Order Value */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Final Order Total
              </label>
              <Input
                type="number"
                placeholder="0.00"
                value={orderValue}
                onChange={(e) => setOrderValue(e.target.value)}
              />
            </div>
            
            {/* Feedback Text */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Feedback Notes</label>
              <Textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Enter feedback about the visit, service notes, or guest behavior..."
                rows={4}
              />
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowFeedbackModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleClearTable();
              }}
              variant="destructive"
            >
              Clear Table & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
