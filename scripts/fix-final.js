const fs = require('fs');
const path = require('path');

// === Fix Checkout Page ===
const checkoutPath = path.join(__dirname, '..', 'src', 'app', 'checkout', 'page.tsx');
let checkout = fs.readFileSync(checkoutPath, 'utf8');

// 1. Fix merge conflict marker
checkout = checkout.replace(
  'import { toast } from "sonner";\n>>>>>>>\n\nimport { formatLL',
  'import { toast } from "sonner";\nimport { formatLL'
);
console.log('Checkout: Fixed merge conflict marker');

// 2. Add isOffline state
if (!checkout.includes('const [isOffline, setIsOffline]')) {
  checkout = checkout.replace(
    'const [transactionComplete, setTransactionComplete] = useState(false);',
    'const [transactionComplete, setTransactionComplete] = useState(false);\n  const [isOffline, setIsOffline] = useState(\n    typeof navigator !== "undefined" ? !navigator.onLine : false\n  );'
  );
  console.log('Checkout: Added isOffline state');
}

// 3. Add online/offline event listeners (before "// Handle new transaction")
if (!checkout.includes('handleOnlineCheckout')) {
  checkout = checkout.replace(
    '  // Handle new transaction',
    `  // Track online/offline status
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

  // Handle new transaction`
  );
  console.log('Checkout: Added online/offline listeners');
}

// 4. Add offline banner before the header
if (!checkout.includes('Offline Mode')) {
  checkout = checkout.replace(
    'return (\n    <div className="min-h-screen bg-background">\n      {/* Header */}',
    `return (
    <div className="min-h-screen bg-background">
      {/* Offline Banner */}
      {isOffline && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2">
          <div className="flex items-center gap-2 text-amber-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-amber-600">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" y2="17"></line>
            </svg>
            <span className="font-medium text-sm">Offline Mode - Transaction will be queued and synced when you reconnect</span>
          </div>
        </div>
      )}

      {/* Header */}`
  );
  console.log('Checkout: Added offline banner');
}

// 5. Queue stock decrements when online (after API call succeeds)
if (!checkout.includes('Queue stock decrements as pending_writes')) {
  checkout = checkout.replace(
    `          if (!response.ok) {
           throw new Error("Failed to save transaction");
         }
       } catch (error) {`,
    `          if (!response.ok) {
           throw new Error("Failed to save transaction");
         }

         // Queue stock decrements as pending_writes for reliable sync
         await queueStockDecrementsForTransaction(
           items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
           authData.store_id || ""
         );
       } catch (error) {`
  );
  console.log('Checkout: Added stock decrement queuing for online transactions');
}

// 6. Queue stock decrements when offline (after queueing the transaction)
if (!checkout.includes('Queue stock decrements for offline')) {
  checkout = checkout.replace(
    `        await queueTransaction(offlineTxnData);
        toast.info("Transaction saved offline - will sync when online");`,
    `        await queueTransaction(offlineTxnData);

        // Queue stock decrements as pending_writes for reliable sync
        await queueStockDecrementsForTransaction(
          items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          offlineStoreId
        );

        toast.info("Transaction saved offline - will sync when online");`
  );
  console.log('Checkout: Added stock decrement queuing for offline transactions');
}

fs.writeFileSync(checkoutPath, checkout);
console.log('Checkout page fully updated!');

// === Fix Products Page ===
const productsPath = path.join(__dirname, '..', 'src', 'app', 'pos', 'products', 'page.tsx');
let products = fs.readFileSync(productsPath, 'utf8');

// Modify fetchProducts to load from cache when offline
if (!products.includes('Load from cache when offline')) {
  products = products.replace(
    `    if (!navigator.onLine) {
        toast.error("No internet connection. Please connect to refresh products.");
        setIsLoading(false);
        return;
      }`,
    `    if (!navigator.onLine) {
        // Load from cache when offline
        try {
          const cached = await getCachedProducts(storeId);
          if (cached && cached.length > 0) {
            setProducts(cached.map((p: any) => ({
              ...p,
              currency: p.currency || "LL",
            })));
            toast.info("Showing cached products (offline mode)");
          } else {
            toast.error("No internet connection and no cached products available.");
          }
        } catch (cacheError) {
          console.error("Error loading cached products:", cacheError);
          toast.error("No internet connection. Please check your internet connection.");
        }
        setIsLoading(false);
        return;
      }`
  );
  console.log('Products: Added cache fallback for offline mode');
}

fs.writeFileSync(productsPath, products);
console.log('Products page fully updated!');
console.log('All done!');
