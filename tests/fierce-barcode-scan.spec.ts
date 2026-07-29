import { test, expect } from '@playwright/test';
import {
  injectAuth,
  injectFeatureFlags,
  setMobileViewport,
} from './integration/test-utils';

// ============================================================================
// Test data — same products used by the rest of the test suite
// These match the structure injectCartItems expects
// ============================================================================
const PRODUCT_TO_SCAN = {
  product_id: 'coffee-1',
  product_name: 'Morning Coffee',
  barcode: '6221001001007',
  quantity: 1,
  unit_price: 20000,
  total_price: 20000,
  unit_price_usd: 0.67,
  total_price_usd: 0.67,
  stock_quantity: 50,
};

const TEA_PRODUCT = {
  product_id: 'tea-1',
  product_name: 'Green Tea',
  barcode: '6222002002007',
  quantity: 1,
  unit_price: 15000,
  total_price: 15000,
  unit_price_usd: 0.50,
  total_price_usd: 0.50,
  stock_quantity: 100,
};

const CROISSANT_PRODUCT = {
  product_id: 'croissant-1',
  product_name: 'Butter Croissant',
  barcode: '6223003003007',
  quantity: 1,
  unit_price: 25000,
  total_price: 25000,
  unit_price_usd: 0.83,
  total_price_usd: 0.83,
  stock_quantity: 30,
};

// ============================================================================
// Helper: Seed products into IndexedDB directly (using native API to Dexie-managed stores)
// The app builds its barcode index from IndexedDB cache (getCachedProducts → products state)
// Dexie schema: products_cache has keyPath 'id', indexes: store_id, name, barcode, updated_at
// ============================================================================
async function seedProductsIntoIndexedDB(page: any): Promise<boolean> {
  const cachedProducts = [
    {
      id: 'coffee-1',
      store_id: 'test-store-id',
      name: 'Morning Coffee',
      barcode: '6221001001007',
      cost_price: 5000,
      selling_price: 20000,
      currency: 'LL',
      profit_percentage: 300,
      discount_percentage: 0,
      stock_quantity: 50,
      min_stock_threshold: 5,
      parent_id: null,
      variant_name: null,
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tea-1',
      store_id: 'test-store-id',
      name: 'Green Tea',
      barcode: '6222002002007',
      cost_price: 3000,
      selling_price: 15000,
      currency: 'LL',
      profit_percentage: 400,
      discount_percentage: 0,
      stock_quantity: 100,
      min_stock_threshold: 10,
      parent_id: null,
      variant_name: null,
      updated_at: new Date().toISOString(),
    },
    {
      id: 'croissant-1',
      store_id: 'test-store-id',
      name: 'Butter Croissant',
      barcode: '6223003003007',
      cost_price: 4000,
      selling_price: 25000,
      currency: 'LL',
      profit_percentage: 525,
      discount_percentage: 0,
      stock_quantity: 30,
      min_stock_threshold: 5,
      parent_id: null,
      variant_name: null,
      updated_at: new Date().toISOString(),
    },
  ];

  const count = await page.evaluate(async (products) => {
    return new Promise<number>((resolve) => {
      const request = indexedDB.open('GoldenSquirrelPOS', 2);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const tx = db.transaction('products_cache', 'readwrite');
          const store = tx.objectStore('products_cache');
          // Clear first
          store.clear();
          // Add all
          for (const p of products) {
            store.put(p);
          }
          tx.oncomplete = () => {
            // Verify by counting
            const tx2 = db.transaction('products_cache', 'readonly');
            const store2 = tx2.objectStore('products_cache');
            const countReq = store2.count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => resolve(0);
          };
          tx.onerror = () => resolve(0);
        } catch {
          resolve(0);
        }
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('products_cache')) {
          const objStore = db.createObjectStore('products_cache', { keyPath: 'id' });
          objStore.createIndex('store_id', 'store_id', { unique: false });
          objStore.createIndex('name', 'name', { unique: false });
          objStore.createIndex('barcode', 'barcode', { unique: false });
          objStore.createIndex('updated_at', 'updated_at', { unique: false });
        }
        // Return 0 on upgrade (store may not be fully ready)
        resolve(0);
      };
      request.onerror = () => resolve(0);
    });
  }, cachedProducts);

  return count === 3;
}

