"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Product } from "@/lib/types/product";
import { formatLL, formatUSD, convertLlToUsdForReturn, convertUsdToLl } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface ProductSearchBarProps {
  products: Product[];
  onSelect: (product: Product) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

export default function ProductSearchBar({
  products,
  onSelect,
  placeholder = "Search products...",
  className,
  autoFocus = false,
  inputRef: externalInputRef,
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

  // Filter products by name or barcode (case-insensitive)
  const filteredProducts = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [products, debouncedQuery]);

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
          className="pl-10 pr-8 h-10"
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
          className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-[320px] overflow-y-auto"
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
                    "px-3 py-2 cursor-pointer transition-colors flex items-center justify-between gap-3 rounded-sm",
                    activeIndex === index
                      ? "bg-amber-200 dark:bg-amber-700"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "font-semibold text-sm leading-tight truncate",
                      activeIndex === index ? "text-amber-900 dark:text-white" : ""
                    )}>
                      {product.name}
                    </p>
                    <p className={cn(
                      "text-xs mt-0.5 truncate",
                      activeIndex === index ? "text-amber-800 dark:text-amber-100" : "text-muted-foreground"
                    )}>
                      {product.barcode || "No barcode"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={cn(
                      "text-sm font-semibold",
                      activeIndex === index ? "text-amber-900 dark:text-white" : "text-amber-600"
                    )}>
                      {product.currency === "USD"
                        ? formatUSD(product.selling_price)
                        : formatLL(product.selling_price)}
                    </p>
                    <p className={cn(
                      "text-xs",
                      activeIndex === index ? "text-amber-800 dark:text-amber-100" : "text-muted-foreground"
                    )}>
                      {product.currency === "USD"
                        ? formatLL(convertUsdToLl(product.selling_price))

                        : formatUSD(convertLlToUsdForReturn(product.selling_price))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}