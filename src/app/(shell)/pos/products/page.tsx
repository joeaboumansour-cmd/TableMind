"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
   Plus,
   Loader2,
   Package,
   Edit,
   Trash2,
   RefreshCw,
   LogOut,
   ChevronLeft,
   Search,
   Scan,
   X,
   Download,
   Upload,
   Star,
   Check,
   CheckSquare,
   MoreHorizontal,
   WifiOff,
  } from "lucide-react";
 import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import ProductRow from "@/components/pos/ProductRow";
import type { InventoryProduct } from "@/components/pos/ProductRow";
import { useAuth } from "@/lib/auth/AuthContext";
import { PermissionGuard } from "@/lib/auth/guards";
import { formatLL, formatUSD, convertLlToUsdForSale, SELL_RATE, RETURN_RATE, convertLlToUsdForReturn } from "@/lib/utils/format";
import dynamic from "next/dynamic";
// See the POS page: the scanner drags in @zxing/library, so it is loaded on
// demand and the beep comes from the standalone feedback module instead.
import { playSuccessSound, playErrorSound } from "@/lib/feedback";
import { isDesktop } from "@/lib/device";
import CSVImportDialog from "@/components/CSVImportDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { getFrequentlyUsedProductIds, addFrequentlyUsedProduct, removeFrequentlyUsedProduct, isFrequentlyUsed, syncFavoritesFromSupabase } from "@/lib/frequentlyUsed";
import { downloadCSV, productsToCSV } from "@/lib/csv/utils";
import { FeatureFlagGuard, useFeatureFlag } from "@/lib/auth/featureGuard";
import { refreshProductsIntoCache } from "@/lib/products/refresh";
import { getCachedProductsSortedByName } from "@/lib/db/localDB";
import type { CachedProduct } from "@/lib/db/localDB";
import { connectivity } from "@/lib/connectivity";
import { useReloadGuard } from "@/lib/pwa/useReloadGuard";
import BulkPriceDialog from "@/components/pos/BulkPriceDialog";
import {
  chunkIds,
  countRequests,
  type BulkPlan,
  type BulkTarget,
} from "@/lib/products/bulkPricing";
import { logActivity } from "@/lib/activity/logger";

interface Product {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: 'LL' | 'USD';
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string | null;
  variant_name?: string | null;
}

type StockFilter = "all" | "low" | "out";

/** Row shapes the virtualiser renders — section headers share the list. */
type ListRow =
  | { kind: "header"; id: string; label: string; count: number }
  | { kind: "product"; id: string; product: InventoryProduct };

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), {
  ssr: false,
  loading: () => (
    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
      Starting camera…
    </div>
  ),
});

export default function StoreProductsPage() {
  return (
    <PermissionGuard section="inventory">
      <StoreProductsPageContent />
    </PermissionGuard>
  );
}

