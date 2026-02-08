"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Filter,
  Download,
  Calendar,
  Users,
  Phone,
  Clock,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  Plus,
  LayoutDashboard,
  Star,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const supabase = createClient();

interface Reservation {
  id: string;
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  table_id: string;
  table_name?: string;
  start_time: string;
  end_time: string;
  status: "booked" | "confirmed" | "seated" | "finished" | "cancelled" | "no_show";
  notes?: string;
}

interface TableType {
  id: string;
  name: string;
  capacity: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
}

// Mock data for fallback
const mockReservations: Reservation[] = [
  { id: "1", customer_name: "John Smith", customer_phone: "555-0101", party_size: 2, table_id: "1", table_name: "Table 1", start_time: "2024-01-15T19:00:00", end_time: "2024-01-15T20:30:00", status: "finished", notes: "Anniversary dinner" },
  { id: "2", customer_name: "Sarah Johnson", customer_phone: "555-0102", party_size: 4, table_id: "2", table_name: "Table 2", start_time: "2024-01-15T19:30:00", end_time: "2024-01-15T21:00:00", status: "finished" },
  { id: "3", customer_name: "Mike Brown", customer_phone: "555-0103", party_size: 3, table_id: "2", table_name: "Table 2", start_time: "2024-01-15T17:00:00", end_time: "2024-01-15T18:30:00", status: "cancelled" },
  { id: "4", customer_name: "Emily Davis", customer_phone: "555-0104", party_size: 6, table_id: "4", table_name: "Table 4", start_time: "2024-01-15T20:00:00", end_time: "2024-01-15T22:00:00", status: "finished" },
  { id: "5", customer_name: "Robert Wilson", customer_phone: "555-0105", party_size: 8, table_id: "5", table_name: "Table 5", start_time: "2024-01-15T18:00:00", end_time: "2024-01-15T20:00:00", status: "no_show" },
];

const mockTables: TableType[] = [
  { id: "1", name: "Table 1", capacity: 2 },
  { id: "2", name: "Table 2", capacity: 4 },
  { id: "3", name: "Table 3", capacity: 4 },
  { id: "4", name: "Table 4", capacity: 6 },
  { id: "5", name: "Table 5", capacity: 8 },
  { id: "6", name: "Table 6", capacity: 2 },
  { id: "7", name: "Table 7", capacity: 4 },
  { id: "8", name: "Table 8", capacity: 6 },
];

