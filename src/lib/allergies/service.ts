// =============================================
// Allergy Management Service
// Handles CRUD operations for allergies and customer allergies
// =============================================

import { createClientWithAuth } from "@/lib/supabase/client";

// Get supabase client instance
const supabase = createClientWithAuth();
import type { 
  Allergy, 
  CustomerAllergy, 
  AllergyFormData, 
  AllergySeverity,
  ApiResponse 
} from "@/lib/types";

// =============================================
// Master Allergies (Read-only common allergens)
// =============================================

/**
 * Fetch all master allergies from the database
 */
export async function getAllAllergies(): Promise<ApiResponse<Allergy[]>> {
  try {
    const { data, error } = await supabase
      .from("allergies")
      .select("*")
      .order("name");

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error("Error fetching allergies:", error);
    return { 
      success: false, 
      data: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Search allergies by name
 */
export async function searchAllergies(query: string): Promise<ApiResponse<Allergy[]>> {
  try {
    const { data, error } = await supabase
      .from("allergies")
      .select("*")
      .ilike("name", `%${query}%`)
      .order("name")
      .limit(10);

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error("Error searching allergies:", error);
    return { 
      success: false, 
      data: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// =============================================
// Customer Allergy Management
// =============================================

/**
 * Fetch all allergies for a specific customer
 */
export async function getCustomerAllergies(customerId: string): Promise<ApiResponse<CustomerAllergy[]>> {
  try {
    const { data, error } = await supabase
      .from("customer_allergies")
      .select(`
        *,
        allergy:allergy_id (name)
      `)
      .eq("customer_id", customerId)
      .order("created_at");

    if (error) throw error;

    // Transform the data to include allergy_name
    const transformedData: CustomerAllergy[] = (data || []).map(item => ({
      ...item,
      allergy_name: item.allergy?.name || item.custom_allergy_name
    }));

    return { success: true, data: transformedData };
  } catch (error) {
    console.error("Error fetching customer allergies:", error);
    return { 
      success: false, 
      data: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Add an allergy to a customer using the RPC function
 */
export async function addAllergyToCustomer(
  customerId: string, 
  formData: AllergyFormData
): Promise<ApiResponse<{ success: boolean; allergy: string; severity: string }>> {
  try {
    const { data, error } = await supabase
      .rpc("add_customer_allergy", {
        p_customer_id: customerId,
        p_allergy_name: formData.allergy_name,
        p_severity: formData.severity || "moderate",
        p_notes: formData.notes || null
      });

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error("Error adding allergy to customer:", error);
    return { 
      success: false, 
      data: { success: false, allergy: "", severity: "" }, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Add an allergy to a customer directly (fallback if RPC fails)
 */
export async function addCustomerAllergyDirect(
  customerId: string,
  formData: AllergyFormData
): Promise<ApiResponse<CustomerAllergy>> {
  try {
    // First, try to find the allergy in the master list
    const { data: allergyData } = await supabase
      .from("allergies")
      .select("id")
      .ilike("name", formData.allergy_name)
      .single();

    const allergyId = allergyData?.id || null;

    // Insert the customer allergy
    const { data, error } = await supabase
      .from("customer_allergies")
      .insert({
        customer_id: customerId,
        allergy_id: allergyId,
        custom_allergy_name: allergyId ? null : formData.allergy_name,
        severity: formData.severity || "moderate",
        notes: formData.notes
      })
      .select()
      .single();

    if (error) {
      // Handle duplicate error
      if (error.code === "23505") {
        return { 
          success: false, 
          data: null as any, 
          error: "This allergy is already recorded for this customer" 
        };
      }
      throw error;
    }

    // Also update the customer's tags for quick filtering
    try {
      await supabase
        .rpc("add_customer_tag", {
          p_customer_id: customerId,
          p_tag: `Allergy: ${formData.allergy_name}`
        });
    } catch {
      // Silently fail - tags are not critical
    }

    return { success: true, data };
  } catch (error) {
    console.error("Error adding customer allergy:", error);
    return { 
      success: false, 
      data: null as any, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Remove an allergy from a customer
 */
export async function removeCustomerAllergy(
  customerAllergyId: string
): Promise<ApiResponse<void>> {
  try {
    const { error } = await supabase
      .from("customer_allergies")
      .delete()
      .eq("id", customerAllergyId);

    if (error) throw error;

    return { success: true, data: undefined };
  } catch (error) {
    console.error("Error removing customer allergy:", error);
    return { 
      success: false, 
      data: undefined, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Update the severity of a customer allergy
 */
export async function updateAllergySeverity(
  customerAllergyId: string,
  severity: AllergySeverity,
  notes?: string
): Promise<ApiResponse<CustomerAllergy>> {
  try {
    const updateData: Partial<CustomerAllergy> = { severity };
    if (notes !== undefined) updateData.notes = notes;

    const { data, error } = await supabase
      .from("customer_allergies")
      .update(updateData)
      .eq("id", customerAllergyId)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error("Error updating allergy severity:", error);
    return { 
      success: false, 
      data: null as any, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// =============================================
// Allergy Search & Reporting
// =============================================

/**
 * Get all customers with a specific allergy (uses RPC function)
 */
export async function getCustomersByAllergy(
  restaurantId: string,
  allergyName: string
): Promise<ApiResponse<Array<{
  customer_id: string;
  customer_name: string;
  phone: string;
  allergy_severity: string;
  notes: string;
}>>> {
  try {
    const { data, error } = await supabase
      .rpc("get_customers_by_allergy", {
        p_restaurant_id: restaurantId,
        p_allergy_name: allergyName
      });

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error) {
    console.error("Error fetching customers by allergy:", error);
    return { 
      success: false, 
      data: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// =============================================
// Helper Functions
// =============================================

/**
 * Get severity color for UI display
 */
export function getSeverityColor(severity: AllergySeverity | string | undefined): string {
  switch (severity) {
    case "life_threatening":
      return "text-red-600 bg-red-50 border-red-200";
    case "severe":
      return "text-orange-600 bg-orange-50 border-orange-200";
    case "moderate":
      return "text-yellow-600 bg-yellow-50 border-yellow-200";
    case "mild":
      return "text-green-600 bg-green-50 border-green-200";
    default:
      return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

/**
 * Get severity label with emoji for quick visual identification
 */
export function getSeverityLabel(severity: AllergySeverity | string | undefined): string {
  switch (severity) {
    case "life_threatening":
      return "🚨 Life Threatening";
    case "severe":
      return "⚠️ Severe";
    case "moderate":
      return "⚡ Moderate";
    case "mild":
      return "🟢 Mild";
    default:
      return "❓ Unknown";
  }
}

/**
 * Format allergies for display in customer lists
 */
export function formatAllergiesForDisplay(allergies: string[] | undefined): string {
  if (!allergies || allergies.length === 0) return "None";
  if (allergies.length <= 2) return allergies.join(", ");
  return `${allergies.slice(0, 2).join(", ")} +${allergies.length - 2} more`;
}

/**
 * Check if a customer has a life-threatening allergy
 */
export function hasLifeThreateningAllergy(
  customerAllergies: CustomerAllergy[]
): boolean {
  return customerAllergies.some(
    ca => ca.severity === "life_threatening"
  );
}

/**
 * Get the most common allergies for a restaurant
 */
export async function getMostCommonAllergies(
  restaurantId: string,
  limit: number = 10
): Promise<ApiResponse<Array<{ allergy: string; count: number }>>> {
  try {
    const { data, error } = await supabase
      .from("customer_allergies")
      .select(`
        allergy_id,
        custom_allergy_name,
        allergy:allergy_id (name),
        customer!inner (restaurant_id)
      `)
      .eq("customer.restaurant_id", restaurantId)
      .limit(1000);

    if (error) throw error;

    // Count occurrences
    const counts = new Map<string, number>();
    (data || []).forEach((item: any) => {
      const allergyName = Array.isArray(item.allergy) 
        ? item.allergy[0]?.name 
        : item.allergy?.name;
      const name = allergyName || item.custom_allergy_name || "Unknown";
      counts.set(name, (counts.get(name) || 0) + 1);
    });

    // Convert to array and sort
    const sorted = Array.from(counts.entries())
      .map(([allergy, count]) => ({ allergy, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return { success: true, data: sorted };
  } catch (error) {
    console.error("Error fetching common allergies:", error);
    return { 
      success: false, 
      data: [], 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}