"use client";

import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, ScanLine, Squirrel } from "lucide-react";
import { cn } from "@/lib/utils";
import CartSheet from "@/components/pos/CartSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useCartStore } from "@/lib/stores/cartStore";
import { useAuth } from "@/lib/auth/AuthContext";
import { Product } from "@/lib/types/product";
import { useToastManager } from "@/hooks/useToastManager";
import { formatLL } from "@/lib/utils/format";
import { warmLocalDB } from "@/lib/pos/saleCompletion";
import dynamic from "next/dynamic";
// Imported from the standalone feedback module, NOT from BarcodeScanner —
// importing it from there would pull ZXing back into this bundle.
import { playSuccessSound, playErrorSound, primeFeedback } from "@/lib/feedback";
import ProductSearchBar from "@/components/ProductSearchBar";
import { SyncIndicator } from "@/components/SyncIndicator";
import { syncEngine } from "@/lib/sync/engine";
import { getCachedProducts, seedProductsIfNeeded } from "@/lib/db";
import type { CachedProduct } from "@/lib/db";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { isDesktop } from "@/lib/device";
import { getFrequentlyUsedProductIds } from "@/lib/frequentlyUsed";
import { connectivity } from "@/lib/connectivity";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import { warmAppShell } from "@/lib/pwa/warmAppShell";
import {
  ensurePersistentStorage,
  hasShownPersistNotice,
  markPersistNoticeShown,
} from "@/lib/pwa/persistentStorage";
import { mapToCachedProduct, cachedToProduct } from "@/lib/products/refresh";
import { isSellable, isIngredient } from "@/lib/products/kind";
import { getCategories, refreshCategories } from "@/lib/categories/load";
import type { Category } from "@/lib/categories/types";
import { getCachedRecipes, refreshRecipes } from "@/lib/recipes/load";
import type { RecipeMap } from "@/lib/recipes/types";
import ProPOSLayout from "@/components/pos/pro/ProPOSLayout";
import MenuBrowser from "@/components/pos/pro/MenuBrowser";
import ModifierSheet from "@/components/pos/pro/ModifierSheet";
import { useMenuSheet } from "@/components/pos/pro/useMenuSheet";

// BarcodeScanner statically imports @zxing/library (~420KB) plus the camera
// pipeline. It is only ever rendered when the scanner is open, so loading it
// on demand keeps that weight off the POS first paint — the busiest screen in
// the app. ssr:false because it touches navigator/getUserMedia on mount.
const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), {
  ssr: false,
  loading: () => (
    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
      Starting camera…
    </div>
  ),
});

// Minimum gap between focus-triggered product refreshes. Each refresh is a
// full sync cycle, so alt-tabbing should not re-pull the catalog every time.
const FOCUS_SYNC_MIN_INTERVAL_MS = 60_000;

