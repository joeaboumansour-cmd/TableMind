"use client";

// =============================================
// Inventory row
//
// Replaces the four icon buttons that used to sit on every row — at 2,500
// products that is 10,000 tap targets, each one small enough to mis-hit next
// to a delete. Instead the row is one target that opens the product, and the
// actions live behind a leftward swipe.
//
// touch-action: pan-y is what makes that safe inside a scrolling list: the
// browser keeps vertical scrolling for itself and only hands us the horizontal
// gesture, so a swipe can never fight the scroll.
// =============================================

import React, { useCallback, useEffect, useRef } from "react";
import { Check, Edit, Star, Trash2 } from "lucide-react";
import { formatLL, formatUSD, convertLlToUsdForReturn, convertUsdToLl } from "@/lib/utils/format";
import { vibrate } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/** Width of one revealed action. */
const ACTION_WIDTH = 56;
const ACTIONS_TOTAL = ACTION_WIDTH * 3;

/** Travel before the gesture commits to an axis. */
const AXIS_LOCK_PX = 8;

export interface InventoryProduct {
  id: string;
  store_id: string;
  created_at: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: "LL" | "USD";
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string | null;
  variant_name?: string | null;
  _displayName: string;
  _isVariant: boolean;
  _isParent: boolean;
}

interface ProductRowProps {
  product: InventoryProduct;
  isFavourite: boolean;
  isHighlighted: boolean;
  isOpen: boolean;
  /** Writes are blocked with no connection — the actions grey out, not vanish. */
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavourite: () => void;
  /**
   * Bulk-select mode. The swipe gesture is off, the whole row toggles instead
   * of opening, and the monogram becomes the tick.
   */
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

/** Two-letter monogram, so a list of 2,500 rows still has something to scan by. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Stock tone. `min_stock_threshold` is the store's own restock line, so "low"
 * is whatever the owner said it is, not a hardcoded number.
 */
function stockTone(product: InventoryProduct): {
  label: string;
  className: string;
  chip: boolean;
} {
  if (product.stock_quantity <= 0) {
    return { label: "Out", className: "bg-destructive text-white", chip: true };
  }
  if (product.stock_quantity <= product.min_stock_threshold) {
    return { label: "Low", className: "bg-primary text-primary-foreground", chip: true };
  }
  return { label: "in stock", className: "text-foreground", chip: false };
}

function ProductRow({
  product,
  isFavourite,
  isHighlighted,
  isOpen,
  disabled,
  onOpenChange,
  onSelect,
  onEdit,
  onDelete,
  onToggleFavourite,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: ProductRowProps) {
  // Variants carry cost 0 / price 0 — they are barcode aliases of their parent,
  // not independently priced items, so there is nothing for a bulk reprice to
  // do to them. They stay visible but inert.
  const selectable = !product._isVariant;
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    startOffset: number;
    axis: null | "x" | "y";
  } | null>(null);
  // Set when a swipe ends, so the click synthesised at the end of the gesture
  // does not also open the product.
  const suppressClickRef = useRef(false);

  const translate = useCallback((x: number) => {
    if (contentRef.current) contentRef.current.style.transform = `translateX(${x}px)`;
  }, []);

  // Keep the DOM in step when the parent closes this row (because another one
  // was opened, or the list was filtered).
  useEffect(() => {
    if (contentRef.current) contentRef.current.style.transition = "";
    translate(isOpen ? -ACTIONS_TOTAL : 0);
  }, [isOpen, translate]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // No swiping while selecting: Edit and Delete must not sit one careless
    // gesture away from a finger that is ticking its way down the list.
    if (selectMode) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (contentRef.current) contentRef.current.style.transition = "none";
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      dy: 0,
      startOffset: isOpen ? -ACTIONS_TOTAL : 0,
      axis: null,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;

    if (!drag.axis) {
      if (Math.abs(drag.dx) > AXIS_LOCK_PX && Math.abs(drag.dx) > Math.abs(drag.dy)) {
        drag.axis = "x";
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(drag.dy) > AXIS_LOCK_PX) {
        drag.axis = "y";
      }
    }
    if (drag.axis !== "x") return;

    const next = Math.min(0, Math.max(-ACTIONS_TOTAL, drag.startOffset + drag.dx));
    translate(next);
  };

  const endDrag = (commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (contentRef.current) contentRef.current.style.transition = "";
    if (!drag) return;

    if (drag.axis !== "x") {
      translate(isOpen ? -ACTIONS_TOTAL : 0);
      return;
    }

    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const offset = drag.startOffset + drag.dx;
    const shouldOpen = commit && offset < -ACTIONS_TOTAL / 2;
    translate(shouldOpen ? -ACTIONS_TOTAL : 0);
    if (shouldOpen !== isOpen) {
      vibrate(10);
      onOpenChange(shouldOpen);
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) return;
    if (selectMode) {
      if (!selectable) return;
      vibrate(10);
      onToggleSelect?.();
      return;
    }
    if (isOpen) {
      onOpenChange(false);
      return;
    }
    onSelect();
  };

  const tone = stockTone(product);

  // A product's price in the other currency. LL→USD uses the return rate to
  // stay consistent with what the cart actually charges; USD→LL goes through
  // convertUsdToLl so the figure shown is a payable amount (multiple of 5,000)
  // rather than a raw rate multiplication.
  const secondary =
    product.currency === "USD"
      ? formatLL(convertUsdToLl(product.selling_price))
      : formatUSD(convertLlToUsdForReturn(product.selling_price));
  const primary =
    product.currency === "USD"
      ? formatUSD(product.selling_price)
      : formatLL(product.selling_price);

  return (
    <div
      id={`product-${product.id}`}
      className={cn(
        "relative overflow-hidden border-b border-white/[0.05] transition-colors duration-300",
        isHighlighted && "bg-primary/15",
        selectMode && isSelected && "bg-primary/[0.08]",
        selectMode && !selectable && "opacity-40"
      )}
    >
      {/* ---- Actions, revealed by the swipe ---- */}
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => {
            onToggleFavourite();
            onOpenChange(false);
          }}
          aria-label={isFavourite ? `Unstar ${product.name}` : `Star ${product.name}`}
          className="flex w-14 flex-col items-center justify-center gap-1 bg-muted text-muted-foreground"
        >
          <Star className={cn("h-4 w-4", isFavourite && "fill-primary text-primary")} />
          <span className="text-[10px] font-semibold">Star</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onEdit();
          }}
          disabled={disabled}
          aria-label={`Edit ${product.name}`}
          className="flex w-14 flex-col items-center justify-center gap-1 bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Edit className="h-4 w-4" />
          <span className="text-[10px] font-semibold">Edit</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onDelete();
          }}
          disabled={disabled}
          aria-label={`Delete ${product.name}`}
          className="flex w-14 flex-col items-center justify-center gap-1 bg-destructive text-white disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[10px] font-semibold">Delete</span>
        </button>
      </div>

      {/* ---- Row ---- */}
      <div
        ref={contentRef}
        className="swipe-row relative bg-background"
        style={{ touchAction: "pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
      >
        <button
          type="button"
          onClick={handleClick}
          disabled={selectMode && !selectable}
          aria-pressed={selectMode ? isSelected : undefined}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/30 disabled:pointer-events-none"
        >
          {/*
            The monogram doubles as the tick. A separate checkbox column would
            cost 40px of a 375px-wide row and push the price off the end.
          */}
          <span
            className={cn(
              "flex h-10 w-10 flex-none items-center justify-center rounded-xl transition-colors",
              selectMode && isSelected
                ? "bg-primary text-primary-foreground"
                : "bg-muted/70 text-xs font-bold text-muted-foreground",
              selectMode && !isSelected && selectable && "ring-1 ring-inset ring-white/15"
            )}
          >
            {selectMode && isSelected ? (
              <Check className="h-5 w-5" strokeWidth={3} />
            ) : (
              initials(product._displayName)
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[15px] font-semibold">
                {product._displayName}
              </span>
              {isFavourite && (
                <Star className="h-3 w-3 flex-none fill-primary text-primary" />
              )}
              {product._isVariant && (
                <span className="flex-none rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                  Variant
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground tnum">
              <span className="truncate">
                {primary} · {secondary}
              </span>
              {product.discount_percentage > 0 && (
                <span className="flex-none font-semibold text-emerald-400">
                  −{product.discount_percentage}%
                </span>
              )}
            </span>
          </span>

          <span className="flex-none text-right">
            {tone.chip ? (
              <span
                className={cn(
                  "inline-flex min-w-7 items-center justify-center rounded-lg px-1.5 py-0.5 text-sm font-bold tnum",
                  tone.className
                )}
              >
                {product.stock_quantity}
              </span>
            ) : (
              <span className="block text-lg font-bold leading-none tnum">
                {product.stock_quantity}
              </span>
            )}
            <span
              className={cn(
                "mt-1 block text-[10px] font-semibold uppercase tracking-wide",
                tone.chip
                  ? product.stock_quantity <= 0
                    ? "text-destructive"
                    : "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {tone.label}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

// Memoized: the list is virtualised and the parent re-renders on every
// keystroke in the search field. Without this, each keystroke re-renders every
// mounted row even though only the filtered set changed.
export default React.memo(ProductRow);
