"use client";

// =============================================
// Quick-add tiles (desktop Pro till)
//
// Lifted out of the old desktop POS branch with its data source and behaviour
// unchanged: products with no barcode (bread, coffee, anything sold loose)
// plus whatever the store has marked as frequently used. One tap adds one.
//
// Both currencies stay on the tile. This is a dual-currency till and the
// cashier is often asked "how much is that in dollars" before the item is even
// in the cart; dropping the second line would be a real loss, not tidying.
// =============================================

import { Product } from "@/lib/types/product";
import {
  formatLL,
  formatUSD,
  convertLlToUsdForReturn,
  convertUsdToLl,
} from "@/lib/utils/format";

interface QuickGridProps {
  products: Product[];
  onAdd: (product: Product) => void;
}

export default function QuickGrid({ products, onAdd }: QuickGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-semibold text-muted-foreground">No quick items yet</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Products without a barcode, and anything you star in Inventory, appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="no-scrollbar h-full overflow-y-auto overscroll-contain p-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => onAdd(product)}
            // min-h is a touch target first and a layout decision second: these
            // tills are frequently touchscreens.
            className="tap flex min-h-[92px] flex-col justify-between rounded-2xl border border-white/[0.07] bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <span className="line-clamp-2 break-words text-[13px] font-semibold leading-tight">
              {product.name}
            </span>
            <span className="mt-2 block">
              {/* LL is the base currency and the number the customer pays, so
                  it leads. USD is derived underneath: whichever side is
                  derived goes through the named helpers — USD→LL at the sell
                  rate (the customer is paying), LL→USD at the return rate to
                  match what the cart actually charges. */}
              <span className="block text-sm font-bold leading-none text-primary tnum">
                {product.currency === "USD"
                  ? formatLL(convertUsdToLl(product.selling_price))
                  : formatLL(product.selling_price)}
              </span>
              <span className="mt-1 block text-[11px] leading-none text-muted-foreground/70 tnum">
                {product.currency === "USD"
                  ? formatUSD(product.selling_price)
                  : formatUSD(convertLlToUsdForReturn(product.selling_price))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
