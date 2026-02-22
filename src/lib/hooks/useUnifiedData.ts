"use client";

/**
 * UNIFIED DATA SYNCHRONIZATION SYSTEM
 * 
 * This module provides a single source of truth for all table and reservation data
 * across the entire application. Any change made from any view will automatically
 * reflect in ALL other views in real-time.
 * 
 * Usage:
 * - Floor Plan: useUnifiedData({ date: today })
 * - Timeline View: useUnifiedData({ date: selectedDate })
 * - Reservations List: useUnifiedData()
 * - Waiter View: useUnifiedData({ date: today, includeServiceStatus: true })
 */

import { useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import { useRestaurant } from "@/app/RestaurantContext";
import { useEffect, useMemo, useCallback } from "react";
import type { 
  Reservation, 
  Table, 
  ReservationStatus,
  TableStatusWithDetails,
  ServiceStatus 
} from "@/lib/types";
import { toast } from "sonner";

// =============================================
// SHARED QUERY KEYS - Single Source of Truth
// =============================================

export const QUERY_KEYS = {
  // Core data
  tables: (restaurantId: string | null) => ["unified", "tables", restaurantId] as const,
  reservations: (restaurantId: string | null, date?: string) => 
    ["unified", "reservations", restaurantId, date] as const,
  allReservations: (restaurantId: string | null) => 
    ["unified", "reservations", restaurantId, "all"] as const,
  
  // Derived/Computed data
  tableStatuses: (restaurantId: string | null) => 
    ["unified", "table-statuses", restaurantId] as const,
  
  // Legacy compatibility - map to unified keys
  floorPlanTables: (restaurantId: string | null) => ["unified", "tables", restaurantId] as const,
  floorPlanReservations: (restaurantId: string | null, date: string) => 
    ["unified", "reservations", restaurantId, date] as const,
  timelineTables: (restaurantId: string | null) => ["unified", "tables", restaurantId] as const,
  timelineReservations: (restaurantId: string | null, date: string) => 
    ["unified", "reservations", restaurantId, date] as const,
  listTables: (restaurantId: string | null) => ["unified", "tables", restaurantId] as const,
  listReservations: (restaurantId: string | null) => ["unified", "reservations", restaurantId, "all"] as const,
} as const;

// =============================================
// Types
// =============================================

export interface UnifiedTable extends Table {
  // Real-time computed fields
  current_status?: ServiceStatus;
  current_reservation_id?: string | null;
  current_customer_name?: string | null;
  current_party_size?: number | null;
  availability_status?: "available" | "occupied" | "finishing";
}

export interface UnifiedReservation extends Reservation {
  table_name?: string;
  room_name?: string;
  // Computed fields
  minutes_until?: number;
  urgency?: "overdue" | "arriving_soon" | "upcoming" | "later";
}

export interface TableWithReservation extends UnifiedTable {
  reservation?: UnifiedReservation;
}

export interface UnifiedDataOptions {
  /** Date to fetch reservations for (YYYY-MM-DD). If not provided, fetches all reservations. */
  date?: string;
  /** Include service status data for waiter view */
  includeServiceStatus?: boolean;
  /** Filter by specific table */
  tableId?: string;
  /** Filter by specific status */
  status?: ReservationStatus;
  /** Enable real-time synchronization (default: true) */
  enableRealtime?: boolean;
}

export interface UnifiedDataResult {
  // Data
  tables: UnifiedTable[];
  reservations: UnifiedReservation[];
  tableStatuses: TableStatusWithDetails[];
  
  // Derived data
  tablesWithReservations: TableWithReservation[];
  reservationsByTable: Map<string, UnifiedReservation[]>;
  activeReservations: UnifiedReservation[];
  occupiedTables: UnifiedTable[];
  availableTables: UnifiedTable[];
  
  // Loading states
  isLoading: boolean;
  isLoadingTables: boolean;
  isLoadingReservations: boolean;
  isLoadingStatuses: boolean;
  
  // Errors
  error: Error | null;
  
  // Refetch functions
  refetch: () => Promise<void>;
  refetchTables: () => Promise<void>;
  refetchReservations: () => Promise<void>;
  
  // Mutations
  createReservation: ReturnType<typeof useCreateReservation>;
  updateReservation: ReturnType<typeof useUpdateReservation>;
  deleteReservation: ReturnType<typeof useDeleteReservation>;
  updateTableStatus: ReturnType<typeof useUpdateTableStatus>;
  seatReservation: ReturnType<typeof useSeatReservation>;
}

// =============================================
// Core Data Fetching
// =============================================

/**
 * Fetch all tables for a restaurant
 */
async function fetchTables(restaurantId: string): Promise<UnifiedTable[]> {
  const supabase = createClientWithAuth();
  const { data, error } = await supabase
    .from("tables")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  
  if (error) throw error;
  return data || [];
}

/**
 * Fetch reservations with optional filtering
 */
async function fetchReservations(
  restaurantId: string, 
  options: { date?: string; tableId?: string; status?: ReservationStatus; activeOnly?: boolean } = {}
): Promise<UnifiedReservation[]> {
  const supabase = createClientWithAuth();
  
  let query = supabase
    .from("reservations")
    .select(`
      *,
      tables:table_id (name, room_name)
    `)
    .eq("restaurant_id", restaurantId);
  
  if (options.date) {
    query = query
      .gte("start_time", `${options.date}T00:00:00`)
      .lte("start_time", `${options.date}T23:59:59`);
  }
  
  if (options.tableId) {
    query = query.eq("table_id", options.tableId);
  }
  
  if (options.status) {
    query = query.eq("status", options.status);
  }
  
  if (options.activeOnly) {
    query = query.in("status", ["booked", "confirmed", "seated"]);
  }
  
  const { data, error } = await query.order("start_time", { ascending: true });
  
  if (error) throw error;
  
  // Transform data to include table_name
  return (data || []).map((res: any) => ({
    ...res,
    table_name: res.tables?.name || "Unknown",
    room_name: res.tables?.room_name,
  }));
}

/**
 * Fetch table service statuses for waiter view
 */
async function fetchTableStatuses(restaurantId: string): Promise<TableStatusWithDetails[]> {
  const supabase = createClientWithAuth();
  
  // Use the RPC function if available, otherwise query directly
  const { data, error } = await supabase
    .rpc("get_table_statuses", { p_restaurant_id: restaurantId });
  
  if (error) {
    // Fallback to direct query
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("table_service_status")
      .select(`
        *,
        tables:table_id (name, capacity, room_name, section)
      `)
      .eq("restaurant_id", restaurantId);
    
    if (fallbackError) throw fallbackError;
    
    return (fallbackData || []).map((status: any) => ({
      ...status,
      table_name: status.tables?.name || "Unknown",
      table_capacity: status.tables?.capacity || 0,
      room_name: status.tables?.room_name,
      section: status.tables?.section,
    }));
  }
  
  return data || [];
}

// =============================================
// Real-time Synchronization Hook
// =============================================

/**
 * Sets up real-time subscriptions for ALL reservation and table changes.
 * This ensures that any change made from ANY view immediately updates ALL views.
 */
export function useRealtimeSync(options: { 
  restaurantId: string | null; 
  enabled?: boolean;
  onChange?: (type: 'reservations' | 'tables' | 'statuses') => void;
} = { restaurantId: null, enabled: true }) {
  const { restaurantId, enabled = true, onChange } = options;
  const queryClient = useQueryClient();
  
  useEffect(() => {
    if (!restaurantId || !enabled) return;
    
    const supabase = createClientWithAuth();
    
    // Subscribe to reservation changes
    const reservationSubscription = supabase
      .channel(`unified-reservations-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          console.log("[UnifiedData] Reservation change detected:", payload.eventType, payload.new);
          
          // Invalidate ALL reservation queries
          queryClient.invalidateQueries({ 
            queryKey: ["unified", "reservations"],
            refetchType: "active"
          });
          
          // Also invalidate legacy query keys for backward compatibility
          queryClient.invalidateQueries({ 
            queryKey: ["timeline-reservations"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["list-reservations"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["floor-plan-reservations"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["active-reservations"],
            refetchType: "active"
          });
          
          // Invalidate table statuses as they depend on reservations
          queryClient.invalidateQueries({ 
            queryKey: ["unified", "table-statuses"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["table-statuses"],
            refetchType: "active"
          });
          
          onChange?.('reservations');
        }
      )
      .subscribe();
    
    // Subscribe to table changes
    const tableSubscription = supabase
      .channel(`unified-tables-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tables",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          console.log("[UnifiedData] Table change detected:", payload.eventType, payload.new);
          
          // Invalidate ALL table queries
          queryClient.invalidateQueries({ 
            queryKey: ["unified", "tables"],
            refetchType: "active"
          });
          
          // Also invalidate legacy query keys
          queryClient.invalidateQueries({ 
            queryKey: ["timeline-tables"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["list-tables"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["floor-plan-tables"],
            refetchType: "active"
          });
          
          onChange?.('tables');
        }
      )
      .subscribe();
    
    // Subscribe to table service status changes (waiter view)
    const statusSubscription = supabase
      .channel(`unified-statuses-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "table_service_status",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          console.log("[UnifiedData] Status change detected:", payload.eventType, payload.new);
          
          // Invalidate status queries
          queryClient.invalidateQueries({ 
            queryKey: ["unified", "table-statuses"],
            refetchType: "active"
          });
          queryClient.invalidateQueries({ 
            queryKey: ["table-statuses"],
            refetchType: "active"
          });
          
          onChange?.('statuses');
        }
      )
      .subscribe();
    
    return () => {
      reservationSubscription.unsubscribe();
      tableSubscription.unsubscribe();
      statusSubscription.unsubscribe();
    };
  }, [restaurantId, enabled, queryClient, onChange]);
}

// =============================================
// Main Unified Data Hook
// =============================================

/**
 * Main hook that provides unified access to ALL table and reservation data.
 * This is the SINGLE SOURCE OF TRUTH for the entire application.
 * 
 * @example
 * // Floor Plan View
 * const { tablesWithReservations, isLoading } = useUnifiedData({ date: today });
 * 
 * // Timeline View
 * const { tables, reservations } = useUnifiedData({ date: selectedDate });
 * 
 * // Reservations List
 * const { reservations, createReservation, updateReservation } = useUnifiedData();
 * 
 * // Waiter View
 * const { tableStatuses, reservations } = useUnifiedData({ 
 *   date: today, 
 *   includeServiceStatus: true 
 * });
 */
export function useUnifiedData(options: UnifiedDataOptions = {}): UnifiedDataResult {
  const { 
    date, 
    includeServiceStatus = false, 
    tableId, 
    status,
    enableRealtime = true 
  } = options;
  
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();
  
  // Enable real-time synchronization
  useRealtimeSync({ restaurantId, enabled: enableRealtime });
  
  // Fetch tables - shared across all views
  const tablesQuery = useQuery({
    queryKey: QUERY_KEYS.tables(restaurantId),
    queryFn: () => fetchTables(restaurantId!),
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
  });
  
  // Fetch reservations - filtered by date if provided
  const reservationsQuery = useQuery({
    queryKey: date 
      ? QUERY_KEYS.reservations(restaurantId, date)
      : QUERY_KEYS.allReservations(restaurantId),
    queryFn: () => fetchReservations(restaurantId!, { date, tableId, status }),
    enabled: !!restaurantId,
    staleTime: 15000, // 15 seconds - shorter for reservations
  });
  
  // Fetch table statuses for waiter view
  const statusesQuery = useQuery({
    queryKey: QUERY_KEYS.tableStatuses(restaurantId),
    queryFn: () => fetchTableStatuses(restaurantId!),
    enabled: !!restaurantId && includeServiceStatus,
    staleTime: 5000, // 5 seconds - very short for service status
    refetchInterval: includeServiceStatus ? 3000 : false, // Poll every 3s for waiter view
  });
  
  // Compute derived data
  const tables = useMemo(() => tablesQuery.data || [], [tablesQuery.data]);
  const reservations = useMemo(() => reservationsQuery.data || [], [reservationsQuery.data]);
  const tableStatuses = useMemo(() => statusesQuery.data || [], [statusesQuery.data]);
  
  // Create lookup map for reservations by table
  const reservationsByTable = useMemo(() => {
    const map = new Map<string, UnifiedReservation[]>();
    reservations.forEach((res) => {
      if (res.table_id) {
        const existing = map.get(res.table_id) || [];
        existing.push(res);
        map.set(res.table_id, existing);
      }
    });
    return map;
  }, [reservations]);
  
  // Merge table status data with tables
  const tablesWithStatus = useMemo(() => {
    if (!includeServiceStatus || tableStatuses.length === 0) {
      return tables;
    }
    
    const statusMap = new Map(tableStatuses.map(s => [s.table_id, s]));
    
    return tables.map(table => {
      const status = statusMap.get(table.id);
      if (!status) return table;
      
      return {
        ...table,
        current_status: status.status,
        current_reservation_id: status.reservation_id,
        current_customer_name: status.current_customer_name,
        current_party_size: status.current_party_size,
        availability_status: status.availability_status,
      };
    });
  }, [tables, tableStatuses, includeServiceStatus]);
  
  // Tables with their current reservations
  const tablesWithReservations = useMemo((): TableWithReservation[] => {
    return tablesWithStatus.map(table => ({
      ...table,
      reservation: reservationsByTable.get(table.id)?.[0],
    }));
  }, [tablesWithStatus, reservationsByTable]);
  
  // Filter active reservations
  const activeReservations = useMemo(() => {
    return reservations.filter(r => 
      ["booked", "confirmed", "seated"].includes(r.status)
    );
  }, [reservations]);
  
  // Occupied and available tables
  const occupiedTables = useMemo(() => {
    return tablesWithStatus.filter(t => 
      t.availability_status === "occupied" || 
      t.current_status && t.current_status !== "empty"
    );
  }, [tablesWithStatus]);
  
  const availableTables = useMemo(() => {
    return tablesWithStatus.filter(t => 
      !t.availability_status || 
      t.availability_status === "available" ||
      !t.current_status || 
      t.current_status === "empty"
    );
  }, [tablesWithStatus]);
  
  // Refetch functions
  const refetch = useCallback(async () => {
    await Promise.all([
      tablesQuery.refetch(),
      reservationsQuery.refetch(),
      statusesQuery.refetch(),
    ]);
  }, [tablesQuery, reservationsQuery, statusesQuery]);
  
  // Mutations
  const createReservation = useCreateReservation(restaurantId);
  const updateReservation = useUpdateReservation(restaurantId);
  const deleteReservation = useDeleteReservation(restaurantId);
  const updateTableStatus = useUpdateTableStatus(restaurantId);
  const seatReservation = useSeatReservation(restaurantId);
  
  return {
    // Data
    tables: tablesWithStatus,
    reservations,
    tableStatuses,
    
    // Derived
    tablesWithReservations,
    reservationsByTable,
    activeReservations,
    occupiedTables,
    availableTables,
    
    // Loading states
    isLoading: tablesQuery.isLoading || reservationsQuery.isLoading || (includeServiceStatus && statusesQuery.isLoading),
    isLoadingTables: tablesQuery.isLoading,
    isLoadingReservations: reservationsQuery.isLoading,
    isLoadingStatuses: statusesQuery.isLoading,
    
    // Errors
    error: tablesQuery.error || reservationsQuery.error || statusesQuery.error,
    
    // Refetch
    refetch,
    refetchTables: tablesQuery.refetch,
    refetchReservations: reservationsQuery.refetch,
    
    // Mutations
    createReservation,
    updateReservation,
    deleteReservation,
    updateTableStatus,
    seatReservation,
  };
}

// =============================================
// Mutation Hooks
// =============================================

function useCreateReservation(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: {
      customer_name: string;
      customer_phone?: string;
      party_size: number;
      table_id: string;
      date: string;
      time: string;
      duration: number;
      status?: ReservationStatus;
      notes?: string;
      is_walk_in?: boolean;
    }) => {
      if (!restaurantId) throw new Error("No restaurant ID");
      
      const supabase = createClientWithAuth();
      
      const startDateTime = `${data.date}T${data.time}:00`;
      const [hours, minutes] = data.time.split(":").map(Number);
      const endTotalMinutes = hours * 60 + minutes + data.duration;
      const endHours = Math.floor(endTotalMinutes / 60);
      const endMins = endTotalMinutes % 60;
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}`;
      const endDateTime = `${data.date}T${endTime}:00`;
      
      // Handle customer lookup/creation
      let customerId = null;
      if (data.customer_phone) {
        const phoneDigits = data.customer_phone.replace(/\D/g, "");
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("phone", `%${phoneDigits}%`)
          .single();
        
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const { data: newCustomer } = await supabase
            .from("customers")
            .insert({
              restaurant_id: restaurantId,
              name: data.customer_name,
              phone: data.customer_phone,
            })
            .select()
            .single();
          
          if (newCustomer) customerId = newCustomer.id;
        }
      }
      
      const { data: result, error } = await supabase
        .from("reservations")
        .insert({
          restaurant_id: restaurantId,
          customer_id: customerId,
          customer_name: data.customer_name,
          customer_phone: data.customer_phone,
          party_size: data.party_size,
          table_id: data.table_id,
          start_time: startDateTime,
          end_time: endDateTime,
          status: data.status || "booked",
          notes: data.notes,
          is_walk_in: data.is_walk_in || false,
        })
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      invalidateAll(queryClient);
      toast.success("Reservation created successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to create reservation: " + error.message);
    },
  });
}

function useUpdateReservation(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        customer_name: string;
        customer_phone: string;
        party_size: number;
        table_id: string;
        status: ReservationStatus;
        notes: string;
        start_time: string;
        end_time: string;
      }>;
    }) => {
      const supabase = createClientWithAuth();
      
      const { data: result, error } = await supabase
        .from("reservations")
        .update(data)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      invalidateAll(queryClient);
      toast.success("Reservation updated successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to update reservation: " + error.message);
    },
  });
}

