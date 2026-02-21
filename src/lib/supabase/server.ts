import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient(restaurantId?: string) {
  const cookieStore = await cookies();
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If env vars are not set, return a mock client
  if (!supabaseUrl || supabaseUrl === "your-supabase-project-url" || !supabaseKey) {
    console.warn("Supabase credentials not configured. Using mock client for demo.");
    
    return {
      auth: {
        signInWithPassword: async () => ({ error: new Error("Not configured") }),
        signOut: async () => ({ error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    } as unknown as ReturnType<typeof createServerClient>;
  }

  const options: any = {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  };

  // Pass restaurant_id in header for RLS
  if (restaurantId) {
    options.global = {
      headers: {
        "x-restaurant-id": restaurantId,
      },
    };
  }

  return createServerClient(supabaseUrl, supabaseKey, options);
}

/**
 * Create a Supabase client with service role key (bypasses RLS)
 * Use ONLY for admin operations or when RLS needs to be bypassed
 */
export async function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Service role key not configured");
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore cookie errors in server components
          }
        },
      },
    }
  );
}
