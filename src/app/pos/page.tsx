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
} from "@/lib/db";
import type { CachedProduct } from "@/lib/db";

const supabase = createClient();

export default function POSPage() {
  const router = useRouter();
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

  // Load store and products data
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        // Get auth data from localStorage
        if (typeof window !== 'undefined' && 'localStorage' in window) {
          const authData = localStorage.getItem("goldensquirrel_auth");
          if (!authData) {
            router.push("/login");
            return;
          }

          const { store_id, license_expires_at } = JSON.parse(authData);

          // Check license expiration
          const licenseExpires = new Date(license_expires_at);
          const now = new Date();

          if (licenseExpires < now) {
            toast.error("Your license has expired. Please contact support.");
            localStorage.removeItem("goldensquirrel_auth");
            router.push("/login");
            return;
          }

          setMerchant({ id: store_id });
          setStoreId(store_id);
          syncEngine.setStoreId(store_id);

          // Check if we're online
          const isOnline = navigator.onLine;

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
              stock_quantity: p.stock_quantity,
              min_stock_threshold: p.min_stock_threshold,
              parent_id: p.parent_id || undefined,
              variant_name: p.variant_name || undefined,
            }));

          if (isOnline) {
            // ONLINE: Fetch from Supabase and sync to local cache
            const { data: productsData, error } = await supabase
              .from("products")
              .select("*")
              .eq("store_id", store_id)
              .order("name");

            if (error) {
              // If Supabase fails, fall back to local cache
              console.warn("[POS] Supabase fetch failed, using local cache:", error.message);
              const cached = await getCachedProducts(store_id);
              if (isMounted) {
                setProducts(cached ? mapCachedToProducts(cached) : []);
              }
            } else {
              if (isMounted) {
                setProducts(productsData || []);
              }
              // Initialize/refresh local cache in background
              syncEngine.initialize(store_id);
            }
          } else {
            // OFFLINE: Read from local IndexedDB cache
            console.log("[POS] Offline mode - reading from local cache");
            const cached = await getCachedProducts(store_id);
            if (cached && cached.length > 0) {
              if (isMounted) {
                setProducts(mapCachedToProducts(cached));
                toast.info("Offline mode - showing cached products");
              }
            } else {
              if (isMounted) {
                setProducts([]);
                toast.error("No cached products available offline. Please connect to the internet to sync.");
              }
            }
          }
        }
      } catch (error) {
        console.error("Error loading data:", error);
        // Try local cache as fallback
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
              stock_quantity: p.stock_quantity,
              min_stock_threshold: p.min_stock_threshold,
              parent_id: p.parent_id || undefined,
              variant_name: p.variant_name || undefined,
            }));
          if (cached && cached.length > 0 && isMounted) {
            setProducts(mapCachedToProducts(cached));
          }
        } catch {}
        toast.error("Failed to load products");
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
  }, [router, setStoreId, merchant?.id]);

  // Handle barcode scan from camera
  const handleBarcodeScan = (barcode: string) => {
    const product = products.find((p) => p.barcode === barcode);
    if (product) {
      // Handle product variants with price inheritance
      let resolvedProduct = {...product};
      
      // If this is a variant child product, inherit values from parent
      if (product.parent_id) {
        const parent = products.find(p => p.id === product.parent_id);
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
      } else {
        // Item doesn't exist - add it
        addItem(resolvedProduct);
        // Play success sound ONLY after product has been successfully identified AND added to cart
        playSuccessSound();
        toast.success(`Added ${resolvedProduct.name}`);
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
    // Refresh the page for the scanner toggle effect to take effect
    window.location.reload();
  };

  // Handle logout
  const handleLogout = () => {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      localStorage.removeItem("goldensquirrel_auth");
    }
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
    if (navigator.onLine) {
      router.prefetch("/checkout");
      router.prefetch("/pos/products");
      // Also warm the service worker cache by fetching the documents
      fetch("/checkout", { method: "HEAD", cache: "force-cache" }).catch(() => {});
      fetch("/pos/products", { method: "HEAD", cache: "force-cache" }).catch(() => {});
    }
  }, [router]);

  if (isLoading) {
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
    <p className="text-xs text-muted-foreground text-center">
      {formatLL(item.unit_price)} each
    </p>
    <p className="text-xs text-muted-foreground text-center">
      {formatUSD(item.unit_price_usd)} each
    </p>
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
                  <span className="text-right">
                    <div className="text-2xl font-bold text-amber-500">
                      {formatLL(getTotal())}
                    </div>
                    <div className="text-s text-muted-foreground">
                      {formatUSD(getTotalUsd())}
                    </div>
                  </span>
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