import { createBrowserClient } from "@supabase/ssr";

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

// Mock data for demo mode
const mockTables = [
  { id: "1", name: "Table 1", capacity: 2, shape: "rect" as const, sort_order: 1, restaurant_id: "demo" },
  { id: "2", name: "Table 2", capacity: 4, shape: "rect" as const, sort_order: 2, restaurant_id: "demo" },
  { id: "3", name: "Table 3", capacity: 4, shape: "circle" as const, sort_order: 3, restaurant_id: "demo" },
  { id: "4", name: "Table 4", capacity: 6, shape: "rect" as const, sort_order: 4, restaurant_id: "demo" },
];

export function createClient() {
  // Return cached instance if exists
  if (clientInstance) {
    return clientInstance;
  }

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

  // Create real client
  clientInstance = createBrowserClient(supabaseUrl, supabaseKey);
  return clientInstance;
}