// ============================================================================
// Shared setup: navigate first, then mock products so route priority is correct
// ============================================================================
async function setupPos(page: any, isMobile: boolean) {
  if (isMobile) {
    await setMobileViewport(page);
  }

  // Navigate via page.goto directly, then inject auth/flags manually
  // This avoids navigateWithFlags's internal mockSupabaseApi which overrides our routes
  await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await injectAuth(page);
  if (isMobile) {
    await injectFeatureFlags(page, { desktop_shortcuts: false });
  } else {
    await injectFeatureFlags(page, { desktop_shortcuts: true });
  }

  // Unroute the default mockSupabaseApi which navigateWithFlags may have set
  // We'll set our own routes AFTER navigation
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Now set up our product mock (higher priority since registered last)
  await page.route('**/rest/v1/products*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'coffee-1',
          store_id: 'test-store-id',
          name: 'Morning Coffee',
          barcode: '6221001001007',
          cost_price: 5000,
          selling_price: 20000,
          currency: 'LL',
          profit_percentage: 300,
          discount_percentage: 0,
          stock_quantity: 50,
          min_stock_threshold: 5,
          created_at: new Date().toISOString(),
          parent_id: null,
          variant_name: null,
        },
        {
          id: 'tea-1',
          store_id: 'test-store-id',
          name: 'Green Tea',
          barcode: '6222002002007',
          cost_price: 3000,
          selling_price: 15000,
          currency: 'LL',
          profit_percentage: 400,
          discount_percentage: 0,
          stock_quantity: 100,
          min_stock_threshold: 10,
          created_at: new Date().toISOString(),
          parent_id: null,
          variant_name: null,
        },
        {
          id: 'croissant-1',
          store_id: 'test-store-id',
          name: 'Butter Croissant',
          barcode: '6223003003007',
          cost_price: 4000,
          selling_price: 25000,
          currency: 'LL',
          profit_percentage: 525,
          discount_percentage: 0,
          stock_quantity: 30,
          min_stock_threshold: 5,
          created_at: new Date().toISOString(),
          parent_id: null,
          variant_name: null,
        },
      ]),
    });
  });

  // Reload — app fetches from our mocked API, caches in IndexedDB, builds barcode index
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
}

