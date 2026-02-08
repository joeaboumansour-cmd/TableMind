"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Users, Star, Calendar, Clock, Edit, Trash2, CheckCircle, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const supabase = createClient();

interface Table {
  id: string;
  name: string;
  capacity: number;
}

interface Reservation {
  id: string;
  table_id: string;
  customer_name: string;
  party_size: number;
  start_time: string;
  end_time: string;
  status: "booked" | "confirmed" | "seated" | "finished" | "cancelled" | "no_show";
  notes?: string;
  customer_phone?: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  total_visits: number;
  last_visit?: string;
}

// Mock data for fallback
const mockTables: Table[] = [
  { id: "1", name: "Table 1", capacity: 2 },
  { id: "2", name: "Table 2", capacity: 4 },
  { id: "3", name: "Table 3", capacity: 4 },
  { id: "4", name: "Table 4", capacity: 6 },
  { id: "5", name: "Table 5", capacity: 8 },
  { id: "6", name: "Table 6", capacity: 2 },
  { id: "7", name: "Table 7", capacity: 4 },
  { id: "8", name: "Table 8", capacity: 6 },
];

const mockReservations: Reservation[] = [
  { id: "r1", table_id: "1", customer_name: "John Smith", party_size: 2, start_time: "2024-01-15T19:00:00", end_time: "2024-01-15T20:30:00", status: "seated" },
  { id: "r2", table_id: "2", customer_name: "Sarah Johnson", party_size: 4, start_time: "2024-01-15T19:30:00", end_time: "2024-01-15T21:00:00", status: "booked" },
  { id: "r3", table_id: "2", customer_name: "Mike Brown", party_size: 3, start_time: "2024-01-15T17:00:00", end_time: "2024-01-15T18:30:00", status: "finished" },
  { id: "r4", table_id: "4", customer_name: "Emily Davis", party_size: 6, start_time: "2024-01-15T20:00:00", end_time: "2024-01-15T22:00:00", status: "booked" },
  { id: "r5", table_id: "5", customer_name: "Robert Wilson", party_size: 8, start_time: "2024-01-15T18:00:00", end_time: "2024-01-15T20:00:00", status: "confirmed" },
  { id: "r6", table_id: "3", customer_name: "Lisa Chen", party_size: 2, start_time: "2024-01-15T19:00:00", end_time: "2024-01-15T20:00:00", status: "seated" },
  { id: "r7", table_id: "6", customer_name: "David Lee", party_size: 2, start_time: "2024-01-15T21:00:00", end_time: "2024-01-15T22:30:00", status: "booked" },
];

const mockCustomers: Customer[] = [
  { id: "c1", name: "John Smith", phone: "555-0101", tags: ["VIP", "Regular"], total_visits: 15, last_visit: "2024-01-10" },
  { id: "c2", name: "Sarah Johnson", phone: "555-0102", tags: ["Regular"], total_visits: 8, last_visit: "2024-01-08" },
  { id: "c3", name: "Mike Brown", phone: "555-0103", tags: ["Family"], total_visits: 3, last_visit: "2024-01-05" },
  { id: "c4", name: "Emily Davis", phone: "555-0104", tags: ["Date Night"], total_visits: 12, last_visit: "2024-01-12" },
];

