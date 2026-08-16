// Format utilities for GoldenSquirrel Mobile POS

/**
 * Exchange rate when SELLING (customer pays): 1 USD = 90,000 LL
 * This rate is used when converting LL prices to USD for display during sales
 */
export const SELL_RATE = 90000;

/**
 * Exchange rate when RETURNING money (giving change): 1 USD = 89,000 LL
 * This rate is used when converting LL change back to USD
 */
export const RETURN_RATE = 89000;

/**
 * The smallest physical LL bill denomination.
 * All LL amounts in the system (prices, totals, change, revenue) must be
 * multiples of this value because there are no 1,000 / 250 / 500 LL bills.
 */
export const LL_ROUND_UNIT = 5000;

/**
 * Round a Lebanese Pound amount to the nearest 5,000 LL.
 *
 * Rationale: Lebanon no longer has bills smaller than 5,000 LL, so every
 * LL value that enters the system must be a multiple of 5,000.
 *
 * Example: 186,300 → 185,000 | 209,200 → 210,000
 */
export function roundToNearest5k(amount: number): number {
  return Math.round(amount / LL_ROUND_UNIT) * LL_ROUND_UNIT;
}

/**
 * Convert USD to Lebanese Pounds (uses sell rate) and round to nearest 5k.
 *
 * This is the canonical conversion for product prices: a product priced at
 * $2.07 on the 90,000 sell rate produces 186,300 LL → rounded to 185,000 LL.
 * The original USD value ($2.07) is always preserved; only the LL equivalent
 * is rounded.
 */
export function convertUsdToLl(usdAmount: number): number {
  return roundToNearest5k(usdAmount * SELL_RATE);
}

/**
 * Convert USD to Lebanese Pounds using the RETURN_RATE (89,000) and round to
 * nearest 5k.  Used when a customer pays in USD — the LL-equivalent of their
 * payment is rounded so that change is always a multiple of 5,000.
 */
export function convertUsdToLlForReturn(usdAmount: number): number {
  return roundToNearest5k(usdAmount * RETURN_RATE);
}

/**
 * Convert Lebanese Pounds to USD for sale display (uses sell rate: 90,000)
 * Use this when showing product prices in USD
 */
export function convertLlToUsdForSale(llAmount: number): number {
  return llAmount / SELL_RATE;
}

/**
 * Convert Lebanese Pounds to USD for return/change (uses return rate: 89,000)
 * Use this when calculating USD equivalent of change to give back
 */
export function convertLlToUsdForReturn(llAmount: number): number {
  return llAmount / RETURN_RATE;
}

/**
 * @deprecated Use convertLlToUsdForSale or convertLlToUsdForReturn instead
 * Convert Lebanese Pounds to USD (defaults to sell rate for backwards compatibility)
 */
export function convertLlToUsd(llAmount: number): number {
  return convertLlToUsdForSale(llAmount);
}

/**
 * Format amount as Lebanese Pounds (LL)
 */
export function formatLL(amount: number): string {
  return `${amount.toLocaleString('en-US')} LL`;
}

/**
 * The same string formatLL() produces, split into its number and its unit.
 *
 * Purely a display helper for the headline figures (cart total, amount due,
 * change) where the "LL" suffix is set at a smaller size than the digits.
 * It delegates to formatLL so there is still exactly one place that decides
 * how an LL amount is written — callers must never hand-roll the split.
 */
export function formatLLParts(amount: number): { value: string; unit: string } {
  const formatted = formatLL(amount);
  const unit = ' LL';
  return {
    value: formatted.slice(0, formatted.length - unit.length),
    unit: 'LL',
  };
}

/**
 * Format amount as USD
 */
export function formatUSD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format a number as currency (legacy - defaults to USD)
 */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  if (currency === 'LL') {
    return formatLL(amount);
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number with commas
 */
export function formatNumber(
  value: number,
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Format a date string
 */
export function formatDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

/**
 * Format a date with time
 */
export function formatDateTime(dateString: string): string {
  return formatDate(dateString, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  }

  return formatDate(dateString);
}

/**
 * Format a phone number
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }
  return phone;
}

/**
 * Format a barcode for display
 */
export function formatBarcode(barcode: string): string {
  if (barcode.length <= 4) return barcode;
  return barcode.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format a transaction number
 */
export function formatTransactionNumber(
  prefix: string,
  number: number,
  padding: number = 6
): string {
  return `${prefix}-${String(number).padStart(padding, '0')}`;
}

/**
 * Format a number as percentage
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}