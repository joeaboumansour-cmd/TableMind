// ===
// Preload products into IndexedDB cache right after login.
// This ensures that when the user navigates to POS or Inventory,
// the products are already cached and ready for instant display.
// ===

import { useEffect } from "react";
import { createClient, fetchAllProducts } from "@/lib/supabase/client";
import { getCachedProductsCount } from "@/lib/db/localDB";
import { syncEngine } from "@/lib/sync/engine";

/**
 * Preload products into the local cache as soon as the user logs in.
 * Call this hook once in the layout or login callback.
 * 
 * @param storeId - The store ID to preload products for
 * @param user - The authenticated user object (or null)
 */
export function usePreloadProducts(storeId: string | null | undefined) {
  useEffect(() => {
    if (!storeId || typeof window === "undefined") return;

    let cancelled = false;

    const preload = async () => {
      // Check if we already have cached products
      const count = await getCachedProductsCount();
      if (count > 0) {
        console.log(`[Preload] Cache already has ${count} products, skipping preload`);
        return;
      }

      // Only preload if online
      if (!navigator.onLine) {
        console.log("[Preload] Offline, skipping preload");
        return;
      }

      console.log("[Preload] Starting background product preload...");
      
      try {
        // Set the store ID on the sync engine so it can be used later
        syncEngine.setStoreId(storeId);
        
        // Use syncEngine.initialize() which handles incremental pull + push
        // This is non-blocking and runs in the background
        await syncEngine.initialize(storeId);
        
        if (!cancelled) {
          console.log("[Preload] Background preload complete");
        }
      } catch (error) {
        console.warn("[Preload] Background preload failed:", error);
        // Non-critical — the POS page will load from cache or seed data
      }
    };

    // Use setTimeout to defer preload until after the main render cycle
    const timerId = setTimeout(preload, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [storeId]);
}