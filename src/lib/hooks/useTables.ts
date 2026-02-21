"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import type { Table, TableFormData } from "@/lib/types";

const QUERY_KEY = "tables";

/**
 * Hook to fetch all tables for the current restaurant
 */
export function useTables(restaurantId: string | null | undefined) {
  console.log("[DEBUG useTables] Hook called with restaurantId:", restaurantId);
  
  return useQuery<Table[]>({
    queryKey: [QUERY_KEY, restaurantId],
    queryFn: async () => {
      console.log("[DEBUG useTables] queryFn executing with restaurantId:", restaurantId);
      
      if (!restaurantId) {
        console.log("[DEBUG useTables] No restaurantId, returning empty array");
        return [];
      }
      
      const supabase = createClientWithAuth();
      console.log("[DEBUG useTables] About to query with restaurant_id filter:", restaurantId);
      
      const { data, error } = await supabase
        .from("tables")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true });
      
      console.log("[DEBUG useTables] Query result - count:", data?.length || 0, "error:", error?.message || null);
      
      if (error) {
        console.error("Error fetching tables:", error);
        return [];
      }
      
      return data || [];
    },
    enabled: !!restaurantId,
  });
}

/**
 * Hook for table mutations (create, update, delete)
 */
export function useTableMutations(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (table: TableFormData) => {
      console.log("[DEBUG useTables.create] Creating table with restaurantId:", restaurantId);
      
      if (!restaurantId) throw new Error("No restaurant ID");
      
      const supabase = createClientWithAuth();
      console.log("[DEBUG useTables.create] Getting next sort order for restaurant:", restaurantId);
      
      // Get next sort order
      const { data: existingTables } = await supabase
        .from("tables")
        .select("sort_order")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: false })
        .limit(1);
      
      const nextSortOrder = existingTables && existingTables.length > 0 
        ? (existingTables[0].sort_order || 0) + 1 
        : 1;
      
      console.log("[DEBUG useTables.create] Inserting table with restaurant_id:", restaurantId);
      
      const { data, error } = await supabase
        .from("tables")
        .insert({ 
          ...table, 
          restaurant_id: restaurantId,
          sort_order: nextSortOrder 
        })
        .select()
        .single();
      
      console.log("[DEBUG useTables.create] Result:", data ? "success" : "failed", "error:", error?.message || null);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["timeline-tables"] });
      queryClient.invalidateQueries({ queryKey: ["list-tables"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<TableFormData>) => {
      console.log("[DEBUG useTables.update] Updating table:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
      const { data, error } = await supabase
        .from("tables")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      console.log("[DEBUG useTables.update] Result:", data ? "success" : "failed", "error:", error?.message || null);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["timeline-tables"] });
      queryClient.invalidateQueries({ queryKey: ["list-tables"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      console.log("[DEBUG useTables.delete] Deleting table:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
      const { error } = await supabase
        .from("tables")
        .delete()
        .eq("id", id);
      
      console.log("[DEBUG useTables.delete] Result:", error ? "failed" : "success", "error:", error?.message || null);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["timeline-tables"] });
      queryClient.invalidateQueries({ queryKey: ["list-tables"] });
    },
  });

  return {
    createMutation,
    updateMutation,
    deleteMutation,
  };
}

/**
 * Get suitable tables for a given party size
 */
export function getSuitableTables(tables: Table[], partySize: number): Table[] {
  return tables
    .filter((t) => t.capacity >= partySize)
    .sort((a, b) => a.capacity - b.capacity);
}

/**
 * Get the best table suggestion for a party size
 */
export function getBestTable(tables: Table[], partySize: number, preferredTableId?: string): string | null {
  const suitable = getSuitableTables(tables, partySize);
  if (preferredTableId && suitable.find((t) => t.id === preferredTableId)) {
    return preferredTableId;
  }
  return suitable[0]?.id || null;
}