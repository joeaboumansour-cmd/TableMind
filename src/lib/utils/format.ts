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
 * Convert USD to Lebanese Pounds (uses sell rate)
 */
export function convertUsdToLl(usdAmount: number): number {
  return Math.round(usdAmount * SELL_RATE);
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
