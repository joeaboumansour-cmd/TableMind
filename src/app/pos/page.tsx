"use client";

import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient, fetchAllProducts } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingCart,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Package,
  LogOut,
  Scan,
  X,
  Squirrel,
  History,
  Menu,
  Trash2,
  Check,
  Loader2,
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { useAuth } from "@/lib/auth/AuthContext";
import { Product } from "@/lib/types/product";
import { toast } from "sonner";
import { formatCurrency, formatLL, convertUsdToLl, formatUSD, convertLlToUsd, convertLlToUsdForSale, convertLlToUsdForReturn, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";
import BarcodeScanner, { playSuccessSound } from "@/components/BarcodeScanner";
import ProductSearchBar from "@/components/ProductSearchBar";
import { SyncIndicator } from "@/components/SyncIndicator";
import { syncEngine } from "@/lib/sync/engine";
import {
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductsCount,
  seedProductsIfNeeded,
  queueStockDecrementsForTransaction,
} from "@/lib/db";
import type { CachedProduct } from "@/lib/db";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { usePreloadProducts } from "@/hooks/usePreloadProducts";
import { isDesktop, isIOS, isAndroid } from "@/lib/device";
import { getFrequentlyUsedProductIds, addFrequentlyUsedProduct, removeFrequentlyUsedProduct, isFrequentlyUsed } from "@/lib/frequentlyUsed";

const supabase = createClient();

export default function POSPage() {
  const router = useRouter();
  const { user, logout: authLogout, canAccess, isLoading: authLoading } = useAuth();
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
  const [isLoading, setIsLoading] = useState(true);
  const [merchant, setMerchant] = useState<any>(null);
  const [isCharge, setIsCharge] = useState(true); // true = charge (green), false = credit (red)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // O(1) barcode lookup — rebuilt whenever products change
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, Product>>(new Map());
  const barcodeIndexRef = useRef<Map<string, Product>>(new Map());
  // Check user permissions for History button
  const [canViewTransactions, setCanViewTransactions] = useState(false);
  // Quick end transaction state
  const [isQuickEndDialogOpen, setIsQuickEndDialogOpen] = useState(false);
  const [isQuickEndProcessing, setIsQuickEndProcessing] = useState(false);

  const {
    items,
    addItem,
    incrementQuantity,
    decrementQuantity,
    clearCart,
    setStoreId,
    getSubtotal,
    getSubtotalUsd,
    getTotal,
    getTotalUsd,
    getItemCount,
    isEmpty,
  } = useCartStore();

  // Check user permissions on mount
  useEffect(() => {
    if (user) {
      setCanViewTransactions(canAccess("transactions"));
    }
  }, [user, canAccess]);

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
          if (licenseExpiresAt && navigator.onLine) {
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
          setMerchant({ id: store_id });
          setStoreId(store_id);
          syncEngine.setStoreId(store_id);

          // Helper to map cached products to Product type
          const mapCachedToProducts = (cached: CachedProduct[]): Product[] =>
            cached.map((p) => ({
              id: p.id,
              store_id: p.store_id,
              name: p.name,
              barcode: p.barcode,
              cost_price: p.cost_price,
              selling_price: p.selling_price,
              currency: (p.currency === "USD" ? "USD" : "LL") as "LL" | "USD",
              profit_percentage: p.profit_percentage,
              discount_percentage: p.discount_percentage || 0,
              stock_quantity: p.stock_quantity,
              min_stock_threshold: p.min_stock_threshold,
              parent_id: p.parent_id || undefined,
              variant_name: p.variant_name || undefined,
            }));

          // ALWAYS load from local cache first for instant display
          const cached = await getCachedProducts(store_id);
          if (cached && cached.length > 0) {
            if (isMounted) {
              setProducts(mapCachedToProducts(cached));
            }
          }

          // Then sync in background: pull latest products + push queued transactions
          // syncEngine.initialize() handles both pull and push in one sync cycle
          if (navigator.onLine) {
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
                    setProducts(mapCachedToProducts(updated));
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
                setProducts(mapCachedToProducts(seededProducts));
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
          const mapCachedToProducts = (cached: CachedProduct[]): Product[] =>
            cached.map((p) => ({
              id: p.id,
              store_id: p.store_id,
              name: p.name,
              barcode: p.barcode,
              cost_price: p.cost_price,
              selling_price: p.selling_price,
              currency: (p.currency === "USD" ? "USD" : "LL") as "LL" | "USD",
              profit_percentage: p.profit_percentage,
              discount_percentage: p.discount_percentage || 0,
              stock_quantity: p.stock_quantity,
              min_stock_threshold: p.min_stock_threshold,
              parent_id: p.parent_id || undefined,
              variant_name: p.variant_name || undefined,
            }));
          if (cached && cached.length > 0 && isMounted) {
            setProducts(mapCachedToProducts(cached));
          }
        } catch {}
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    // Refresh products when window gains focus (only if online)
    const handleFocus = () => {
      if (merchant?.id && navigator.onLine) {
        loadData();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [router, setStoreId, merchant?.id, user, authLogout]);

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

    // Check if item already exists in cart
    const existingItem = items.find(item => item.product_id === product.id);

    if (existingItem) {
      // Desktop mode: increment quantity on repeat scan (hardware scanner = intentional)
      // Mobile mode: show "already in cart" (camera can fire false duplicates)
      if (isDesktopMode) {
        incrementQuantity(product.id);
        playSuccessSound();
        toast.success(`${resolvedProduct.name} qty increased to ${existingItem.quantity + 1}`);
      } else {
        setHighlightedItemId(product.id);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightedItemId(null), 800);
        toast.info(`${resolvedProduct.name} is already in cart`);
        setTimeout(() => {
          const el = document.getElementById(`cart-item-${product.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    } else {
      const added = addItem(resolvedProduct);
      if (added) {
        playSuccessSound();
        toast.success(`Added ${resolvedProduct.name}`);
      } else {
        setHighlightedItemId(product.id);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = setTimeout(() => setHighlightedItemId(null), 2000);
        toast.info(`${resolvedProduct.name} is already in cart`);
        setTimeout(() => {
          const el = document.getElementById(`cart-item-${product.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    }
  }, [items, addItem, incrementQuantity, isEnabled, isDesktopMode]);

  // Handle barcode scan from camera — O(1) local first, then live Supabase fallback to guarantee zero misses
  const handleBarcodeScan = async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) {
      toast.error("Empty barcode");
      return;
    }

    // 1. Try local O(1) index
    const product = barcodeIndex.get(trimmed);
    if (product) {
      handleProductAdd(product);
      return;
    }

    // 2. Fallback: query Supabase directly if online — this fixes scan misses for products
    //    that exist server-side but aren't in the local cache/state yet
    if (!navigator.onLine) {
      toast.error("Product not found in local data");
      return;
    }

    const storeId = user?.storeId;
    if (!storeId) {
      toast.error("No store selected");
      return;
    }

    try {
      toast.loading("Verifying barcode...", { id: "scan-fallback" });

      // Use a fresh client to ensure latest restaurant header
      const liveClient = createClient();
      const { data, error } = await liveClient
        .from("products")
        .select("*")
        .eq("barcode", trimmed)
        .eq("store_id", storeId)
        .single();

      if (error || !data) {
        toast.dismiss("scan-fallback");
        toast.error("Product not found");
        return;
      }

      // -- Merge the live product into local state so it's available for future scans --
      const mapped: Product = {
        id: data.id,
        store_id: data.store_id,
        name: data.name,
        barcode: data.barcode,
        cost_price: data.cost_price,
        selling_price: data.selling_price,
        currency: (data.currency === "USD" ? "USD" : "LL") as "LL" | "USD",
        profit_percentage: data.profit_percentage,
        discount_percentage: data.discount_percentage || 0,
        stock_quantity: data.stock_quantity,
        min_stock_threshold: data.min_stock_threshold,
        parent_id: data.parent_id || undefined,
        variant_name: data.variant_name || undefined,
      };

      // Add to local products state (reacts no-op if already there)
      setProducts((prev) => {
        if (prev.some((p) => p.id === mapped.id)) return prev;
        return [...prev, mapped];
      });

      // Also warm IndexedDB so the cache is never stale again
      // Uses upsertSingleProduct to avoid clearing the entire cache
      try {
        const { upsertSingleProduct } = await import("@/lib/db/localDB");
        await upsertSingleProduct({
          id: mapped.id,
          store_id: mapped.store_id,
          name: mapped.name,
          barcode: mapped.barcode,
          cost_price: mapped.cost_price,
          selling_price: mapped.selling_price,
          currency: mapped.currency,
          profit_percentage: mapped.profit_percentage,
          discount_percentage: mapped.discount_percentage,
          stock_quantity: mapped.stock_quantity,
          min_stock_threshold: mapped.min_stock_threshold,
          parent_id: mapped.parent_id || null,
          variant_name: mapped.variant_name || null,
          updated_at: new Date().toISOString(),
        } as any);
      } catch (e) {
        console.warn("[POS Scan] upsert single product failed:", e);
      }

      toast.dismiss("scan-fallback");
      toast.success("Found via server — added to cart");

      // 3. Add to cart
      handleProductAdd(mapped);
    } catch (err) {
      console.error("[POS Scan] fallback error:", err);
      toast.dismiss("scan-fallback");
      toast.error("Product not found");
    }
  };

  const toggleScanner = () => {
    const newState = !isScannerActive;
    setIsScannerActive(newState);
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      localStorage.setItem("scanner_active", String(newState));
    }
    // Mobile (iOS WKWebView/PWA + Android Chrome): the browser may keep the camera
    // hardware active even after the preview disappears,
    // causing battery drain + heat. A page refresh is the only reliable way to
    // force mobile browsers to release the camera. Only refresh when TURNING OFF.
    if (!newState && (isIOS() || isAndroid())) {
      window.location.reload();
    }
  };

  // Handle logout - clear both auth keys
  const handleLogout = () => {
    authLogout();
    router.push("/login");
  };

  // Generate transaction number
  const generateTransactionNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
  };

  // Quick end transaction - immediately completes the sale without checkout
  const handleQuickEnd = async () => {
    if (items.length === 0) return;

    setIsQuickEndProcessing(true);

    try {
      const txnNumber = generateTransactionNumber();
      const total = getTotal();
      const totalUsd = getTotalUsd();

      // Get current user info
      const currentUser = JSON.parse(localStorage.getItem("goldensquirrel_user") || "{}");

      // Build user info - always include user_name for tracking who processed the transaction
      const userInfo: any = {};
      if (currentUser && currentUser.username) {
        userInfo.user_name = currentUser.displayName || currentUser.username;
        // Only set user_id for employees (not owners, whose ID is a store_id)
        if (!currentUser.isOwner && currentUser.id) {
          userInfo.user_id = currentUser.id;
        }
      }

      // Save transaction to database
      const transactionData: any = {
        transaction_number: txnNumber,
        subtotal: getSubtotal(),
        total_amount: total,
        amount_paid: total,
        change_given: 0,
        payment_method: "cash",
        usd_subtotal: getSubtotalUsd(),
        usd_total_amount: totalUsd,
        usd_amount_paid: totalUsd,
        usd_change_given: 0,
        items: items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          currency: item.currency,
          unit_price_usd: item.unit_price_usd,
          total_price_usd: item.total_price_usd,
        })),
        ...userInfo,
      };

      if (navigator.onLine) {
        // Online: Save directly to Supabase
        try {
          const authData = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");

          const response = await fetch("/api/transactions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-auth-data": JSON.stringify({ store_id: authData.store_id }),
            },
            body: JSON.stringify(transactionData),
          });

          if (!response.ok) {
            throw new Error("Failed to save transaction");
          }
        } catch (error) {
          console.error("Failed to save transaction online:", error);
          toast.error("Transaction ended but failed to save receipt");
        }
      } else {
        // Offline: Queue for later sync
        const { queueTransaction } = await import("@/lib/db/localDB");
        const authDataOffline = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
        // Ensure store_id is never empty - try multiple fallbacks
        const offlineStoreId = authDataOffline.store_id || "";
        const offlineTxnData: any = {
          id: crypto.randomUUID(),
          store_id: offlineStoreId,
          transaction_number: txnNumber,
          subtotal: getSubtotal(),
          total_amount: total,
          amount_paid: total,
          change_given: 0,
          payment_method: "cash",
          subtotal_usd: getSubtotalUsd(),
          total_usd: totalUsd,
          amount_paid_usd: totalUsd,
          change_given_usd: 0,
          items: items.map((item) => ({
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            currency: item.currency,
            unit_price_usd: item.unit_price_usd,
            total_price_usd: item.total_price_usd,
          })),
          created_at: new Date().toISOString(),
        };
        // Add user_name for ALL users (owners included) - always set independently of user_id
        if (currentUser && currentUser.username) {
          offlineTxnData.user_name = currentUser.displayName || currentUser.username;
          // Only set user_id for employees (not owners, whose ID is a store_id)
          if (!currentUser.isOwner && currentUser.id) {
            offlineTxnData.user_id = currentUser.id;
          }
        }
        await queueTransaction(offlineTxnData);

        // Queue stock decrements as pending_writes for reliable sync
        await queueStockDecrementsForTransaction(
          items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          offlineStoreId
        );

        toast.info("Transaction saved offline - will sync when online");
      }

      // Clear cart and close dialog
      clearCart();
      setIsQuickEndDialogOpen(false);
      toast.success("Transaction completed!");
    } catch (error) {
      console.error("Error ending transaction:", error);
      toast.error("Failed to end transaction");
    } finally {
      setIsQuickEndProcessing(false);
    }
  };

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMobileMenuOpen && !(event.target as Element).closest('.mobile-menu-container')) {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobileMenuOpen]);

  // Refs for F-key shortcuts
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  // F-key shortcuts: F2=Search, F3=Scanner, F4=Done
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Don't trigger shortcuts when typing in an input
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "F3") {
        e.preventDefault();
        if (!isDesktopMode) {
          toggleScanner();
        } else {
          barcodeInputRef.current?.focus();
        }
      } else if (e.key === "F4") {
        e.preventDefault();
        if (!isEmpty()) {
          setIsQuickEndDialogOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEmpty, isDesktopMode, toggleScanner]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // Prefetch critical routes while online so they are available offline
  useEffect(() => {
    if (navigator.onLine && user) {
      router.prefetch("/checkout");
      router.prefetch("/pos/products");
      router.prefetch("/transactions");
      // Also warm the service worker cache by fetching the documents
      fetch("/checkout", { method: "HEAD", cache: "force-cache" }).catch(() => {});
      fetch("/pos/products", { method: "HEAD", cache: "force-cache" }).catch(() => {});
      fetch("/transactions", { method: "HEAD", cache: "force-cache" }).catch(() => {});
    }
  }, [router, user]);

  // Compute saved products for desktop mode (products without barcodes + frequently used)
  // Must be before any early returns to maintain hooks order
  const savedProducts = useMemo(() => {
    if (!user?.storeId) return [];
    const noBarcodeProducts = products.filter(p => !p.barcode);
    const frequentlyUsedIds = getFrequentlyUsedProductIds(user.storeId);
    const frequentlyUsedProducts = frequentlyUsedIds
      .map(id => products.find(p => p.id === id))
      .filter(Boolean) as Product[];
    // Combine, deduplicating by ID
    const combined = [...noBarcodeProducts, ...frequentlyUsedProducts];
    const seen = new Set<string>();
    return combined.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [products, user?.storeId]);

  if (isLoading || authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-background border-b">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center">
                <Squirrel className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg">GoldenSquirrel</h1>
                <p className="text-xs text-muted-foreground">Point of Sale</p>
              </div>
            </div>

            {/* Desktop Buttons */}
            <div className="hidden md:flex items-center gap-2">
              <SyncIndicator />
              {canViewTransactions && (
                <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>
                  <History className="h-4 w-4 mr-1" />
                  History
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => router.push("/pos/products")}>
                <Package className="h-4 w-4 mr-1" />
                Inventory
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>

            {/* Mobile Hamburger Menu */}
            <div className="md:hidden relative mobile-menu-container">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label="Open menu"
              >
                {isMobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>

              {/* Mobile Dropdown Menu */}
              {isMobileMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-background border rounded-lg shadow-lg z-50 overflow-hidden">
                   <div className="px-4 py-2 border-b">
                     <SyncIndicator compact />
                   </div>
                   {canViewTransactions && (
                     <button
                       className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/50 transition-colors"
                       onClick={() => {
                         router.push("/transactions");
                         setIsMobileMenuOpen(false);
                       }}
                     >
                       <History className="h-4 w-4" />
                       <span>History</span>
                     </button>
                   )}
                   <button
                     className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/50 transition-colors"
                     onClick={() => {
                       router.push("/pos/products");
                       setIsMobileMenuOpen(false);
                     }}
                   >
                     <Package className="h-4 w-4" />
                     <span>Inventory</span>
                   </button>
                   <div className="border-t" />
                  <button
                    className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-muted/50 transition-colors text-red-500"
                    onClick={() => {
                      handleLogout();
                      setIsMobileMenuOpen(false);
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      {isDesktopMode ? (
        /* ===== DESKTOP SPLIT LAYOUT ===== */
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          {/* Top Bar: Product Search + Action Buttons */}
          <div className="flex-shrink-0 flex items-center gap-3">
            <ProductSearchBar
              products={products}
              onSelect={handleProductAdd}
              placeholder="Search products by name or barcode..."
              className="flex-1"
              inputRef={searchInputRef}
            />
            {!isEmpty() && (
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  className="h-10 font-bold bg-green-600 hover:bg-green-700"
                  onClick={() => setIsQuickEndDialogOpen(true)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Done
                </Button>
                <Button
                  className="h-10 font-bold"
                  onClick={() => router.push(`/checkout?method=${isCharge ? "cash" : "card"}`)}
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  Checkout
                </Button>
              </div>
            )}
          </div>

          {/* Split: Cart + Scanner */}
          <div className="flex-1 flex flex-row overflow-hidden gap-4 min-h-0">
            {/* Left side: Cart — 65% */}
            <div className="flex-[65] flex flex-col overflow-hidden min-w-0">
              <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
                {/* Cart Items - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4">
                  {isEmpty() ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                      <Scan className="h-16 w-16 mb-4 opacity-30" />
                      <p className="text-xl font-medium">Scan items to add</p>
                      <p className="text-sm mt-1">Use the scanner on the right</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {items.map((item) => (
                        <div
                          key={item.product_id}
                          id={`cart-item-${item.product_id}`}
                          className={`p-1 rounded-lg transition-all duration-300 ${
                            highlightedItemId === item.product_id
                              ? "bg-yellow-300 border-4 border-yellow-600 shadow-lg scale-[1.02]"
                              : "bg-muted/50 border-2 border-transparent"
                          }`}
                        >
                          <div className="mb-2">
                            <p className="font-semibold text-base leading-tight">
                              {item.product_name}
                            </p>
                            {item.discount_percentage > 0 ? (
                              <>
                                <p className="text-xs text-muted-foreground text-center">
                                  <span className="line-through">{formatLL(item.original_unit_price)}</span>{' '}
                                  <span className="text-green-600 font-semibold">{formatLL(item.unit_price)}</span> each
                                </p>
                                <p className="text-xs text-muted-foreground text-center">
                                  <span className="line-through">{formatUSD(item.original_unit_price_usd)}</span>{' '}
                                  <span className="text-green-600 font-semibold">{formatUSD(item.unit_price_usd)}</span> each
                                </p>
                                <div className="flex justify-center mt-1">
                                  <Badge variant="default" className="text-xs bg-green-500">
                                    -{item.discount_percentage}%
                                  </Badge>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-xs text-muted-foreground text-center">
                                  {formatLL(item.unit_price)} each
                                </p>
                                <p className="text-xs text-muted-foreground text-center">
                                  {formatUSD(item.unit_price_usd)} each
                                </p>
                              </>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded"
                                onClick={() => decrementQuantity(item.product_id)}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center text-base font-bold">
                                {item.quantity}
                              </span>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded"
                                onClick={() => incrementQuantity(item.product_id)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-base text-amber-600">
                                {formatLL(item.total_price)}
                              </p>
                              <p className="text-s text-muted-foreground">
                                {formatUSD(item.total_price_usd)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cart Footer */}
                {!isEmpty() && (
                  <div className="flex-shrink-0 p-4 pt-3 border-t">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="flex items-center gap-2"
                            onClick={() => {
                              if (window.confirm("Are you sure you want to clear all items from the cart?")) {
                                clearCart();
                                toast.success("Cart cleared");
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Clear All
                          </Button>
                          <div className="text-right">
                            {useCartStore.getState().getTotalDiscount() > 0 && (
                              <>
                                <div className="text-sm text-muted-foreground">
                                  Subtotal: {formatLL(useCartStore.getState().getTotalOriginal())}
                                </div>
                                <div className="text-sm text-red-500">
                                  Discount: -{formatLL(useCartStore.getState().getTotalDiscount())}
                                </div>
                              </>
                            )}
                            <div className="text-2xl font-bold text-amber-500">
                              {formatLL(getTotal())}
                            </div>
                            <div className="text-s text-muted-foreground">
                              {formatUSD(getTotalUsd())}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Right side: Scanner + Grid — 35% */}
            <div className="flex-[35] flex flex-col gap-4 min-w-0">
              {/* Barcode Scanner + Grid — scrollable area */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <BarcodeScanner
                  onScan={handleBarcodeScan}
                  isActive={true}
                  desktopMode={true}
                  barcodeInputRef={barcodeInputRef}
                >
                  {savedProducts.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {savedProducts.map(product => (
                        <div key={product.id}>
                          <Button
                            variant="outline"
                            className="w-full min-h-[80px] flex-col py-2 px-3 text-center justify-center"
                            onClick={() => handleProductAdd(product)}
                          >
                            <span className="text-sm leading-tight font-semibold break-words">{product.name}</span>
                            <span className="text-xs text-muted-foreground mt-1.5">
                              {formatLL(product.selling_price)}
                            </span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </BarcodeScanner>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ===== MOBILE LAYOUT (vertical stack) ===== */
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          {/* Product Search Bar - Always visible */}
          <div className="flex-shrink-0">
            <ProductSearchBar
              products={products}
              onSelect={handleProductAdd}
              placeholder="Search products by name or barcode..."
            />
          </div>

          {/* Barcode Scanner - Toggleable */}
          <div className="flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <Button
                variant={isScannerActive ? "default" : "outline"}
                size="sm"
                onClick={toggleScanner}
                className="flex items-center gap-1"
              >
                <Scan className="h-4 w-4" />
                {isScannerActive ? "Turn Off Scanner" : "Turn On Scanner"}
              </Button>
              <Badge variant={isScannerActive ? "default" : "secondary"}>
                {isScannerActive ? "ON" : "OFF"}
              </Badge>
            </div>
            <BarcodeScanner
              onScan={handleBarcodeScan}
              isActive={isScannerActive}
              desktopMode={false}
              showManualInput={false}
            />
          </div>

          {/* Cart Section - Largest Element */}
          <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Cart Items - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              {isEmpty() ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Scan className="h-16 w-16 mb-4 opacity-30" />
                  <p className="text-xl font-medium">Scan items to add</p>
                  <p className="text-sm mt-1">Use the camera above to scan barcodes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.product_id}
                      id={`cart-item-${item.product_id}`}
                      className={`p-1 rounded-lg transition-all duration-300 ${
                        highlightedItemId === item.product_id
                          ? "bg-yellow-300 border-4 border-yellow-600 shadow-lg scale-[1.02]"
                          : "bg-muted/50 border-2 border-transparent"
                      }`}
                    >
                      <div className="mb-2">
                        <p className="font-semibold text-base leading-tight">
                          {item.product_name}
                        </p>
                        {item.discount_percentage > 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground text-center">
                              <span className="line-through">{formatLL(item.original_unit_price)}</span>{' '}
                              <span className="text-green-600 font-semibold">{formatLL(item.unit_price)}</span> each
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                              <span className="line-through">{formatUSD(item.original_unit_price_usd)}</span>{' '}
                              <span className="text-green-600 font-semibold">{formatUSD(item.unit_price_usd)}</span> each
                            </p>
                            <div className="flex justify-center mt-1">
                              <Badge variant="default" className="text-xs bg-green-500">
                                -{item.discount_percentage}%
                              </Badge>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground text-center">
                              {formatLL(item.unit_price)} each
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                              {formatUSD(item.unit_price_usd)} each
                            </p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded"
                            onClick={() => decrementQuantity(item.product_id)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-base font-bold">
                            {item.quantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded"
                            onClick={() => incrementQuantity(item.product_id)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-base text-amber-600">
                            {formatLL(item.total_price)}
                          </p>
                          <p className="text-s text-muted-foreground">
                            {formatUSD(item.total_price_usd)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Footer */}
            {!isEmpty() && (
              <div className="flex-shrink-0 p-4 pt-3 border-t">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex items-center gap-2"
                        onClick={() => {
                          if (window.confirm("Are you sure you want to clear all items from the cart?")) {
                            clearCart();
                            toast.success("Cart cleared");
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Clear All
                      </Button>
                      <div className="text-right">
                        {useCartStore.getState().getTotalDiscount() > 0 && (
                          <>
                            <div className="text-sm text-muted-foreground">
                              Subtotal: {formatLL(useCartStore.getState().getTotalOriginal())}
                            </div>
                            <div className="text-sm text-red-500">
                              Discount: -{formatLL(useCartStore.getState().getTotalDiscount())}
                            </div>
                          </>
                        )}
                        <div className="text-2xl font-bold text-amber-500">
                          {formatLL(getTotal())}
                        </div>
                        <div className="text-s text-muted-foreground">
                          {formatUSD(getTotalUsd())}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Action Buttons: Quick Done + Checkout */}
          {!isEmpty() && (
            <div className="flex-shrink-0">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="h-14 text-lg font-bold bg-green-600 hover:bg-green-700"
                  size="lg"
                  onClick={() => setIsQuickEndDialogOpen(true)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Done
                </Button>
                <Button
                  className="h-14 text-lg font-bold"
                  size="lg"
                  onClick={() => router.push(`/checkout?method=${isCharge ? "cash" : "card"}`)}
                >
                  <CreditCard className="h-5 w-5 mr-2" />
                  Checkout
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick End Confirmation Dialog */}
      <Dialog open={isQuickEndDialogOpen} onOpenChange={setIsQuickEndDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>End Transaction?</DialogTitle>
            <DialogDescription>
              Complete this sale for{" "}
              <span className="font-semibold text-foreground">{formatLL(getTotal())}</span>{" "}
              ({formatUSD(getTotalUsd())}) with {getItemCount()} item
              {getItemCount() !== 1 ? "s" : ""}? This will skip checkout and immediately
              record the transaction.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setIsQuickEndDialogOpen(false)}
              disabled={isQuickEndProcessing}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={handleQuickEnd}
              disabled={isQuickEndProcessing}
            >
              {isQuickEndProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              End Transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}