"use client";

// =============================================
// Cart sheet
//
// The bottom half of the scan-first POS. The camera owns the screen; this
// sheet floats over it and the cashier drags it to trade viewfinder for cart
// list. Three snap points:
//
//   low   — totals + actions only, maximum camera
//   mid   — the default, a few rows of cart visible
//   tall  — reviewing a long basket
//
// Height (not transform) is animated because the totals and the Checkout
// button are pinned to the bottom of the sheet and must stay on
// screen at every snap point. During a drag the height is written straight to
// the DOM node — a React state update per pointermove would re-render the
// whole cart list at 60fps.
// =============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Minus, Plus, ScanLine } from "lucide-react";
import type { CartItem } from "@/lib/types/cart";
import { formatLL, formatLLParts, formatUSD } from "@/lib/utils/format";
import { vibrate } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/** Height of the sheet when the cart is empty — handle plus a one-line hint. */
const PEEK_HEIGHT = 104;

/** The viewfinder never gets smaller than this, however far the sheet is pulled up. */
const MIN_CAMERA_HEIGHT = 152;

/** Snap points closer together than this are collapsed into one. */
const SNAP_MERGE_THRESHOLD = 48;

/** How far a flick is projected past the finger, in ms of travel. */
const VELOCITY_PROJECTION_MS = 130;

/** Pointer travel under this counts as a tap on the handle, not a drag. */
const TAP_SLOP_PX = 5;

