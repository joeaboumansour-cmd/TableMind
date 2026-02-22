import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as currency
 */
export function formatCurrency(value: number, currency = "USD", locale = "en-US"): string {
  if (value === null || value === undefined || isNaN(value)) return "-";
  
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a number as a compact currency (e.g., $1.2K)
 */
export function formatCompactCurrency(value: number, currency = "USD", locale = "en-US"): string {
  if (value === null || value === undefined || isNaN(value)) return "-";
  
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
