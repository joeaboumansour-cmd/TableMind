"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

/**
 * Hook to fetch the current restaurant ID
 * Used across multiple pages to identify the restaurant context
 */
export function useRestaurant() {
  return useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id")
        .limit(1)
        .single();
      
      if (error) {
        console.error("Error fetching restaurant:", error);
        return null;
      }
      
      return data?.id || null;
    },
    staleTime: Infinity, // Restaurant ID rarely changes
  });
}

/**
 * Hook that returns just the restaurant ID (for convenience)
 */
export function useRestaurantId(): string | null {
  const { data } = useRestaurant();
  return data || null;
}