function useDeleteReservation(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClientWithAuth();
      const { error } = await supabase
        .from("reservations")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll(queryClient);
      toast.success("Reservation cancelled successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to cancel reservation: " + error.message);
    },
  });
}

function useUpdateTableStatus(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload: {
      table_id: string;
      status: ServiceStatus;
      session_notes?: string;
      current_order_value?: number;
    }) => {
      if (!restaurantId) throw new Error("No restaurant ID");
      
      const res = await fetch("/api/tables/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          restaurant_id: restaurantId,
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update status");
      }
      
      return res.json();
    },
    onSuccess: () => {
      invalidateAll(queryClient);
    },
    onError: (error: Error) => {
      toast.error("Failed to update table status: " + error.message);
    },
  });
}

function useSeatReservation(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload: {
      reservation_id: string;
      table_id: string;
    }) => {
      if (!restaurantId) throw new Error("No restaurant ID");
      
      const res = await fetch("/api/reservations/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: payload.reservation_id,
          table_id: payload.table_id,
          restaurant_id: restaurantId,
          action: "seat",
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to seat reservation");
      }
      
      return res.json();
    },
    onSuccess: () => {
      invalidateAll(queryClient);
      toast.success("Guest seated successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to seat guest: " + error.message);
    },
  });
}

