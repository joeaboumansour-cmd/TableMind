"use client";

// =============================================
// One input for both jobs (desktop Pro till)
//
// The old desktop layout had two fields: a search box on the left and a
// barcode box on the right. The cashier had to know which one they were aimed
// at, and a wedge scanner fired into whichever happened to hold focus.
//
// This is one field that decides for itself. A wedge emits digits and presses
// Enter, so digits + Enter means "add this barcode". Anything with a letter in
// it is somebody typing a product name, so that opens the search list. Nothing
// to switch, nothing to get wrong.
// =============================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ScanLine } from "lucide-react";
import { Product } from "@/lib/types/product";
// convertUsdToLl, never a raw `* SELL_RATE`: the helper exists to apply the
// 5,000 LL rounding, and the search dropdown must quote the same price the
// QuickGrid tile and the cart do.
import { formatLL, formatUSD, convertLlToUsdForReturn, convertUsdToLl } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/** Most results the dropdown will render at once. */
const MAX_SEARCH_RESULTS = 50;

/** Shortest run of digits treated as a barcode rather than a search. */
const MIN_BARCODE_LENGTH = 4;

/**
 * Digits only, and enough of them to be a code rather than a quantity someone
 * started typing. Deliberately strict: misreading a search as a barcode makes
 * the field appear to swallow input, which is worse than the reverse.
 */
export function looksLikeBarcode(raw: string): boolean {
  const value = raw.trim();
  if (value.length < MIN_BARCODE_LENGTH) return false;
  return /^[0-9]+$/.test(value);
}

interface SmartScanInputProps {
  products: Product[];
  /** A product was picked from the search list. */
  onSelectProduct: (product: Product) => void;
  /** Enter was pressed on something barcode-shaped. */
  onBarcode: (barcode: string) => void;
  /**
   * The parent focuses this field on F1 and after a lane switch, so it takes
   * the ref object directly rather than a callback. Passed straight through to
   * the input — merging an external ref into an internal one means writing to
   * a prop, which React 19 rightly objects to.
   */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Held while the unknown-barcode strip below is being filled in. */
  disabled?: boolean;
  className?: string;
}

export default function SmartScanInput({
  products,
  onSelectProduct,
  onBarcode,
  inputRef: externalInputRef,
  disabled = false,
  className,
}: SmartScanInputProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The parent's ref IS the ref when it supplies one; otherwise a local one
  // stands in so the refocus-after-scan behaviour still works standalone.
  const inputRef = externalInputRef || fallbackInputRef;

  // Debounce the SEARCH only. The barcode path reads `query` directly on
  // Enter, so a wedge scan never waits on a timer.
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedQuery(query), 200);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query]);

  const isBarcodeMode = looksLikeBarcode(query);

  // Capped at MAX_SEARCH_RESULTS: on a 2,500 product catalogue a single common
  // letter would otherwise build ~2,000 rows inside a 320px scroller on every
  // keystroke, and nobody scrolls past the first handful anyway.
  const { visibleProducts, totalMatches } = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return { visibleProducts: [] as Product[], totalMatches: 0 };

    const matches: Product[] = [];
    let total = 0;
    for (const p of products) {
      if (
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      ) {
        total++;
        if (matches.length < MAX_SEARCH_RESULTS) matches.push(p);
      }
    }
    return { visibleProducts: matches, totalMatches: total };
  }, [products, debouncedQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const activeEl = dropdownRef.current?.querySelector(
      `[data-search-index="${activeIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const reset = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setIsOpen(false);
    setActiveIndex(0);
  }, []);

  /** Hand focus back for the next scan — a till scans continuously. */
  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [inputRef]);

  const handleSelect = useCallback(
    (product: Product) => {
      onSelectProduct(product);
      reset();
      refocus();
    },
    [onSelectProduct, reset, refocus]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = query.trim();
      if (!raw) return;

      // Digits + Enter is a scan (or someone typing a code by hand). No dedup
      // and no confirmation: a hardware wedge does not fire false duplicates,
      // and the cashier is holding the next item.
      if (looksLikeBarcode(raw)) {
        onBarcode(raw);
        reset();
        refocus();
        return;
      }

      if (isOpen && visibleProducts[activeIndex]) {
        handleSelect(visibleProducts[activeIndex]);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (isOpen) setIsOpen(false);
      else reset();
      return;
    }

    if (!isOpen) {
      if (e.key === "ArrowDown" && visibleProducts.length > 0) {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev < visibleProducts.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : visibleProducts.length - 1));
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
    // Everything else, F-keys included, bubbles: the POS shortcuts must keep
    // working while the cashier is mid-search.
  };

  const showDropdown = isOpen && !isBarcodeMode && debouncedQuery.trim().length > 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border bg-card px-4 transition-colors",
          isBarcodeMode ? "border-primary/50" : "border-white/[0.08]",
          disabled && "opacity-60"
        )}
      >
        <ScanLine
          className={cn(
            "h-5 w-5 flex-none",
            isBarcodeMode ? "text-primary" : "text-muted-foreground"
          )}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          // Not inputMode="numeric": the same field takes product names, and
          // pinning a numeric keypad would make it useless on a touch till.
          value={query}
          disabled={disabled}
          placeholder="Scan, or type a product name"
          aria-label="Scan a barcode or search products"
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setIsOpen(next.trim().length > 0 && !looksLikeBarcode(next));
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!isBarcodeMode && debouncedQuery.trim() && visibleProducts.length > 0) {
              setIsOpen(true);
            }
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-[58px] min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />

        {/* Says what the field is about to do with what is currently in it. */}
        <span className="hidden flex-none items-center gap-2 text-[11px] font-semibold text-muted-foreground/70 sm:flex">
          {isBarcodeMode ? (
            <span className="text-primary">press Enter to add</span>
          ) : (
            <span>letters search · digits add</span>
          )}
          <kbd className="rounded border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            F1
          </kbd>
        </span>
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="no-scrollbar absolute z-50 mt-1 max-h-[320px] w-full overflow-y-auto rounded-2xl border bg-popover shadow-2xl"
        >
          {visibleProducts.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No products found for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : (
            <ul className="py-1">
              {visibleProducts.map((product, index) => (
                <li
                  key={product.id}
                  data-search-index={index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(product);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "mx-1 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors",
                    activeIndex === index ? "bg-primary/15" : "hover:bg-muted/50"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-tight">
                      {product.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground tnum">
                      {product.barcode || "No barcode"}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-semibold text-primary tnum">
                      {product.currency === "USD"
                        ? formatUSD(product.selling_price)
                        : formatLL(product.selling_price)}
                    </p>
                    <p className="text-xs text-muted-foreground tnum">
                      {product.currency === "USD"
                        ? formatLL(convertUsdToLl(product.selling_price))
                        : formatUSD(convertLlToUsdForReturn(product.selling_price))}
                    </p>
                  </div>
                </li>
              ))}
              {totalMatches > visibleProducts.length && (
                <li className="mt-1 border-t px-3 py-2 text-center text-xs text-muted-foreground">
                  Showing {visibleProducts.length} of {totalMatches} matches — keep typing to
                  narrow
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
