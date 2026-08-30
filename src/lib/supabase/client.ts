import { createBrowserClient } from "@supabase/ssr";

// Mock data for demo mode
const mockTables = [
  { id: "1", name: "Table 1", capacity: 2, shape: "rect" as const, sort_order: 1, restaurant_id: "demo" },
  { id: "2", name: "Table 2", capacity: 4, shape: "rect" as const, sort_order: 2, restaurant_id: "demo" },
  { id: "3", name: "Table 3", capacity: 4, shape: "circle" as const, sort_order: 3, restaurant_id: "demo" },
  { id: "4", name: "Table 4", capacity: 6, shape: "rect" as const, sort_order: 4, restaurant_id: "demo" },
];

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

  // No `global.fetch` wrapper, and no options object at all.
  //
  // There used to be one here whose entire job was to read `tablemind_auth`
  // out of localStorage and JSON.parse it on EVERY Supabase request, to set an
  // `x-restaurant-id` header. That header is dead TableMind scaffolding: the
  // tenancy column is `store_id`, nothing on the server reads the header, and
  // no RLS policy references it — so every product pull, favourite write and
  // login paid a synchronous storage read plus a Headers allocation for
  // nothing. (The key it read, `tablemind_auth`, has never been written by
  // this app.)
  //
  // Dropping it also lets @supabase/ssr do what it already wanted to. Despite
  // the old "ALWAYS create a fresh client - no caching!" comment,
  // createBrowserClient has ALWAYS returned a cached singleton in the browser
  // unless `isSingleton` is set explicitly — the comment was simply wrong. One
  // client is also the correct answer here: tenancy comes from the `x-auth-data`
  // header the API routes read, never from client identity.
  return createBrowserClient(supabaseUrl, supabaseKey);
}