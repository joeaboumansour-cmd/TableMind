"use client";

// =============================================
// Ranked list with a magnitude bar
//
// "Which few products carry the store?" is a magnitude-plus-identity question,
// and a ranked list answers it directly: the names are readable, the order IS
// the answer, and a thin bar makes the gaps between them visible.
//
// Top-products-by-revenue used to be a pie chart. A pie asks the reader to
// compare angles, hides the labels behind a legend, and needs a colour per
// slice -- five arbitrary hues that had nothing to do with the brand. This is
// the same component the quantity list already used, now shared by both.
// =============================================

import { cn } from "@/lib/utils";

export interface RankedItem {
  /** Row label — the product name. */
  name: string;
  /** Drives the bar width. */
  value: number;
  /** Right-aligned headline figure, already formatted. */
  primary: string;
  /** Smaller figure under it, already formatted. */
  secondary?: string;
}

export function RankedBarList({
  items,
  emptyLabel = "Nothing sold in this range.",
}: {
  items: RankedItem[];
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  // Scale to the leader, not to the total: the question is "how do these
  // compare to each other", and a share-of-total scale squashes everything
  // when one product dominates.
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={`${item.name}-${index}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              <span className="mr-2 text-xs text-muted-foreground tnum">{index + 1}</span>
              {item.name}
            </span>
            <span className="flex-none text-right text-sm">
              <span className="font-semibold tnum">{item.primary}</span>
              {item.secondary && (
                <span className="ml-2 text-xs text-muted-foreground tnum">
                  {item.secondary}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                // The leader carries full brand weight; the rest recede, so
                // rank is legible without reading a single number.
                index === 0 ? "bg-primary" : "bg-primary/55"
              )}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