export default function POSPage() {
  const router = useRouter();
  const { user, logout: authLogout, isLoading: authLoading } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [isDesktopMode, setIsDesktopMode] = useState(false);
  const [isScannerActive, setIsScannerActive] = useState(() => {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      const saved = localStorage.getItem("scanner_active");
      return saved === null ? true : saved === "true";
    }
    return true;
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recipes, setRecipes] = useState<RecipeMap>({});
  const [isLoading, setIsLoading] = useState(true);
  // Throttles the focus-triggered refresh (see the load effect below)
  const lastFocusSyncRef = useRef(0);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // O(1) barcode lookup — rebuilt whenever products change
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, Product>>(new Map());
  const barcodeIndexRef = useRef<Map<string, Product>>(new Map());
  // Confirm before ending the session — see the header button.
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);

  // The cart check in PWAUpdateListener already covers a sale in progress. What
  // it does not cover is the moment AFTER the cart is cleared but while the
  // completion dialog is still on screen holding the receipt QR, or a confirm
  // dialog awaiting an answer.
  // (isScannerActive is deliberately NOT a hold: it is a persisted preference
  // that defaults to on, so holding on it would defer updates forever.)
  useReloadGuard(isLogoutDialogOpen, "pos-busy");

  // Open the Dexie chunk/connection now rather than at checkout, where it
  // would sit in front of the receipt.
  useEffect(() => {
    warmLocalDB();
  }, []);

  const { toast } = useToastManager({ throttleMs: 1200 });

  // CachedProduct -> Product. Was written out inline twice inside the load
  // effect below; it lives in products/refresh.ts now, next to its inverse.
  const toProducts = useCallback(
    (cached: CachedProduct[]): Product[] => cached.map(cachedToProduct),
    []
  );

  // Narrow selectors rather than `useCartStore()` with no selector. Actions and
  // getters are defined once in the store's create() closure, so their
  // identities are stable — selecting them individually keeps this component's
  // props/deps stable, which is what lets the memoized scanner subtree below
  // avoid re-rendering on every add-to-cart.
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const incrementQuantity = useCartStore((s) => s.incrementQuantity);
  const decrementQuantity = useCartStore((s) => s.decrementQuantity);
  const clearCart = useCartStore((s) => s.clearCart);
  const setStoreId = useCartStore((s) => s.setStoreId);
  const getTotal = useCartStore((s) => s.getTotal);
  const getTotalUsd = useCartStore((s) => s.getTotalUsd);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const isEmpty = useCartStore((s) => s.isEmpty);
  // These three were previously read via useCartStore.getState() DURING RENDER,
  // which does not subscribe — they only appeared to update because `items`
  // triggered the render anyway. Selecting them makes the dependency real.
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount);
  const getRoundingAdjustment = useCartStore((s) => s.getRoundingAdjustment);

  // Unlock audio on the first user interaction. Browsers start an AudioContext
  // "suspended" until a real gesture, so without this the first scan of a
  // session beeps silently.
  useEffect(() => {
    const prime = () => primeFeedback();
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", prime, opts);
    window.addEventListener("keydown", prime, opts);
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // Detect desktop mode for hardware scanner + saved product buttons
  useEffect(() => {
    if (isDesktop() && isEnabled("desktop_shortcuts")) {
      setIsDesktopMode(true);
    }
  }, [isEnabled]);

  // Helper: check if user auth exists in localStorage (works offline)
  function hasAuthInStorage(): boolean {
    try {
      return !!localStorage.getItem("goldensquirrel_user") || 
             !!localStorage.getItem("goldensquirrel_auth");
    } catch { return false; }
  }

  // Redirect to login only if there's truly no auth data in localStorage.
  // Never redirect during the brief mount cycle when user state hasn't resolved yet.
  useEffect(() => {
    if (!user && !authLoading) {
      if (hasAuthInStorage()) return; // Wait for user state to resolve
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  // Load store and products data
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        // Get auth data from localStorage for legacy compatibility
        if (typeof window !== 'undefined' && 'localStorage' in window) {
          const authData = localStorage.getItem("goldensquirrel_auth");
          const licenseExpiresAt = authData ? JSON.parse(authData)?.license_expires_at : null;

          // Check license expiration - only when online, never block offline
          if (licenseExpiresAt && connectivity.isOnline) {
            const licenseExpires = new Date(licenseExpiresAt);
            const now = new Date();
            if (licenseExpires < now) {
              toast.error("Your license has expired. Please contact support.");
              localStorage.removeItem("goldensquirrel_auth");
              authLogout();
              router.push("/login");
              return;
            }
          }

          const store_id = user.storeId;
          setStoreId(store_id);
          syncEngine.setStoreId(store_id);

          // Cache first, then revalidate — the rail and the modifier sheet must
          // be usable on the first frame with no internet, and a failed refresh
          // keeps whatever was cached rather than emptying them.
          setCategories(getCategories(store_id));
          setRecipes(getCachedRecipes(store_id));
          void refreshCategories(store_id).then(setCategories);
          void refreshRecipes(store_id).then(setRecipes);

          // ALWAYS load from local cache first for instant display
          const cached = await getCachedProducts(store_id);
          if (cached && cached.length > 0) {
            if (isMounted) {
              setProducts(toProducts(cached));
              // Drop the loading gate the moment we have something real to
              // show. isLoading previously stayed true until the `finally`
              // below, which is AFTER the network sync — so the whole point of
              // reading IndexedDB first (instant paint) was thrown away and
              // the cashier stared at a full-screen spinner anyway.
              // The background sync still runs and updates the list in place.
              setIsLoading(false);
            }
          }

          // Then sync in background: pull latest products + push queued transactions
          // syncEngine.initialize() handles both pull and push in one sync cycle
          if (connectivity.isOnline) {
            // Initialize/refresh local cache in background (non-blocking)
            // This uses incremental upsert so it's fast even with 2500 items
            // Use startTransition to mark this as non-urgent — React will
            // prioritize user interactions over the state update from sync
            syncEngine.initialize(store_id).then(() => {
              // After sync completes, refresh products from cache in a non-urgent transition
              if (isMounted) {
                startTransition(async () => {
                  const { getCachedProducts } = await import("@/lib/db/localDB");
                  const updated = await getCachedProducts(store_id);
                  if (updated && updated.length > 0) {
                    setProducts(toProducts(updated));
                  }
                });
              }
            }).catch(() => {});
          } else if (!cached || cached.length === 0) {
            // Offline with no cache - seed from static JSON for first-time offline use
            console.log("[POS] Offline with no cached products, seeding from static data...");
            const seeded = await seedProductsIfNeeded(store_id);
            if (seeded > 0 && isMounted) {
              const seededProducts = await getCachedProducts(store_id);
              if (seededProducts && seededProducts.length > 0) {
                setProducts(toProducts(seededProducts));
              }
              toast.success(`Loaded ${seeded} default products (offline mode)`);
            }
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
        // Try local cache as fallback with empty store_id
        try {
          const cached = await getCachedProducts("");
          if (cached && cached.length > 0 && isMounted) {
            setProducts(toProducts(cached));
          }
        } catch {}
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    // Refresh products when window gains focus (only if online).
    // Throttled: a full loadData() means a complete sync cycle (product pull +
    // queue flush). Alt-tabbing repeatedly should not re-pull the catalog each
    // time, so we only refresh if the cache is actually stale.
    const handleFocus = () => {
      if (!user?.storeId || !connectivity.isOnline) return;
      if (Date.now() - lastFocusSyncRef.current < FOCUS_SYNC_MIN_INTERVAL_MS) return;
      lastFocusSyncRef.current = Date.now();
      loadData();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleFocus);
    };
    // NOTE: `merchant?.id` must NOT be in these deps. setMerchant() is called
    // inside this effect, so including it made the effect re-fire and run a
    // full loadData() (and therefore a full sync) twice on every mount.
    // The store id is read from `user.storeId` directly instead.
  }, [router, setStoreId, user, authLogout, toast, toProducts]);

  // ---- Build O(1) barcode index whenever products change ----
  useEffect(() => {
    const index = new Map<string, Product>();
    const idIndex = new Map<string, Product>();
    for (const p of products) {
      if (p.barcode) {
        index.set(p.barcode, p);
      }
      idIndex.set(p.id, p);
    }
    setBarcodeIndex(index);
    barcodeIndexRef.current = idIndex;
  }, [products]);

  // Add a product to the cart (used by both barcode scan and saved product buttons)
  const handleProductAdd = useCallback((product: Product) => {
    // An ingredient is not a thing a customer buys. Refuse clearly rather than
    // silently doing nothing, and name it so the cashier knows why — this is
    // reachable by scanning, because the barcode index is deliberately complete.
    if (isIngredient(product)) {
      toast.error(`${product.name} is an ingredient — it isn't sold on its own`);
      playErrorSound();
      return;
    }

    let resolvedProduct = {...product};

    // If this is a variant child product, inherit values from parent (O(1) lookup)
    if (product.parent_id) {
      const parent = barcodeIndexRef.current.get(product.parent_id);
      if (parent) {
        resolvedProduct = {
          ...resolvedProduct,
          name: product.variant_name ? `${parent.name} - ${product.variant_name}` : parent.name,
          cost_price: parent.cost_price,
          selling_price: parent.selling_price,
          profit_percentage: parent.profit_percentage,
          currency: parent.currency,
        };
      }
    }

    // If product discount feature is disabled, force discount to 0
    if (!isEnabled("product_discount")) {
      resolvedProduct = {
        ...resolvedProduct,
        discount_percentage: 0,
      };
    }

    // Read the cart imperatively rather than closing over `items`.
    // This is an event handler, not render, so getState() is the correct
    // Zustand usage — and it keeps `items` out of this callback's deps, so the
    // callback identity stays stable across cart changes. That matters because
    // this function is the `onScan` prop of the memoized scanner: rebuilding it
    // on every add re-rendered the live camera subtree mid-scan.
    //
    // Matches on product_id, NOT lineKey(), and that is correct: this path only
    // ever handles a plain scanned/tapped product, whose lineKey IS its
    // product_id. A configured (made-to-order) line never arrives here — it is
    // built through addConfiguredItem, which deliberately never dedupes, so two
    // sandwiches with different modifiers stay two lines.
    const existingItem = useCartStore
      .getState()
      .items.find((item) => item.product_id === product.id);

    if (existingItem) {
      // Desktop mode: increment quantity on repeat scan (hardware scanner = intentional)
      // Mobile mode: show "already in cart" (camera can fire false duplicates)
      if (isDesktopMode) {
        incrementQuantity(product.id);
        playSuccessSound();
        toast.success(`${resolvedProduct.name} qty increased to ${existingItem.quantity + 1}`, { key: "cart-add" });
      } else {
        setHighlightedItemId(product.id);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightedItemId(null), 800);
        toast.info(`${resolvedProduct.name} is already in cart`, { key: "cart-duplicate" });
        setTimeout(() => {
          const el = document.getElementById(`cart-item-${product.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    } else {
      const added = addItem(resolvedProduct);
      if (added) {
        playSuccessSound();
        toast.success(`Added ${resolvedProduct.name}`, { key: "cart-add" });
      } else {
        setHighlightedItemId(product.id);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightedItemId(null), 2000);
        toast.info(`${resolvedProduct.name} is already in cart`, { key: "cart-duplicate" });
        setTimeout(() => {
          const el = document.getElementById(`cart-item-${product.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    }
    // `items` is deliberately NOT a dependency — it is read via getState()
    // above so this callback stays referentially stable.
  }, [addItem, incrementQuantity, isEnabled, isDesktopMode, toast]);

  const sellableProducts = useMemo(() => products.filter(isSellable), [products]);

  /**
   * Every ingredient in inventory, so ANY of them can be added to ANY line —
   * hummus does not have to be in the taouk sandwich's recipe to go on it.
   * Variants are excluded: a variant is a way of selling a product, not a
   * thing you put inside one.
   */
  const ingredientProducts = useMemo(
    () => products.filter((p) => isIngredient(p) && !p.parent_id),
    [products]
  );

  /**
   * The mobile till's modifier sheet. Same hook the desktop layout uses, so the
   * "recipe -> open the sheet, otherwise add straight to the cart" rule has one
   * implementation rather than one per layout.
   */
  const {
    setConfiguring: setMobileConfiguring,
    handleTileAdd,
    handleEditModifiers: handleMobileEditModifiers,
    handleConfirm: handleMobileConfirm,
    sheetProps: mobileSheetProps,
  } = useMenuSheet({
    recipes,
    products: sellableProducts,
    enabled: isEnabled("menu_items"),
    onPlainAdd: handleProductAdd,
  });

  // Resolve a scanned code to a product: the O(1) local index first, then a
  // live Supabase lookup for something that exists server-side but has not
  // reached this device's cache yet.
  //
  // Returns null for a genuine miss and says nothing about it. Reporting is
  // the caller's job, because the two callers want opposite things: the
  // desktop till turns a miss into the "name this barcode" prompt, while the
  // mobile camera just beeps — a camera fires misreads, and a prompt on every
  // one of them would be unusable.
  //
  // MUST stay referentially stable: it feeds the memoized scanner's onScan, so
  // a new identity on every render would restart the camera mid-scan.
  // `barcodeIndex` is the only value here that legitimately changes, and only
  // when the catalogue does.
  const resolveBarcode = useCallback(
    async (barcode: string): Promise<Product | null> => {
      const trimmed = barcode.trim();
      if (!trimmed) return null;

      const local = barcodeIndex.get(trimmed);
      if (local) return local;

      if (!connectivity.isOnline) return null;

      const storeId = user?.storeId;
      if (!storeId) return null;

      try {
        // A fresh client so the lookup carries the current store header.
        const liveClient = createClient();
        const { data, error } = await liveClient
          .from("products")
          .select("*")
          .eq("barcode", trimmed)
          .eq("store_id", storeId)
          .single();

        if (error || !data) return null;

        const cached = mapToCachedProduct(data);
        const mapped = cachedToProduct(cached);

        // Merge into local state so the next scan of this code is instant.
        setProducts((prev) => {
          if (prev.some((p) => p.id === mapped.id)) return prev;
          return [...prev, mapped];
        });

        // And warm IndexedDB so the cache is never stale on it again. Single
        // upsert, not a cache clear.
        try {
          const { upsertSingleProduct } = await import("@/lib/db/localDB");
          await upsertSingleProduct(cached);
        } catch (e) {
          console.warn("[POS Scan] upsert single product failed:", e);
        }

        return mapped;
      } catch (err) {
        console.error("[POS Scan] fallback error:", err);
        return null;
      }
    },
    [barcodeIndex, user?.storeId]
  );

  // Camera scan (mobile). A miss is reported and dropped — see resolveBarcode.
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      if (!barcode.trim()) {
        toast.error("Empty barcode", { key: "scan-miss" });
        return;
      }

      // The local index answers instantly; only the server fallback is slow
      // enough to need saying something about, and it only runs when the code
      // is not in the cache. Without this the camera looks like it froze.
      const needsServerLookup =
        connectivity.isOnline && !barcodeIndex.has(barcode.trim());
      if (needsServerLookup) toast.loading("Verifying barcode...", { key: "scan-fallback" });

      const product = await resolveBarcode(barcode);
      if (needsServerLookup) toast.dismiss("scan-fallback");

      if (product) {
        // handleTileAdd, not handleProductAdd: a scanned item WITH a recipe
        // must still open the modifier sheet, or it sells as a plain line and
        // decrements the menu item instead of its ingredients.
        handleTileAdd(product);
        return;
      }

      playErrorSound();
      toast.error(
        connectivity.isOnline ? "Product not found" : "Product not found in local data",
        { key: "scan-miss" }
      );
    },
    [resolveBarcode, handleTileAdd, toast, barcodeIndex]
  );

  // A product created or repriced from the desktop till. Folding it into
  // `products` here is what makes the next scan, the search list and the quick
  // grid agree with what was just saved.
  const handleProductUpserted = useCallback((product: Product) => {
    setProducts((prev) => {
      const index = prev.findIndex((p) => p.id === product.id);
      if (index === -1) return [...prev, product];
      const next = prev.slice();
      next[index] = product;
      return next;
    });
  }, []);

  // useCallback so the keydown effect below doesn't tear down and re-register
  // its listener on every render (this was a plain function in a dep array).
  const toggleScanner = useCallback(() => {
    setIsScannerActive((prev) => {
      const newState = !prev;
      if (typeof window !== 'undefined' && 'localStorage' in window) {
        localStorage.setItem("scanner_active", String(newState));
      }
      return newState;
    });
    // NOTE: this used to call window.location.reload() when switching the
    // scanner off on iOS/Android, to force the browser to release the camera.
    // A full page reload mid-shift is the least app-like thing the POS did —
    // white flash, lost component state, re-run of the whole boot sequence.
    // The scanner is now UNMOUNTED when off instead, which runs its
    // stopEverything() cleanup (stops every MediaStream track, resets ZXing,
    // tears down Quagga) and removes the <video> element. That is what
    // actually frees the camera. See the render site below.
  }, []);

  // Handle logout - clear both auth keys
  const handleLogout = () => {
    authLogout();
    router.push("/login");
  };

  // ---- Shortcuts ----
  //
  // Only F3 lives here now, and only for the mobile camera layout, where it
  // toggles the scanner. Everything the desktop till uses — F1 to focus the
  // scan field, F4 to check out, ALT+1..9 to change lane — targets something
  // ProPOSLayout renders, so it is registered there instead of reaching across
  // two layouts from here.
  //
  // e.repeat guards against a leaned-on key firing the toggle repeatedly.
  useEffect(() => {
    if (isDesktopMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isLogoutDialogOpen) return; // the modal owns the keyboard
      if (e.key === "F3") {
        e.preventDefault();
        toggleScanner();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktopMode, toggleScanner, isLogoutDialogOpen]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // Prefetch critical routes while online so they are available offline.
  //
  // router.prefetch covers the client-side RSC payloads; warmAppShell covers
  // the HTML documents, which is what a COLD launch with no internet needs.
  // The three HEAD requests that used to sit here never did anything: Workbox
  // registers every route for "GET", so a HEAD was not intercepted, and a HEAD
  // response has no body to serve a navigation from anyway.
  useEffect(() => {
    if (connectivity.isOnline && user) {
      router.prefetch("/checkout");
      router.prefetch("/pos/products");
      router.prefetch("/transactions");
      void warmAppShell();
    }
  }, [router, user]);

  // Ask the browser to stop treating our storage as disposable.
  //
  // offline_queue holds sales whose money is already in the drawer. Without a
  // persistence grant those rows are evictable — iOS clears script-writable
  // storage after 7 days idle, and Chrome evicts whole origins under pressure.
  // Neither browser prompts for this; a denial means the app is running in a
  // plain tab rather than installed, which is worth saying once.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void (async () => {
      const { persisted, supported } = await ensurePersistentStorage();
      if (cancelled || !supported || persisted) return;
      if (hasShownPersistNotice()) return;

      markPersistNoticeShown();
      toast.warning("Install the app to protect offline sales", {
        description:
          "In a browser tab, the device can clear unsynced sales during a long outage. Installing Golden Squirrel keeps them safe.",
        duration: 12000,
      });
    })();

    return () => {
      cancelled = true;
    };
    // `toast` is a stable module import from sonner — listed only to satisfy
    // exhaustive-deps; its identity never changes, so it cannot re-run this.
  }, [user, toast]);

  // Compute saved products for desktop mode (products without barcodes + frequently used)
  // Must be before any early returns to maintain hooks order
  /**
   * What the till may sell. Ingredients are stock consumed BY menu items, so
   * they must not appear in search or on the quick grid.
   *
   * `barcodeIndex` is deliberately NOT filtered — see handleProductAdd. A
   * scanned ingredient IS in the catalogue, and letting it fall through to the
   * unknown-barcode prompt would read as a broken scanner.
   */
  /**
   * Ingredient names for the modifier sheet. Built from the FULL catalogue,
   * not from sellableProducts — the ingredients are exactly the rows that list
   * excludes, and a sheet that cannot name them is useless.
   */
  /**
   * Menu mode: the mobile till browses a menu instead of pointing a camera.
   * A rail with no categories behind it is worse than the camera it replaces,
   * hence the length check as well as the flag — same rule as ProPOSLayout.
   */
  const menuMode = isEnabled("product_categories") && categories.length > 0;

  const ingredientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) map.set(product.id, product.name);
    return map;
  }, [products]);

  const savedProducts = useMemo(() => {
    if (!user?.storeId) return [];
    const noBarcodeProducts = sellableProducts.filter(p => !p.barcode);
    const frequentlyUsedIds = getFrequentlyUsedProductIds(user.storeId);
    const frequentlyUsedProducts = frequentlyUsedIds
      .map(id => sellableProducts.find(p => p.id === id))
      .filter(Boolean) as Product[];
    // Combine, deduplicating by ID
    const combined = [...noBarcodeProducts, ...frequentlyUsedProducts];
    const seen = new Set<string>();
    return combined.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [sellableProducts, user?.storeId]);

  // ---- Layout measurements for the scan-first mobile layout ----
  //
  // The cart sheet needs to know how much room it is allowed to take, and the
  // floating search bar sits between the camera and the sheet. Both are
  // measured rather than assumed: the POS surface is the viewport minus the
  // tab bar minus the iOS safe areas, and none of those are knowable
  // statically. Callback refs (not useRef + useEffect) because the elements
  // mount after the loading gate below, which a mount-time effect would miss.
  const [posHeight, setPosHeight] = useState(0);
  const [searchBlockHeight, setSearchBlockHeight] = useState(76);

  const posObserverRef = useRef<ResizeObserver | null>(null);
  const searchObserverRef = useRef<ResizeObserver | null>(null);

  const posSurfaceRef = useCallback((el: HTMLDivElement | null) => {
    posObserverRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setPosHeight(el.clientHeight));
    ro.observe(el);
    posObserverRef.current = ro;
    setPosHeight(el.clientHeight);
  }, []);

  const searchBlockRef = useCallback((el: HTMLDivElement | null) => {
    searchObserverRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setSearchBlockHeight(el.offsetHeight));
    ro.observe(el);
    searchObserverRef.current = ro;
    setSearchBlockHeight(el.offsetHeight);
  }, []);

  useEffect(
    () => () => {
      posObserverRef.current?.disconnect();
      searchObserverRef.current?.disconnect();
    },
    []
  );

  // Clearing the cart is destructive and one tap away, so it keeps its confirm.
  const handleClearCart = () => {
    if (window.confirm("Clear all items from the cart?")) {
      clearCart();
      toast.success("Cart cleared");
    }
  };

  // `!user` matters as much as the loading flags: once authLoading flips false
  // with no user, the redirect to /login is only *scheduled* — an effect that
  // runs after this render. Without this the till rendered in the meantime,
  // which mounted the camera scanner and asked a signed-out stranger for
  // camera permission on their way to the login screen.
  if (isLoading || authLoading || !user) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  // Shared by both layouts. Held as JSX rather than an inner component so it is
  // not a fresh component type on every render — that would remount the dialog
  // (and drop its open/close animation) on every cart change.
  const dialogs = (
    <>
      {/* ---- Confirm sign out ---- */}
      <ConfirmDialog
        open={isLogoutDialogOpen}
        onOpenChange={setIsLogoutDialogOpen}
        title="Log out?"
        description="You'll need your username and password to get back in."
        // An open cart is the reason this needs a confirm at all — it survives
        // the logout, but the cashier should know that before they hand the
        // till over.
        details={
          !isEmpty() ? (
            <div className="rounded-2xl bg-muted/50 px-4 py-3">
              <p className="font-semibold">
                {getItemCount()} item{getItemCount() !== 1 ? "s" : ""} still in the cart
              </p>
              <p className="mt-0.5 text-muted-foreground tnum">
                {formatLL(getTotal())} — kept on this device and still here after you
                log back in.
              </p>
            </div>
          ) : null
        }
        cancelLabel="Stay"
        confirmLabel="Log out"
        confirmIcon={<LogOut className="h-4 w-4" />}
        onConfirm={() => {
          setIsLogoutDialogOpen(false);
          handleLogout();
        }}
      />

      {/* Mobile only: the desktop layout mounts its own via ProPOSLayout. */}
      {!isDesktopMode && (
        <ModifierSheet
          {...mobileSheetProps}
          onOpenChange={(open) => {
            if (!open) setMobileConfiguring(null);
          }}
          ingredientNames={ingredientNames}
          ingredients={ingredientProducts}
          onConfirm={handleMobileConfirm}
        />
      )}
    </>
  );

  // ===================== MOBILE: SCAN-FIRST =====================
  // The camera is the page. Everything else floats over it: a header chip, a
  // search pill, and the draggable cart sheet. Nothing is stacked in flow, so
  // dragging the sheet never re-lays-out the live video behind it.
  if (!isDesktopMode) {
    return (
      <div ref={posSurfaceRef} className="relative h-full w-full overflow-hidden bg-black">
        {/* ---- Camera layer, or the menu ---- */}
        {/*
          A snack shop has no barcodes, so a camera is the wrong page for it:
          the menu takes the camera's place and everything floating over it —
          header, search pill, cart sheet — is untouched.

          Note BarcodeScanner is NOT MOUNTED in menu mode, so ZXing's ~420KB
          dynamic chunk is never fetched for these stores. That is a real bundle
          win, not just a layout change.

          The scanner switch stays in the header, so the odd barcoded bottle can
          still be scanned by turning it on.
        */}
        <div className="absolute inset-0">
          {menuMode && !isScannerActive ? (
            <div className="absolute inset-0 bg-background pb-[var(--pos-sheet-peek,0px)]">
              <MenuBrowser
                products={sellableProducts}
                categories={categories}
                onAdd={handleTileAdd}
              />
            </div>
          ) : isScannerActive ? (
            /* Unmounted (not merely deactivated) when off. Unmount runs the
               scanner's stopEverything() cleanup — stop all MediaStream
               tracks, reset ZXing, tear down Quagga — and removes the <video>
               element from the DOM entirely. That is what actually releases
               the camera. */
            <BarcodeScanner
              onScan={handleBarcodeScan}
              isActive={true}
              desktopMode={false}
              showManualInput={false}
              fullBleed
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 px-8 text-center">
              <ScanLine className="h-9 w-9 text-zinc-700" />
              <p className="mt-3 text-sm font-semibold text-zinc-400">Scanner is off</p>
              <p className="mt-1 text-xs text-zinc-600">
                The camera is released. Search or type a barcode below to keep selling.
              </p>
              {/* Same wording as the header switch, so the two controls read as
                  the one setting they are. */}
              <button
                type="button"
                onClick={toggleScanner}
                className="tap mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
              >
                Turn scanner on
              </button>
            </div>
          )}

          {/* Keeps the header chips readable when the camera is pointed at a
              bright shelf. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />
        </div>

        {/* ---- Floating header ---- */}
        {/* safe-top clears the iOS status bar / notch, which the page paints
            under because appleWebApp.statusBarStyle is 'black-translucent'. */}
        <header className="safe-top absolute inset-x-0 top-0 z-20 px-4 pt-3">
          <div className="flex items-center gap-2">
            {/* Brand chip. min-w-0 + truncate so it yields space to the
                controls on a narrow handset rather than pushing them off. */}
            <div className="glass flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 ring-1 ring-white/10">
              {/* Same mark as the desktop header — one identity across both
                  layouts instead of a letter here and a logo there. */}
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary">
                <Squirrel className="h-4 w-4 text-primary-foreground" />
              </span>
              {/* Decorative, so it is the first thing to go: below ~390px the
                  wordmark would truncate to "GoldenSqui…" to make room for the
                  scanner switch. The avatar and the connectivity dot beside it
                  are the functional parts and always stay. */}
              <span className="hidden truncate text-sm font-bold leading-none min-[390px]:inline">
                GoldenSquirrel
              </span>
              <SyncIndicator dot />
            </div>

            <div className="ml-auto flex flex-none items-center gap-2">
              {/* ---- Scanner switch ----
                  Was a bare icon button whose state you had to infer from its
                  tint. It is a real switch now: a written label, a track the
                  knob visibly slides along, and role="switch" so assistive
                  tech reads the on/off state instead of guessing. */}
              <button
                type="button"
                role="switch"
                aria-checked={isScannerActive}
                aria-label="Barcode scanner"
                onClick={toggleScanner}
                className={cn(
                  "tap glass flex h-11 items-center gap-2 rounded-full pl-3 pr-1.5 ring-1 transition-colors",
                  isScannerActive
                    ? "text-primary ring-primary/40"
                    : "text-muted-foreground ring-white/10"
                )}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.1em]">
                  Scanner
                </span>
                {/* Track 38x22, knob 16 — 3px of inset all round.
                    The knob's offsets are explicit rather than left to static
                    positioning, and the movement is an INLINE transform on
                    purpose: Tailwind v4 compiles translate-x-* to the CSS
                    `translate` property, which `transition-transform` does not
                    animate, so the class-based version jumped instead of
                    sliding and depended on a static position that put it on
                    the wrong side. */}
                <span
                  aria-hidden
                  className={cn(
                    "relative block h-[22px] w-[38px] flex-none rounded-full transition-colors duration-200",
                    isScannerActive ? "bg-primary" : "bg-white/20"
                  )}
                >
                  <span
                    className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{ transform: `translateX(${isScannerActive ? 16 : 0}px)` }}
                  />
                </span>
              </button>

              {/* Signing out mid-shift loses the till to whoever knows the
                  next password — it gets a confirm, and the universally
                  understood door icon rather than a power symbol that reads
                  as "turn the device off". */}
              <button
                type="button"
                onClick={() => setIsLogoutDialogOpen(true)}
                aria-label="Log out"
                className="tap glass flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {/* ---- Search pill + cart sheet ---- */}
        <div className="absolute inset-x-0 bottom-0 z-20">
          <div ref={searchBlockRef} className="px-4 pb-3">
            <ProductSearchBar
              products={sellableProducts}
              onSelect={handleTileAdd}
              placeholder="Search or type a barcode"
              dropUp
              inputClassName="glass h-[52px] rounded-2xl border-white/10 text-[15px]"
            />
          </div>

          <CartSheet
            items={items}
            itemCount={getItemCount()}
            total={getTotal()}
            totalUsd={getTotalUsd()}
            totalDiscount={getTotalDiscount()}
            roundingAdjustment={getRoundingAdjustment()}
            availableHeight={Math.max(0, posHeight - searchBlockHeight)}
            highlightedItemId={highlightedItemId}
            onIncrement={incrementQuantity}
            onDecrement={decrementQuantity}
            // Presence of this prop is the menu-mode signal inside the sheet.
            onEditModifiers={
              isEnabled("menu_items") ? handleMobileEditModifiers : undefined
            }
            onClear={handleClearCart}
            onCheckout={() => router.push("/checkout")}
          />
        </div>

        {dialogs}
      </div>
    );
  }

  // ===================== DESKTOP: PRO TILL =====================
  // A wide screen, a keyboard, a wedge scanner and often a touchscreen. The
  // layout lives in ProPOSLayout; this page stays responsible for the data —
  // loading the catalogue, keeping the barcode index, and driving sync.
  //
  // No page header here on purpose. Brand, section nav, connection state and
  // sign-out are global and live in DesktopNav, rendered by AppShell. A second
  // bar repeating them costs ~64px, which a 1366x768 till cannot spare.
  return (
    <>
      <ProPOSLayout
        products={sellableProducts}
        savedProducts={savedProducts}
        categories={categories}
        recipes={recipes}
        ingredientNames={ingredientNames}
        ingredients={ingredientProducts}
        storeId={user?.storeId || ""}
        onProductAdd={handleProductAdd}
        resolveBarcode={resolveBarcode}
        onProductUpserted={handleProductUpserted}
        highlightedItemId={highlightedItemId}
        onCheckout={() => router.push("/checkout")}
      />
      {dialogs}
    </>
  );
}