export default function ReservationsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("date");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);

  // Form states for add/edit
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    party_size: 2,
    table_id: "",
    date: "",
    time: "",
    duration: 90,
    status: "booked" as Reservation["status"],
    notes: "",
  });

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").limit(1).single();
      if (error) return null;
      return data?.id || null;
    },
  });

  // Fetch tables
  const { data: tables = mockTables } = useQuery({
    queryKey: ["list-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return mockTables;
      const { data, error } = await supabase
        .from("tables")
        .select("id, name, capacity")
        .eq("restaurant_id", restaurantId);
      if (error) return mockTables;
      return data || mockTables;
    },
    enabled: true,
  });

  // Fetch reservations
  const { data: reservations = mockReservations } = useQuery({
    queryKey: ["list-reservations", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return mockReservations;
      const { data, error } = await supabase
        .from("reservations")
        .select("id, customer_name, customer_phone, party_size, table_id, start_time, end_time, status, notes")
        .eq("restaurant_id", restaurantId)
        .order("start_time", { ascending: false });
      if (error) return mockReservations;
      
      return (data || []).map((r: Reservation) => ({
        ...r,
        table_name: tables.find((t: TableType) => t.id === r.table_id)?.name || "Unknown",
      }));
    },
    enabled: true,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reservations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation deleted successfully");
    },
    onError: (error) => {
      toast.error("Failed to delete reservation: " + error.message);
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!restaurantId) throw new Error("No restaurant");
      
      const startDateTime = `${data.date}T${data.time}:00`;
      const [hours, minutes] = data.time.split(":").map(Number);
      const endTotalMinutes = hours * 60 + minutes + data.duration;
      const endHours = Math.floor(endTotalMinutes / 60);
      const endMins = endTotalMinutes % 60;
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}`;
      const endDateTime = `${data.date}T${endTime}:00`;

      const { data: result, error } = await supabase
        .from("reservations")
        .insert({
          restaurant_id: restaurantId,
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          party_size: data.party_size,
          table_id: data.table_id,
          start_time: startDateTime,
          end_time: endDateTime,
          status: data.status,
          notes: data.notes,
        })
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast.success("Reservation created successfully");
    },
    onError: (error) => {
      toast.error("Failed to create reservation: " + error.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previousStatus }: { id: string; data: Partial<typeof formData>; previousStatus?: string }) => {
      const updateData: Record<string, unknown> = {};
      
      if (data.customer_name) updateData.customer_name = data.customer_name;
      if (data.customer_phone !== undefined) updateData.customer_phone = data.customer_phone;
      if (data.party_size) updateData.party_size = data.party_size;
      if (data.table_id) updateData.table_id = data.table_id;
      if (data.status) updateData.status = data.status;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const { data: result, error } = await supabase
        .from("reservations")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsEditDialogOpen(false);
      setSelectedReservation(null);
      toast.success("Reservation updated successfully");
    },
    onError: (error) => {
      toast.error("Failed to update reservation: " + error.message);
    },
  });

  // Record visit mutation for customer stats tracking
  const recordVisitMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const response = await fetch(`/api/reservations/${id}/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error('Failed to record visit');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const resetForm = () => {
    setFormData({
      customer_name: "",
      customer_phone: "",
      party_size: 2,
      table_id: "",
      date: new Date().toISOString().split("T")[0],
      time: "19:00",
      duration: 90,
      status: "booked",
      notes: "",
    });
  };

  const handleEdit = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    const date = reservation.start_time.split("T")[0];
    const timeMatch = reservation.start_time.match(/T(\d{2}):(\d{2})/);
    const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : "19:00";
    
    // Calculate duration
    const start = new Date(reservation.start_time).getTime();
    const end = new Date(reservation.end_time).getTime();
    const durationMinutes = Math.round((end - start) / (1000 * 60));

    setFormData({
      customer_name: reservation.customer_name,
      customer_phone: reservation.customer_phone || "",
      party_size: reservation.party_size,
      table_id: reservation.table_id,
      date,
      time,
      duration: durationMinutes,
      status: reservation.status,
      notes: reservation.notes || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this reservation?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditDialogOpen && selectedReservation) {
      // Check if status changed and call visit API
      if (formData.status !== selectedReservation.status) {
        // Update reservation status first
        updateMutation.mutate({ id: selectedReservation.id, data: formData });
        
        // Then call visit API for customer stats
        if (formData.status === "seated") {
          recordVisitMutation.mutate({ id: selectedReservation.id, action: "seat" });
        } else if (formData.status === "finished") {
          recordVisitMutation.mutate({ id: selectedReservation.id, action: "finish" });
        } else if (formData.status === "no_show") {
          recordVisitMutation.mutate({ id: selectedReservation.id, action: "no_show" });
        } else if (formData.status === "cancelled") {
          recordVisitMutation.mutate({ id: selectedReservation.id, action: "cancel" });
        }
      } else {
        updateMutation.mutate({ id: selectedReservation.id, data: formData });
      }
    } else {
      createMutation.mutate(formData);
    }
  };

  // Filter and sort reservations
  const filteredReservations = useMemo(() => {
    let filtered = [...reservations];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(query) ||
          (r.customer_phone && r.customer_phone.includes(query))
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }

    if (tableFilter !== "all") {
      filtered = filtered.filter((r) => r.table_id === tableFilter);
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case "date":
          return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
        case "name":
          return a.customer_name.localeCompare(b.customer_name);
        case "party":
          return b.party_size - a.party_size;
        case "status":
          return a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });

    return filtered;
  }, [reservations, searchQuery, statusFilter, tableFilter, sortBy]);

  const totalPages = Math.ceil(filteredReservations.length / itemsPerPage);
  const paginatedReservations = filteredReservations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "booked": return "bg-blue-500";
      case "confirmed": return "bg-blue-600";
      case "seated": return "bg-green-500";
      case "finished": return "bg-gray-500";
      case "cancelled": return "bg-red-500";
      case "no_show": return "bg-amber-500";
      default: return "bg-blue-500";
    }
  };

  const formatTime = (timeString: string) => {
    const match = timeString.match(/T(\d{2}):(\d{2})/);
    if (!match) return "--:--";
    const hours = parseInt(match[1], 10);
    const mins = match[2];
    const displayHours = hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? "PM" : "AM";
    return `${displayHours}:${mins} ${ampm}`;
  };

  const formatDate = (timeString: string) => {
    const date = new Date(timeString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const handleExport = () => {
    const csv = [
      ["Name", "Phone", "Party Size", "Table", "Date", "Time", "Status", "Notes"].join(","),
      ...filteredReservations.map((r) =>
        [
          r.customer_name,
          r.customer_phone || "",
          r.party_size,
          r.table_name,
          formatDate(r.start_time),
          formatTime(r.start_time),
          r.status,
          r.notes || "",
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reservations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const today = new Date().toISOString().split("T")[0];

  // Mobile Card Component
  const ReservationCard = ({ reservation }: { reservation: Reservation }) => (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-lg">{reservation.customer_name}</h3>
            {reservation.customer_phone && (
              <div className="flex items-center gap-1 text-muted-foreground text-sm">
                <Phone className="h-3 w-3" />
                {reservation.customer_phone}
              </div>
            )}
          </div>
          <Badge className={`${getStatusColor(reservation.status)} text-white capitalize`}>
            {reservation.status.replace("_", "-")}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span>{reservation.party_size} guests</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{reservation.table_name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm mb-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>
            {formatDate(reservation.start_time)} • {formatTime(reservation.start_time)} - {formatTime(reservation.end_time)}
          </span>
        </div>

        {reservation.notes && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {reservation.notes}
          </p>
        )}

        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="flex-1"
            onClick={() => handleEdit(reservation)}
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => handleDelete(reservation.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header - Responsive */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-4xl font-bold mb-1">Reservations</h1>
          <p className="text-sm lg:text-xl text-muted-foreground">
            {filteredReservations.length} total reservations
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className="flex-1 lg:flex-none">
            <Button variant="outline" className="w-full lg:w-auto gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Timeline View</span>
              <span className="sm:hidden">Timeline</span>
            </Button>
          </Link>
          <Button onClick={handleExport} variant="outline" className="flex-1 lg:flex-none gap-2">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">Export</span>
          </Button>
          <Button 
            onClick={() => { resetForm(); setIsAddDialogOpen(true); }} 
            className="flex-1 lg:flex-none gap-2"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Reservation</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      {/* Filters - Responsive */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Desktop Filters */}
        <div className="hidden md:flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="booked">Booked</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="seated">Seated</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="no_show">No-Show</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Tables" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tables</SelectItem>
              {tables.map((table: TableType) => (
                <SelectItem key={table.id} value={table.id}>
                  {table.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Sort by Date</SelectItem>
              <SelectItem value="name">Sort by Name</SelectItem>
              <SelectItem value="party">Sort by Party Size</SelectItem>
              <SelectItem value="status">Sort by Status</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mobile Filters Sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="md:hidden gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {(statusFilter !== "all" || tableFilter !== "all") && (
                <Badge variant="secondary" className="ml-1">
                  {(statusFilter !== "all" ? 1 : 0) + (tableFilter !== "all" ? 1 : 0)}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[70vh]">
            <SheetHeader>
              <SheetTitle>Filters & Sort</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="booked">Booked</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="seated">Seated</SelectItem>
                    <SelectItem value="finished">Finished</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="no_show">No-Show</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Table</Label>
                <Select value={tableFilter} onValueChange={setTableFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Tables" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tables</SelectItem>
                    {tables.map((table: TableType) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Sort By</Label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Sort by Date</SelectItem>
                    <SelectItem value="name">Sort by Name</SelectItem>
                    <SelectItem value="party">Sort by Party Size</SelectItem>
                    <SelectItem value="status">Sort by Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Date & Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedReservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No reservations found. Click "New Reservation" to create one.
                </TableCell>
              </TableRow>
            ) : (
              paginatedReservations.map((reservation) => (
                <TableRow key={reservation.id}>
                  <TableCell className="font-medium">{reservation.customer_name}</TableCell>
                  <TableCell>
                    {reservation.customer_phone && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {reservation.customer_phone}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {reservation.party_size}
                    </div>
                  </TableCell>
                  <TableCell>{reservation.table_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{formatDate(reservation.start_time)}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(reservation.start_time)} - {formatTime(reservation.end_time)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${getStatusColor(reservation.status)} text-white capitalize`}>
                      {reservation.status.replace("_", "-")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
                      {reservation.notes || "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => handleEdit(reservation)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-red-500"
                        onClick={() => handleDelete(reservation.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden">
        {paginatedReservations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No reservations found. Click "New" to create one.
          </div>
        ) : (
          paginatedReservations.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-muted-foreground hidden sm:block">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, filteredReservations.length)} of{" "}
            {filteredReservations.length} reservations
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-center sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add/Edit Dialog - Responsive */}
      <Dialog open={isAddDialogOpen || isEditDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setIsEditDialogOpen(false);
          setSelectedReservation(null);
        }
      }}>
        <DialogContent className="sm:max-w-md max-h-[95vh] sm:max-h-[90vh] overflow-y-auto w-[95vw] sm:w-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-xl sm:text-2xl">
              {isEditDialogOpen ? "Edit Reservation" : "New Reservation"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm sm:text-base">Customer Name *</Label>
              <Input
                id="name"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                placeholder="John Smith"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm sm:text-base">Phone Number</Label>
              <Input
                id="phone"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                placeholder="555-0101"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-2">
                <Label className="text-sm sm:text-base">Party Size</Label>
                <div className="flex gap-1 sm:gap-2">
                  {[2, 4, 6, 8].map((size) => (
                    <Button
                      key={size}
                      type="button"
                      variant={formData.party_size === size ? "default" : "outline"}
                      className="flex-1 text-sm sm:text-base px-2 sm:px-4"
                      onClick={() => setFormData({ ...formData, party_size: size })}
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="table" className="text-sm sm:text-base">Table *</Label>
                <Select
                  value={formData.table_id}
                  onValueChange={(value) => setFormData({ ...formData, table_id: value })}
                  required
                >
                  <SelectTrigger className="text-sm sm:text-base">
                    <SelectValue placeholder="Select table" />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((table: TableType) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name} (seats {table.capacity})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="date" className="text-sm sm:text-base">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  min={today}
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time" className="text-sm sm:text-base">Time *</Label>
                <Input
                  id="time"
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm sm:text-base">Duration</Label>
              <div className="flex gap-1 sm:gap-2">
                {[60, 90, 120, 150].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={formData.duration === mins ? "default" : "outline"}
                    className="flex-1 text-xs sm:text-sm px-2 sm:px-4"
                    onClick={() => setFormData({ ...formData, duration: mins })}
                  >
                    {mins}m
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-sm sm:text-base">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value as Reservation["status"] })}
              >
                <SelectTrigger className="text-sm sm:text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked">Booked</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="seated">Seated</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No-Show</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm sm:text-base">Notes</Label>
              <textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Special requests, allergies, occasion..."
                className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-sm sm:text-base resize-none"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full text-sm sm:text-base"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending 
                ? "Saving..." 
                : isEditDialogOpen ? "Update Reservation" : "Create Reservation"
              }
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
