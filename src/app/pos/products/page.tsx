"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
   ArrowLeft,
   Search,
   Scan,
   Info,
   X,
   Download,
   Upload,
   Layers,
 } from "lucide-react";
 import { toast } from "sonner";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatLL, formatUSD, convertUsdToLl, convertLlToUsdForSale, SELL_RATE, RETURN_RATE, convertLlToUsdForReturn } from "@/lib/utils/format";
import BarcodeScanner from "@/components/BarcodeScanner";
import CSVImportDialog from "@/components/CSVImportDialog";
import { downloadCSV, productsToCSV } from "@/lib/csv/utils";

const supabase = createClient();

interface Product {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: 'LL' | 'USD';
  profit_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  created_at: string;
  parent_id?: string | null;
  variant_name?: string | null;
}

export default function StoreProductsPage() {
  const router = useRouter();
  const { user, logout: authLogout, isLoading: authLoading } = useAuth();
  const [storeId, setStoreId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const [showScanSearch, setShowScanSearch] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  // O(1) barcode product index
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, Product>>(new Map());

  // Track online/offline status for UI
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Form state
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [currency, setCurrency] = useState<'LL' | 'USD'>("LL");
  const [costPrice, setCostPrice] = useState("");
  const [profitPercentage, setProfitPercentage] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [minStockThreshold, setMinStockThreshold] = useState("5");
  
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
    if (user) {
      setStoreId(user.storeId);
      fetchProducts(user.storeId);
    }
  }, [user]);

  // Redirect if no user (and auth has finished loading)
  useEffect(() => {
    if (!user && !authLoading) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

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

  const fetchProducts = async (storeId: string) => {
    try {
      // Check if online before attempting the query
      if (!navigator.onLine) {
        toast.error("No internet connection. Please connect to refresh products.");
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("store_id", storeId)
        .order("name");

      if (error) throw error;
      setProducts(data || []);
      
      // Update selected product if it exists in the new data
      if (selectedProduct && data) {
        const updatedProduct = data.find((p: Product) => p.id === selectedProduct.id);
        if (updatedProduct) {
          setSelectedProduct(updatedProduct);
        }
      }
    } catch (error: any) {
      console.error("Error fetching products:", error);
      // Show a more helpful error message
      if (error?.message?.includes("Failed to fetch") || error?.message?.includes("NetworkError")) {
        toast.error("Network error. Please check your internet connection.");
      } else {
        toast.error("Failed to load products");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) {
      toast.error("Store not found");
      return;
    }

    setIsSubmitting(true);

    try {
      const cost = parseFloat(costPrice);
      const selling = parseFloat(sellingPrice);
      const profit = parseFloat(profitPercentage) || 0;

      let parentProductId;

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
            stock_quantity: parseInt(stockQuantity),
            min_stock_threshold: parseInt(minStockThreshold),
          })
          .eq("id", editingProduct.id)
          .select()
          .single();

        if (error) throw error;
        parentProductId = data.id;
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
            stock_quantity: parseInt(stockQuantity),
            min_stock_threshold: parseInt(minStockThreshold),
          })
          .select()
          .single();

        if (error) throw error;
        parentProductId = data.id;
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
    setSellingPrice(product.selling_price.toString());
    setStockQuantity(product.stock_quantity.toString());
    setMinStockThreshold(product.min_stock_threshold.toString());
    setIsDialogOpen(true);
  };

  const handleDeleteProduct = async (productId: string, productName: string) => {
    if (!confirm(`Are you sure you want to delete "${productName}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", productId);

      if (error) throw error;

      toast.success(`Product "${productName}" deleted`);
      fetchProducts(storeId);
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error("Failed to delete product");
    }
  };

  const resetForm = () => {
    setName("");
    setBarcode("");
    setCurrency("LL");
    setCostPrice("");
    setProfitPercentage("");
    setSellingPrice("");
    setStockQuantity("");
    setMinStockThreshold("5");
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

// Build a set of product IDs that are parents (referenced by other products' parent_id)
const parentIds = new Set<string>();
products.forEach(p => {
  if (p.parent_id) parentIds.add(p.parent_id);
});

const filteredProducts = products.filter(
  (product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
).map((product: any) => {
  const isParent = parentIds.has(product.id);
  const isVariant = !!product.parent_id;

  // Determine product type badge
  let _typeLabel: string | null = null;
  let _typeColor: string = '';
  if (isVariant) {
    _typeLabel = 'Variant';
    _typeColor = 'bg-purple-100 text-purple-700 border-purple-300';
  } else if (isParent) {
    _typeLabel = 'Parent';
    _typeColor = 'bg-amber-100 text-amber-700 border-amber-300';
  }

  // Enhance variant products with their full name
  if (isVariant && product.variant_name) {
    return {
      ...product,
      _displayName: `${product.name} - ${product.variant_name}`,
      _isVariant: true,
      _isParent: false,
      _parentId: product.parent_id,
      _typeLabel,
      _typeColor,
    };
  }
  return {
    ...product,
    _displayName: product.name,
    _isVariant: false,
    _isParent: isParent,
    _parentId: null,
    _typeLabel,
    _typeColor,
  };
});


  // Stats calculations
  const totalProducts = products.length;
  const lowStockCount = products.filter(p => p.stock_quantity <= p.min_stock_threshold).length;
  const totalCostValue = products.reduce((sum, p) => sum + (p.cost_price * p.stock_quantity), 0);
  const totalSellValue = products.reduce((sum, p) => sum + (p.selling_price * p.stock_quantity), 0);

  // Show loading while auth is initializing
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Compact Header */}
      <header className="flex-shrink-0 bg-background border-b">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => router.push("/pos")}
                className="h-8 w-8 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="h-8 w-8 rounded-lg bg-amber-500 flex items-center justify-center">
                <Package className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-sm">Products</h1>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => fetchProducts(storeId)}
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleLogout}
                className="h-8 w-8 p-0"
              >
                <LogOut className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Offline Notice */}
      {isOffline && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-3 py-2">
          <p className="text-sm text-amber-600 text-center font-medium">
            You're offline. Inventory viewing, adding, editing, deleting, or importing products requires an internet connection.
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
        {/* Stats Row */}
        <div className="flex gap-2 text-sm overflow-x-auto">
          <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-lg whitespace-nowrap">
            <Package className="h-3 w-3 text-amber-500" />
            <span className="font-bold">{totalProducts}</span>
            <span className="text-muted-foreground text-xs">items</span>
          </div>
          {lowStockCount > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded-lg whitespace-nowrap">
              <span className="font-bold">{lowStockCount}</span>
              <span className="text-xs">low</span>
            </div>
          )}
          <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-lg whitespace-nowrap">
            <span className="text-muted-foreground text-xs">Cost:</span>
            <span className="font-bold">{formatLL(totalCostValue)}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded-lg whitespace-nowrap">
            <span className="text-muted-foreground text-xs">Sell:</span>
            <span className="font-bold">{formatLL(totalSellValue)}</span>
          </div>
        </div>

        {/* Search and Add */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowScanSearch(true)} className="h-9 px-3">
            <Scan className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportProducts} className="h-9 px-3" disabled={products.length === 0 || isOffline}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} className="h-9 px-3" disabled={isOffline}>
            <Upload className="h-4 w-4" />
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9 px-3" disabled={isOffline}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md mx-4">
              <DialogHeader>
                <DialogTitle className="text-lg">{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
                <DialogDescription className="text-sm">
                  {editingProduct ? "Update product details." : "Add a new product to your store."}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateProduct}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm">Product Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Coffee"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="barcode" className="text-sm">Barcode</Label>
                    <div className="flex gap-2">
                      <Input
                        id="barcode"
                        placeholder="e.g., 123456789"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        className="h-9"
                        inputMode="numeric"
                        pattern="[0-9]*"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowBarcodeScanner(true)}>
                        <Scan className="h-4 w-4" />
                      </Button>
                      {barcode && (
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm"
                          onClick={() => setBarcode("")}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {barcode && (
                      <p className="text-xs text-muted-foreground">
                        Scanned: {barcode}
                      </p>
                    )}
                    
                    {/* Product Variants */}
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={addVariant}
                        className="w-full h-7 text-xs border border-dashed border-muted-foreground/30 hover:border-amber-500 hover:text-amber-600"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Variant Barcode
                      </Button>
                      
                      {variants.map((variant, index) => (
                        <div key={index} className="flex gap-2 mt-2 items-end">
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs text-muted-foreground">Variant {index + 1}</Label>
                            <div className="flex gap-1">
                              <Input
                                placeholder="Barcode"
                                value={variant.barcode}
                                onChange={(e) => updateVariant(index, 'barcode', e.target.value)}
                                className="h-8 text-sm flex-1"
                                inputMode="numeric"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  // Store which variant we are scanning for
                                  (window as any).currentScanningVariantIndex = index;
                                  setShowBarcodeScanner(true);
                                }}
                                className="h-8 w-8 p-0"
                              >
                                <Scan className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                placeholder="Flavor Name"
                                value={variant.variantName}
                                onChange={(e) => updateVariant(index, 'variantName', e.target.value)}
                                className="h-8 text-sm flex-1"
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeVariant(index)}
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency" className="text-sm">Currency</Label>
                    <select
                      id="currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as 'LL' | 'USD')}
                      className="h-9 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="LL">LL (Lebanese Lira)</option>
                      <option value="USD">USD (US Dollar)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="costPrice" className="text-sm">Cost Price ({currency})</Label>
                      <Input
                        id="costPrice"
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={costPrice}
                        onChange={(e) => handleCostPriceChange(e.target.value)}
                        required
                        className="h-9"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="profitPercentage" className="text-sm">Profit %</Label>
                      <Input
                        id="profitPercentage"
                        type="number"
                        step="0.1"
                        placeholder="0"
                        value={profitPercentage}
                        onChange={(e) => handleProfitPercentageChange(e.target.value)}
                        required
                        className="h-9"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sellingPrice" className="text-sm">Selling Price ({currency})</Label>
                    <Input
                      id="sellingPrice"
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={sellingPrice}
                      onChange={(e) => handleSellingPriceChange(e.target.value)}
                      required
                      className="h-9"
                      inputMode="decimal"
                    />
                    <p className="text-xs text-muted-foreground">
                      {currency === 'LL' ? (
                        <>Calculated: {formatLL(parseFloat(sellingPrice) || 0)} ≈ {formatUSD((parseFloat(sellingPrice) || 0) / RETURN_RATE)}</>
                      ) : (
                        <>Calculated: {formatUSD(parseFloat(sellingPrice) || 0)} ≈ {formatLL((parseFloat(sellingPrice) || 0) * SELL_RATE)}</>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="stockQuantity" className="text-sm">Stock Quantity</Label>
                      <Input
                        id="stockQuantity"
                        type="number"
                        placeholder="0"
                        value={stockQuantity}
                        onChange={(e) => setStockQuantity(e.target.value)}
                        required
                        className="h-9"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minStockThreshold" className="text-sm">Min Stock Alert</Label>
                      <Input
                        id="minStockThreshold"
                        type="number"
                        placeholder="5"
                        value={minStockThreshold}
                        onChange={(e) => setMinStockThreshold(e.target.value)}
                        required
                        className="h-9"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    setIsDialogOpen(false);
                    resetForm();
                  }}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        {editingProduct ? "Updating..." : "Adding..."}
                      </>
                    ) : (
                      editingProduct ? "Update" : "Add"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Mobile-Friendly Product List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {products.length === 0 
                  ? "No products yet. Add your first product!"
                  : "No products match your search."
                }
              </p>
            </div>
          ) : (
            filteredProducts.map((product) => (
              <Card 
                key={product.id} 
                id={`product-${product.id}`}
                className={`p-3 transition-all duration-500 ${
                  highlightedProductId === product.id 
                    ? "ring-2 ring-amber-500 bg-amber-50 shadow-lg scale-[1.02]" 
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm truncate">{product._displayName}</h3>
                      {product._typeLabel && (
                        <Badge variant="outline" className={`text-xs px-1 py-0 ${product._typeColor}`}>
                          {product._typeLabel}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        {product.currency}
                      </Badge>
                      {product.stock_quantity <= product.min_stock_threshold && (
                        <Badge variant="destructive" className="text-xs px-1 py-0">
                          Low
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground mb-2">
                      {product.currency === 'LL' ? (
                        <>
                          <div className="flex items-center justify-center gap-3">
                            <span>Cost: {formatLL(product.cost_price)}</span>
                            <span>•</span>
                            <span>Sell: {formatLL(product.selling_price)}</span>
                          </div>
                          <div className="flex items-center justify-center gap-3 text-[12px]">
                            <span>Cost: {formatUSD(product.cost_price / RETURN_RATE)}</span>
                            <span>•</span>
                            <span>Sell: {formatUSD(product.selling_price / RETURN_RATE)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-center gap-3">
                            <span>Cost: {formatUSD(product.cost_price)}</span>
                            <span>•</span>
                            <span>Sell: {formatUSD(product.selling_price)}</span>
                          </div>
                          <div className="flex items-center justify-center gap-3 text-[12px]">
                            <span>Cost: {formatLL(product.cost_price * SELL_RATE)}</span>
                            <span>•</span>
                            <span>Sell: {formatLL(product.selling_price * SELL_RATE)}</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant={product.profit_percentage >= 0 ? "default" : "destructive"} className="text-xs">
                        {product.profit_percentage.toFixed(1)}% profit
                      </Badge>
                      <span className="text-muted-foreground">
                        Stock: {product.stock_quantity}
                      </span>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedProduct(product);
                        setShowInfoDialog(true);
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <Info className="h-4 w-4 text-blue-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditProduct(product)}
                      className="h-8 w-8 p-0"
                      disabled={isOffline}
                    >
                      <Edit className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProduct(product.id, product.name)}
                      className="h-8 w-8 p-0"
                      disabled={isOffline}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Product Info Dialog */}
      <Dialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle className="text-lg">Product Details</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-3 py-4">
              <div>
                <Label className="text-xs text-muted-foreground">Name</Label>
                <p className="font-medium">{selectedProduct.name}</p>
              </div>
              {selectedProduct.barcode && (
                <div>
                  <Label className="text-xs text-muted-foreground">Barcode</Label>
                  <p className="font-mono text-sm">{selectedProduct.barcode}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Cost Price</Label>
                  <p className="font-medium">{formatLL(selectedProduct.cost_price)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Selling Price</Label>
                  <p className="font-medium">{formatLL(selectedProduct.selling_price)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Profit</Label>
                  <p className="font-medium">{selectedProduct.profit_percentage.toFixed(1)}%</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Stock</Label>
                  <p className="font-medium">{selectedProduct.stock_quantity}</p>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Min Stock Alert</Label>
                <p className="font-medium">{selectedProduct.min_stock_threshold}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Added</Label>
                <p className="text-sm text-muted-foreground">
                  {new Date(selectedProduct.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowInfoDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan Search Dialog */}
      {showScanSearch && (
        <Dialog open={showScanSearch} onOpenChange={setShowScanSearch}>
          <DialogContent className="max-w-lg mx-4">
            <DialogHeader>
              <DialogTitle>Scan to Search</DialogTitle>
              <DialogDescription>
                Scan a barcode to find and highlight the product
              </DialogDescription>
            </DialogHeader>
            <BarcodeScanner
              onScan={(scannedBarcode: string) => {
                const product = barcodeIndex.get(scannedBarcode.trim());
                if (product) {
                  setHighlightedProductId(product.id);
                  setSearchQuery("");
                  setShowScanSearch(false);
                  toast.success(`Found: ${product.name}`);
                  
                  // Auto-scroll to the product
                  setTimeout(() => {
                    const element = document.getElementById(`product-${product.id}`);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }, 100);
                  
                  // Clear highlight after 5 seconds
                  setTimeout(() => {
                    setHighlightedProductId(null);
                  }, 5000);
                } else {
                  toast.error("Product not found");
                  setShowScanSearch(false);
                }
              }}
              onClose={() => setShowScanSearch(false)}
              isActive={showScanSearch}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Barcode Scanner Dialog */}
      {showBarcodeScanner && (
        <Dialog open={showBarcodeScanner} onOpenChange={setShowBarcodeScanner}>
          <DialogContent className="max-w-lg mx-4">
            <DialogHeader>
              <DialogTitle>Scan Barcode</DialogTitle>
              <DialogDescription>
                Point your camera at a barcode to scan it.
              </DialogDescription>
            </DialogHeader>
            <BarcodeScanner
              onScan={handleBarcodeScanFromCamera}
              onClose={() => setShowBarcodeScanner(false)}
              isActive={showBarcodeScanner}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* CSV Import Dialog */}
      <CSVImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        storeId={storeId}
        onImportComplete={() => {
          fetchProducts(storeId);
          setShowImportDialog(false);
        }}
      />
    </div>
  );
}
