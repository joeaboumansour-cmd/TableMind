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
//
// ## Virtualised, and it is a Tier-1 fix rather than tidying
//
// `MenuBrowser`'s "All" tab hands this EVERY sellable product, so on a store
// with a real catalogue this rendered 2,488 tiles and 12,666 DOM nodes on the
// till's first paint — measured 2026-09-01, and it accounted for most of the
// 833 ms of main-thread blocking during boot.
//
// The first paint is only half of it. `setProducts` fires again after **every
// background sync**, which runs every 30 seconds all day — so the till was
// reconciling thousands of tiles WHILE THE CASHIER WAS SCANNING. That is queue
// time, on the one screen the plan says may never regress.
//
// Same `@tanstack/react-virtual` already used by the inventory list. Rows, not
// tiles: the CSS grid stays the layout, one virtual row per grid row.
// =============================================

import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

/**
 * The layout numbers, kept beside the classes that used to own them.
 *
 * The grid was `repeat(auto-fill, minmax(108px, 1fr))` with `gap-2` inside
 * `p-3`. A virtualiser has to know how many tiles are on a row, and `auto-fill`
 * only tells the browser — so the count is computed here from the same three
 * numbers. Change one and change the class below with it.
 */
const MIN_TILE_PX = 108;
const GAP_PX = 8;
const PAD_PX = 12;

/** Starting guess only; every row is measured for real once it mounts. */
const ESTIMATED_ROW_PX = 92 + GAP_PX;

/** Rows kept mounted above and below the viewport, so scrolling never shows a gap. */
const OVERSCAN_ROWS = 3;

function columnsFor(width: number): number {
  const usable = width - PAD_PX * 2;
  if (usable <= 0) return 1;
  // auto-fill's own arithmetic: as many tracks of MIN_TILE_PX as fit once the
  // gaps between them are paid for.
  return Math.max(1, Math.floor((usable + GAP_PX) / (MIN_TILE_PX + GAP_PX)));
}

export default function QuickGrid({ products, onAdd }: QuickGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(3);

  // The panel is user-resizable (the cashier drags the cart divider), so the
  // column count has to follow the element, not a viewport breakpoint — which
  // is the same reason the CSS used auto-fill rather than `lg:grid-cols-3`.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const apply = () => setColumns(columnsFor(el.clientWidth));
    apply();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(products.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: OVERSCAN_ROWS,
  });

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
    // A VISIBLE scrollbar, unlike the rest of the app's scrollers.
    //
    // This always scrolled, but `no-scrollbar` hid every cue that it did — and
    // with the old 12-item cap on starred products there was rarely enough in
    // here to overflow, so nobody found out. Uncapped, this list is routinely
    // taller than the panel, and a cashier who cannot see that there is more
    // below will believe the missing items simply are not there.
    <div
      ref={scrollRef}
      className="quick-grid-scroll h-full overflow-y-auto overscroll-contain p-3"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          const tiles = products.slice(start, start + columns);
          return (
            <div
              key={row.key}
              data-index={row.index}
              // Measured, not guessed. Tile heights are bounded (the name is
              // `line-clamp-2`) but not known, and a measured row costs
              // nothing here.
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full gap-2 pb-2"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {tiles.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onAdd(product)}
                  // min-h is a touch target first and a layout decision second:
                  // these tills are frequently touchscreens.
                  className="tap flex min-h-[92px] flex-col justify-between rounded-2xl border border-white/[0.07] bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className="line-clamp-2 break-words text-[13px] font-semibold leading-tight">
                    {product.name}
                  </span>
                  <span className="mt-2 block">
                    {/* LL is the base currency and the number the customer pays,
                        so it leads. USD is derived underneath: whichever side is
                        derived goes through the named helpers — USD→LL at the
                        sell rate (the customer is paying), LL→USD at the return
                        rate to match what the cart actually charges. */}
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
          );
        })}
      </div>
    </div>
  );
}
