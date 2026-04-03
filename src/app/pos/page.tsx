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
} from "lucide-react";
import { useCartStore } from "@/lib/stores/cartStore";
import { Product } from "@/lib/types/product";
import { toast } from "sonner";
import { formatCurrency, formatLL, convertUsdToLl, formatUSD, convertLlToUsd } from "@/lib/utils/format";
import BarcodeScanner from "@/components/BarcodeScanner";

const supabase = createClient();

export default function POSPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [merchant, setMerchant] = useState<any>(null);
  const [isCharge, setIsCharge] = useState(true); // true = charge (green), false = credit (red)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    items,
    addItem,
    incrementQuantity,
    decrementQuantity,
    clearCart,
    setStoreId,
    getSubtotal,
    getTotal,
    getItemCount,
    isEmpty,
  } = useCartStore();

  // Load store and products data
  useEffect(() => {
    const loadData = async () => {
      try {
        // Get auth data from localStorage
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

        // Fetch products for this store
        const { data: productsData, error } = await supabase
          .from("products")
          .select("*")
          .eq("store_id", store_id)
          .order("name");

        if (error) throw error;
        setProducts(productsData || []);
      } catch (error) {
        console.error("Error loading data:", error);
        toast.error("Failed to load products");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();

    // Refresh products when window gains focus
    const handleFocus = () => {
      if (merchant?.id) {
        loadData();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [router, setStoreId, merchant?.id]);

  // Handle barcode scan from camera
  const handleBarcodeScan = (barcode: string) => {
    const product = products.find((p) => p.barcode === barcode);
    if (product) {
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
        
        toast.info(`${product.name} is already in cart`);
      } else {
        // Item doesn't exist - add it
        addItem(product);
        toast.success(`Added ${product.name}`);
      }
    } else {
      toast.error("Product not found");
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("goldensquirrel_auth");
    router.push("/login");
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

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

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => router.push("/pos/products")}>
                <Package className="h-4 w-4 mr-1" />
                Inventory
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Non-scrollable */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        {/* Barcode Scanner - Always Open - Compact */}
        <div className="flex-shrink-0">
          <BarcodeScanner
            onScan={handleBarcodeScan}
            isActive={true}
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
                    className={`p-4 rounded-xl transition-all duration-300 ${
                      highlightedItemId === item.product_id
                        ? "bg-amber-100 border-2 border-amber-500 shadow-lg scale-[1.02]"
                        : "bg-muted/50 border-2 border-transparent"
                    }`}
                  >
                    {/* Product Name - Always Visible */}
                    <div className="mb-3">
                      <p className="font-bold text-lg leading-tight">
                        {item.product_name}
                      </p>
                      <p className="text-sm text-muted-foreground text-center">
                        {formatLL(item.unit_price)} each
                      </p>
                    </div>

                    {/* Quantity and Price Row */}
                    <div className="flex items-center justify-between">
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-lg"
                          onClick={() => decrementQuantity(item.product_id)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-10 text-center text-xl font-bold">
                          {item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-lg"
                          onClick={() => incrementQuantity(item.product_id)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Item Total */}
                      <div className="text-right">
                        <p className="font-bold text-xl text-amber-600">
                          {formatLL(item.total_price)}
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
              {/* Total */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xl font-semibold">Total</span>
                  <span className="text-2xl font-bold text-amber-500">
                    {formatLL(getTotal())}
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