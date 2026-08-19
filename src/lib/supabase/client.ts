import { createBrowserClient } from "@supabase/ssr";

// Track current restaurant ID to detect changes
let currentRestaurantId: string | null = null;

// Mock data for demo mode
const mockTables = [
  { id: "1", name: "Table 1", capacity: 2, shape: "rect" as const, sort_order: 1, restaurant_id: "demo" },
  { id: "2", name: "Table 2", capacity: 4, shape: "rect" as const, sort_order: 2, restaurant_id: "demo" },
  { id: "3", name: "Table 3", capacity: 4, shape: "circle" as const, sort_order: 3, restaurant_id: "demo" },
  { id: "4", name: "Table 4", capacity: 6, shape: "rect" as const, sort_order: 4, restaurant_id: "demo" },
];

/**
 * Get the restaurant ID from localStorage auth data
 */
function getRestaurantIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  
  try {
    const authData = localStorage.getItem("tablemind_auth");
    if (!authData) return null;
    
    const parsed = JSON.parse(authData);
    return parsed.restaurant?.id || null;
  } catch {
    return null;
  }
}

// ---- Product reads ----
//
// These moved to @/lib/products/refresh, which is now the single home for
// "get this store's products from Supabase into the local cache". They used to
// live here alongside a near-identical copy inside SyncEngine.pullProducts, and
// the two drifted apart on the details that matter (pagination, reconciliation)
// while nothing stopped them running at the same time.
//
// Re-exported so existing import sites keep working.
export {
  fetchAllProducts,
  fetchAllProductIds,
  getLastSyncKey,
  refreshProductsIntoCache,
  PRODUCT_COLUMNS,
  mapToCachedProduct,
} from "@/lib/products/refresh";
export type { RefreshResult } from "@/lib/products/refresh";

/**
 * Create a Supabase client with restaurant_id header for RLS
 * This function ALWAYS creates a fresh client to ensure correct tenant isolation
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Check if credentials are valid (not empty and not placeholder)
  const isConfigured = supabaseUrl && 
    supabaseUrl !== "your-supabase-project-url" && 
    supabaseUrl.startsWith("http") &&
    supabaseKey && 
    supabaseKey.length > 10;

  if (!isConfigured) {
    console.warn("Supabase credentials not configured. Using mock client for demo.");
    
    // Return a mock client that mimics Supabase API
    return {
      auth: {
        signInWithPassword: async () => ({ data: { user: null }, error: new Error("Not configured") }),
        signOut: async () => ({ error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => {
        if (table === "tables") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  then: (cb: any) => Promise.resolve(cb({ data: mockTables, error: null })),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () => Promise.resolve({ 
                  data: { id: String(Date.now()), name: "New Table", capacity: 2, shape: "rect", sort_order: 5, restaurant_id: "demo" }, 
                  error: null 
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: mockTables[0], error: null }),
                }),
              }),
            }),
            delete: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      },
    } as unknown as ReturnType<typeof createBrowserClient>;
  }

  // DEBUG: Log restaurant ID
  console.log("[Supabase Client] Creating client - will read restaurant ID from localStorage on each request");

  // Create real client with DYNAMIC header injection
  // Use custom fetch to ensure fresh restaurant_id header on EVERY request
  const options: any = {
    global: {
      fetch: (...args: Parameters<typeof fetch>) => {
        const [url, config = {}] = args;
        
        // Read restaurant ID FRESH from localStorage on every request
        const restaurantId = getRestaurantIdFromStorage();
        
        console.log("[Supabase Client] Fetch with Restaurant ID:", restaurantId, "URL:", url.toString().slice(0, 100));
        
        // Create new headers with fresh restaurant_id
        const headers = new Headers(config.headers || {});
        if (restaurantId) {
          headers.set("x-restaurant-id", restaurantId);
        }
        
        return fetch(url, {
          ...config,
          headers,
        });
      },
    },
  };

  // ALWAYS create a fresh client - no caching!
  return createBrowserClient(supabaseUrl, supabaseKey, options);
}

/**
 * Create a fresh Supabase client with the current restaurant ID
 * Use this for operations that need the latest auth state
 */
export function createClientWithAuth() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials not configured");
  }

  console.log("[Supabase Client] createClientWithAuth - will read restaurant ID from localStorage on each request");

  // Use custom fetch to ensure fresh restaurant_id header on EVERY request
  const options: any = {
    global: {
      fetch: (...args: Parameters<typeof fetch>) => {
        const [url, config = {}] = args;
        
        // Read restaurant ID FRESH from localStorage on every request
        const restaurantId = getRestaurantIdFromStorage();
        
        console.log("[Supabase Client] createClientWithAuth fetch with Restaurant ID:", restaurantId);
        
        // Create new headers with fresh restaurant_id
        const headers = new Headers(config.headers || {});
        if (restaurantId) {
          headers.set("x-restaurant-id", restaurantId);
        }
        
        return fetch(url, {
          ...config,
          headers,
        });
      },
    },
  };

  return createBrowserClient(supabaseUrl, supabaseKey, options);
}