import { type Page, expect } from '@playwright/test';

/**
 * Injects auth state into localStorage so the app thinks we're logged in.
 */
export async function injectAuth(page: Page) {
  await page.evaluate(() => {
    const storeUser = {
      id: 'test-store-id',
      storeId: 'test-store-id',
      username: 'teststore',
      displayName: 'teststore',
      isOwner: true,
      permissions: {
        pos: true,
        inventory: true,
        transactions: true,
        receipts: true,
      },
    };
    localStorage.setItem('goldensquirrel_user', JSON.stringify(storeUser));
    localStorage.setItem('goldensquirrel_auth', JSON.stringify({
      store_id: 'test-store-id',
      username: 'teststore',
      license_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      timestamp: Date.now(),
    }));
  });
}

/**
 * Default feature flags matching the "general" preset.
 * All core features enabled by default.
 */
export const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  pos: true,
  inventory: true,
  transactions: true,
  receipts: true,
  product_discount: true,
  transaction_analytics: false,
};

/**
 * Injects feature flags into localStorage so useFeatureFlags() reads them.
 * Override any flag by passing partial overrides (e.g. { product_discount: false }).
 */
export async function injectFeatureFlags(page: Page, overrides?: Record<string, boolean>) {
  await page.evaluate(({ defaults, overrides }: { defaults: Record<string, boolean>; overrides?: Record<string, boolean> }) => {
    const flags = { ...defaults, ...overrides };
    localStorage.setItem('store_features_test-store-id', JSON.stringify({
      flags,
      storeType: 'general',
    }));
  }, { defaults: DEFAULT_FEATURE_FLAGS, overrides });
}

/**
 * Injects cart items into the Zustand-persisted cart store.
 * Respects discount_percentage from the passed items (defaults to 0).
 * When discount_percentage > 0, the unit_price/total_price values are treated
 * as the DISCOUNTED prices, and original_unit_price/original_total_price are
 * computed by reversing the discount (matching the cart store's addItem behavior).
 */
export async function injectCartItems(page: Page, items: Array<{
  product_id: string;
  product_name: string;
  barcode: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_price_usd: number;
  total_price_usd: number;
  stock_quantity: number;
  discount_percentage?: number;
  original_unit_price?: number;
  original_total_price?: number;
  original_unit_price_usd?: number;
  original_total_price_usd?: number;
}>) {
  await page.evaluate((cartItems) => {
    const cartState = {
      state: {
        items: cartItems.map(item => {
          const discountPct = item.discount_percentage || 0;
          const hasDiscount = discountPct > 0;
          // Reconstruct original (pre-discount) prices from discounted prices
          const originalUnitPrice = item.original_unit_price ?? (hasDiscount ? Math.round(item.unit_price / (1 - discountPct / 100)) : item.unit_price);
          const originalTotalPrice = item.original_total_price ?? (hasDiscount ? Math.round(item.total_price / (1 - discountPct / 100)) : item.total_price);
          const originalUnitPriceUsd = item.original_unit_price_usd ?? (hasDiscount ? item.unit_price_usd / (1 - discountPct / 100) : item.unit_price_usd);
          const originalTotalPriceUsd = item.original_total_price_usd ?? (hasDiscount ? item.total_price_usd / (1 - discountPct / 100) : item.total_price_usd);
          const unitDiscountAmount = originalUnitPrice - item.unit_price;
          const totalDiscountAmount = originalTotalPrice - item.total_price;
          return {
            ...item,
            currency: 'LL',
            discount_percentage: discountPct,
            original_unit_price: originalUnitPrice,
            original_total_price: originalTotalPrice,
            original_unit_price_usd: originalUnitPriceUsd,
            original_total_price_usd: originalTotalPriceUsd,
            unit_price_discount_amount: unitDiscountAmount,
            total_discount_amount: totalDiscountAmount,
          };
        }),
        store_id: 'test-store-id',
      },
      version: 0,
    };
    localStorage.setItem('goldensquirrel-cart', JSON.stringify(cartState));
  }, items);
}

const DEFAULT_CART_ITEMS = [
  {
    product_id: 'test-product-1',
    product_name: 'Test Coffee',
    barcode: 'COFFEE001',
    quantity: 2,
    unit_price: 50000,
    total_price: 100000,
    unit_price_usd: 1.67,
    total_price_usd: 3.34,
    stock_quantity: 50,
  },
  {
    product_id: 'test-product-2',
    product_name: 'Test Tea',
    barcode: 'TEA001',
    quantity: 1,
    unit_price: 30000,
    total_price: 30000,
    unit_price_usd: 1.00,
    total_price_usd: 1.00,
    stock_quantity: 100,
  },
];