interface CartSheetProps {
  items: CartItem[];
  itemCount: number;
  total: number;
  totalUsd: number;
  totalDiscount: number;
  roundingAdjustment: number;
  /** Height of the POS surface the sheet is floating in, in px. */
  availableHeight: number;
  highlightedItemId: string | null;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function CartSheet({
  items,
  itemCount,
  total,
  totalUsd,
  totalDiscount,
  roundingAdjustment,
  availableHeight,
  highlightedItemId,
  onIncrement,
  onDecrement,
  onClear,
  onCheckout,
}: CartSheetProps) {
  const isEmpty = items.length === 0;

  const sheetRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Measured rather than hardcoded: the footer grows a line when there is a
  // discount or a rounding adjustment, and the "low" snap must still show all
  // of it.
  const [chromeHeight, setChromeHeight] = useState(72);
  const [footerHeight, setFooterHeight] = useState(150);

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (el === chromeRef.current) setChromeHeight(el.offsetHeight);
        else if (el === footerRef.current) setFooterHeight(el.offsetHeight);
      }
    });
    if (chromeRef.current) ro.observe(chromeRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [isEmpty]);

  const snaps = useMemo(() => {
    if (isEmpty || availableHeight === 0) return [PEEK_HEIGHT];

    const ceiling = Math.max(chromeHeight + footerHeight, availableHeight - MIN_CAMERA_HEIGHT);
    const low = Math.min(chromeHeight + footerHeight, ceiling);
    const mid = clamp(Math.round(availableHeight * 0.52), low, ceiling);

    const merged: number[] = [];
    for (const candidate of [low, mid, ceiling]) {
      if (!merged.length || candidate - merged[merged.length - 1] > SNAP_MERGE_THRESHOLD) {
        merged.push(candidate);
      }
    }
    return merged;
  }, [isEmpty, availableHeight, chromeHeight, footerHeight]);

  const [snapIndex, setSnapIndex] = useState(1);

  // Opening the first item of a sale should reveal the cart; emptying it should
  // hand the screen back to the camera. Adjusted during render rather than in
  // an effect so the sheet never paints once at the old snap and then jumps.
  // Only the transition is reacted to, so a cashier who dragged the sheet
  // somewhere keeps it there for the rest of the sale.
  const [lastEmpty, setLastEmpty] = useState(isEmpty);
  if (lastEmpty !== isEmpty) {
    setLastEmpty(isEmpty);
    setSnapIndex(isEmpty ? 0 : 1);
  }

  const activeIndex = Math.min(snapIndex, snaps.length - 1);
  const height = snaps[activeIndex] ?? PEEK_HEIGHT;

  // ---- Drag ----
  const dragRef = useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    moved: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (isEmpty || snaps.length < 2) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      sheet.style.transition = "none";
      dragRef.current = {
        startY: e.clientY,
        startHeight: sheet.offsetHeight,
        lastY: e.clientY,
        lastTime: e.timeStamp,
        velocity: 0,
        moved: 0,
      };
    },
    [isEmpty, snaps.length]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;

    const dt = Math.max(1, e.timeStamp - drag.lastTime);
    // Upward drag = growing sheet = positive velocity.
    drag.velocity = (drag.lastY - e.clientY) / dt;
    drag.lastY = e.clientY;
    drag.lastTime = e.timeStamp;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.startY));

    const next = clamp(
      drag.startHeight + (drag.startY - e.clientY),
      snaps[0],
      snaps[snaps.length - 1]
    );
    sheet.style.height = `${next}px`;
  }, [snaps]);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    dragRef.current = null;
    if (!drag || !sheet) return;

    sheet.style.transition = "";

    // A tap on the handle cycles through the snap points — the same gesture
    // one-handed, without a drag.
    if (drag.moved < TAP_SLOP_PX) {
      const next = (activeIndex + 1) % snaps.length;
      sheet.style.height = `${snaps[next]}px`;
      vibrate(12);
      setSnapIndex(next);
      return;
    }

    const projected = sheet.offsetHeight + drag.velocity * VELOCITY_PROJECTION_MS;
    let best = 0;
    snaps.forEach((snap, i) => {
      if (Math.abs(snap - projected) < Math.abs(snaps[best] - projected)) best = i;
    });

    sheet.style.height = `${snaps[best]}px`;
    if (best !== activeIndex) vibrate(12);
    setSnapIndex(best);
  }, [activeIndex, snaps]);

  const gripProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    // Without this the browser claims the gesture for scroll/refresh before
    // pointermove ever fires.
    style: { touchAction: "none" as const },
  };

  const rounding = Math.round(roundingAdjustment);
  const { value: totalValue, unit: totalUnit } = formatLLParts(total);

  return (
    <div
      ref={sheetRef}
      className={cn(
        "sheet relative flex flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-card",
        "shadow-[0_-24px_48px_-24px_rgba(0,0,0,0.85)]"
      )}
      style={{ height }}
      aria-label="Cart"
    >
      {/* ---- Grab handle + title row ---- */}
      <div ref={chromeRef} className="flex-shrink-0" {...gripProps}>
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/40" />
        </div>

        {isEmpty ? (
          <div className="flex items-center justify-center gap-2 px-5 pb-4 pt-1 text-sm text-muted-foreground">
            <ScanLine className="h-4 w-4" />
            <span>Scan or search to start a sale</span>
          </div>
        ) : (
          <div className="flex items-baseline justify-between px-5 pb-2.5 pt-1">
            <h2 className="text-lg font-bold">
              Cart{" "}
              <span className="text-sm font-medium text-muted-foreground">
                · {itemCount} item{itemCount !== 1 ? "s" : ""}
              </span>
            </h2>
            <button
              type="button"
              onClick={onClear}
              onPointerDown={(e) => e.stopPropagation()}
              className="tap -mr-2 rounded-lg px-2 py-1 text-sm font-semibold text-destructive"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ---- Items ---- */}
      {!isEmpty && (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {items.map((item) => (
            <div
              key={item.product_id}
              id={`cart-item-${item.product_id}`}
              className={cn(
                "animate-cart-item-in flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-300",
                highlightedItemId === item.product_id
                  ? "bg-primary/15 ring-1 ring-primary/60"
                  : "ring-1 ring-transparent"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
                  <span className="truncate">{item.product_name}</span>
                  {/* A one-off has no catalogue row behind it — it was named and
                      priced at the till. The desktop cart says so; on mobile it
                      was indistinguishable from a real product. */}
                  {item.line_kind === "one_off" && (
                    <span className="flex-none rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                      One-off
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground tnum">
                  {item.discount_percentage > 0 ? (
                    <>
                      <span className="line-through opacity-60">
                        {formatLL(item.original_unit_price)}
                      </span>{" "}
                      <span className="font-semibold text-emerald-400">
                        {formatLL(item.unit_price)}
                      </span>{" "}
                      each · −{item.discount_percentage}%
                    </>
                  ) : (
                    <>{formatLL(item.unit_price)} each</>
                  )}
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center rounded-xl bg-muted/70">
                <button
                  type="button"
                  aria-label={`Decrease ${item.product_name}`}
                  onClick={() => onDecrement(item.product_id)}
                  className="tap flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center text-[15px] font-bold tnum">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${item.product_name}`}
                  onClick={() => onIncrement(item.product_id)}
                  className="tap flex h-9 w-9 items-center justify-center rounded-xl text-primary"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="w-[92px] flex-shrink-0 text-right text-[15px] font-semibold tnum">
                {formatLLParts(item.total_price).value}
                <span className="ml-0.5 text-[10px] font-bold text-muted-foreground">
                  {formatLLParts(item.total_price).unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Totals + actions ---- */}
      {!isEmpty && (
        <div ref={footerRef} className="flex-shrink-0 border-t border-white/[0.07] px-5 pb-4 pt-3">
          <div className="flex items-end justify-between gap-3" {...gripProps}>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Total
                {rounding !== 0 && (
                  <span className="tnum">
                    {" · Rounded "}
                    {rounding > 0 ? "+" : "−"}
                    {Math.abs(rounding).toLocaleString("en-US")}
                  </span>
                )}
              </p>
              {totalDiscount > 0 && (
                <p className="mt-0.5 text-xs font-semibold text-emerald-400 tnum">
                  Saved {formatLL(totalDiscount)}
                </p>
              )}
              <p className="mt-0.5 text-sm text-muted-foreground tnum">{formatUSD(totalUsd)}</p>
            </div>

            <p
              key={total}
              className="animate-value-bump flex-shrink-0 text-[34px] font-extrabold leading-none text-primary tnum"
            >
              {totalValue}
              <span className="ml-1 text-base font-bold">{totalUnit}</span>
            </p>
          </div>

          {/* One way to finish a sale, not two. "Done" used to sit here and
              complete the sale in place with no change calculated, which meant
              a second payment path to keep correct for no benefit the cashier
              could name. Checkout is the whole width now. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={onCheckout}
              className="tap flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground"
            >
              <CreditCard className="h-5 w-5" />
              Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
