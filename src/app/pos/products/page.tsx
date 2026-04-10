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
} from "lucide-react";
import { toast } from "sonner";
import { formatLL, convertUsdToLl } from "@/lib/utils/format";
import BarcodeScanner from "@/components/BarcodeScanner";

const supabase = createClient();

interface Product {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  profit_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  created_at: string;
}

export default function StoreProductsPage() {
  const router = useRouter();
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

  // Form state
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [profitPercentage, setProfitPercentage] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [minStockThreshold, setMinStockThreshold] = useState("5");

  // Calculate selling price from cost and profit percentage
  const calculateSellingPrice = () => {
    const cost = parseFloat(costPrice) || 0;
    const profit = parseFloat(profitPercentage) || 0;
    return cost * (1 + profit / 100);
  };

  // Check store auth
  useEffect(() => {
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

    setStoreId(store_id);
    fetchProducts(store_id);
  }, [router]);

  const fetchProducts = async (storeId: string) => {
    try {
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
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error("Failed to load products");
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
      const profit = parseFloat(profitPercentage) || 0;
      const selling = cost * (1 + profit / 100);

      if (editingProduct) {
        // Update existing product
        const { error } = await supabase
          .from("products")
          .update({
            name: name,
            barcode: barcode || null,
            cost_price: cost,
            selling_price: selling,
            profit_percentage: profit,
            stock_quantity: parseInt(stockQuantity),
            min_stock_threshold: parseInt(minStockThreshold),
          })
          .eq("id", editingProduct.id);

        if (error) throw error;
        toast.success(`Product "${name}" updated successfully!`);
      } else {
        // Create new product
        const { error } = await supabase
          .from("products")
          .insert({
            store_id: storeId,
            name: name,
            barcode: barcode || null,
            cost_price: cost,
            selling_price: selling,
            profit_percentage: profit,
            stock_quantity: parseInt(stockQuantity),
            min_stock_threshold: parseInt(minStockThreshold),
          });

        if (error) throw error;
        toast.success(`Product "${name}" created successfully!`);
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
    setCostPrice(product.cost_price.toString());
    setProfitPercentage(product.profit_percentage.toString());
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
    setCostPrice("");
    setProfitPercentage("");
    setStockQuantity("");
    setMinStockThreshold("5");
    setEditingProduct(null);
  };

  const handleLogout = () => {
    localStorage.removeItem("goldensquirrel_auth");
    router.push("/login");
  };

  const handleBarcodeScanFromCamera = (scannedBarcode: string) => {
    // Validate barcode before setting
    if (!scannedBarcode || scannedBarcode.trim().length === 0) {
      toast.error("Invalid barcode scanned");
      return;
    }
    
    const trimmedBarcode = scannedBarcode.trim();
    
    // Check barcode length (typical barcodes are 8-13 characters)
    if (trimmedBarcode.length < 4 || trimmedBarcode.length > 20) {
      toast.error("Barcode length is invalid. Please try again.");
      return;
    }
    
    // Check if barcode contains only valid characters (alphanumeric and common symbols)
    const validBarcodeRegex = /^[A-Za-z0-9\-_]+$/;
    if (!validBarcodeRegex.test(trimmedBarcode)) {
      toast.error("Barcode contains invalid characters. Please try again.");
      return;
    }
    
    setBarcode(trimmedBarcode);
    setShowBarcodeScanner(false);
    toast.success("Barcode scanned successfully! If this is the wrong barcode, you can clear it and scan again.");
  };

  const handleBarcodeScan = async () => {
    if (!barcode.trim()) {
      toast.error("Please enter a barcode");
      return;
    }

    const trimmedBarcode = barcode.trim();
    
    // Validate barcode length
    if (trimmedBarcode.length < 4 || trimmedBarcode.length > 20) {
      toast.error("Barcode must be between 4 and 20 characters");
      return;
    }

    // Check if product with this barcode already exists
    const existingProduct = products.find(p => p.barcode === trimmedBarcode);
    if (existingProduct) {
      toast.error("Product with this barcode already exists");
      return;
    }

    toast.success("Barcode is available");
  };

  const filteredProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Stats calculations
  const totalProducts = products.length;
  const lowStockCount = products.filter(p => p.stock_quantity <= p.min_stock_threshold).length;
  const totalCostValue = products.reduce((sum, p) => sum + (p.cost_price * p.stock_quantity), 0);
  const totalSellValue = products.reduce((sum, p) => sum + (p.selling_price * p.stock_quantity), 0);

  if (isLoading) {
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
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9 px-3">
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
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="costPrice" className="text-sm">Cost Price (LL)</Label>
                      <Input
                        id="costPrice"
                        type="number"
                        step="1"
                        placeholder="0"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        required
                        className="h-9"
                        inputMode="numeric"
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
                        onChange={(e) => setProfitPercentage(e.target.value)}
                        required
                        className="h-9"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Selling Price (Calculated)</Label>
                    <Input
                      type="text"
                      value={formatLL(calculateSellingPrice())}
                      disabled
                      className="h-9 bg-muted text-muted-foreground"
                    />
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
                      <h3 className="font-semibold text-sm truncate">{product.name}</h3>
                      {product.stock_quantity <= product.min_stock_threshold && (
                        <Badge variant="destructive" className="text-xs px-1 py-0">
                          Low
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground mb-2">
                      <span>Cost: {formatLL(product.cost_price)}</span>
                      <span>•</span>
                      <span>Sell: {formatLL(product.selling_price)}</span>
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
                    >
                      <Edit className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProduct(product.id, product.name)}
                      className="h-8 w-8 p-0"
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
                const product = products.find(p => p.barcode === scannedBarcode.trim());
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
    </div>
  );
}