// Generate time slots from 12:00 PM to 12:00 AM (15-minute increments)
const generateTimeSlots = () => {
  const slots = [];
  for (let hour = 12; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour > 12 ? hour - 12 : hour;
      const time = `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
      slots.push({ time, hour, minute, key: `${hour}:${minute}` });
    }
  }
  slots.push({ time: "12:00 AM", hour: 0, minute: 0, key: "0:0" });
  return slots;
};

const timeSlots = generateTimeSlots();
const SLOT_WIDTH = 80;
const TABLE_ROW_HEIGHT = 80;
const HEADER_HEIGHT = 60;
const TABLE_COLUMN_WIDTH = 140;

  // Get today's date in local time (uses computer's timezone)
  const getTodayString = () => {
    if (typeof window === "undefined") return "";
    const now = new Date();
    return now.getFullYear() + "-" + 
      String(now.getMonth() + 1).padStart(2, "0") + "-" + 
      String(now.getDate()).padStart(2, "0");
  };

// Get current time as ISO string in local time
const getCurrentTimeISO = () => {
  const now = new Date();
  return now.getFullYear() + "-" + 
    String(now.getMonth() + 1).padStart(2, "0") + "-" + 
    String(now.getDate()).padStart(2, "0") + "T" + 
    String(now.getHours()).padStart(2, "0") + ":" + 
    String(now.getMinutes()).padStart(2, "0") + ":" + 
    String(now.getSeconds()).padStart(2, "0");
};

// Format date for display
const formatDateDisplay = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

interface TimelineViewProps {
  selectedDate?: string;
}

export default function TimelineView({ selectedDate: propSelectedDate }: TimelineViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ tableId: string; slotIndex: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [duration, setDuration] = useState(90);
  const [notes, setNotes] = useState("");
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  
  // Edit reservation state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  
  // Drag and drop state
  const [draggedReservation, setDraggedReservation] = useState<Reservation | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{tableId: string, slotIndex: number} | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  // Update reservation time mutation
  const updateTimeMutation = useMutation({
    mutationFn: async ({ id, start_time, end_time, table_id }: { id: string; start_time: string; end_time: string; table_id: string }) => {
      const { data, error } = await supabase
        .from("reservations")
        .update({ start_time, end_time, table_id, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      setDraggedReservation(null);
      setDragOverSlot(null);
      setDropError(null);
    },
  });

  // Check if a time slot conflicts with existing reservations
  const hasConflict = (reservation: Reservation, newTableId: string, newStartSlot: number, durationSlots: number) => {
    const newEndSlot = newStartSlot + durationSlots;
    const tableReservations = reservationsByTable[newTableId] || [];
    
    return tableReservations.some((res: Reservation) => {
      if (res.id === reservation.id) return false; // Don't conflict with itself
      
      const resStart = timeToSlotIndex(res.start_time);
      const resEnd = timeToSlotIndex(res.end_time);
      
      // Check overlap: (StartA < EndB) and (EndA > StartB)
      return (newStartSlot < resEnd && newEndSlot > resStart);
    });
  };

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").limit(1).single();
      if (error) {
        console.log("Using mock mode - no restaurant found");
        return null;
      }
      return data?.id || null;
    },
  });

  // Fetch tables
  const { data: tables = mockTables } = useQuery({
    queryKey: ["timeline-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return mockTables;
      const { data, error } = await supabase
        .from("tables")
        .select("id, name, capacity")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true });
      if (error) return mockTables;
      return data || mockTables;
    },
    enabled: true,
  });

  // Get selected date from parent or default to today
  const [selectedDate, setSelectedDate] = useState(() => propSelectedDate || getTodayString());
  
  // Sync with parent date prop
  useEffect(() => {
    if (propSelectedDate && propSelectedDate !== selectedDate) {
      setSelectedDate(propSelectedDate);
    }
  }, [propSelectedDate]);
  
  // Fetch reservations for selected date
  const { data: reservations = mockReservations, isLoading: isLoadingReservations } = useQuery({
    queryKey: ["timeline-reservations", restaurantId, selectedDate],
    queryFn: async () => {
      if (!restaurantId) {
        console.log("Using mock reservations - no restaurant ID");
        return mockReservations;
      }
      console.log("Fetching reservations for date:", selectedDate, "restaurant:", restaurantId);
      const { data, error } = await supabase
        .from("reservations")
        .select("id, table_id, customer_name, party_size, start_time, end_time, status")
        .eq("restaurant_id", restaurantId)
        .gte("start_time", `${selectedDate}T00:00:00`)
        .lte("start_time", `${selectedDate}T23:59:59`)
        .order("start_time", { ascending: true });
      if (error) {
        console.error("Error fetching reservations:", error);
        return mockReservations;
      }
      console.log("Fetched reservations:", data?.length || 0);
      return data?.length ? data : mockReservations;
    },
    enabled: !!restaurantId,
  });

  // Create reservation mutation
  const createMutation = useMutation({
    mutationFn: async (reservation: Omit<Reservation, "id"> & { customer_id?: string }) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("reservations")
        .insert({ ...reservation, restaurant_id: restaurantId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      setIsDialogOpen(false);
      resetForm();
    },
  });

  // Update reservation status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase
        .from("reservations")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  // Record visit mutation (for seated/finished/no-show)
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
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  // Delete/Cancel reservation mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reservations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
      setIsEditDialogOpen(false);
      setSelectedReservation(null);
    },
  });

  // Lookup customer
  const lookupCustomer = async (phone: string) => {
    if (!restaurantId || phone.length < 7) return null;
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, tags, total_visits, last_visit")
      .eq("restaurant_id", restaurantId)
      .eq("phone", phone)
      .single();
    if (error) return mockCustomers.find((c) => c.phone === phone) || null;
    return data;
  };

  // Create customer
  const createCustomer = async (customer: Omit<Customer, "id">) => {
    if (!restaurantId) throw new Error("No restaurant");
    const { data, error } = await supabase
      .from("customers")
      .insert({ ...customer, restaurant_id: restaurantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const reservationsByTable = useMemo(() => {
    const grouped: Record<string, Reservation[]> = {};
    reservations.forEach((res: Reservation) => {
      if (!grouped[res.table_id]) grouped[res.table_id] = [];
      grouped[res.table_id].push(res);
    });
    return grouped;
  }, [reservations]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const handleScroll = () => setScrollPosition({ x: grid.scrollLeft, y: grid.scrollTop });
    grid.addEventListener("scroll", handleScroll);
    return () => grid.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isDialogOpen && phoneInputRef.current) {
      setTimeout(() => phoneInputRef.current?.focus(), 100);
    }
  }, [isDialogOpen]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (phone.length >= 7) {
        setIsLookingUp(true);
        const customer = await lookupCustomer(phone);
        setFoundCustomer(customer);
        if (customer) setName(customer.name);
        setIsLookingUp(false);
      } else {
        setFoundCustomer(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [phone, restaurantId]);

  const resetForm = () => {
    setPhone("");
    setName("");
    setPartySize(2);
    setDuration(90);
    setNotes("");
    setSelectedSlot(null);
    setFoundCustomer(null);
  };

  const handleSlotClick = (tableId: string, slotIndex: number) => {
    // Check if date is in the past
    const today = getTodayString();
    if (selectedDate < today) {
      alert("Cannot create reservations for past dates");
      return;
    }
    setSelectedSlot({ tableId, slotIndex });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedSlot || !name || !phone || !restaurantId) return;
    
    // Calculate times correctly
    // Slot 0 = 12:00 PM (noon), each slot = 15 minutes
    const startTotalMinutes = 12 * 60 + selectedSlot.slotIndex * 15;
    const startHours = Math.floor(startTotalMinutes / 60);
    const startMins = startTotalMinutes % 60;
    const startTime = `${startHours.toString().padStart(2, "0")}:${startMins.toString().padStart(2, "0")}`;
    const startDateTime = `${selectedDate}T${startTime}:00`;
    
    // End time = start + duration
    const endTotalMinutes = startTotalMinutes + duration;
    const endHours = Math.floor(endTotalMinutes / 60);
    const endMins = endTotalMinutes % 60;
    const endDateTime = `${selectedDate}T${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}:00`;

    console.log("Creating reservation:", {
      slotIndex: selectedSlot.slotIndex,
      startTime,
      duration,
      startDateTime,
      endDateTime
    });

    let customerId = foundCustomer?.id;

    // Only create customer if phone doesn't exist
    if (!foundCustomer) {
      try {
        const newCustomer = await createCustomer({ name, phone, tags: [], total_visits: 0 });
        customerId = newCustomer.id;
      } catch (e: any) {
        // If customer already exists (duplicate phone), lookup the customer
        if (e?.code === '23505' || e?.message?.includes('duplicate')) {
          console.log("Customer already exists, looking up customer ID");
          const existingCustomer = await lookupCustomer(phone);
          customerId = existingCustomer?.id;
        } else {
          console.error("Failed to create customer", e);
        }
      }
    }

    createMutation.mutate({
      table_id: selectedSlot.tableId,
      customer_name: name,
      customer_id: customerId,
      party_size: partySize,
      start_time: startDateTime,
      end_time: endDateTime,
      status: "booked",
      notes: notes || undefined,
      customer_phone: phone,
    });
  };

  const getSelectedTableName = () => {
    if (!selectedSlot) return "";
    const table = tables.find((t: Table) => t.id === selectedSlot.tableId);
    return table?.name || "";
  };

  const slotIndexToTime = (slotIndex: number) => {
    const totalMinutes = 12 * 60 + slotIndex * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  const timeToSlotIndex = (timeString: string) => {
    // Parse ISO string manually to avoid timezone issues
    // Format: "2024-01-15T13:00:00" or "2024-01-15T13:00:00.000Z"
    const match = timeString.match(/T(\d{2}):(\d{2})/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    // Calculate slot index from noon (12:00 = slot 0)
    const slotsFromNoon = (hours - 12) * 4 + Math.floor(minutes / 15);
    return Math.max(0, slotsFromNoon);
  };

  const calculatePosition = (startTime: string) => {
    // Parse ISO string manually to avoid timezone issues
    const match = startTime.match(/T(\d{2}):(\d{2})/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const slotsFromNoon = (hours - 12) * 4 + Math.floor(minutes / 15);
    return Math.max(0, slotsFromNoon * SLOT_WIDTH);
  };

  const calculateWidth = (startTime: string, endTime: string) => {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const durationMinutes = (end - start) / (1000 * 60);
    return Math.max(SLOT_WIDTH, (durationMinutes / 15) * SLOT_WIDTH);
  };

  const getStatusColor = (status: Reservation["status"]) => {
    switch (status) {
      case "booked": return "bg-blue-500 hover:bg-blue-600";
      case "confirmed": return "bg-blue-600 hover:bg-blue-700";
      case "seated": return "bg-green-500 hover:bg-green-600";
      case "finished": return "bg-gray-500 hover:bg-gray-600";
      case "cancelled": return "bg-red-500 hover:bg-red-600";
      case "no_show": return "bg-amber-500 hover:bg-amber-600";
      default: return "bg-blue-500 hover:bg-blue-600";
    }
  };

  const formatLastVisit = (dateString?: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const today = new Date();
    const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const totalWidth = timeSlots.length * SLOT_WIDTH;
  const totalHeight = tables.length * TABLE_ROW_HEIGHT;

  // State for current time (refreshes every minute)
  const [currentTime, setCurrentTime] = useState(getCurrentTimeISO());

  useEffect(() => {
    // Update current time every minute
    const interval = setInterval(() => {
      setCurrentTime(getCurrentTimeISO());
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="relative h-[calc(100vh-140px)] bg-background overflow-hidden border-2 rounded-lg">
        {/* Top Left Corner */}
        <div className="absolute top-0 left-0 z-30 bg-card border-r-2 border-b-2 flex items-center justify-center font-bold text-lg" style={{ width: TABLE_COLUMN_WIDTH, height: HEADER_HEIGHT }}>
          Tables
        </div>

        {/* Time Header */}
        <div className="absolute top-0 left-0 z-20 bg-card border-b-2 overflow-hidden" style={{ marginLeft: TABLE_COLUMN_WIDTH, width: `calc(100% - ${TABLE_COLUMN_WIDTH}px)`, height: HEADER_HEIGHT }}>
          <div className="flex" style={{ width: totalWidth, transform: `translateX(-${scrollPosition.x}px)` }}>
            {timeSlots.map((slot, index) => (
              <div key={slot.key} className="flex-shrink-0 border-r border-border flex items-center justify-center text-sm font-medium" style={{ width: SLOT_WIDTH, height: HEADER_HEIGHT, backgroundColor: index % 4 === 0 ? "hsl(var(--muted))" : "transparent" }}>
                {index % 4 === 0 ? slot.time : ""}
              </div>
            ))}
          </div>
        </div>

        {/* Table Column */}
        <div className="absolute top-0 left-0 z-20 bg-card border-r-2 overflow-hidden" style={{ marginTop: HEADER_HEIGHT, width: TABLE_COLUMN_WIDTH, height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
          <div style={{ height: totalHeight, transform: `translateY(-${scrollPosition.y}px)` }}>
            {tables.map((table: Table) => (
              <div key={table.id} className="border-b border-border flex items-center px-4" style={{ height: TABLE_ROW_HEIGHT }}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-bold text-base">{table.name}</div>
                    <div className="text-sm text-muted-foreground">{table.capacity} seats</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div ref={gridRef} className="absolute overflow-auto" style={{ top: HEADER_HEIGHT, left: TABLE_COLUMN_WIDTH, width: `calc(100% - ${TABLE_COLUMN_WIDTH}px)`, height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
          <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {timeSlots.map((slot, index) => (
                <div key={`vline-${slot.key}`} className="absolute top-0 bottom-0 border-l" style={{ left: index * SLOT_WIDTH, borderColor: index % 4 === 0 ? "hsl(var(--border))" : "hsl(var(--muted))", borderWidth: index % 4 === 0 ? "2px" : "1px" }} />
              ))}
              {tables.map((_: Table, index: number) => (
                <div key={`hline-${index}`} className="absolute left-0 right-0 border-t border-border" style={{ top: (index + 1) * TABLE_ROW_HEIGHT }} />
              ))}
              {timeSlots.map((_, index) => index % 4 === 0 ? (
                <div key={`highlight-${index}`} className="absolute top-0 bottom-0 bg-muted/30 pointer-events-none" style={{ left: index * SLOT_WIDTH, width: SLOT_WIDTH * 4 }} />
              ) : null)}
            </div>

            {/* Current Time */}
            <div className="absolute top-0 bottom-0 border-l-2 border-primary z-10 pointer-events-none" style={{ left: calculatePosition(currentTime) }}>
              <div className="absolute -top-1 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded">Now</div>
            </div>

              {/* Reservations */}
              {tables.map((table: Table, tableIndex: number) => {
              // Only show active reservations (not cancelled or no_show)
              const activeTableReservations = (reservationsByTable[table.id] || []).filter(
                (res) => res.status !== 'cancelled' && res.status !== 'no_show'
              );
              const tableReservations = activeTableReservations;
              
              // Get reserved slot indices for this table
              const reservedSlots = new Set<number>();
              tableReservations.forEach(res => {
                const startIdx = timeToSlotIndex(res.start_time);
                const endIdx = timeToSlotIndex(res.end_time);
                for (let i = startIdx; i < endIdx; i++) {
                  reservedSlots.add(i);
                }
              });
              
              return (
                <div key={table.id} className="absolute left-0 right-0" style={{ top: tableIndex * TABLE_ROW_HEIGHT, height: TABLE_ROW_HEIGHT }}>
                  {/* Empty slots first (behind) */}
                  {timeSlots.map((slot, slotIndex) => {
                    const isDropTarget = dragOverSlot?.tableId === table.id && dragOverSlot?.slotIndex === slotIndex;
                    const canDrop = draggedReservation && !hasConflict(
                      draggedReservation, 
                      table.id, 
                      slotIndex, 
                      timeToSlotIndex(draggedReservation.end_time) - timeToSlotIndex(draggedReservation.start_time)
                    );
                    
                    return (
                      <div 
                        key={`slot-${table.id}-${slotIndex}`} 
                        className={`absolute top-0 bottom-0 transition-colors ${
                          reservedSlots.has(slotIndex) 
                            ? '' 
                            : draggedReservation 
                              ? canDrop 
                                ? isDropTarget 
                                  ? 'bg-green-200 cursor-copy' 
                                  : 'bg-green-100 cursor-copy'
                                : 'bg-red-100 cursor-not-allowed'
                              : 'hover:bg-accent/20 cursor-pointer'
                        }`} 
                        style={{ left: slotIndex * SLOT_WIDTH, width: SLOT_WIDTH }}
                        onClick={() => !reservedSlots.has(slotIndex) && !draggedReservation && handleSlotClick(table.id, slotIndex)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (draggedReservation && canDrop) {
                            setDragOverSlot({ tableId: table.id, slotIndex });
                          }
                        }}
                        onDragLeave={() => setDragOverSlot(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!draggedReservation || !canDrop) {
                            setDropError('Cannot drop here - time conflict');
                            return;
                          }
                          
                          // Calculate new times
                          const durationSlots = timeToSlotIndex(draggedReservation.end_time) - timeToSlotIndex(draggedReservation.start_time);
                          const newStartTime = slotIndexToTime(slotIndex);
                          const newEndSlot = slotIndex + durationSlots;
                          const newEndTime = slotIndexToTime(newEndSlot);
                          
                          const newStartDateTime = `${selectedDate}T${newStartTime}:00`;
                          const newEndDateTime = `${selectedDate}T${newEndTime}:00`;
                          
                          // Update the reservation
                          updateTimeMutation.mutate({
                            id: draggedReservation.id,
                            start_time: newStartDateTime,
                            end_time: newEndDateTime,
                            table_id: table.id,
                          });
                        }}
                      />
                    );
                  })}
                  {/* Reservations on top */}
              {tableReservations.map((reservation) => {
                    const isDragging = draggedReservation?.id === reservation.id;
                    return (
                      <div 
                        key={reservation.id} 
                        draggable
                        className={`absolute top-2 bottom-2 rounded-lg shadow-md cursor-move transition-all hover:shadow-lg hover:scale-[1.02] z-10 ${getStatusColor(reservation.status)} ${isDragging ? 'opacity-50' : ''}`} 
                        style={{ left: calculatePosition(reservation.start_time), width: calculateWidth(reservation.start_time, reservation.end_time) - 4, minWidth: SLOT_WIDTH - 4 }} 
                        onClick={(e) => { 
                          e.preventDefault();
                          e.stopPropagation(); 
                          setSelectedReservation(reservation); 
                          setIsEditDialogOpen(true); 
                        }}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDraggedReservation(reservation);
                          setDropError(null);
                        }}
                        onDragEnd={() => {
                          setDraggedReservation(null);
                          setDragOverSlot(null);
                        }}
                      >
                        <div className="h-full flex flex-col justify-center px-2 text-white overflow-hidden select-none">
                          <div className="font-bold text-sm truncate leading-tight">{reservation.customer_name}</div>
                          <div className="text-xs opacity-90 truncate">{reservation.party_size} guests</div>
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

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">New Reservation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-4 text-sm bg-muted p-3 rounded-lg">
              <div><span className="text-muted-foreground">Table:</span> <span className="font-bold">{getSelectedTableName()}</span></div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-base">Phone Number <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input ref={phoneInputRef} id="phone" type="tel" placeholder="555-0101" value={phone} onChange={(e) => setPhone(e.target.value)} className="text-lg py-6" />
                {isLookingUp && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" /></div>}
              </div>
            </div>

            {foundCustomer && (
              <Card className="border-2 border-primary/20 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2"><Star className="h-5 w-5 text-primary" /><span className="font-bold text-lg">Customer Insights</span></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><div><div className="text-xs text-muted-foreground">Total Visits</div><div className="font-bold text-lg">{foundCustomer.total_visits}</div></div></div>
                    <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><div><div className="text-xs text-muted-foreground">Last Visit</div><div className="font-bold">{formatLastVisit(foundCustomer.last_visit)}</div></div></div>
                  </div>
                  {foundCustomer.tags.length > 0 && <div className="flex flex-wrap gap-2">{foundCustomer.tags.map((tag) => <Badge key={tag} variant={tag === "VIP" ? "default" : "secondary"} className="text-sm">{tag}</Badge>)}</div>}
                </CardContent>
              </Card>
            )}

            {!foundCustomer && phone.length >= 7 && !isLookingUp && <div className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded-lg">New customer - will be created automatically</div>}

            <div className="space-y-2">
              <Label htmlFor="name" className="text-base">Customer Name <span className="text-destructive">*</span></Label>
              <Input id="name" placeholder="John Smith" value={name} onChange={(e) => setName(e.target.value)} className="text-lg py-6" />
            </div>

            <div className="space-y-2">
              <Label className="text-base">Party Size</Label>
              <div className="flex gap-2">{[2, 4, 6, 8].map((size) => <Button key={size} type="button" variant={partySize === size ? "default" : "outline"} className="flex-1 text-lg py-6" onClick={() => setPartySize(size)}>{size}</Button>)}</div>
            </div>

            <div className="space-y-2">
              <Label className="text-base">Duration</Label>
              <div className="flex gap-2">{[60, 90, 120, 150].map((mins) => <Button key={mins} type="button" variant={duration === mins ? "default" : "outline"} className="flex-1 text-base py-5" onClick={() => setDuration(mins)}>{mins}m</Button>)}</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-base">Notes</Label>
              <textarea
                id="notes"
                placeholder="Add any special requests or notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-base resize-none"
              />
            </div>

            <Button onClick={handleSave} disabled={!phone || !name || createMutation.isPending || !restaurantId} className="w-full text-lg py-6 font-bold">
              {createMutation.isPending ? "Creating..." : "Create Reservation"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Reservation Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Edit className="h-6 w-6" />
              Reservation Details
            </DialogTitle>
          </DialogHeader>
          {selectedReservation && (
            <div className="space-y-4 py-4">
              {/* Guest Info */}
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-bold">{selectedReservation.customer_name}</div>
                  <div className="text-muted-foreground">{selectedReservation.party_size} guests</div>
                </CardContent>
              </Card>

              {/* Time Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted p-3 rounded-lg">
                  <div className="text-sm text-muted-foreground">Start</div>
                  <div className="font-bold">{
                    (() => {
                      const match = selectedReservation.start_time.match(/T(\d{2}):(\d{2})/);
                      if (!match) return '--:--';
                      const hours = parseInt(match[1], 10);
                      const mins = match[2];
                      const displayHours = hours > 12 ? hours - 12 : hours;
                      const ampm = hours >= 12 ? 'PM' : 'AM';
                      return `${displayHours}:${mins} ${ampm}`;
                    })()
                  }</div>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <div className="text-sm text-muted-foreground">End</div>
                  <div className="font-bold">{
                    (() => {
                      const match = selectedReservation.end_time.match(/T(\d{2}):(\d{2})/);
                      if (!match) return '--:--';
                      const hours = parseInt(match[1], 10);
                      const mins = match[2];
                      const displayHours = hours > 12 ? hours - 12 : hours;
                      const ampm = hours >= 12 ? 'PM' : 'AM';
                      return `${displayHours}:${mins} ${ampm}`;
                    })()
                  }</div>
                </div>
              </div>

              {/* Notes Display/Edit */}
              <div className="space-y-2">
                <Label className="text-base">Notes</Label>
                <textarea
                  value={selectedReservation.notes || ""}
                  onChange={(e) => {
                    setSelectedReservation({...selectedReservation, notes: e.target.value});
                  }}
                  onBlur={() => {
                    // Save notes when user leaves the field
                    if (selectedReservation.notes !== undefined) {
                      supabase
                        .from("reservations")
                        .update({ notes: selectedReservation.notes })
                        .eq("id", selectedReservation.id)
                        .then(() => {
                          queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
                        });
                    }
                  }}
                  placeholder="Add notes about this reservation..."
                  className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-base resize-none"
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label className="text-base">Status</Label>
                <div className="flex gap-2 flex-wrap">
                  {["booked", "confirmed", "seated", "finished", "cancelled", "no_show"].map((status) => (
                    <Button
                      key={status}
                      type="button"
                      variant={selectedReservation.status === status ? "default" : "outline"}
                      size="sm"
                      className="flex-1 capitalize"
                      disabled={updateStatusMutation.isPending || recordVisitMutation.isPending}
                      onClick={() => {
                        const newStatus = status as Reservation["status"];
                        
                        // Optimistically update UI
                        setSelectedReservation({...selectedReservation, status: newStatus});
                        
                        // Update status in DB
                        updateStatusMutation.mutate({ id: selectedReservation.id, status });
                        
                        // Record visit actions to update customer stats
                        if (status === "seated") {
                          recordVisitMutation.mutate({ id: selectedReservation.id, action: "seat" });
                        } else if (status === "finished") {
                          recordVisitMutation.mutate({ id: selectedReservation.id, action: "finish" });
                        } else if (status === "no_show") {
                          recordVisitMutation.mutate({ id: selectedReservation.id, action: "no_show" });
                        } else if (status === "cancelled") {
                          recordVisitMutation.mutate({ id: selectedReservation.id, action: "cancel" });
                        }
                      }}
                    >
                      {updateStatusMutation.isPending && selectedReservation.status !== status ? "..." : status}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4">
                <Button 
                  className="w-full gap-2"
                  onClick={() => setIsEditDialogOpen(false)}
                >
                  <CheckCircle className="h-5 w-5" />
                  Done
                </Button>
                <Button 
                  variant="destructive" 
                  className="w-full gap-2"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (confirm("Are you sure you want to cancel this reservation?")) {
                      deleteMutation.mutate(selectedReservation.id);
                    }
                  }}
                >
                  <XCircle className="h-5 w-5" />
                  {deleteMutation.isPending ? "Cancelling..." : "Cancel Reservation"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
