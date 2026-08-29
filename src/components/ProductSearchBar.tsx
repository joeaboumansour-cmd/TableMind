"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Product } from "@/lib/types/product";
// convertUsdToLl, never a raw `* SELL_RATE` — the helper is where the 5,000 LL
// rounding lives, and this list must quote the same price the cart charges.
import { formatLL, formatUSD, convertLlToUsdForReturn, convertUsdToLl } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/** Most results the dropdown will render at once. */
const MAX_SEARCH_RESULTS = 50;

interface ProductSearchBarProps {
  products: Product[];
  onSelect: (product: Product) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Extra classes for the input itself — lets the POS render this as a
   *  floating pill over the camera without forking the component. */
  inputClassName?: string;
  /** Open the results above the field instead of below. Required wherever the
   *  bar sits near the bottom of the screen (the mobile POS), otherwise the
   *  list renders behind the cart sheet. */
  dropUp?: boolean;
}

export default function ProductSearchBar({
  products,
  onSelect,
  placeholder = "Search products...",
  className,
  autoFocus = false,
  inputRef: externalInputRef,
  inputClassName,
  dropUp = false,
}: ProductSearchBarProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);

  // Merge external ref with internal ref
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    internalInputRef.current = node;
    if (externalInputRef) {
      if (typeof externalInputRef === 'function') {
        externalInputRef(node);
      } else {
        (externalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
      }
    }
  }, [externalInputRef]);

  const inputRef = setInputRef;
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search query (200ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  // Filter products by name or barcode (case-insensitive).
  //
  // Capped at MAX_SEARCH_RESULTS. This previously rendered every match: on a
  // 2,500 product catalog, typing a single common letter built ~2,000 <li>
  // nodes inside a 320px scroller on every keystroke. Nobody scrolls past the
  // first handful — they type another character instead.
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

  // Kept as the name used throughout the render below.
  const filteredProducts = visibleProducts;

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus) {
      internalInputRef.current?.focus();
    }
  }, [autoFocus]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const dropdown = dropdownRef.current;
    if (!dropdown) return;
    const activeEl = dropdown.querySelector(
      `[data-search-index="${activeIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen]);

  const handleSelect = useCallback(
    (product: Product) => {
      onSelect(product);
      setQuery("");
      setDebouncedQuery("");
      setIsOpen(false);
      setActiveIndex(0);
      // Re-focus for next search
      setTimeout(() => internalInputRef.current?.focus(), 0);
    },
    [onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" && filteredProducts.length > 0) {
        setIsOpen(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < filteredProducts.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : filteredProducts.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (filteredProducts[activeIndex]) {
          handleSelect(filteredProducts[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  const showDropdown = isOpen && debouncedQuery.trim().length > 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Open dropdown when user starts typing (will show after debounce)
            if (e.target.value.trim()) {
              setIsOpen(true);
            } else {
              setIsOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (debouncedQuery.trim() && filteredProducts.length > 0) {
              setIsOpen(true);
            }
          }}
          className={cn("pl-10 pr-8 h-10", inputClassName)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDebouncedQuery("");
              setIsOpen(false);
              internalInputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className={cn(
            "absolute z-50 w-full overflow-y-auto rounded-2xl border bg-popover shadow-2xl max-h-[320px] no-scrollbar",
            dropUp ? "bottom-full mb-2" : "mt-1"
          )}
        >
          {filteredProducts.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No products found for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : (
            <ul className="py-1">
              {filteredProducts.map((product, index) => (
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
              {totalMatches > filteredProducts.length && (
                <li className="px-3 py-2 text-center text-xs text-muted-foreground border-t mt-1">
                  Showing {filteredProducts.length} of {totalMatches} matches — keep
                  typing to narrow
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}