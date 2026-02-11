"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { 
  Users, Star, Calendar, Clock, Edit, Trash2, CheckCircle, XCircle, 
  ChevronLeft, ChevronRight, Plus, MapPin, AlertCircle, GripVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import ReservationModal from "@/components/reservations/ReservationModal";
import type { Table, Reservation } from "@/components/reservations/ReservationModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const supabase = createClient();

interface Customer {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  total_visits: number;
  last_visit?: string;
}

// Generate time slots from 8:00 AM to 12:00 AM (15-minute increments)
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 8; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const time = `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
      slots.push({ time, hour, minute, key: `${hour}:${minute}` });
    }
  }
  slots.push({ time: "12:00 AM", hour: 0, minute: 0, key: "0:0" });
  return slots;
};

const timeSlots = generateTimeSlots();
const SLOT_WIDTH = 60; // Slightly smaller for more slots visible
const TABLE_ROW_HEIGHT = 100; // Taller for more info
const HEADER_HEIGHT = 60;
const TABLE_COLUMN_WIDTH = 160;

// Get today's date in local time
const getTodayString = () => {
  if (typeof window === "undefined") return "";
  const now = new Date();
  return now.toISOString().split("T")[0];
};

// Get current time as ISO string in local time
const getCurrentTimeISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
};

// Format time from 24h to 12h
const formatTime12h = (timeString: string) => {
  const match = timeString.match(/T(\d{2}):(\d{2})/);
  if (!match) return "--:--";
  const hours = parseInt(match[1], 10);
  const mins = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${mins} ${period}`;
};

