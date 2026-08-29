"use client";

// =============================================
// Category rail + item grid
// =============================================
// A shop with no barcodes sells by tapping. This is the browse surface: a strip
// of categories over the existing QuickGrid.
//
// QuickGrid's props are UNCHANGED — it stays the leaf renderer, and all
// filtering happens here. Layout-agnostic on purpose: the desktop till puts
// this in its right panel and the mobile till uses it full-page, and neither
// needs its own copy of the filtering rule.
// =============================================

import { useMemo, useState } from "react";
import QuickGrid from "./QuickGrid";
import type { Product } from "@/lib/types/product";
import type { Category } from "@/lib/categories/types";

interface MenuBrowserProps {
  /** Already filtered to sellable items by the caller. */
  products: Product[];
  categories: Category[];
  onAdd: (product: Product) => void;
}

/** Sentinel for the "All" tab. Not a real category id. */
const ALL = "__all__";

export default function MenuBrowser({ products, categories, onAdd }: MenuBrowserProps) {
  const [activeId, setActiveId] = useState<string>(ALL);

  /** Counts per category, so a tab can say whether it is worth tapping. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) {
      const key = product.category_id || "";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [products]);

  /** Are there products with no category? Only then is the tab worth showing. */
  const uncategorisedCount = counts.get("") || 0;

  const visible = useMemo(() => {
    if (activeId === ALL) return products;
    if (activeId === "") return products.filter((p) => !p.category_id);
    return products.filter((p) => p.category_id === activeId);
  }, [products, activeId]);

  const tabs: Array<{ id: string; label: string; count: number }> = [
    { id: ALL, label: "All", count: products.length },
    ...categories.map((c) => ({
      id: c.id,
      label: c.name,
      count: counts.get(c.id) || 0,
    })),
  ];
  // Only offer "Other" when something is actually in it — an always-present
  // empty tab is noise on a till.
  if (uncategorisedCount > 0) {
    tabs.push({ id: "", label: "Other", count: uncategorisedCount });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar flex flex-none gap-2 overflow-x-auto p-3 pb-2">
        {tabs.map((tab) => {
          const selected = activeId === tab.id;
          return (
            <button
              key={tab.id || "uncategorised"}
              type="button"
              onClick={() => setActiveId(tab.id)}
              aria-pressed={selected}
              className={`tap flex h-10 flex-none items-center gap-1.5 rounded-xl px-4 text-sm font-semibold ${
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 text-xs font-bold tnum ${
                  selected ? "bg-background/20" : "bg-primary/20 text-primary"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        <QuickGrid products={visible} onAdd={onAdd} />
      </div>
    </div>
  );
}
