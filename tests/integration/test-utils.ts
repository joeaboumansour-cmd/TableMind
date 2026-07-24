import { type Page } from '@playwright/test';

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
 * Injects cart items into the Zustand-persisted cart store.
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
}>) {
  await page.evaluate((cartItems) => {
    const cartState = {
      state: {
        items: cartItems.map(item => ({
          ...item,
          currency: 'LL',
          discount_percentage: 0,
          original_unit_price: item.unit_price,
          original_total_price: item.total_price,
          original_unit_price_usd: item.unit_price_usd,
          original_total_price_usd: item.total_price_usd,
          unit_price_discount_amount: 0,
          total_discount_amount: 0,
        })),
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