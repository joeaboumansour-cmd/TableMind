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
  Copy,
  Share2,
  Printer,
  Power,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CartSheet from "@/components/pos/CartSheet";
import { useCartStore } from "@/lib/stores/cartStore";
import { useAuth } from "@/lib/auth/AuthContext";
import { Product } from "@/lib/types/product";
import { useToastManager } from "@/hooks/useToastManager";
import { formatCurrency, formatLL, formatUSD, convertLlToUsd, convertLlToUsdForSale, convertLlToUsdForReturn, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";
import { generateReceiptToken } from "@/lib/receipt/token";
import QRCode from "qrcode";
import dynamic from "next/dynamic";
// Imported from the standalone feedback module, NOT from BarcodeScanner —
// importing it from there would pull ZXing back into this bundle.
import { playSuccessSound, playErrorSound, playCompleteSound, primeFeedback } from "@/lib/feedback";
import ProductSearchBar from "@/components/ProductSearchBar";
import { SyncIndicator } from "@/components/SyncIndicator";
import { syncEngine } from "@/lib/sync/engine";
import {
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductsCount,
  seedProductsIfNeeded,
} from "@/lib/db";
import type { CachedProduct } from "@/lib/db";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { usePreloadProducts } from "@/hooks/usePreloadProducts";
import { isDesktop, isIOS, isAndroid } from "@/lib/device";
import { getFrequentlyUsedProductIds, addFrequentlyUsedProduct, removeFrequentlyUsedProduct, isFrequentlyUsed } from "@/lib/frequentlyUsed";
import { connectivity } from "@/lib/connectivity";

const supabase = createClient();

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
  // Throttles the focus-triggered refresh (see the load effect below)
  const lastFocusSyncRef = useRef(0);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // O(1) barcode lookup — rebuilt whenever products change
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, Product>>(new Map());
  const barcodeIndexRef = useRef<Map<string, Product>>(new Map());
  // Check user permissions for History button
  const [canViewTransactions, setCanViewTransactions] = useState(false);
  // Check user permissions for Cash Register button
  const [canViewCash, setCanViewCash] = useState(false);
  // Check user permissions for Inventory button
  const [canViewInventory, setCanViewInventory] = useState(false);
  // Quick end transaction state
  const [isQuickEndDialogOpen, setIsQuickEndDialogOpen] = useState(false);
  const [isQuickEndProcessing, setIsQuickEndProcessing] = useState(false);
  // Quick end completion (QR receipt) state
  const [completedTxnNumber, setCompletedTxnNumber] = useState("");
  const [completedReceiptUrl, setCompletedReceiptUrl] = useState("");
  const [completedQrDataUrl, setCompletedQrDataUrl] = useState("");
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedTotalUsd, setCompletedTotalUsd] = useState(0);
  const [completedItemCount, setCompletedItemCount] = useState(0);
  const [completedChange, setCompletedChange] = useState(0);
  const [completedChangeUsd, setCompletedChangeUsd] = useState(0);
  const [completedPaid, setCompletedPaid] = useState(0);
  const [completedPaidUsd, setCompletedPaidUsd] = useState(0);

  const { toast } = useToastManager({ throttleMs: 1200 });

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
  const getSubtotal = useCartStore((s) => s.getSubtotal);
  const getSubtotalUsd = useCartStore((s) => s.getSubtotalUsd);
  const getTotal = useCartStore((s) => s.getTotal);
  const getTotalUsd = useCartStore((s) => s.getTotalUsd);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const isEmpty = useCartStore((s) => s.isEmpty);
  // These three were previously read via useCartStore.getState() DURING RENDER,
  // which does not subscribe — they only appeared to update because `items`
  // triggered the render anyway. Selecting them makes the dependency real.
  const getTotalDiscount = useCartStore((s) => s.getTotalDiscount);
  const getTotalOriginal = useCartStore((s) => s.getTotalOriginal);
  const getRoundingAdjustment = useCartStore((s) => s.getRoundingAdjustment);

  // Check user permissions on mount
  useEffect(() => {
    if (user) {
      setCanViewTransactions(canAccess("transactions"));
      setCanViewCash(canAccess("cash_register") && isEnabled("cash_register"));
      setCanViewInventory(canAccess("inventory") && isEnabled("inventory"));
    }
  }, [user, canAccess, isEnabled]);

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
  }, [router, setStoreId, user, authLogout]);

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

    // Read the cart imperatively rather than closing over `items`.
    // This is an event handler, not render, so getState() is the correct
    // Zustand usage — and it keeps `items` out of this callback's deps, so the
    // callback identity stays stable across cart changes. That matters because
    // this function is the `onScan` prop of the memoized scanner: rebuilding it
    // on every add re-rendered the live camera subtree mid-scan.
    const existingItem = useCartStore
      .getState()
      .items.find((item) => item.product_id === product.id);

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
    // `items` is deliberately NOT a dependency — it is read via getState()
    // above so this callback stays referentially stable.
  }, [addItem, incrementQuantity, isEnabled, isDesktopMode]);

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
    if (!connectivity.isOnline) {
      playErrorSound();
      toast.error("Product not found in local data");
      return;
    }

    const storeId = user?.storeId;
    if (!storeId) {
      toast.error("No store selected");
      return;
    }

    try {
      toast.loading("Verifying barcode...", { key: "scan-fallback" });

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
        playErrorSound();
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
      playErrorSound();
      toast.error("Product not found");
    }
  };

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

  // Generate transaction number
  const generateTransactionNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
  };

  // Copy receipt link to clipboard
  const handleCopyCompletedLink = async () => {
    try {
      await navigator.clipboard.writeText(completedReceiptUrl);
      toast.success("Receipt link copied to clipboard");
    } catch (err) {
      console.error("Failed to copy link:", err);
      toast.error("Failed to copy link");
    }
  };

  // Share receipt link via Web Share API
  const handleShareCompletedReceipt = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Receipt - ${completedTxnNumber}`,
          text: `Your receipt for transaction ${completedTxnNumber}`,
          url: completedReceiptUrl,
        });
      } catch (err) {
        // User cancelled share
      }
    } else {
      await handleCopyCompletedLink();
    }
  };

  // Print the QR code (for hard-copy at the register)
  const handlePrintCompletedQR = () => {
    const printWindow = window.open("", "_blank", "width=400,height=500");
    if (!printWindow) {
      toast.error("Please allow pop-ups to print the QR code");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt QR - ${completedTxnNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
            h2 { margin-bottom: 4px; }
            p { color: #666; margin-bottom: 16px; }
            img { max-width: 300px; }
            .url { font-size: 12px; color: #888; word-break: break-all; margin-top: 12px; }
          </style>
        </head>
        <body>
          <h2>Scan for Digital Receipt</h2>
          <p>Transaction #${completedTxnNumber}</p>
          <img src="${completedQrDataUrl}" alt="Receipt QR Code" />
          <div class="url">${completedReceiptUrl}</div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Quick end transaction - immediately completes the sale without checkout
  const handleQuickEnd = async () => {
    if (items.length === 0) return;

    setIsQuickEndProcessing(true);

    try {
      const txnNumber = generateTransactionNumber();
      const total = getTotal();
      const totalUsd = getTotalUsd();

      // Generate unguessable receipt token (works fully offline)
      const token = generateReceiptToken();
      const receiptUrl = `${window.location.origin}/receipt/${token}`;
      const itemCount = getItemCount();
      setCompletedTxnNumber(txnNumber);
      setCompletedReceiptUrl(receiptUrl);
      setCompletedTotal(total);
      setCompletedTotalUsd(totalUsd);
      setCompletedItemCount(itemCount);
      setCompletedChange(0);
      setCompletedChangeUsd(0);
      setCompletedPaid(total);
      setCompletedPaidUsd(totalUsd);

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
        receipt_token: token,
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

      // Build the offline queue payload up-front so we can fall back to it
      // if the online save fails (e.g. navigator.onLine lies on desktop).
      const { queueTransaction } = await import("@/lib/db/localDB");
      const authDataOffline = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
      // Ensure store_id is never empty - try multiple fallbacks
      const offlineStoreId = authDataOffline.store_id || "";
      const offlineTxnData: any = {
        id: crypto.randomUUID(),
        store_id: offlineStoreId,
        transaction_number: txnNumber,
        receipt_token: token,
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

      // NOTE: Stock decrements are now handled server-side in the /api/transactions
      // POST route. No client-side stock decrement queuing is needed.
      // This prevents double-decrementing for offline transactions.

      let savedOnline = false;
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
          savedOnline = true;
        } catch (error) {
          // Fall back to offline queue so the transaction is NEVER lost.
          console.error("Failed to save transaction online, queuing offline:", error);
        }
      }

      if (!savedOnline) {
        await queueTransaction(offlineTxnData);
        toast.info("Transaction saved offline - will sync when online");
      }

      // Reflect stock decrement in local cache IMMEDIATELY.
      // The server already decremented stock (or will when synced), but the
      // local cache has a 5-minute freshness window that would otherwise
      // show stale stock levels until the next sync.
      try {
        const { decrementCachedStock } = await import("@/lib/db/localDB");
        await decrementCachedStock(
          items.map((item) => ({ product_id: item.product_id, quantity: item.quantity }))
        );
      } catch (e) {
        console.warn("[POS QuickEnd] Failed to update cached stock:", e);
      }

      // Clear cart and close dialog
      clearCart();
      setIsQuickEndDialogOpen(false);
      setCompletedQrDataUrl("");
      playCompleteSound();
      setIsCompleteDialogOpen(true);
      toast.success("Transaction completed!");

      // Generate QR code for the digital receipt (client-side, works offline)
      try {
        const dataUrl = await QRCode.toDataURL(receiptUrl, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        setCompletedQrDataUrl(dataUrl);
      } catch (qrError) {
        console.error("Failed to generate QR code:", qrError);
      }
    } catch (error) {
      console.error("Error ending transaction:", error);
      toast.error("Failed to end transaction");
    } finally {
      setIsQuickEndProcessing(false);
    }
  };

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
    if (connectivity.isOnline && user) {
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

  if (isLoading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  // Shared by both layouts. Held as JSX rather than an inner component so it
  // is not a fresh component type on every render — that would remount the
  // dialogs (and drop their open/close animation) on every cart change.
  const dialogs = (
    <>
      {/* ---- Confirm quick sale ---- */}
      <Dialog open={isQuickEndDialogOpen} onOpenChange={setIsQuickEndDialogOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Finish this sale?</DialogTitle>
            <DialogDescription>
              Records {getItemCount()} item{getItemCount() !== 1 ? "s" : ""} immediately and
              skips checkout. No change is calculated.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl bg-muted/50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Total
            </p>
            <p className="text-3xl font-extrabold leading-tight text-primary tnum">
              {formatLL(getTotal())}
            </p>
            <p className="text-sm text-muted-foreground tnum">{formatUSD(getTotalUsd())}</p>
          </div>

          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="h-12 flex-1 rounded-2xl"
              onClick={() => setIsQuickEndDialogOpen(false)}
              disabled={isQuickEndProcessing}
            >
              Cancel
            </Button>
            <Button
              className="h-12 flex-1 rounded-2xl font-bold"
              onClick={handleQuickEnd}
              disabled={isQuickEndProcessing}
            >
              {isQuickEndProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Sale complete — digital receipt ---- */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-7 w-7 text-emerald-400" />
            </div>
            <DialogHeader>
              <DialogTitle>Sale complete</DialogTitle>
              <DialogDescription className="tnum">
                #{completedTxnNumber} · {completedItemCount} item
                {completedItemCount !== 1 ? "s" : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-2 rounded-2xl bg-muted/50 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold tnum">{formatLL(completedTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-bold tnum">{formatLL(completedPaid)}</span>
              </div>
              {completedChange > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Change</span>
                  <span className="font-bold tnum">{formatLL(completedChange)}</span>
                </div>
              )}
            </div>

            {completedQrDataUrl ? (
              <div className="mb-4 rounded-2xl border p-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Customer scans this for their receipt
                </p>
                <div className="mb-3 flex justify-center">
                  <img
                    src={completedQrDataUrl}
                    alt="Digital receipt QR code"
                    className="h-44 w-44 rounded-xl bg-white p-2"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={handleCopyCompletedLink}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={handleShareCompletedReceipt}>
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={handlePrintCompletedQR}>
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl border p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating QR…
              </div>
            )}

            <DialogFooter>
              <Button
                className="h-12 w-full rounded-2xl font-bold"
                onClick={() => setIsCompleteDialogOpen(false)}
              >
                New sale
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  // ===================== MOBILE: SCAN-FIRST =====================
  // The camera is the page. Everything else floats over it: a header chip, a
  // search pill, and the draggable cart sheet. Nothing is stacked in flow, so
  // dragging the sheet never re-lays-out the live video behind it.
  if (!isDesktopMode) {
    return (
      <div ref={posSurfaceRef} className="relative h-full w-full overflow-hidden bg-black">
        {/* ---- Camera layer ---- */}
        <div className="absolute inset-0">
          {isScannerActive ? (
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
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
              <ScanLine className="h-9 w-9 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">Scanner is off</p>
              <button
                type="button"
                onClick={toggleScanner}
                className="tap mt-4 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
              >
                Turn on
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
          <div className="flex items-center justify-between gap-3">
            <div className="glass flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 ring-1 ring-white/10">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                G
              </span>
              <span className="text-[15px] font-bold leading-none">GoldenSquirrel</span>
              <SyncIndicator dot />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleScanner}
                aria-label={isScannerActive ? "Turn scanner off" : "Turn scanner on"}
                aria-pressed={isScannerActive}
                className={cn(
                  "tap glass flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-white/10",
                  isScannerActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Scan className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Log out"
                className="tap glass flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground ring-1 ring-white/10"
              >
                <Power className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {/* ---- Search pill + cart sheet ---- */}
        <div className="absolute inset-x-0 bottom-0 z-20">
          <div ref={searchBlockRef} className="px-4 pb-3">
            <ProductSearchBar
              products={products}
              onSelect={handleProductAdd}
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
            onClear={handleClearCart}
            onDone={() => setIsQuickEndDialogOpen(true)}
            onCheckout={() => router.push("/checkout")}
          />
        </div>

        {dialogs}
      </div>
    );
  }

  // ===================== DESKTOP: HARDWARE-SCANNER SPLIT =====================
  // A till with a wedge scanner and a keyboard, not a phone. The cart gets the
  // width, the barcode field keeps focus, and F2 / F3 / F4 drive the whole
  // flow without the mouse.
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="safe-top flex-shrink-0 border-b bg-background">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Squirrel className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">GoldenSquirrel</h1>
              <p className="text-xs text-muted-foreground">Point of Sale</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SyncIndicator />
            {canViewCash && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => router.push("/pos/cash")}
              >
                <Banknote className="h-4 w-4" />
                Cash
              </Button>
            )}
            {canViewTransactions && isEnabled("transactions") && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => router.push("/transactions")}
              >
                <History className="h-4 w-4" />
                History
              </Button>
            )}
            {canViewInventory && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => router.push("/pos/products")}
              >
                <Package className="h-4 w-4" />
                Inventory
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl"
              onClick={handleLogout}
              aria-label="Log out"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {/* ---- Search + primary actions ---- */}
        <div className="flex flex-shrink-0 items-center gap-3">
          <ProductSearchBar
            products={products}
            onSelect={handleProductAdd}
            placeholder="Search products by name or barcode…   F2"
            className="flex-1"
            inputClassName="h-11 rounded-2xl"
            inputRef={searchInputRef}
          />
          {!isEmpty() && (
            <div className="flex flex-shrink-0 gap-2">
              <Button
                className="tap h-11 rounded-2xl bg-secondary px-5 font-bold text-secondary-foreground hover:bg-secondary/80"
                onClick={() => setIsQuickEndDialogOpen(true)}
              >
                <Check className="h-4 w-4 text-emerald-400" />
                Done
              </Button>
              <Button
                className="tap h-11 rounded-2xl px-5 font-bold"
                onClick={() => router.push("/checkout")}
              >
                <CreditCard className="h-4 w-4" />
                Checkout
              </Button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-row gap-4 overflow-hidden">
          {/* ---- Cart — 65% ---- */}
          <div className="flex min-w-0 flex-[65] flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border bg-card">
              {isEmpty() ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <ScanLine className="mb-4 h-12 w-12 opacity-25" />
                  <p className="text-lg font-semibold">Scan items to add</p>
                  <p className="mt-1 text-sm">Barcode field is on the right — F3 to focus</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-shrink-0 items-baseline justify-between px-5 pb-2 pt-4">
                    <h2 className="text-lg font-bold">
                      Cart{" "}
                      <span className="text-sm font-medium text-muted-foreground">
                        · {getItemCount()} item{getItemCount() !== 1 ? "s" : ""}
                      </span>
                    </h2>
                    <button
                      type="button"
                      onClick={handleClearCart}
                      className="tap -mr-2 rounded-lg px-2 py-1 text-sm font-semibold text-destructive"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2">
                    {items.map((item) => (
                      <div
                        key={item.product_id}
                        id={`cart-item-${item.product_id}`}
                        className={cn(
                          "animate-cart-item-in flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-300",
                          highlightedItemId === item.product_id
                            ? "bg-primary/15 ring-1 ring-primary/60"
                            : "ring-1 ring-transparent"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold leading-tight">
                            {item.product_name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground tnum">
                            {item.discount_percentage > 0 ? (
                              <>
                                <span className="line-through opacity-60">
                                  {formatLL(item.original_unit_price)}
                                </span>{" "}
                                <span className="font-semibold text-emerald-400">
                                  {formatLL(item.unit_price)}
                                </span>{" "}
                                each · −{item.discount_percentage}%
                              </>
                            ) : (
                              <>
                                {formatLL(item.unit_price)} · {formatUSD(item.unit_price_usd)} each
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex flex-shrink-0 items-center rounded-xl bg-muted/70">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.product_name}`}
                            onClick={() => decrementQuantity(item.product_id)}
                            className="tap flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-6 text-center text-[15px] font-bold tnum">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${item.product_name}`}
                            onClick={() => incrementQuantity(item.product_id)}
                            className="tap flex h-9 w-9 items-center justify-center rounded-xl text-primary"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="w-[132px] flex-shrink-0 text-right">
                          <p className="text-[15px] font-semibold tnum">
                            {formatLL(item.total_price)}
                          </p>
                          <p className="text-xs text-muted-foreground tnum">
                            {formatUSD(item.total_price_usd)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-shrink-0 items-end justify-between gap-3 border-t px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Total
                        {getRoundingAdjustment() !== 0 && (
                          <span className="tnum">
                            {" · Rounded "}
                            {getRoundingAdjustment() > 0 ? "+" : "−"}
                            {Math.abs(Math.round(getRoundingAdjustment())).toLocaleString("en-US")}
                          </span>
                        )}
                      </p>
                      {getTotalDiscount() > 0 && (
                        <p className="mt-0.5 text-xs font-semibold text-emerald-400 tnum">
                          Saved {formatLL(getTotalDiscount())}
                        </p>
                      )}
                      <p className="mt-0.5 text-sm text-muted-foreground tnum">
                        {formatUSD(getTotalUsd())}
                      </p>
                    </div>
                    <p
                      key={getTotal()}
                      className="animate-value-bump flex-shrink-0 text-[34px] font-extrabold leading-none text-primary tnum"
                    >
                      {formatLL(getTotal())}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ---- Barcode field + saved products — 35% ---- */}
          <div className="flex min-w-0 flex-[35] flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <BarcodeScanner
                onScan={handleBarcodeScan}
                isActive={true}
                desktopMode={true}
                barcodeInputRef={barcodeInputRef}
              >
                {savedProducts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {savedProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleProductAdd(product)}
                        className="tap flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border bg-background px-3 py-2 text-center hover:bg-muted/50"
                      >
                        <span className="break-words text-sm font-semibold leading-tight">
                          {product.name}
                        </span>
                        <span className="text-xs text-muted-foreground tnum">
                          {formatLL(product.selling_price)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </BarcodeScanner>
            </div>
          </div>
        </div>
      </div>

      {dialogs}
    </div>
  );
}