function StoreProductsPageContent() {
  const router = useRouter();
  const { user, logout: authLogout, isLoading: authLoading } = useAuth();
  // Destructive confirms (delete, wipe-and-replace import) go through this.
  const { confirm, confirmDialog } = useConfirm();
  // Lazy init supabase client inside component to avoid SSR issues on hard refresh
  const [supabase] = useState(() => createClient());
  const [storeId, setStoreId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const [showScanSearch, setShowScanSearch] = useState(false);
  const [isOffline, setIsOffline] = useState(connectivity.isOffline);
  // O(1) barcode product index
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, Product>>(new Map());
  // Desktop mode for hardware scanner (no camera)
  const [isDesktopMode, setIsDesktopMode] = useState(false);
  // Force re-render when star is toggled (localStorage change)
  const [freqVersion, setFreqVersion] = useState(0);
  // Which stock bucket the list is narrowed to.
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  // Only one row may have its swipe actions revealed at a time.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // Row tapped open for the read-only detail sheet.
  const [detailProduct, setDetailProduct] = useState<InventoryProduct | null>(null);
  // Import / export / refresh / sign out, kept out of the header.
  const [showMore, setShowMore] = useState(false);
  // True while a network refresh runs BEHIND an already-painted list. Distinct
  // from isLoading, which means "there is nothing to show yet".
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Invalidates in-flight loads. Incremented on every new load and on unmount,
  // so a slow fetch cannot write its result over a newer one - or into a page
  // that has gone away.
  const loadTokenRef = useRef(0);
  /** Abandon every load currently in flight. */
  const invalidateLoads = useCallback(() => {
    loadTokenRef.current++;
  }, []);

  // ---- Bulk select ----
  // Selection is keyed by product id, never by list index: the list is
  // virtualised and re-sorts on every search keystroke, so an index-keyed
  // selection would silently point at different products.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkScan, setShowBulkScan] = useState(false);
  const [showBulkApply, setShowBulkApply] = useState(false);
  const [bulkScanLog, setBulkScanLog] = useState<string[]>([]);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  // Store-level gate for the discount half of the bulk tool.
  const discountEnabled = useFeatureFlag("product_discount");

  // A deployed update must not reload the page out from under a task in
  // progress. Building a bulk selection is the case that actually broke: the
  // cart is empty on this screen, so the update listener's cart check never
  // protected it and a selection of 5 products vanished mid-edit.
  useReloadGuard(
    selectMode ||
      isDialogOpen ||
      showImportDialog ||
      showBulkScan ||
      showBulkApply ||
      showBarcodeScanner ||
      showScanSearch ||
      detailProduct !== null ||
      isSubmitting ||
      isApplyingBulk,
    "inventory-busy"
  );

  // Track online/offline status for UI (heartbeat-based)
  useEffect(() => {
    const unsubscribe = connectivity.subscribe((status) => {
      setIsOffline(status === "offline");
    });
    return unsubscribe;
  }, []);

  // Detect desktop mode — skip camera, use compact barcode input
  useEffect(() => {
    if (isDesktop()) {
      setIsDesktopMode(true);
    }
  }, []);

  // Form state
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [currency, setCurrency] = useState<'LL' | 'USD'>("LL");
  const [costPrice, setCostPrice] = useState("");
  const [profitPercentage, setProfitPercentage] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [minStockThreshold, setMinStockThreshold] = useState("0");

  // Product Variants
  const [variants, setVariants] = useState<Array<{ barcode: string; variantName: string }>>([]);
  
  const addVariant = () => {
    setVariants([...variants, { barcode: "", variantName: "" }]);
  };
  
  const removeVariant = (index: number) => {
    setVariants(variants.filter((_, i) => i !== index));
  };
  
  const updateVariant = (index: number, field: 'barcode' | 'variantName', value: string) => {
    const newVariants = [...variants];
    newVariants[index][field] = value;
    setVariants(newVariants);
  };

  // Track which field triggered the update to avoid circular updates
  const [lastUpdated, setLastUpdated] = useState<'cost' | 'profit' | 'selling'>("cost");

  // Tri-directional calculation functions
  const calculateSellingPrice = (cost: number, profit: number) => {
    return cost * (1 + profit / 100);
  };

  const calculateProfitPercentage = (cost: number, selling: number) => {
    if (cost === 0) return 0;
    return ((selling - cost) / cost) * 100;
  };

  // Handle cost price change
  const handleCostPriceChange = (value: string) => {
    setCostPrice(value);
    setLastUpdated('cost');
    
    const cost = parseFloat(value) || 0;
    const profit = parseFloat(profitPercentage) || 0;
    
    if (cost > 0) {
      const calculatedSelling = calculateSellingPrice(cost, profit);
      setSellingPrice(calculatedSelling.toString());
    } else {
      setSellingPrice("");
    }
  };

  // Handle profit percentage change
  const handleProfitPercentageChange = (value: string) => {
    setProfitPercentage(value);
    setLastUpdated('profit');
    
    const cost = parseFloat(costPrice) || 0;
    const profit = parseFloat(value) || 0;
    
    if (cost > 0) {
      const calculatedSelling = calculateSellingPrice(cost, profit);
      setSellingPrice(calculatedSelling.toString());
    } else {
      setSellingPrice("");
    }
  };

  // Handle selling price change
  const handleSellingPriceChange = (value: string) => {
    setSellingPrice(value);
    setLastUpdated('selling');
    
    const cost = parseFloat(costPrice) || 0;
    const selling = parseFloat(value) || 0;
    
    if (cost > 0) {
      const calculatedProfit = calculateProfitPercentage(cost, selling);
      setProfitPercentage(calculatedProfit.toFixed(2));
    } else {
      setProfitPercentage("");
    }
  };

  // Load products when user is available
  useEffect(() => {
    if (!user) return;
    setStoreId(user.storeId);
    fetchProducts(user.storeId);
    // Sync favorites from Supabase (merge remote stars into localStorage)
    // then force re-render so star icons reflect the merged state
    syncFavoritesFromSupabase(user.storeId).then(() => {
      setFreqVersion(v => v + 1);
    });
    // Invalidate whatever is still in flight. Without this, a fetch that
    // resolves after the user has left writes into an unmounted page.
    return invalidateLoads;
  }, [user, invalidateLoads]);

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

  // ---- Debounce search query (200ms) to avoid filtering on every keystroke ----
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery]);

  // ---- Build O(1) barcode index whenever products change ----
  useEffect(() => {
    const index = new Map<string, Product>();
    for (const p of products) {
      if (p.barcode) {
        index.set(p.barcode, p);
      }
    }
    setBarcodeIndex(index);
  }, [products]);

  // ---- Derived barcode validation (O(1) lookup, works offline) ----
  const barcodeStatus = useMemo(() => {
    const trimmed = barcode.trim();
    if (!trimmed) return null;
    const existing = barcodeIndex.get(trimmed);
    if (existing) {
      // When editing, the product's own barcode exists in the index.
      // Allow it only if it belongs to the product currently being edited.
      if (editingProduct && existing.id === editingProduct.id) {
        return { valid: true };
      }
      return { valid: false, existingName: existing.name };
    }
    return { valid: true };
  }, [barcode, barcodeIndex, editingProduct]);

  /**
   * Cached rows into the page's Product shape. The cache stores {currency} as a
   * plain string; every price helper downstream expects the union.
   */
  const toProducts = (rows: CachedProduct[]): Product[] =>
    rows.map((p) => ({
      id: p.id,
      store_id: p.store_id,
      name: p.name,
      barcode: p.barcode,
      cost_price: p.cost_price,
      selling_price: p.selling_price,
      currency: p.currency === "USD" ? "USD" : "LL",
      profit_percentage: p.profit_percentage,
      discount_percentage: p.discount_percentage || 0,
      stock_quantity: p.stock_quantity,
      min_stock_threshold: p.min_stock_threshold,
      parent_id: p.parent_id ?? null,
      variant_name: p.variant_name ?? null,
    }));

  /**
   * Load the product list: paint the cache, then refresh behind it.
   *
   * This screen used to await a full paginated pull of the whole catalogue
   * before rendering anything — about 4 seconds of skeletons on a
   * 2,300-product store, on every single entry. The cache is a complete
   * mirror, so it is what the user sees within a frame of arriving, and the
   * network refresh lands behind it.
   *
   * It is still genuinely fresh: every load hits Supabase. What changed is
   * that it asks only for rows whose updated_at moved (see
   * refreshProductsIntoCache) instead of re-downloading the whole catalogue.
   */
  const fetchProducts = async (storeId: string) => {
    const token = ++loadTokenRef.current;
    const isStale = () => token !== loadTokenRef.current;
    let painted = false;

    try {
      const cached = await getCachedProductsSortedByName(storeId);
      if (isStale()) return;
      if (cached.length > 0) {
        setProducts(toProducts(cached));
        setIsLoading(false);
        painted = true;
      }

      // Offline is NOT an error on this screen — the cache above IS the
      // product list, and an offline-first POS has to show it. This used to
      // toast an error and render an empty page on a device holding a
      // complete catalogue. Only say something when there is nothing to show.
      if (connectivity.isOffline) {
        if (!painted) {
          toast.error("No internet connection. Please connect to load products.");
        }
        return;
      }

      setIsRefreshing(true);
      const result = await refreshProductsIntoCache(supabase, storeId);
      if (isStale()) return;

      // Nothing moved on the server: leave products alone. Replacing the array
      // rebuilds every row object and forces the virtualiser to re-measure,
      // which reads as the list jumping under a selection in progress.
      if (result.changed || !painted) {
        const fresh = await getCachedProductsSortedByName(storeId);
        if (isStale()) return;
        setProducts(toProducts(fresh));
      }
    } catch (error: any) {
      if (isStale()) return;
      console.error("Error fetching products:", error);
      if (painted) {
        // A usable list is already on screen — a failed background refresh is
        // not worth interrupting the user for.
        console.warn("[Inventory] Background refresh failed; showing cached products");
      } else if (
        error?.message?.includes("Failed to fetch") ||
        error?.message?.includes("NetworkError")
      ) {
        toast.error("Network error. Please check your internet connection.");
      } else {
        toast.error("Failed to load products");
      }
    } finally {
      if (!isStale()) {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) {
      toast.error("Store not found");
      return;
    }

    // Block submission if the barcode is a duplicate of an existing product
    if (barcode.trim() && barcodeStatus?.valid === false) {
      toast.error(
        `This barcode is already assigned to "${barcodeStatus.existingName}". Please use a different barcode or clear the field.`
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const cost = parseFloat(costPrice) || 0;
      const selling = parseFloat(sellingPrice) || 0;
      const profit = parseFloat(profitPercentage) || 0;

      let parentProductId;

      const discount = parseFloat(discountPercentage) || 0;
      const stockQty = parseInt(stockQuantity) || 0;
      const minStock = parseInt(minStockThreshold) || 0;

      if (editingProduct) {
        // Update existing product
        const { data, error } = await supabase
          .from("products")
          .update({
            name: name,
            barcode: barcode || null,
            cost_price: cost,
            selling_price: selling,
            currency: currency,
            profit_percentage: profit,
            discount_percentage: discount,
            stock_quantity: stockQty,
            min_stock_threshold: minStock,
          })
          .eq("id", editingProduct.id)
          .select()
          .single();

        if (error) throw error;
        parentProductId = data.id;
        // NOTE: this form still writes straight to Supabase rather than going
        // through products/write.ts, so it is online-only and there is no
        // syncedNow to report. Moving it across is an open task.
        logActivity("catalog.product_update", {
          target: name,
          details: {
            product_id: data.id,
            barcode: barcode || null,
            selling_price: selling,
            cost_price: cost,
            currency,
            discount_percentage: discount,
            stock_quantity: stockQty,
            source: "inventory_form",
          },
        });
        toast.success(`Product "${name}" updated successfully!`);
      } else {
        // Create new product
        const { data, error } = await supabase
          .from("products")
          .insert({
            store_id: storeId,
            name: name,
            barcode: barcode || null,
            cost_price: cost,
            selling_price: selling,
            currency: currency,
            profit_percentage: profit,
            discount_percentage: discount,
            stock_quantity: stockQty,
            min_stock_threshold: minStock,
          })
          .select()
          .single();

        if (error) throw error;
        parentProductId = data.id;
        logActivity("catalog.product_create", {
          target: name,
          details: {
            product_id: data.id,
            barcode: barcode || null,
            selling_price: selling,
            cost_price: cost,
            currency,
            discount_percentage: discount,
            stock_quantity: stockQty,
            variants: variants.filter((v) => v.barcode.trim()).length,
            source: "inventory_form",
          },
        });
        toast.success(`Product "${name}" created successfully!`);
      }

      // Create all product variants
      if (variants.length > 0) {
        const variantRows = variants.filter(v => v.barcode.trim()).map(variant => ({
          store_id: storeId,
          name: name,
          parent_id: parentProductId,
          barcode: variant.barcode.trim() || null,
          variant_name: variant.variantName.trim() || null,
          cost_price: 0,
          selling_price: 0,
          currency: currency,
          profit_percentage: 0,
          stock_quantity: 0,
          min_stock_threshold: parseInt(minStockThreshold),
        }));

        if (variantRows.length > 0) {
          const { error: variantError } = await supabase
            .from("products")
            .insert(variantRows);

          if (variantError) {
            console.error("Variant save error:", variantError);
            toast.warning("Product saved but some variants may have failed");
          }
        }
      }

      setIsDialogOpen(false);
      resetForm();

      // CRITICAL FIX: Upsert the saved product directly into the local cache
      // instead of relying only on a full refetch. This keeps the cache
      // consistent even if the subsequent fetch fails or is interrupted.
      try {
        const { upsertSingleProduct } = await import("@/lib/db/localDB");
        await upsertSingleProduct({
          id: parentProductId,
          store_id: storeId,
          name: name,
          barcode: barcode || null,
          cost_price: cost,
          selling_price: selling,
          currency: currency,
          profit_percentage: profit,
          discount_percentage: discount,
          stock_quantity: stockQty,
          min_stock_threshold: minStock,
          parent_id: null,
          variant_name: null,
          updated_at: new Date().toISOString(),
        } as any);
      } catch (cacheError) {
        console.warn("[Products] Failed to update local cache after save:", cacheError);
      }

      fetchProducts(storeId);
    } catch (error: any) {
      console.error("Error saving product:", error);
      if (error.code === "23505") {
        toast.error("Product with this barcode already exists in your store");
      } else {
        toast.error("Failed to save product");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setBarcode(product.barcode || "");
    setCurrency(product.currency || "LL");
    setCostPrice(product.cost_price.toString());
    setProfitPercentage(product.profit_percentage.toString());
    setDiscountPercentage(product.discount_percentage?.toString() || "0");
    setSellingPrice(product.selling_price.toString());
    setStockQuantity(product.stock_quantity.toString());
    setMinStockThreshold(product.min_stock_threshold.toString());
    setIsDialogOpen(true);
  };

  const handleDeleteProduct = async (productId: string, productName: string) => {
    // Deleting also takes any variants of this product with it, and there is
    // no undo — hence the cooldown rather than a bare yes/no.
    const confirmed = await confirm({
      title: "Delete this product?",
      description:
        "It is removed from your inventory and from every till that has it cached. This cannot be undone.",
      details: (
        <div className="rounded-2xl bg-muted/50 px-4 py-3">
          <p className="font-semibold">{productName}</p>
        </div>
      ),
      confirmLabel: "Delete",
      confirmIcon: <Trash2 className="h-4 w-4" />,
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", productId);

      if (error) {
        // Handle FK constraint violations (product has transaction history)
        if (error.code === "23503") {
          toast.error(`Cannot delete "${productName}" — it has transaction history. Consider deactivating it instead.`);
          return;
        }
        throw error;
      }

      // CRITICAL FIX: Remove the product from the local cache immediately.
      // This prevents the deleted product from reappearing on refresh.
      try {
        const { removeCachedProducts } = await import("@/lib/db/localDB");

        // Find and remove any variant products that reference this product as parent
        const variantIds = products
          .filter((p) => p.parent_id === productId)
          .map((p) => p.id);

        const idsToRemove = [productId, ...variantIds];
        await removeCachedProducts(idsToRemove);

        // Also remove from React state immediately
        setProducts((prev) => prev.filter((p) => !idsToRemove.includes(p.id)));

        // Clean up favorites for the deleted product and its variants
        try {
          const { removeFrequentlyUsedProduct } = await import("@/lib/frequentlyUsed");
          for (const id of idsToRemove) {
            removeFrequentlyUsedProduct(storeId, id);
          }
        } catch {}
      } catch (cacheError) {
        console.warn("[Products] Failed to update local cache after delete:", cacheError);
      }

      logActivity("catalog.product_delete", {
        target: productName,
        details: {
          product_id: productId,
          variants_removed: products.filter((p) => p.parent_id === productId).length,
        },
      });
      toast.success(`Product "${productName}" deleted`);
      fetchProducts(storeId);
    } catch (error: any) {
      console.error("Error deleting product:", error);
      toast.error(error?.message || "Failed to delete product");
    }
  };

  const resetForm = () => {
    setName("");
    setBarcode("");
    setCurrency("LL");
    setCostPrice("");
    setProfitPercentage("");
    setDiscountPercentage("");
    setSellingPrice("");
    setStockQuantity("");
    setMinStockThreshold("0");
    setEditingProduct(null);
    setLastUpdated('cost');
  };

  const handleLogout = () => {
    authLogout();
    router.push("/login");
  };

  const handleExportProducts = () => {
    if (products.length === 0) {
      toast.error("No products to export");
      return;
    }

    logActivity("catalog.export", { details: { rows: products.length } });

    try {
      // Build a lookup map: parent UUID -> parent barcode
      const parentBarcodeMap = new Map<string, string>();
      products.forEach(p => {
        parentBarcodeMap.set(p.id, p.barcode || p.id);
      });

      // Convert products to CSV format (includes variant fields for variants)
      // parent_id column uses parent's barcode for easy re-import
      const csvData = products.map((p: any) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode || '',
        cost_price: p.parent_id ? 0 : p.cost_price,
        selling_price: p.parent_id ? 0 : p.selling_price,
        currency: p.currency,
        profit_percentage: p.parent_id ? 0 : p.profit_percentage,
        stock_quantity: p.stock_quantity,
        min_stock_threshold: p.min_stock_threshold,
        parent_id: p.parent_id ? (parentBarcodeMap.get(p.parent_id) || p.parent_id) : '',
        variant_name: p.variant_name || '',
      }));

      const csvContent = productsToCSV(csvData);
      const filename = `products_export_${new Date().toISOString().slice(0, 10)}`;
      
      downloadCSV(csvContent, filename);
      toast.success(`Exported ${products.length} products to CSV`);

      // Log export operation
      fetch("/api/products/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId,
          totalRows: products.length,
          fileName: `${filename}.csv`,
          fileSize: new Blob([csvContent]).size,
        }),
      }).catch(console.error);

    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export products");
    }
  };

  const handleBarcodeScanFromCamera = (scannedBarcode: string) => {
    // Validate barcode before setting
    if (!scannedBarcode || scannedBarcode.trim().length === 0) {
      toast.error("Invalid barcode scanned");
      return;
    }
    
    const trimmedBarcode = scannedBarcode.trim();
    
    // Check barcode length (typical barcodes are 8-13 characters)
    if (trimmedBarcode.length < 2 || trimmedBarcode.length > 30) {
      toast.error("Barcode length is invalid. Please try again.");
      return;
    }
    
    // Check if barcode contains only valid characters (alphanumeric and common symbols)
    const validBarcodeRegex = /^[A-Za-z0-9\-_]+$/;
    if (!validBarcodeRegex.test(trimmedBarcode)) {
      toast.error("Barcode contains invalid characters. Please try again.");
      return;
    }

    // Check if we are scanning for a variant
    if (typeof (window as any).currentScanningVariantIndex !== 'undefined') {
      const variantIndex = (window as any).currentScanningVariantIndex;
      updateVariant(variantIndex, 'barcode', trimmedBarcode);
      delete (window as any).currentScanningVariantIndex;
      toast.success(`Variant ${variantIndex + 1} barcode scanned successfully!`);
    } else {
      setBarcode(trimmedBarcode);
      toast.success("Barcode scanned successfully! If this is the wrong barcode, you can clear it and scan again.");
    }

    setShowBarcodeScanner(false);
  };

  const handleBarcodeScan = async () => {
    if (!barcode.trim()) {
      toast.error("Please enter a barcode");
      return;
    }

    const trimmedBarcode = barcode.trim();
    
    // Validate barcode length
    if (trimmedBarcode.length < 2 || trimmedBarcode.length > 30) {
      toast.error("Barcode must be between 2 and 30 characters");
      return;
    }

    // Check if product with this barcode already exists (O(1) lookup)
    const existingProduct = barcodeIndex.get(trimmedBarcode);
    if (existingProduct) {
      toast.error("Product with this barcode already exists");
      return;
    }

    toast.success("Barcode is available");
  };

  // Build a set of product IDs that are parents (referenced by other products'
  // parent_id). Memoized on `products` — it does not depend on the search.
  const parentIds = useMemo(() => {
    const ids = new Set<string>();
    products.forEach((p) => {
      if (p.parent_id) ids.add(p.parent_id);
    });
    return ids;
  }, [products]);

  // Filter + decorate the list for rendering.
  //
  // This whole block used to run in the component body on EVERY render — a
  // full filter, a full map allocating a new object per row, and (below) four
  // more full traversals for the stat tiles. At 2,500 products that was ~15k
  // iterations plus 2,500 allocations on every keystroke, dialog toggle and
  // star click. The fresh objects also changed item identity each render,
  // which defeated the virtualizer's reuse.
  const filteredProducts = useMemo(() => {
    // Hoisted: this was being recomputed once per product inside the predicate.
    const q = debouncedSearch.toLowerCase();

    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(q) ||
          product.barcode?.toLowerCase().includes(q)
      )
      .map((product): InventoryProduct => {
        const isParent = parentIds.has(product.id);
        const isVariant = !!product.parent_id;

        return {
          ...product,
          // Variants read as "Parent - Flavour" so a search result is
          // unambiguous without opening it.
          _displayName:
            isVariant && product.variant_name
              ? `${product.name} - ${product.variant_name}`
              : product.name,
          _isVariant: isVariant,
          _isParent: isParent,
        };
      });
  }, [products, debouncedSearch, parentIds]);

  // Counts for the filter chips. Always over the whole catalogue, not the
  // current filter — a chip that reports the count of its own selection is
  // useless for deciding whether to tap it.
  const { totalProducts, lowStockCount, outOfStockCount } = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const p of products) {
      if (p.stock_quantity <= 0) out++;
      else if (p.stock_quantity <= p.min_stock_threshold) low++;
    }
    return {
      totalProducts: products.length,
      lowStockCount: low,
      outOfStockCount: out,
    };
  }, [products]);

  // The rendered list: a flat array so section headers can be virtualised
  // alongside the rows instead of forcing the whole catalogue into the DOM.
  const listRows = useMemo(() => {
    const rows: ListRow[] = [];

    const needsRestock = (p: InventoryProduct) =>
      p.stock_quantity <= 0 || p.stock_quantity <= p.min_stock_threshold;

    if (stockFilter === "low") {
      const set = filteredProducts.filter(
        (p) => p.stock_quantity > 0 && p.stock_quantity <= p.min_stock_threshold
      );
      set.forEach((product) => rows.push({ kind: "product", id: product.id, product }));
      return rows;
    }

    if (stockFilter === "out") {
      const set = filteredProducts.filter((p) => p.stock_quantity <= 0);
      set.forEach((product) => rows.push({ kind: "product", id: product.id, product }));
      return rows;
    }

    // "All" splits the list: anything at or below its restock line floats to
    // the top, because that is the only part of a 2,500-row catalogue that
    // needs a decision today.
    const restock = filteredProducts.filter(needsRestock);
    const rest = filteredProducts.filter((p) => !needsRestock(p));

    if (restock.length > 0) {
      rows.push({
        kind: "header",
        id: "h-restock",
        label: "Needs restock",
        count: restock.length,
      });
      restock.forEach((product) => rows.push({ kind: "product", id: product.id, product }));
    }
    if (rest.length > 0) {
      rows.push({
        kind: "header",
        id: "h-all",
        label: restock.length > 0 ? "All products" : "Products",
        count: rest.length,
      });
      rest.forEach((product) => rows.push({ kind: "product", id: product.id, product }));
    }
    return rows;
  }, [filteredProducts, stockFilter]);

  // Everything currently on screen that can actually be repriced. Derived from
  // `listRows`, so "Select all" honours the search box and the stock chips and
  // never reaches past what the owner can see.
  const visibleSelectableIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of listRows) {
      if (row.kind === "product" && !row.product._isVariant) ids.push(row.product.id);
    }
    return ids;
  }, [listRows]);

  // The selection as the planner sees it. Derived from `products` rather than
  // captured when each row was ticked, so a refetch mid-selection can never
  // apply a percentage against a stale cost price. Products deleted in the
  // meantime drop out on their own.
  // Parent id → its variant rows. Built in one pass so the selection below does
  // not filter the whole catalogue once per selected product.
  const variantIdsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of products) {
      if (!p.parent_id) continue;
      const bucket = map.get(p.parent_id);
      if (bucket) bucket.push(p.id);
      else map.set(p.parent_id, [p.id]);
    }
    return map;
  }, [products]);

  const selectedTargets = useMemo<BulkTarget[]>(() => {
    if (selectedIds.size === 0) return [];
    return products
      .filter((p) => selectedIds.has(p.id) && !p.parent_id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        currency: p.currency || "LL",
        cost_price: p.cost_price,
        selling_price: p.selling_price,
        discount_percentage: p.discount_percentage || 0,
        // Only the currency planner uses these — a variant is never repriced,
        // but it has to follow its parent's denomination.
        variantIds: variantIdsByParent.get(p.id) ?? [],
      }));
  }, [products, selectedIds, variantIdsByParent]);

  const selectionCount = selectedTargets.length;

  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((id) => selectedIds.has(id));

  // Virtual scrolling setup for product list
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: listRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (listRows[index]?.kind === "header" ? 36 : 69),
    overscan: 8,
    getItemKey: (index) => listRows[index]?.id ?? index,
  });

  const favStoreId = user?.storeId || "";

  const toggleFavourite = (product: InventoryProduct) => {
    const wasFavourite = isFrequentlyUsed(favStoreId, product.id);
    logActivity("catalog.favorite_toggle", {
      target: product.name,
      details: { product_id: product.id, added: !wasFavourite },
    });
    if (wasFavourite) {
      removeFrequentlyUsedProduct(favStoreId, product.id);
      toast.info(`${product.name} removed from quick access`, { key: "favourite" });
    } else {
      addFrequentlyUsedProduct(favStoreId, product.id);
      toast.success(`${product.name} added to quick access`, { key: "favourite" });
    }
    setFreqVersion((v) => v + 1);
  };

  const enterSelectMode = () => {
    setSelectMode(true);
    // Nothing from the single-product world should still be open behind the
    // selection UI.
    setOpenRowId(null);
    setDetailProduct(null);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkScanLog([]);
  };

  const toggleSelect = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        // Clear only what is on screen — a selection built by scanning must
        // survive the owner tapping Clear while a filter is narrowing the list.
        visibleSelectableIds.forEach((id) => next.delete(id));
      } else {
        visibleSelectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /**
   * Chain scanning: every scan ADDS to the selection, it never toggles.
   *
   * The scanner reports continuously with only a 500 ms dedup window
   * (BarcodeScanner DEDUP_WINDOW_MS), so a barcode left sitting in frame fires
   * repeatedly. A toggle would flicker that product in and out of the
   * selection; an idempotent add just stays added.
   */
  const handleBulkScanSelect = (scannedBarcode: string) => {
    const code = scannedBarcode.trim();
    if (!code) return;

    const hit = barcodeIndex.get(code);
    if (!hit) {
      playErrorSound();
      toast.error("No product with that barcode", { key: "bulk-scan" });
      return;
    }

    // A variant's barcode is an alias for its parent, and the parent is where
    // the price lives — so scanning a variant selects the product that a
    // reprice can actually act on.
    const target = hit.parent_id
      ? products.find((p) => p.id === hit.parent_id)
      : hit;

    if (!target) {
      playErrorSound();
      toast.error("That barcode belongs to a variant with no parent", {
        key: "bulk-scan",
      });
      return;
    }

    if (selectedIds.has(target.id)) {
      toast.info(`${target.name} is already selected`, { key: "bulk-scan" });
      return;
    }

    playSuccessSound();
    setSelectedIds((prev) => new Set(prev).add(target.id));
    setBulkScanLog((prev) => [target.name, ...prev].slice(0, 5));
    toast.success(`Added ${target.name}`, { key: "bulk-scan" });
  };

  /**
   * Apply a bulk plan.
   *
   * Two things here are load-bearing and must not be simplified away:
   *
   *  - Profit is applied by writing `selling_price`, never `profit_percentage`.
   *    `trigger_calculate_profit` (migration 005) recomputes the percentage from
   *    cost and selling on every UPDATE, so writing the percentage is a no-op.
   *  - The `.select()` reads back what the database actually stored, including
   *    the trigger's recomputed percentage, so local state and the offline cache
   *    are written from server truth rather than from an optimistic guess.
   */
  const handleBulkApply = async (plan: BulkPlan) => {
    if (!storeId) {
      toast.error("Store not found");
      return;
    }
    if (!plan.valid || plan.changes.length === 0) return;

    // The dialog hides the Discount chip when the store lacks the feature; this
    // refuses the write as well. Same belt-and-braces as the POS cart-add check.
    if (plan.mode === "discount" && !discountEnabled) {
      toast.error("Discounts are not enabled for this store", { key: "bulk-apply" });
      return;
    }

    setIsApplyingBulk(true);
    setBulkProgress({ done: 0, total: countRequests(plan) });
    logActivity("catalog.bulk_apply", {
      target: plan.mode,
      details: { affected: plan.changes.length, batches: plan.batches.length },
    });

    type AppliedRow = {
      id: string;
      cost_price: number;
      selling_price: number;
      currency: string | null;
      profit_percentage: number;
      discount_percentage: number;
    };
    const applied: AppliedRow[] = [];
    let failure: string | null = null;

    try {
      for (const batch of plan.batches) {
        for (const chunk of chunkIds(batch.ids)) {
          const { data, error } = await supabase
            .from("products")
            .update(batch.patch)
            .in("id", chunk)
            // The single-product edit path filters on id alone and leans
            // entirely on RLS. Scoping the bulk write by store as well is a
            // strengthening — do not drop it to make something work.
            .eq("store_id", storeId)
            .select(
              "id, cost_price, selling_price, currency, profit_percentage, discount_percentage"
            );

          if (error) throw error;
          if (data) applied.push(...(data as AppliedRow[]));
          setBulkProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        }
      }
    } catch (error: unknown) {
      console.error("[Products] Bulk apply failed:", error);
      failure = error instanceof Error ? error.message : "Unknown error";
    }

    // Reconcile whatever did land, success or partial failure alike.
    if (applied.length > 0) {
      const byId = new Map(applied.map((row) => [row.id, row]));

      setProducts((prev) =>
        prev.map((p) => {
          const row = byId.get(p.id);
          if (!row) return p;
          return {
            ...p,
            cost_price: Number(row.cost_price),
            selling_price: Number(row.selling_price),
            currency: row.currency === "USD" ? "USD" : "LL",
            profit_percentage: Number(row.profit_percentage),
            discount_percentage: Number(row.discount_percentage),
          };
        })
      );

      try {
        const { localDB } = await import("@/lib/db/localDB");
        await localDB.products_cache
          .where("id")
          .anyOf(applied.map((row) => row.id))
          .modify((cached) => {
            const row = byId.get(cached.id);
            if (!row) return;
            cached.cost_price = Number(row.cost_price);
            cached.selling_price = Number(row.selling_price);
            cached.currency = row.currency === "USD" ? "USD" : "LL";
            cached.profit_percentage = Number(row.profit_percentage);
            cached.discount_percentage = Number(row.discount_percentage);
          });
      } catch (cacheError) {
        console.warn("[Products] Failed to update local cache after bulk apply:", cacheError);
      }
    }

    setIsApplyingBulk(false);
    setBulkProgress(null);

    // Variant rows ride along in the currency patch but were never counted as
    // changes, so report against the plan rather than against every row the
    // database handed back.
    const plannedIds = new Set(plan.changes.map((change) => change.id));
    const appliedCount = applied.filter((row) => plannedIds.has(row.id)).length;

    if (failure) {
      toast.error(
        `Updated ${appliedCount} of ${plan.changes.length} — ${failure}`,
        { key: "bulk-apply" }
      );
    } else {
      toast.success(
        `Updated ${appliedCount} product${appliedCount !== 1 ? "s" : ""}`,
        { key: "bulk-apply" }
      );
      setShowBulkApply(false);
      exitSelectMode();
    }

    fetchProducts(storeId);
  };

  const FILTERS: { key: StockFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: 0 },
    { key: "low", label: "Low", count: lowStockCount },
    { key: "out", label: "Out", count: outOfStockCount },
  ];

  // Auth resolving, or the first product fetch still in flight. Skeleton rows
  // rather than a full-screen spinner: the page keeps its shape, so nothing
  // jumps when the catalogue lands.
  const isBusy = authLoading || isLoading;
  const needsRestockTotal = lowStockCount + outOfStockCount;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ---- Header ---- */}
      <header className="safe-top flex-shrink-0 px-4 pt-3">
        {selectMode ? (
          /*
            The header becomes the selection bar rather than growing a third
            row of controls — the count and the way out need to be the two
            most obvious things on screen while a selection is being built.
          */
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={exitSelectMode}
                aria-label="Exit selection"
                className="tap -ml-2 flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="text-[22px] font-bold leading-none tnum">
                  {selectionCount} selected
                </h1>
                <p className="mt-1.5 truncate text-xs text-muted-foreground">
                  Tap rows, search, or scan to add
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleSelectAllVisible}
              disabled={visibleSelectableIds.length === 0}
              className="tap flex h-11 flex-none items-center rounded-2xl bg-muted/60 px-4 text-sm font-semibold disabled:opacity-40"
            >
              {allVisibleSelected ? "Clear" : "Select all"}
            </button>
          </div>
        ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-1">
            <button
              type="button"
              onClick={() => router.push("/pos")}
              aria-label="Back to sale"
              className="tap -ml-2 mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground md:hidden"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold leading-none">Inventory</h1>
              <p className="mt-1.5 text-xs text-muted-foreground tnum">
                {totalProducts} product{totalProducts !== 1 ? "s" : ""}
                {needsRestockTotal > 0 && ` · ${needsRestockTotal} need restock`}
                {isRefreshing && " · updating…"}
              </p>
            </div>
          </div>

          {/* Desktop has room for labels, so the two actions a shopkeeper
              actually reaches for come out of the overflow menu and onto the
              bar. Import/export and sign out stay in the menu: rare, and one
              of them is destructive enough to be worth a deliberate trip.
              Phones keep the compact icon row -- there is no width for this. */}
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={enterSelectMode}
              className="tap hidden h-11 items-center gap-2 rounded-2xl bg-muted/60 px-4 text-sm font-semibold text-muted-foreground hover:text-foreground md:flex"
            >
              <CheckSquare className="h-4 w-4" />
              Select products
            </button>
            <button
              type="button"
              onClick={() => fetchProducts(storeId)}
              disabled={isRefreshing}
              className="tap hidden h-11 items-center gap-2 rounded-2xl bg-muted/60 px-4 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60 md:flex"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              Refresh from server
            </button>
            <button
              type="button"
              onClick={() => setShowMore(true)}
              aria-label="More actions"
              className="tap flex h-11 w-11 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setIsDialogOpen(true);
              }}
              disabled={isOffline}
              aria-label="Add product"
              className="tap flex h-11 w-11 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 md:w-auto md:px-4"
            >
              <Plus className="h-5 w-5 md:h-4 md:w-4" />
              <span className="hidden md:inline">Add product</span>
            </button>
          </div>
        </div>
        )}
      </header>

      {/* ---- Search + scan ---- */}
      <div className="flex flex-shrink-0 gap-2 px-4 pt-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or barcode"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="tap absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/*
          One scan button, two jobs. Out of select mode it finds a product; in
          select mode it adds to the selection. A second scan button would only
          make the owner choose between two things that both say "scan".
        */}
        <button
          type="button"
          onClick={() => {
            if (selectMode) {
              setBulkScanLog([]);
              setShowBulkScan(true);
            } else {
              setShowScanSearch(true);
            }
          }}
          aria-label={
            selectMode ? "Scan to add products to the selection" : "Scan to find a product"
          }
          className={cn(
            "tap flex h-11 w-11 flex-none items-center justify-center rounded-xl",
            selectMode
              ? "bg-primary text-primary-foreground"
              : "border border-primary/40 text-primary"
          )}
        >
          <Scan className="h-5 w-5" />
        </button>
      </div>

      {/* ---- Filters ---- */}
      <div className="flex flex-shrink-0 gap-2 px-4 pb-3 pt-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setStockFilter(f.key);
              setOpenRowId(null);
            }}
            aria-pressed={stockFilter === f.key}
            className={cn(
              "tap flex h-9 flex-none items-center gap-1.5 rounded-full px-4 text-sm font-semibold",
              stockFilter === f.key
                ? "bg-foreground text-background"
                : "bg-muted/60 text-muted-foreground"
            )}
          >
            {f.label}
            {f.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-bold tnum",
                  stockFilter === f.key
                    ? "bg-background/20"
                    : f.key === "out"
                      ? "bg-destructive/20 text-destructive"
                      : "bg-primary/20 text-primary"
                )}
              >
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---- Offline notice ---- */}
      {isOffline && (
        <div className="mx-4 mb-3 flex flex-shrink-0 items-start gap-3 rounded-2xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
          <WifiOff className="mt-0.5 h-4 w-4 flex-none text-primary" />
          <p className="text-xs text-muted-foreground">
            You&rsquo;re offline. Browsing works; adding, editing, deleting and importing
            need a connection.
          </p>
        </div>
      )}

      {/* ---- List ---- */}
      <div ref={parentRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {isBusy ? (
          <div>
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3"
              >
                <div className="skeleton h-10 w-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-40" />
                  <div className="skeleton h-3 w-24" />
                </div>
                <div className="skeleton h-7 w-9" />
              </div>
            ))}
          </div>
        ) : listRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            <Package className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="text-lg font-semibold">
              {products.length === 0 ? "No products yet" : "Nothing matches"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {products.length === 0
                ? "Add your first product to start selling."
                : "Try another search or a different filter."}
            </p>
            {products.length === 0 && (
              <Button
                className="mt-5 rounded-2xl"
                disabled={isOffline}
                onClick={() => {
                  resetForm();
                  setIsDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add product
              </Button>
            )}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = listRows[virtualItem.index];
              if (!row) return null;
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                >
                  {row.kind === "header" ? (
                    <div className="flex items-baseline justify-between bg-background px-4 pb-1.5 pt-3">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {row.label}
                      </h2>
                      <span className="text-[11px] font-semibold text-muted-foreground tnum">
                        {row.count}
                      </span>
                    </div>
                  ) : (
                    <ProductRow
                      product={row.product}
                      isFavourite={isFrequentlyUsed(favStoreId, row.product.id)}
                      isHighlighted={highlightedProductId === row.product.id}
                      isOpen={openRowId === row.product.id}
                      disabled={isOffline}
                      onOpenChange={(open) => setOpenRowId(open ? row.product.id : null)}
                      onSelect={() => setDetailProduct(row.product)}
                      onEdit={() => handleEditProduct(row.product)}
                      onDelete={() => handleDeleteProduct(row.product.id, row.product.name)}
                      onToggleFavourite={() => toggleFavourite(row.product)}
                      selectMode={selectMode}
                      isSelected={selectedIds.has(row.product.id)}
                      onToggleSelect={() => toggleSelect(row.product.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Bulk action bar ---- */}
      {selectMode && selectionCount > 0 && (
        <div className="flex-shrink-0 border-t border-white/[0.06] bg-background px-4 py-3">
          {isOffline ? (
            <p className="text-center text-xs text-muted-foreground">
              Bulk changes need a connection. Your selection is kept.
            </p>
          ) : (
            <Button
              className="h-12 w-full rounded-2xl text-[15px] font-bold"
              onClick={() => setShowBulkApply(true)}
            >
              Apply to {selectionCount} product{selectionCount !== 1 ? "s" : ""}
            </Button>
          )}
        </div>
      )}

      {/* ---- Product detail ---- */}
      <Dialog
        open={!!detailProduct}
        onOpenChange={(open) => !open && setDetailProduct(null)}
      >
        <DialogContent className="max-w-sm">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{detailProduct._displayName}</DialogTitle>
                <DialogDescription className="tnum">
                  {detailProduct.barcode || "No barcode"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Selling price</p>
                  <p className="mt-0.5 text-lg font-bold text-primary tnum">
                    {detailProduct.currency === "USD"
                      ? formatUSD(detailProduct.selling_price)
                      : formatLL(detailProduct.selling_price)}
                  </p>
                  <p className="text-xs text-muted-foreground tnum">
                    {detailProduct.currency === "USD"
                      ? formatLL(detailProduct.selling_price * SELL_RATE)
                      : formatUSD(detailProduct.selling_price / RETURN_RATE)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Cost price</p>
                  <p className="mt-0.5 text-lg font-bold tnum">
                    {detailProduct.currency === "USD"
                      ? formatUSD(detailProduct.cost_price)
                      : formatLL(detailProduct.cost_price)}
                  </p>
                  <p className="text-xs text-muted-foreground tnum">
                    {detailProduct.profit_percentage.toFixed(1)}% profit
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">In stock</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-bold tnum",
                      detailProduct.stock_quantity <= 0
                        ? "text-destructive"
                        : detailProduct.stock_quantity <= detailProduct.min_stock_threshold
                          ? "text-primary"
                          : ""
                    )}
                  >
                    {detailProduct.stock_quantity}
                  </p>
                  <p className="text-xs text-muted-foreground tnum">
                    Alerts at {detailProduct.min_stock_threshold}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Discount</p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-bold tnum",
                      detailProduct.discount_percentage > 0 ? "text-emerald-400" : ""
                    )}
                  >
                    {detailProduct.discount_percentage > 0
                      ? `−${detailProduct.discount_percentage}%`
                      : "None"}
                  </p>
                  <p className="text-xs text-muted-foreground">{detailProduct.currency}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => toggleFavourite(detailProduct)}
                  className="tap flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-muted/60 text-sm font-semibold"
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      isFrequentlyUsed(favStoreId, detailProduct.id) &&
                        "fill-primary text-primary"
                    )}
                  />
                  Star
                </button>
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => {
                    const target = detailProduct;
                    setDetailProduct(null);
                    handleEditProduct(target);
                  }}
                  className="tap flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => {
                    const target = detailProduct;
                    setDetailProduct(null);
                    handleDeleteProduct(target.id, target.name);
                  }}
                  className="tap flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-destructive/15 text-sm font-bold text-destructive disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- More actions ---- */}
      <Dialog open={showMore} onOpenChange={setShowMore}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Inventory actions</DialogTitle>
            <DialogDescription>Bulk tools and account.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            {/* md:hidden — promoted to the toolbar on desktop. */}
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                enterSelectMode();
              }}
              className="tap flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-semibold hover:bg-muted/50 md:hidden"
            >
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              Select products
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                fetchProducts(storeId);
              }}
              className="tap flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-semibold hover:bg-muted/50 md:hidden"
            >
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              Refresh from server
            </button>
            <button
              type="button"
              disabled={products.length === 0 || isOffline}
              onClick={() => {
                setShowMore(false);
                handleExportProducts();
              }}
              className="tap flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-semibold hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-40"
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              Export to CSV
            </button>
            <button
              type="button"
              disabled={isOffline}
              onClick={() => {
                setShowMore(false);
                setShowImportDialog(true);
              }}
              className="tap flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-semibold hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-40"
            >
              <Upload className="h-4 w-4 text-muted-foreground" />
              Import from CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMore(false);
                handleLogout();
              }}
              className="tap flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-semibold text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- Add / edit product ---- */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Update the details and save."
                : "Cost, profit and selling price stay in sync — fill any two."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProduct} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Product name</Label>
              <Input
                id="name"
                placeholder="e.g. Almaza 33cl"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="barcode">Barcode</Label>
              <div className="flex gap-2">
                <Input
                  id="barcode"
                  placeholder="Scan or type"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className={cn(
                    "flex-1 tnum",
                    barcodeStatus?.valid === false && "border-destructive focus-visible:ring-destructive/40",
                    barcode && barcodeStatus?.valid === true && "border-emerald-500/60"
                  )}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <button
                  type="button"
                  onClick={() => setShowBarcodeScanner(true)}
                  aria-label="Scan barcode"
                  className="tap flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-primary/40 text-primary"
                >
                  <Scan className="h-4 w-4" />
                </button>
                {barcode && (
                  <button
                    type="button"
                    onClick={() => setBarcode("")}
                    aria-label="Clear barcode"
                    className="tap flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-muted/60 text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {barcode && barcodeStatus?.valid === true && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                  Barcode is free to use
                </p>
              )}
              {barcode && barcodeStatus?.valid === false && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <X className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  Already used by &ldquo;{barcodeStatus.existingName}&rdquo; — pick another.
                </p>
              )}

              {/* ---- Variant barcodes ---- */}
              <button
                type="button"
                onClick={addVariant}
                className="tap mt-1 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-muted-foreground/30 text-xs font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                Add variant barcode
              </button>

              {variants.map((variant, index) => (
                <div key={index} className="mt-2 flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label>Variant {index + 1}</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Barcode"
                        value={variant.barcode}
                        onChange={(e) => updateVariant(index, "barcode", e.target.value)}
                        className="min-w-0 flex-1 tnum"
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          // Remembered so the scan result lands on this row.
                          (window as any).currentScanningVariantIndex = index;
                          setShowBarcodeScanner(true);
                        }}
                        aria-label={`Scan barcode for variant ${index + 1}`}
                        className="tap flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-primary/40 text-primary"
                      >
                        <Scan className="h-4 w-4" />
                      </button>
                      <Input
                        placeholder="Flavour"
                        value={variant.variantName}
                        onChange={(e) => updateVariant(index, "variantName", e.target.value)}
                        className="min-w-0 flex-1"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariant(index)}
                    aria-label={`Remove variant ${index + 1}`}
                    className="tap flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-destructive/10 text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Currency</Label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
                {(["LL", "USD"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    aria-pressed={currency === c}
                    className={cn(
                      "tap h-9 rounded-lg text-sm font-bold",
                      currency === c
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="costPrice">Cost ({currency})</Label>
                <Input
                  id="costPrice"
                  type="number"
                  step="0.01"
                  placeholder="0"
                  value={costPrice}
                  onChange={(e) => handleCostPriceChange(e.target.value)}
                  inputMode="decimal"
                  className="tnum"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profitPercentage">Profit %</Label>
                <Input
                  id="profitPercentage"
                  type="number"
                  step="0.1"
                  placeholder="0"
                  value={profitPercentage}
                  onChange={(e) => handleProfitPercentageChange(e.target.value)}
                  inputMode="decimal"
                  className="tnum"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sellingPrice">Selling price ({currency})</Label>
              <Input
                id="sellingPrice"
                type="number"
                step="0.01"
                placeholder="0"
                value={sellingPrice}
                onChange={(e) => handleSellingPriceChange(e.target.value)}
                inputMode="decimal"
                className="tnum"
              />
              <p className="text-xs text-muted-foreground tnum">
                {currency === "LL" ? (
                  <>
                    ≈ {formatUSD((parseFloat(sellingPrice) || 0) / RETURN_RATE)} for the
                    customer
                  </>
                ) : (
                  <>≈ {formatLL((parseFloat(sellingPrice) || 0) * SELL_RATE)} for the customer</>
                )}
              </p>
            </div>

            <FeatureFlagGuard feature="product_discount">
              <div className="space-y-1.5">
                <Label htmlFor="discountPercentage">Discount %</Label>
                <Input
                  id="discountPercentage"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={discountPercentage}
                  onChange={(e) => setDiscountPercentage(e.target.value)}
                  inputMode="decimal"
                  className="tnum"
                />
                <p className="text-xs text-muted-foreground">
                  {discountPercentage && parseFloat(discountPercentage) > 0
                    ? `Sold at ${parseFloat(discountPercentage).toFixed(1)}% off`
                    : "No discount applied"}
                </p>
              </div>
            </FeatureFlagGuard>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stockQuantity">Stock</Label>
                <Input
                  id="stockQuantity"
                  type="number"
                  placeholder="0"
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  inputMode="numeric"
                  className="tnum"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minStockThreshold">Alert at</Label>
                <Input
                  id="minStockThreshold"
                  type="number"
                  placeholder="0"
                  value={minStockThreshold}
                  onChange={(e) => setMinStockThreshold(e.target.value)}
                  inputMode="numeric"
                  className="tnum"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1 rounded-2xl"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-12 flex-1 rounded-2xl font-bold"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : editingProduct ? (
                  "Save changes"
                ) : (
                  "Add product"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Scan to find ---- */}
      {showScanSearch && (
        <Dialog open={showScanSearch} onOpenChange={setShowScanSearch}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Scan to find</DialogTitle>
              <DialogDescription>
                Point at a barcode and the product jumps to the top of the list.
              </DialogDescription>
            </DialogHeader>
            <BarcodeScanner
              onScan={(scannedBarcode: string) => {
                const product = barcodeIndex.get(scannedBarcode.trim());
                if (product) {
                  setHighlightedProductId(product.id);
                  setSearchQuery(scannedBarcode.trim());
                  setStockFilter("all");
                  setShowScanSearch(false);
                  playSuccessSound();
                  toast.success(`Found: ${product.name}`, { key: "scan-find" });

                  setTimeout(() => {
                    const element = document.getElementById(`product-${product.id}`);
                    if (element) {
                      element.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }, 100);

                  setTimeout(() => setHighlightedProductId(null), 1600);
                } else {
                  toast.error("No product with that barcode", { key: "scan-find" });
                  setShowScanSearch(false);
                }
              }}
              onClose={() => setShowScanSearch(false)}
              isActive={showScanSearch}
              desktopMode={isDesktopMode}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ---- Scan into the barcode field ---- */}
      {showBarcodeScanner && (
        <Dialog open={showBarcodeScanner} onOpenChange={setShowBarcodeScanner}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Scan barcode</DialogTitle>
              <DialogDescription>
                Point your camera at the barcode to fill the field.
              </DialogDescription>
            </DialogHeader>
            <BarcodeScanner
              onScan={handleBarcodeScanFromCamera}
              onClose={() => setShowBarcodeScanner(false)}
              isActive={showBarcodeScanner}
              desktopMode={isDesktopMode}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ---- Scan to select ---- */}
      {/*
        Unlike the two scanners above, this one does NOT close on a hit.
        BarcodeScanner reports continuously by design, so the owner can walk a
        shelf and keep scanning; only Done closes it.
      */}
      {showBulkScan && (
        <Dialog open={showBulkScan} onOpenChange={setShowBulkScan}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Scan to select</DialogTitle>
              <DialogDescription>
                Keep scanning — every product found is added to the selection.
              </DialogDescription>
            </DialogHeader>

            <BarcodeScanner
              onScan={handleBulkScanSelect}
              onClose={() => setShowBulkScan(false)}
              isActive={showBulkScan}
              desktopMode={isDesktopMode}
            />

            <div className="rounded-2xl bg-muted/40 px-4 py-3">
              <p className="text-sm font-semibold tnum">{selectionCount} selected</p>
              {bulkScanLog.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {bulkScanLog.map((name, i) => (
                    <li
                      key={`${name}-${i}`}
                      className="truncate text-xs text-muted-foreground"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Point at a barcode. The scanner stays open between scans.
                </p>
              )}
            </div>

            <Button
              className="w-full rounded-2xl"
              onClick={() => setShowBulkScan(false)}
            >
              Done
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {/* ---- Bulk profit / discount ---- */}
      {/* Mounted only while open so the mode and the percentage reset every
          time — reopening with the last number still in the box is how the
          wrong percentage gets applied twice. */}
      {showBulkApply && (
        <BulkPriceDialog
          open={showBulkApply}
          onOpenChange={setShowBulkApply}
          targets={selectedTargets}
          isOffline={isOffline}
          isApplying={isApplyingBulk}
          progress={bulkProgress}
          onApply={handleBulkApply}
        />
      )}

      {/* ---- CSV import ---- */}
      <CSVImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        storeId={storeId}
        onImportComplete={() => {
          fetchProducts(storeId);
          setShowImportDialog(false);
        }}
      />

      {/* ---- Destructive confirms (3s cooldown) ---- */}
      {confirmDialog}
    </div>
  );
}