/**
 * Invalidate ALL reservation and table related queries
 */
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  // Unified keys
  queryClient.invalidateQueries({ queryKey: ["unified"] });
  
  // Legacy keys for backward compatibility
  queryClient.invalidateQueries({ queryKey: ["tables"] });
  queryClient.invalidateQueries({ queryKey: ["reservations"] });
  queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["list-tables"] });
  queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["timeline-tables"] });
  queryClient.invalidateQueries({ queryKey: ["floor-plan-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["floor-plan-tables"] });
  queryClient.invalidateQueries({ queryKey: ["table-statuses"] });
  queryClient.invalidateQueries({ queryKey: ["active-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["customers"] });
}

// =============================================
// Utility Exports
// =============================================

/**
 * Get status color class for reservations
 */
export function getReservationStatusColor(status: ReservationStatus): string {
  switch (status) {
    case "booked": return "bg-blue-500";
    case "confirmed": return "bg-indigo-500";
    case "seated": return "bg-green-500";
    case "finished": return "bg-gray-500";
    case "cancelled": return "bg-red-500";
    case "no_show": return "bg-amber-500";
    default: return "bg-blue-500";
  }
}

/**
 * Get availability color for floor plan
 */
export function getAvailabilityColor(
  table: UnifiedTable, 
  reservation?: UnifiedReservation
): string {
  if (reservation?.status === "seated") return "bg-red-500 border-red-600";
  if (["booked", "confirmed"].includes(reservation?.status || "")) {
    return "bg-amber-400 border-amber-500";
  }
  if (table.current_status && table.current_status !== "empty") {
    return "bg-red-500 border-red-600";
  }
  return "bg-green-500 border-green-600";
}

export default useUnifiedData;
