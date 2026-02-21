"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientWithAuth } from "@/lib/supabase/client";
import type { 
  Customer, 
  CustomerFormData, 
  CustomerVisitLog,
  CustomerVisitSummary 
} from "@/lib/types";

const QUERY_KEY = "customers";

// =============================================
// HOST-FOCUSED CUSTOMER HOOKS
// =============================================

/**
 * Hook to fetch all customers for the current restaurant
 * Uses the customer_analytics view which includes calculated fields
 * like reliability_score and risk_level
 */
export function useCustomers(restaurantId: string | null | undefined) {
  console.log("[DEBUG useCustomers] Hook called with restaurantId:", restaurantId);
  
  return useQuery<Customer[]>({
    queryKey: [QUERY_KEY, restaurantId],
    queryFn: async () => {
      console.log("[DEBUG useCustomers] queryFn executing with restaurantId:", restaurantId);
      
      if (!restaurantId) {
        console.log("[DEBUG useCustomers] No restaurantId, returning empty array");
        return [];
      }
      
      const supabase = createClientWithAuth();
      console.log("[DEBUG useCustomers] About to query with restaurant_id filter:", restaurantId);
      
      // Always read from customer_analytics view for consistency
      const { data, error } = await supabase
        .from("customer_analytics")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });
      
      console.log("[DEBUG useCustomers] Query result - count:", data?.length || 0, "error:", error?.message || null);
      
      if (error) {
        console.error("Error fetching customers:", error);
        return [];
      }
      
      return data || [];
    },
    enabled: !!restaurantId,
  });
}

// =============================================
// LEGACY LOOKUP
// =============================================

/**
 * Hook to look up a customer by phone number
 * Uses the customers table directly for quick lookup
 * @deprecated Use useCustomerSearch instead for better UX
 */
export function useCustomerLookup(restaurantId: string | null | undefined) {
  console.log("[DEBUG useCustomerLookup] Hook called with restaurantId:", restaurantId);
  
  return async (phone: string): Promise<Customer | null> => {
    console.log("[DEBUG useCustomerLookup] Looking up phone:", phone, "restaurantId:", restaurantId);
    
    if (!restaurantId || phone.length < 7) {
      console.log("[DEBUG useCustomerLookup] Skipping - no restaurantId or phone too short");
      return null;
    }
    
    const supabase = createClientWithAuth();
    console.log("[DEBUG useCustomerLookup] Querying with restaurant_id:", restaurantId);
    
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, tags, total_visits, last_visit_date")
      .eq("restaurant_id", restaurantId)
      .ilike("phone", `%${phone}%`)
      .single();
    
    console.log("[DEBUG useCustomerLookup] Result:", data ? "found" : "not found", "error:", error?.message || null);
    
    if (error || !data) return null;
    return data as Customer;
  };
}

// =============================================
// CUSTOMER MUTATIONS
// =============================================

/**
 * Hook for customer mutations (create, update, delete)
 * All writes go to the customers table - analytics view is read-only
 */
export function useCustomerMutations(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (customer: Omit<CustomerFormData, "tags"> & { tags?: string[] }) => {
      console.log("[DEBUG useCustomers.create] Creating customer with restaurantId:", restaurantId);
      
      if (!restaurantId) throw new Error("No restaurant ID");
      
      const supabase = createClientWithAuth();
      console.log("[DEBUG useCustomers.create] Inserting with restaurant_id:", restaurantId);
      
      const { data, error } = await supabase
        .from("customers")
        .insert({ 
          ...customer, 
          restaurant_id: restaurantId,
          tags: customer.tags || [],
        })
        .select()
        .single();
      
      console.log("[DEBUG useCustomers.create] Result:", data ? "success" : "failed", "error:", error?.message || null);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["analytics-customers"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<CustomerFormData>) => {
      console.log("[DEBUG useCustomers.update] Updating customer:", id, "restaurantId:", restaurantId);
      
      const supabase = createClientWithAuth();
      const { data, error } = await supabase
        .from("customers")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      console.log("[DEBUG useCustomers.update] Result:", data ? "success" : "failed", "error:", error?.message || null);
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["analytics-customers"] });
    },
  });

  return {
    createMutation,
    updateMutation,
  };
}

// =============================================
// VISIT LOGS (Simplified for Host Entry)
// =============================================

/**
 * Hook to fetch visit logs for a customer
 */
export function useCustomerVisits(customerId: string | null | undefined) {
  return useQuery<CustomerVisitSummary[]>({
    queryKey: ["customer-visits", customerId],
    queryFn: async () => {
      if (!customerId) return [];

      const supabase = createClientWithAuth();
      const { data, error } = await supabase
        .from("customer_visit_summary")
        .select("*")
        .eq("customer_id", customerId)
        .order("visit_date", { ascending: false });

      if (error) {
        console.error("Error fetching customer visits:", error);
        return [];
      }

      return data || [];
    },
    enabled: !!customerId,
  });
}

/**
 * Hook for creating visit logs (simplified for host)
 */
export function useVisitLogMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (log: Omit<CustomerVisitLog, "id" | "created_at" | "updated_at">) => {
      const supabase = createClientWithAuth();
      const { data, error } = await supabase
        .from("customer_visit_logs")
        .insert(log)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["customer-visits", variables.customer_id] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  return { createMutation };
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Find a customer by phone number from a list of customers
 */
export function findCustomerByPhone(customers: Customer[], phone: string): Customer | null {
  if (!phone || phone.length < 3) return null;
  
  const phoneDigits = phone.replace(/\D/g, "");
  
  return customers.find((c) => {
    if (!c.phone) return false;
    const customerPhoneDigits = c.phone.replace(/\D/g, "");
    return (
      customerPhoneDigits === phoneDigits ||
      c.phone.includes(phone) ||
      phoneDigits.includes(customerPhoneDigits)
    );
  }) || null;
}

/**
 * Calculate customer statistics
 */
export function calculateCustomerStats(customers: Customer[]) {
  const totalCustomers = customers.length;
  const vipCustomers = customers.filter((c) => c.tags?.includes("VIP")).length;
  const avgVisits = totalCustomers > 0 
    ? Math.round(customers.reduce((acc, c) => acc + c.total_visits, 0) / totalCustomers)
    : 0;
  const reliableCustomers = customers.filter((c) => (c.reliability_score || 0) >= 80).length;
  const unreliableCustomers = customers.filter((c) => (c.reliability_score || 0) < 50).length;
  const highRiskCustomers = customers.filter((c) => c.tags?.includes("High Risk")).length;
  
  return {
    totalCustomers,
    vipCustomers,
    avgVisits,
    reliableCustomers,
    unreliableCustomers,
    highRiskCustomers,
  };
}

/**
 * Get customer risk badge color
 */
export function getRiskBadgeColor(riskLevel?: string): string {
  switch (riskLevel) {
    case "High":
      return "bg-red-100 text-red-800 border-red-200";
    case "Medium":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "Low":
      return "bg-green-100 text-green-800 border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

/**
 * Get reliability score color
 */
export function getReliabilityColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