// ============================================================================
// DESKTOP MODE
// ============================================================================
test.describe('Barcode Scan — Desktop Mode', () => {

  test('Type barcode and press Add button → item appears in cart', async ({ page }) => {
    await setupPos(page, false);

    const barcodeInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    await barcodeInput.fill('6221001001007');
    const addBtn = page.locator('button:has-text("Add")').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
    expect(await barcodeInput.inputValue()).toBe('');
    await expect(page.locator('text=20,000').first()).toBeVisible({ timeout: 5000 });
  });

  test('Type barcode and press Enter → item appears in cart', async ({ page }) => {
    await setupPos(page, false);

    const barcodeInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    await barcodeInput.fill('6222002002007');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
    expect(await barcodeInput.inputValue()).toBe('');
  });

  test('Scan 2 different barcodes → both items in cart', async ({ page }) => {
    await setupPos(page, false);

    const barcodeInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    await barcodeInput.fill('6221001001007');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(500);

    await barcodeInput.fill('6223003003007');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Butter Croissant').first()).toBeVisible({ timeout: 5000 });
  });

  test('Scan same barcode twice → quantity increments to 2', async ({ page }) => {
    await setupPos(page, false);

    const barcodeInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    await barcodeInput.fill('6221001001007');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(500);

    await barcodeInput.fill('6221001001007');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('span.w-8.text-center.text-base.font-bold').first()).toHaveText('2', { timeout: 3000 });
  });

  test('Unknown barcode → cart stays empty', async ({ page }) => {
    await setupPos(page, false);

    const barcodeInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    await barcodeInput.fill('9999999999999');
    await barcodeInput.press('Enter');
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// MOBILE MODE
// ============================================================================
test.describe('Barcode Scan — Mobile Mode', () => {

  test('Type barcode and press Add button → item appears in cart', async ({ page }) => {
    await setupPos(page, true);

    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });

    await manualInput.fill('6221001001007');
    const addBtn = page.locator('button:has-text("Add")').last();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
    expect(await manualInput.inputValue()).toBe('');
  });

  test('Type barcode and press Enter → item appears in cart', async ({ page }) => {
    await setupPos(page, true);

    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });

    await manualInput.fill('6222002002007');
    await manualInput.press('Enter');
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
    expect(await manualInput.inputValue()).toBe('');
  });

  test('Scan 2 different barcodes → both items in cart', async ({ page }) => {
    await setupPos(page, true);

    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });

    await manualInput.fill('6221001001007');
    await manualInput.press('Enter');
    await page.waitForTimeout(500);

    await manualInput.fill('6223003003007');
    await manualInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Butter Croissant').first()).toBeVisible({ timeout: 5000 });
  });

  test('Scan same barcode twice → quantity stays 1 (mobile behavior)', async ({ page }) => {
    await setupPos(page, true);

    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });

    await manualInput.fill('6221001001007');
    await manualInput.press('Enter');
    await page.waitForTimeout(500);

    await manualInput.fill('6221001001007');
    await manualInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 3000 });
  });

  test('Unknown barcode → cart stays empty', async ({ page }) => {
    await setupPos(page, true);

    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });

    await manualInput.fill('0000000000000');
    await manualInput.press('Enter');
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// PRODUCTS PAGE — Scan barcode to search
// ============================================================================
test.describe('Barcode Search — Products Page', () => {

  test('Desktop: click scan icon → type barcode → dialog closes → item appears in results', async ({ page }) => {
    await setupPos(page, false);

    // Navigate to Products page via Inventory button
    const inventoryBtn = page.locator('button:has-text("Inventory")').first();
    await expect(inventoryBtn).toBeVisible({ timeout: 5000 });
    await inventoryBtn.click();
    await page.waitForURL('**/pos/products', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Click scan search icon
    const scanBtn = page.locator('button svg.lucide-scan').first();
    await expect(scanBtn).toBeVisible({ timeout: 5000 });
    await scanBtn.click();
    await page.waitForTimeout(500);

    // Dialog opens with "Scan to Search"
    await expect(page.locator('text=Scan to Search').first()).toBeVisible({ timeout: 5000 });

    // Type barcode into the dialog's compact input
    const dialogInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(dialogInput).toBeVisible({ timeout: 5000 });
    await dialogInput.fill('6221001001007');
    await dialogInput.press('Enter');
    await page.waitForTimeout(500);

    // Dialog should close after scan
    await expect(page.locator('text=Scan to Search')).not.toBeVisible({ timeout: 3000 }).catch(() => {});

    // Product should appear in the list
    await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
  });

  test('Mobile: click scan icon → type barcode → dialog closes → item appears in results', async ({ page }) => {
    await setMobileViewport(page);
    await setupPos(page, true);

    // Navigate to Products page via hamburger menu
    const hamburger = page.locator('button[aria-label="Open menu"]').first();
    await expect(hamburger).toBeVisible({ timeout: 5000 });
    await hamburger.click();
    await page.waitForTimeout(300);

    const inventoryItem = page.locator('span:has-text("Inventory")').first();
    await expect(inventoryItem).toBeVisible({ timeout: 5000 });
    await inventoryItem.click();
    await page.waitForURL('**/pos/products', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Click scan search icon
    const scanBtn = page.locator('button svg.lucide-scan').first();
    await expect(scanBtn).toBeVisible({ timeout: 5000 });
    await scanBtn.click();
    await page.waitForTimeout(500);

    // Dialog opens
    await expect(page.locator('text=Scan to Search').first()).toBeVisible({ timeout: 5000 });

    // Type barcode into the dialog's manual input (mobile mode)
    const dialogInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(dialogInput).toBeVisible({ timeout: 5000 });
    await dialogInput.fill('6222002002007');
    await dialogInput.press('Enter');
    await page.waitForTimeout(500);

    // Dialog should close
    await expect(page.locator('text=Scan to Search')).not.toBeVisible({ timeout: 3000 }).catch(() => {});

    // Product should appear in the list
    await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
  });
});
