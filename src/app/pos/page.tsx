"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { useAuth } from "@/lib/auth/AuthContext";
import { Product } from "@/lib/types/product";
import { toast } from "sonner";
import { formatCurrency, formatLL, convertUsdToLl, formatUSD, convertLlToUsd, convertLlToUsdForSale, convertLlToUsdForReturn, SELL_RATE, RETURN_RATE } from "@/lib/utils/format";
import BarcodeScanner, { playSuccessSound } from "@/components/BarcodeScanner";
import { SyncIndicator } from "@/components/SyncIndicator";
import { syncEngine } from "@/lib/sync/engine";
import {
  getCachedProducts,
  getCachedProductByBarcode,
  getCachedProductsCount,
  seedProductsIfNeeded,
} from "@/lib/db";
import type { CachedProduct } from "@/lib/db";
import { useFeatureFlag } from "@/lib/auth/featureGuard";

const supabase = createClient();

export default function POSPage() {
  const router = useRouter();
  const { user, logout: authLogout, canAccess, isLoading: authLoading } = useAuth();
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

          // Then try to fetch fresh data from Supabase if online
          if (navigator.onLine) {
            const { data: productsData, error } = await supabase
              .from("products")
              .select("*")
              .eq("store_id", store_id)
              .order("name");

            if (!error && productsData && isMounted) {
              setProducts(productsData);
            }
            // Initialize/refresh local cache in background (non-blocking)
            syncEngine.initialize(store_id).catch(() => {});
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

  // Handle barcode scan from camera
  const handleBarcodeScan = (barcode: string) => {
    const product = barcodeIndex.get(barcode);
    if (product) {
      // Handle product variants with price inheritance
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
      if (!useFeatureFlag("product_discount")) {
        resolvedProduct = {
          ...resolvedProduct,
          discount_percentage: 0,
        };
      }

      // Check if item already exists in cart
      const existingItem = items.find(item => item.product_id === product.id);

      if (existingItem) {
        // Item exists - highlight it instead of increasing quantity
        setHighlightedItemId(product.id);

        // Clear previous timeout if exists
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        // Set timeout to remove highlight after 2 seconds
        highlightTimeoutRef.current = setTimeout(() => {
          setHighlightedItemId(null);
        }, 2000);

        toast.info(`${resolvedProduct.name} is already in cart`);

        // Scroll the existing cart item into view
        setTimeout(() => {
          const el = document.getElementById(`cart-item-${product.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      } else {
        // Item doesn't exist - add it (idempotent: returns true only if actually added)
        const added = addItem(resolvedProduct);
        if (added) {
          // Play success sound ONLY after product has been successfully identified AND added to cart
          playSuccessSound();
          toast.success(`Added ${resolvedProduct.name}`);
        } else {
          // Lost the race to a duplicate emission — highlight instead
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
    } else {
      toast.error("Product not found");
    }
  };

  const toggleScanner = () => {
    const newState = !isScannerActive;
    setIsScannerActive(newState);
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      localStorage.setItem("scanner_active", String(newState));
    }
    // No page reload needed — BarcodeScanner's isActive prop change triggers stop/start automatically
  };

  // Handle logout - clear both auth keys
  const handleLogout = () => {
    authLogout();
    router.push("/login");
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

      {/* Main Content - Non-scrollable */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        {/* Barcode Scanner - Always Open - Compact */}
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
      ? "bg-amber-100 border-2 border-amber-500 shadow-lg scale-[1.02]"
      : "bg-muted/50 border-2 border-transparent"
  }`}
>
  {/* Product Name - Always Visible */}
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

  {/* Quantity and Price Row */}
  <div className="flex items-center justify-between">
    {/* Quantity Controls */}
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
        disabled={item.quantity >= item.stock_quantity}
        onClick={() => {
          const success = incrementQuantity(item.product_id);
          if (!success) {
            toast.error(`Cannot exceed available stock (${item.stock_quantity})`);
          }
        }}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>

  {/* Item Total */}
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
              {/* Clear All + Total */}
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
                      {/* Show discount breakdown if any items have discounts */}
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

        {/* Checkout Button - Outside Cart */}
        {!isEmpty() && (
          <div className="flex-shrink-0">
            <Button
              className="w-full h-14 text-xl font-bold"
              size="lg"
              onClick={() => router.push(`/checkout?method=${isCharge ? "cash" : "card"}`)}
            >
              Checkout
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}