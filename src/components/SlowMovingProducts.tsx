"use client";

import { cn } from "@/lib/utils";

interface SlowMovingProduct {
  product_name: string;
  totalQuantity: number;
  lastSold: string;
  daysSinceLastSale: number;
}

interface SlowMovingProductsProps {
  products: SlowMovingProduct[];
}

export function SlowMovingProducts({ products }: SlowMovingProductsProps) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Slow moving stock
      </h3>
      <div className="rounded-3xl border border-white/10 bg-card p-4">
        {products.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing is sitting still — every product sold more than once.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Sold once or less in this range
            </p>
            <ul className="space-y-2.5">
              {products.map((product, index) => (
                <li
                  key={`${product.product_name}-${index}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{product.product_name}</p>
                    <p className="text-xs text-muted-foreground tnum">
                      {product.totalQuantity} sold
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex-none rounded-lg px-2 py-1 text-xs font-semibold tnum",
                      product.daysSinceLastSale > 30
                        ? "bg-destructive/15 text-destructive"
                        : product.daysSinceLastSale > 14
                          ? "bg-primary/15 text-primary"
                          : "bg-muted/70 text-muted-foreground"
                    )}
                  >
                    {product.lastSold ? `${product.daysSinceLastSale}d ago` : "Never sold"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