interface TimelineViewProps {
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

export default function TimelineView({ selectedDate: propSelectedDate, onDateChange }: TimelineViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  
  // Core state
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });
  const [selectedDate, setSelectedDate] = useState(() => propSelectedDate || getTodayString());
  const [currentTime, setCurrentTime] = useState(getCurrentTimeISO());
  
  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ tableId: string; slotIndex: number } | null>(null);
  
  // Drag and drop state
  const [draggedReservation, setDraggedReservation] = useState<Reservation | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{tableId: string, slotIndex: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    partySize: 2,
    tableId: "",
    duration: 90,
    notes: "",
  });
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Sync with parent date
  useEffect(() => {
    if (propSelectedDate && propSelectedDate !== selectedDate) {
      setSelectedDate(propSelectedDate);
    }
  }, [propSelectedDate]);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getCurrentTimeISO()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Scroll handler
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const handleScroll = () => setScrollPosition({ x: grid.scrollLeft, y: grid.scrollTop });
    grid.addEventListener("scroll", handleScroll);
    return () => grid.removeEventListener("scroll", handleScroll);
  }, []);

  // Fetch restaurant
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").limit(1).single();
      if (error) return null;
      return data?.id || null;
    },
  });

  // Fetch tables
  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["timeline-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("tables")
        .select("id, name, capacity")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  // Fetch reservations
  const { data: reservations = [] } = useQuery<Reservation[]>({
    queryKey: ["timeline-reservations", restaurantId, selectedDate],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("reservations")
        .select("id, table_id, customer_name, party_size, start_time, end_time, status, notes, customer_phone")
        .eq("restaurant_id", restaurantId)
        .gte("start_time", `${selectedDate}T00:00:00`)
        .lte("start_time", `${selectedDate}T23:59:59`)
        .order("start_time", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  // Group reservations by table
  const reservationsByTable = useMemo(() => {
    const grouped: Record<string, Reservation[]> = {};
    reservations.forEach((res) => {
      if (!grouped[res.table_id]) grouped[res.table_id] = [];
      grouped[res.table_id].push(res);
    });
    return grouped;
  }, [reservations]);

  // Get table availability
  const getTableAvailability = useCallback((tableId: string, startSlot: number, durationSlots: number, excludeReservationId?: string) => {
    const tableReservations = reservationsByTable[tableId] || [];
    const endSlot = startSlot + durationSlots;
    
    for (const res of tableReservations) {
      if (excludeReservationId && res.id === excludeReservationId) continue;
      if (res.status === 'cancelled' || res.status === 'no_show') continue;
      
      const resStart = timeToSlotIndex(res.start_time);
      const resEnd = timeToSlotIndex(res.end_time);
      
      if (startSlot < resEnd && endSlot > resStart) {
        return { available: false, conflictingReservation: res };
      }
    }
    return { available: true, conflictingReservation: null };
  }, [reservationsByTable]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (reservation: any) => {
      const { data, error } = await supabase.from("reservations").insert(reservation).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation created successfully");
      closeCreateDialog();
    },
    onError: (error: any) => {
      toast.error("Failed to create reservation: " + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: result, error } = await supabase.from("reservations").update(data).eq("id", id).select().single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation updated");
    },
  });

  const updateTimeMutation = useMutation({
    mutationFn: async ({ id, start_time, end_time, table_id }: { id: string; start_time: string; end_time: string; table_id: string }) => {
      const { data, error } = await supabase.from("reservations").update({ start_time, end_time, table_id }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation moved");
      setDraggedReservation(null);
      setDragOverSlot(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reservations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      toast.success("Reservation cancelled");
      setIsDeleteOpen(false);
      setSelectedReservation(null);
    },
  });

  // Customer lookup
  const lookupCustomer = async (phone: string) => {
    if (!restaurantId || phone.length < 7) return null;
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, tags, total_visits, last_visit")
      .eq("restaurant_id", restaurantId)
      .eq("phone", phone)
      .single();
    return data;
  };

  // Phone lookup effect
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (formData.phone.length >= 7) {
        setIsLookingUp(true);
        const customer = await lookupCustomer(formData.phone);
        setFoundCustomer(customer);
        if (customer && !formData.name) {
          setFormData(prev => ({ ...prev, name: customer.name }));
        }
        setIsLookingUp(false);
      } else {
        setFoundCustomer(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [formData.phone, restaurantId]);

  // Focus phone input when create dialog opens
  useEffect(() => {
    if (isCreateOpen && phoneInputRef.current) {
      setTimeout(() => phoneInputRef.current?.focus(), 100);
    }
  }, [isCreateOpen]);

  // Helper functions
  const slotIndexToTime = (slotIndex: number) => {
    const totalMinutes = 8 * 60 + slotIndex * 15; // Start from 8 AM
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  const timeToSlotIndex = (timeString: string) => {
    const match = timeString.match(/T(\d{2}):(\d{2})/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return Math.max(0, (hours - 8) * 4 + Math.floor(minutes / 15));
  };

  const calculatePosition = (startTime: string) => {
    const slotIndex = timeToSlotIndex(startTime);
    return slotIndex * SLOT_WIDTH;
  };

  const calculateWidth = (startTime: string, endTime: string) => {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMinutes = (end - start) / (1000 * 60);
    return Math.max(SLOT_WIDTH, (durationMinutes / 15) * SLOT_WIDTH);
  };

  const getStatusColor = (status: Reservation["status"]) => {
    switch (status) {
      case "booked": return "bg-blue-500 hover:bg-blue-600 border-blue-400";
      case "confirmed": return "bg-indigo-500 hover:bg-indigo-600 border-indigo-400";
      case "seated": return "bg-green-500 hover:bg-green-600 border-green-400";
      case "finished": return "bg-gray-500 hover:bg-gray-600 border-gray-400";
      case "cancelled": return "bg-red-500 hover:bg-red-600 border-red-400";
      case "no_show": return "bg-amber-500 hover:bg-amber-600 border-amber-400";
      default: return "bg-blue-500 hover:bg-blue-600 border-blue-400";
    }
  };

  const getStatusIcon = (status: Reservation["status"]) => {
    switch (status) {
      case "seated": return "🪑";
      case "finished": return "✓";
      case "cancelled": return "✕";
      case "no_show": return "⚠";
      default: return "";
    }
  };

  // Dialog handlers
  const openCreateDialog = (tableId: string, slotIndex: number) => {
    const today = getTodayString();
    if (selectedDate < today) {
      toast.error("Cannot create reservations for past dates");
      return;
    }
    
    // Check if trying to create reservation in the past on the same day
    if (selectedDate === today) {
      const slotTime = slotIndexToTime(slotIndex);
      const [slotHour, slotMinute] = slotTime.split(':').map(Number);
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      // Compare times - if slot time is before current time, don't allow
      if (slotHour < currentHour || (slotHour === currentHour && slotMinute < currentMinute)) {
        toast.error("Cannot create reservations for past times");
        return;
      }
    }
    
    setSelectedSlot({ tableId, slotIndex });
    setFormData({
      name: "",
      phone: "",
      partySize: 2,
      tableId,
      duration: 90,
      notes: "",
    });
    setFoundCustomer(null);
    setFormErrors({});
    setIsCreateOpen(true);
  };

  const closeCreateDialog = () => {
    setIsCreateOpen(false);
    setSelectedSlot(null);
    setFormData({ name: "", phone: "", partySize: 2, tableId: "", duration: 90, notes: "" });
    setFoundCustomer(null);
    setFormErrors({});
  };

  const openEditDialog = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setFormData({
      name: reservation.customer_name,
      phone: reservation.customer_phone || "",
      partySize: reservation.party_size,
      tableId: reservation.table_id,
      duration: calculateDuration(reservation.start_time, reservation.end_time),
      notes: reservation.notes || "",
    });
    setFormErrors({});
    setIsEditOpen(true);
  };

  const calculateDuration = (start: string, end: string) => {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return Math.round((endMs - startMs) / (1000 * 60));
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.phone.trim()) errors.phone = "Phone is required";
    if (formData.partySize < 1) errors.partySize = "Party size must be at least 1";
    if (!formData.tableId) errors.tableId = "Table is required";
    
    // Check for conflicts
    if (selectedSlot) {
      const durationSlots = Math.ceil(formData.duration / 15);
      const { available, conflictingReservation } = getTableAvailability(
        formData.tableId, 
        selectedSlot.slotIndex, 
        durationSlots,
        selectedReservation?.id
      );
      if (!available) {
        errors.conflict = `Conflicts with ${conflictingReservation?.customer_name}'s reservation`;
      }
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreate = () => {
    if (!validateForm() || !selectedSlot || !restaurantId) return;
    
    const startTime = slotIndexToTime(selectedSlot.slotIndex);
    const startDateTime = `${selectedDate}T${startTime}:00`;
    const endTotalMinutes = (8 * 60 + selectedSlot.slotIndex * 15) + formData.duration;
    const endHours = Math.floor(endTotalMinutes / 60);
    const endMins = endTotalMinutes % 60;
    const endDateTime = `${selectedDate}T${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}:00`;

    createMutation.mutate({
      restaurant_id: restaurantId,
      table_id: formData.tableId,
      customer_name: formData.name,
      customer_phone: formData.phone,
      party_size: formData.partySize,
      start_time: startDateTime,
      end_time: endDateTime,
      status: "booked",
      notes: formData.notes || undefined,
    });
  };

  const handleUpdate = () => {
    if (!validateForm() || !selectedReservation || !selectedReservation.id) return;
    
    updateMutation.mutate({
      id: selectedReservation.id,
      data: {
        customer_name: formData.name,
        customer_phone: formData.phone,
        party_size: formData.partySize,
        table_id: formData.tableId,
        notes: formData.notes || undefined,
      },
    });
  };

  const handleStatusChange = (status: Reservation["status"]) => {
    if (!selectedReservation || !selectedReservation.id) return;
    
    updateMutation.mutate({
      id: selectedReservation.id,
      data: { status },
    });
    
    // Update local state optimistically
    setSelectedReservation({ ...selectedReservation, status });
  };

  const handleDelete = () => {
    if (selectedReservation && selectedReservation.id) {
      deleteMutation.mutate(selectedReservation.id);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, reservation: Reservation) => {
    setDraggedReservation(reservation);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedReservation(null);
    setDragOverSlot(null);
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent, tableId: string, slotIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedReservation) return;
    
    const durationSlots = timeToSlotIndex(draggedReservation.end_time) - timeToSlotIndex(draggedReservation.start_time);
    const { available } = getTableAvailability(tableId, slotIndex, durationSlots, draggedReservation.id);
    
    if (available) {
      setDragOverSlot({ tableId, slotIndex });
    }
  };

  const handleDrop = (e: React.DragEvent, tableId: string, slotIndex: number) => {
    e.preventDefault();
    if (!draggedReservation || !draggedReservation.id) return;
    
    // Check if dropping to past time on same day
    const today = getTodayString();
    if (selectedDate === today) {
      const slotTime = slotIndexToTime(slotIndex);
      const [slotHour, slotMinute] = slotTime.split(':').map(Number);
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      if (slotHour < currentHour || (slotHour === currentHour && slotMinute < currentMinute)) {
        toast.error("Cannot move reservations to past times");
        setDraggedReservation(null);
        setDragOverSlot(null);
        setIsDragging(false);
        return;
      }
    }
    
    const durationSlots = timeToSlotIndex(draggedReservation.end_time) - timeToSlotIndex(draggedReservation.start_time);
    const { available } = getTableAvailability(tableId, slotIndex, durationSlots, draggedReservation.id);
    
    if (!available) {
      toast.error("Cannot move here - time conflict");
      setDraggedReservation(null);
      setDragOverSlot(null);
      setIsDragging(false);
      return;
    }
    
    const newStartTime = slotIndexToTime(slotIndex);
    const newEndSlot = slotIndex + durationSlots;
    const newEndTime = slotIndexToTime(newEndSlot);
    
    updateTimeMutation.mutate({
      id: draggedReservation.id,
      start_time: `${selectedDate}T${newStartTime}:00`,
      end_time: `${selectedDate}T${newEndTime}:00`,
      table_id: tableId,
    });
  };

  // Get suitable tables for party size
  const getSuitableTables = (partySize: number) => {
    return tables.filter((t: Table) => t.capacity >= partySize).sort((a: Table, b: Table) => a.capacity - b.capacity);
  };

  // Get best table suggestion
  const getBestTable = (partySize: number, preferredTableId?: string) => {
    const suitable = getSuitableTables(partySize);
    if (preferredTableId && suitable.find((t: Table) => t.id === preferredTableId)) {
      return preferredTableId;
    }
    return suitable[0]?.id || "";
  };

  // Auto-suggest table when party size changes
  useEffect(() => {
    if (isCreateOpen && !formData.tableId) {
      const bestTable = getBestTable(formData.partySize);
      setFormData(prev => ({ ...prev, tableId: bestTable }));
    }
  }, [formData.partySize, isCreateOpen]);

  const totalWidth = timeSlots.length * SLOT_WIDTH;
  const totalHeight = tables.length * TABLE_ROW_HEIGHT;

  // Navigate dates
  const navigateDate = (days: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + days);
    const newDate = current.toISOString().split("T")[0];
    setSelectedDate(newDate);
    onDateChange?.(newDate);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-background border rounded-lg overflow-hidden">
      {/* Header with date navigation */}
      <div className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigateDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="text-lg font-semibold">
              {new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <div className="text-sm text-muted-foreground">
              {reservations.filter(r => r.status !== 'cancelled' && r.status !== 'no_show').length} reservations
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={() => navigateDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" onClick={() => navigateDate(0)}>
          Today
        </Button>
      </div>

      {/* Timeline grid */}
      <div className="relative flex-1 overflow-hidden">
        {/* Top Left Corner */}
        <div className="absolute top-0 left-0 z-30 bg-card border-r border-b flex items-center justify-center font-semibold" 
          style={{ width: TABLE_COLUMN_WIDTH, height: HEADER_HEIGHT }}>
          Tables
        </div>

        {/* Time Header */}
        <div className="absolute top-0 left-0 z-20 bg-card border-b overflow-hidden" 
          style={{ marginLeft: TABLE_COLUMN_WIDTH, width: `calc(100% - ${TABLE_COLUMN_WIDTH}px)`, height: HEADER_HEIGHT }}>
          <div className="flex" style={{ width: totalWidth, transform: `translateX(-${scrollPosition.x}px)` }}>
            {timeSlots.map((slot, index) => (
              <div key={slot.key} 
                className="flex-shrink-0 border-r border-border flex items-center justify-center text-xs font-medium"
                style={{ width: SLOT_WIDTH, height: HEADER_HEIGHT, backgroundColor: index % 4 === 0 ? "hsl(var(--muted))" : "transparent" }}>
                {index % 4 === 0 ? slot.time : ""}
              </div>
            ))}
          </div>
        </div>

        {/* Table Column */}
        <div className="absolute top-0 left-0 z-20 bg-card border-r overflow-hidden" 
          style={{ marginTop: HEADER_HEIGHT, width: TABLE_COLUMN_WIDTH, height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
          <div style={{ height: totalHeight, transform: `translateY(-${scrollPosition.y}px)` }}>
            {tables.map((table) => (
              <div key={table.id} className="border-b border-border flex items-center px-3" style={{ height: TABLE_ROW_HEIGHT }}>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">{table.name}</div>
                    <div className="text-xs text-muted-foreground">{table.capacity} seats</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div ref={gridRef} className="absolute overflow-auto" 
          style={{ top: HEADER_HEIGHT, left: TABLE_COLUMN_WIDTH, width: `calc(100% - ${TABLE_COLUMN_WIDTH}px)`, height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
          <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {timeSlots.map((slot, index) => (
                <div key={`vline-${slot.key}`} 
                  className="absolute top-0 bottom-0 border-l"
                  style={{ left: index * SLOT_WIDTH, borderColor: index % 4 === 0 ? "hsl(var(--border))" : "hsl(var(--muted))" }} />
              ))}
              {tables.map((_, index) => (
                <div key={`hline-${index}`} className="absolute left-0 right-0 border-t border-border" 
                  style={{ top: (index + 1) * TABLE_ROW_HEIGHT }} />
              ))}
            </div>

            {/* Current Time Line */}
            <div className="absolute top-0 bottom-0 border-l-2 border-red-500 z-10 pointer-events-none" 
              style={{ left: calculatePosition(currentTime) }}>
              <div className="absolute -top-1 -translate-x-1/2 bg-red-500 text-white text-xs px-1 rounded">Now</div>
            </div>

            {/* Reservations and Slots */}
            {tables.map((table, tableIndex) => {
              const tableReservations = (reservationsByTable[table.id] || [])
                .filter(r => r.status !== 'cancelled' && r.status !== 'no_show');
              
              return (
                <div key={table.id} className="absolute left-0 right-0" 
                  style={{ top: tableIndex * TABLE_ROW_HEIGHT, height: TABLE_ROW_HEIGHT }}>
                  {/* Clickable slots */}
                  {timeSlots.map((_, slotIndex) => {
                    const isDropTarget = dragOverSlot?.tableId === table.id && dragOverSlot?.slotIndex === slotIndex;
                    const hasConflictHere = draggedReservation && !getTableAvailability(
                      table.id, slotIndex, 
                      timeToSlotIndex(draggedReservation.end_time) - timeToSlotIndex(draggedReservation.start_time),
                      draggedReservation.id
                    ).available;
                    
                    return (
                      <div key={`slot-${table.id}-${slotIndex}`}
                        className={`absolute top-0 bottom-0 transition-colors ${
                          isDragging 
                            ? isDropTarget ? 'bg-green-200' : hasConflictHere ? 'bg-red-100' : 'bg-green-50'
                            : 'hover:bg-accent/10 cursor-pointer'
                        }`}
                        style={{ left: slotIndex * SLOT_WIDTH, width: SLOT_WIDTH }}
                        onClick={() => !isDragging && openCreateDialog(table.id, slotIndex)}
                        onDragOver={(e) => handleDragOver(e, table.id, slotIndex)}
                        onDrop={(e) => handleDrop(e, table.id, slotIndex)}
                      />
                    );
                  })}
                  
                  {/* Reservations */}
                  {tableReservations.map((reservation) => {
                    const isThisDragging = draggedReservation?.id === reservation.id;
                    return (
                      <div
                        key={reservation.id}
                        draggable
                        className={`absolute top-2 bottom-2 rounded-md shadow-md cursor-move transition-all hover:shadow-lg hover:scale-[1.02] z-10 border-2 border-white/20 ${getStatusColor(reservation.status)} ${isThisDragging ? 'opacity-50 pointer-events-none' : ''}`}
                        style={{ 
                          left: calculatePosition(reservation.start_time), 
                          width: Math.max(calculateWidth(reservation.start_time, reservation.end_time) - 4, SLOT_WIDTH - 4)
                        }}
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          openEditDialog(reservation);
                        }}
                        onDragStart={(e) => handleDragStart(e, reservation)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="h-full flex flex-col justify-center px-2 text-white overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-xs">{getStatusIcon(reservation.status)}</span>
                            <span className="font-semibold text-sm truncate">{reservation.customer_name}</span>
                          </div>
                          <div className="text-xs opacity-90 flex items-center gap-2">
                            <span>{reservation.party_size} guests</span>
                            <span>•</span>
                            <span>{formatTime12h(reservation.end_time)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create Reservation Dialog - Using Shared Component */}
      <ReservationModal
        isOpen={isCreateOpen}
        onClose={closeCreateDialog}
        mode="create"
        restaurantId={restaurantId}
        tables={tables}
        selectedDate={selectedDate}
        selectedSlot={selectedSlot}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
        }}
      />

      {/* Edit Reservation Dialog - Using Shared Component */}
      <ReservationModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        mode="edit"
        reservation={selectedReservation}
        restaurantId={restaurantId}
        tables={tables}
        selectedDate={selectedDate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently cancel the reservation for {selectedReservation?.customer_name}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Reservation</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Cancel Reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
