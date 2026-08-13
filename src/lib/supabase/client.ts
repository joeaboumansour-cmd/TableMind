import { createBrowserClient } from "@supabase/ssr";
import { upsertProducts, reconcileProductsCache } from "@/lib/db/localDB";

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

/**
 * Get the per-store last sync timestamp key.
 * Using per-store keys prevents Store A's sync timestamp
 * from making Store B skip network fetches.
 */
export function getLastSyncKey(storeId: string): string {
  return `products_last_sync_${storeId}`;
}

/**
 * Fetch ALL products for a store using pagination.
 * Supabase/PostgREST enforces a server-side max-rows limit (default 1000),
 * so we must paginate through all pages using .range().
 * After fetch, writes products to IndexedDB cache for instant subsequent reads.
 * Also reconciles the cache — removes any cached products that no longer
 * exist in Supabase (deleted products).
 */
export async function fetchAllProducts(
  supabase: ReturnType<typeof createBrowserClient>,
  storeId: string
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allProducts: any[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("store_id", storeId)
      // Stable pagination: order by name THEN id. Without a unique tiebreaker
      // (id), pagination across page boundaries can skip/duplicate rows when
      // many products share the same name (e.g. "Coffee" variants).
      .order("name")
      .order("id")
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allProducts = allProducts.concat(data);
    if (data.length < PAGE_SIZE) break; // Last page

    from += PAGE_SIZE;
  }

  // Write-through cache: update IndexedDB after every successful fetch
  if (typeof window !== "undefined") {
    try {
      if (allProducts.length > 0) {
        await upsertProducts(
          allProducts.map((p) => ({
            id: p.id,
            store_id: p.store_id,
            name: p.name,
            barcode: p.barcode,
            cost_price: p.cost_price,
            selling_price: p.selling_price,
            currency: p.currency || "LL",
            profit_percentage: p.profit_percentage,
            discount_percentage: p.discount_percentage || 0,
            stock_quantity: p.stock_quantity,
            min_stock_threshold: p.min_stock_threshold,
            parent_id: p.parent_id || null,
            variant_name: p.variant_name || null,
            updated_at: p.updated_at || new Date().toISOString(),
          }))
        );
      }

      // CRITICAL FIX: Reconcile the cache against the live product set.
      // This removes any cached products that were deleted in Supabase.
      // Without this, deleted products linger in IndexedDB and reappear on refresh.
      await reconcileProductsCache(
        storeId,
        allProducts.map((p) => p.id)
      );

      // Update per-store last sync timestamp
      try {
        localStorage.setItem(getLastSyncKey(storeId), Date.now().toString());
        // Also update the global key for backward compatibility
        localStorage.setItem('products_last_sync', Date.now().toString());
      } catch {}
    } catch (e) {
      console.warn("[Supabase] Failed to write-through cache:", e);
    }
  }

  return allProducts;
}

// Cache freshness threshold: 5 minutes
const CACHE_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Check if the local product cache is still fresh for a specific store.
 * Uses a per-store timestamp stored in localStorage to avoid unnecessary network fetches.
 */
function isCacheFresh(storeId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Prefer per-store key, fall back to global key for backward compatibility
    const perStoreKey = getLastSyncKey(storeId);
    const lastSync = localStorage.getItem(perStoreKey) || localStorage.getItem('products_last_sync');
    if (!lastSync) return false;
    return Date.now() - parseInt(lastSync) < CACHE_FRESHNESS_MS;
  } catch {
    return false;
  }
}

/**
 * Fetch products cache-first: returns cached products instantly (if available),
 * then silently refreshes from Supabase in the background.
 * If the cache is fresh (updated within 5 min), skips the network fetch entirely.
 * Returns fresh products but the caller can render stale cache immediately
 * if desired by providing an onCacheHit callback.
 */
export async function fetchProductsCacheFirst(
  supabase: ReturnType<typeof createBrowserClient>,
  storeId: string,
  onCacheHit?: (products: any[]) => void,
  forceRefresh = false
): Promise<any[]> {
  // 1. Try cache first (instant, no network)
  if (typeof window !== "undefined" && !forceRefresh) {
    try {
      const { getCachedProducts } = await import("@/lib/db/localDB");
      const cached = await getCachedProducts(storeId);
      if (cached && cached.length > 0) {
        onCacheHit?.(cached);

        // 2. If cache is fresh (synced within 5 min), skip network fetch entirely
        if (isCacheFresh(storeId)) {
          console.log("[Supabase] Cache is fresh, skipping network fetch");
          return cached;
        }
        // Otherwise, proceed to background refresh below
      }
    } catch (e) {
      console.warn("[Supabase] Cache read failed:", e);
    }
  }

  // 3. Refresh from network (this also writes to cache via write-through)
  try {
    const fresh = await fetchAllProducts(supabase, storeId);
    return fresh;
  } catch (error) {
    // If network fails and we had cache, return cache silently
    if (typeof window !== "undefined") {
      try {
        const { getCachedProducts } = await import("@/lib/db/localDB");
        const cached = await getCachedProducts(storeId);
        if (cached && cached.length > 0) {
          return cached;
        }
      } catch {}
    }
    throw error;
  }
}

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