export { DEFAULT_CART_ITEMS };

/**
 * Cart items with discounts applied — for testing discount display behavior.
 * Test Coffee: 10% off → unit_price becomes 45,000 (50,000 - 10%), total_price becomes 90,000 (2 × 45,000)
 * Test Tea: no discount.
 * The injectCartItems function stores these as-is in the cart store, so total_price
 * must already reflect the discounted amount (matching what the cart store's addItem would produce).
 */
const DISCOUNT_CART_ITEMS = [
  {
    product_id: 'test-product-1',
    product_name: 'Test Coffee',
    barcode: 'COFFEE001',
    quantity: 2,
    unit_price: 45000,       // 50,000 - 10% discount
    total_price: 90000,      // 2 × 45,000
    unit_price_usd: 1.50,    // 1.67 - 10% discount
    total_price_usd: 3.00,   // 2 × 1.50
    stock_quantity: 50,
    discount_percentage: 10,
  },
  {
    product_id: 'test-product-2',
    product_name: 'Test Tea',
    barcode: 'TEA001',
    quantity: 1,
    unit_price: 30000,
    total_price: 30000,
    unit_price_usd: 1.00,
    total_price_usd: 1.00,
    stock_quantity: 100,
    discount_percentage: 0,
  },
];

export { DISCOUNT_CART_ITEMS };

/**
 * Mocks Supabase REST API to return empty results.
 */
export async function mockSupabaseApi(page: Page) {
  await page.route('**/rest/v1/**', (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else {
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    }
  });
}

/**
 * Navigate to a page with auth and optionally cart items pre-injected.
 */
export async function navigateWithAuth(page: Page, url: string, cartItems?: any[]) {
  await mockSupabaseApi(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await injectAuth(page);
  if (cartItems) {
    await injectCartItems(page, cartItems);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
}

/**
 * Navigate to a page with auth, feature flags, and optionally cart items.
 * Feature flags are injected into localStorage before the page renders,
 * so useFeatureFlags() reads the desired state immediately.
 *
 * Usage:
 *   // Test with discounts OFF
 *   await navigateWithFlags(page, '/pos', { product_discount: false });
 *
 *   // Test with analytics ON and discounted cart items
 *   await navigateWithFlags(page, '/transactions', { transaction_analytics: true }, DISCOUNT_CART_ITEMS);
 */
export async function navigateWithFlags(
  page: Page,
  url: string,
  featureOverrides?: Record<string, boolean>,
  cartItems?: any[]
) {
  await mockSupabaseApi(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await injectAuth(page);
  await injectFeatureFlags(page, featureOverrides);
  if (cartItems) {
    await injectCartItems(page, cartItems);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
}

/**
 * Click a button by its text and verify the URL changes to the expected path.
 * This is the core "button-first" navigation assertion.
 */
export async function clickButtonAndVerifyUrl(page: Page, buttonText: string, expectedUrlContains: string, options?: { timeout?: number }) {
  const timeout = options?.timeout ?? 15000;
  const btn = page.locator(`button:has-text("${buttonText}")`).first();
  await expect(btn).toBeVisible({ timeout });
  await btn.click();
  await page.waitForURL(`**${expectedUrlContains}`, { timeout });
  expect(page.url()).toContain(expectedUrlContains);
}

/**
 * Assert the current URL contains the expected path.
 */
export async function expectUrlToContain(page: Page, expected: string) {
  expect(page.url()).toContain(expected);
}

/**
 * Click a mobile menu item and verify navigation.
 */
export async function clickMobileMenuItemAndVerifyUrl(page: Page, itemText: string, expectedUrlContains: string) {
  // Open mobile menu
  const hamburger = page.locator('button[aria-label="Open menu"]').first();
  await expect(hamburger).toBeVisible({ timeout: 10000 });
  await hamburger.click();
  await page.waitForTimeout(300);

  // Click the menu item
  const menuItem = page.locator(`button:has-text("${itemText}"), span:has-text("${itemText}")`).first();
  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.click();
  await page.waitForURL(`**${expectedUrlContains}`, { timeout: 15000 });
  expect(page.url()).toContain(expectedUrlContains);
}

/**
 * Set the viewport to mobile size for mobile-specific tests.
 */
export async function setMobileViewport(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
}

/**
 * Go offline by disabling network requests.
 */
export async function goOffline(page: Page) {
  await page.context().setOffline(true);
  await page.route('**/*', (route) => {
    route.abort();
  });
}

/**
 * Go back online.
 */
export async function goOnline(page: Page) {
  await page.context().setOffline(false);
  await page.unrouteAll({ behavior: 'wait' });
}