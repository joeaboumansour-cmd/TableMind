"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import type { Reservation, ReservationFormData, ReservationStatus, Table } from "@/lib/types";

const QUERY_KEY = "reservations";

interface UseReservationsOptions {
  date?: string;
  status?: ReservationStatus;
  tableId?: string;
}

/**
 * Hook to fetch reservations with optional filtering
 */
export function useReservations(
  restaurantId: string | null | undefined,
  options: UseReservationsOptions = {}
) {
  const { date, status, tableId } = options;
  
  console.log("[DEBUG useReservations] Hook called with restaurantId:", restaurantId, "options:", options);

  return useQuery<Reservation[]>({
    queryKey: [QUERY_KEY, restaurantId, options],
    queryFn: async () => {
      console.log("[DEBUG useReservations] queryFn executing with restaurantId:", restaurantId, "date:", date);
      
      if (!restaurantId) {
        console.log("[DEBUG useReservations] No restaurantId, returning empty array");
        return [];
      }

      const supabase = createClientWithAuth();
      console.log("[DEBUG useReservations] Building query with restaurant_id filter:", restaurantId);
      
      let query = supabase
        .from("reservations")
        .select("*")
        .eq("restaurant_id", restaurantId);

      if (date) {
        query = query
          .gte("start_time", `${date}T00:00:00`)
          .lte("start_time", `${date}T23:59:59`);
      }

      if (status) {
        query = query.eq("status", status);
      }

      if (tableId) {
        query = query.eq("table_id", tableId);
      }

      const { data, error } = await query.order("start_time", { ascending: true });
      
      console.log("[DEBUG useReservations] Query result - count:", data?.length || 0, "error:", error?.message || null);

      if (error) {
        console.error("Error fetching reservations:", error);
        return [];
      }

      return data || [];
    },
    enabled: !!restaurantId,
  });
}

/**
 * Hook to fetch reservations with table names joined
 */
export function useReservationsWithTables(
  restaurantId: string | null | undefined,
  tables: Table[] = []
) {
  const { data: reservations = [], ...rest } = useReservations(restaurantId);

  const reservationsWithTables = reservations.map((reservation) => ({
    ...reservation,
    table_name: tables.find((t) => t.id === reservation.table_id)?.name || "Unknown",
  }));

  return { data: reservationsWithTables, ...rest };
}

/**
 * Hook for reservation mutations
 */
export function useReservationMutations(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data: ReservationFormData) => {
      console.log("[DEBUG useReservations.create] Creating reservation with restaurantId:", restaurantId);
      
      if (!restaurantId) throw new Error("No restaurant ID");

      const supabase = createClientWithAuth();
      const startDateTime = `${data.date}T${data.time}:00`;
      const [hours, minutes] = data.time.split(":").map(Number);
      const endTotalMinutes = hours * 60 + minutes + data.duration;
      const endHours = Math.floor(endTotalMinutes / 60);
      const endMins = endTotalMinutes % 60;
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMins.toString().padStart(2, "0")}`;
      const endDateTime = `${data.date}T${endTime}:00`;

      // Check if customer exists with this phone number
      let customerId = null;
      if (data.customer_phone) {
        console.log("[DEBUG useReservations.create] Looking up customer by phone:", data.customer_phone);
        const phoneDigits = data.customer_phone.replace(/\D/g, "");
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id, phone")
          .eq("restaurant_id", restaurantId)
          .ilike("phone", `%${phoneDigits}%`)
          .single();
        
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          // Create new customer
          const { data: newCustomer, error: customerError } = await supabase
            .from("customers")
            .insert({
              restaurant_id: restaurantId,
              name: data.customer_name,
              phone: data.customer_phone,
            })
            .select()
            .single();
          
          if (!customerError && newCustomer) {
            customerId = newCustomer.id;
          }
        }
      }

      console.log("[DEBUG useReservations.create] Inserting reservation with restaurant_id:", restaurantId, "customerId:", customerId);
      
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
          status: data.status,
          notes: data.notes,
        })
        .select()
        .single();
      
      console.log("[DEBUG useReservations.create] Result:", result ? "success" : "failed", "error:", error?.message || null);

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      invalidateReservationQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ReservationFormData>;
    }) => {
      console.log("[DEBUG useReservations.update] Updating reservation:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
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
      invalidateReservationQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      console.log("[DEBUG useReservations.delete] Deleting reservation:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
      const { error } = await supabase.from("reservations").delete().eq("id", id);
      
      console.log("[DEBUG useReservations.delete] Result:", error ? "failed" : "success", "error:", error?.message || null);
      
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateReservationQueries(queryClient);
    },
  });

  const updateTimeMutation = useMutation({
    mutationFn: async ({
      id,
      start_time,
      end_time,
      table_id,
    }: {
      id: string;
      start_time: string;
      end_time: string;
      table_id: string;
    }) => {
      console.log("[DEBUG useReservations.updateTime] Updating time for reservation:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
      const { data, error } = await supabase
        .from("reservations")
        .update({ start_time, end_time, table_id })
        .eq("id", id)
        .select()
        .single();

      console.log("[DEBUG useReservations.updateTime] Result:", data ? "success" : "failed", "error:", error?.message || null);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateReservationQueries(queryClient);
    },
  });

  // Record visit via API for customer stats tracking
  const recordVisitMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const response = await fetch(`/api/reservations/${id}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to record visit");
      }
      return response.json();
    },
    onSuccess: () => {
      invalidateReservationQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  return {
    createMutation,
    updateMutation,
    deleteMutation,
    updateTimeMutation,
    recordVisitMutation,
  };
}

/**
 * Invalidate all reservation-related queries
 */
function invalidateReservationQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: ["list-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["timeline-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-reservations"] });
  queryClient.invalidateQueries({ queryKey: ["analytics-reservations"] });
}
