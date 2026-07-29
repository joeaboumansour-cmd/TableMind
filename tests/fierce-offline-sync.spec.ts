import { test, expect } from '@playwright/test';
import {
  navigateWithAuth,
  injectAuth,
  injectCartItems,
  mockSupabaseApi,
  DEFAULT_CART_ITEMS,
} from './integration/test-utils';

// ============================================================================
// Helper: Check and manipulate the offline queue in IndexedDB
// The app uses Dexie with database name "GoldenSquirrelPOS" and store "offline_queue"
// Must be called AFTER navigating to the app (page loaded on localhost)
// ============================================================================
async function getQueuedCount(page: any): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const request = indexedDB.open('GoldenSquirrelPOS');
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const tx = db.transaction('offline_queue', 'readonly');
          const store = tx.objectStore('offline_queue');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => resolve(0);
        } catch (e) {
          resolve(0);
        }
      };
      request.onerror = () => resolve(0);
    });
  });
}

async function clearOfflineQueue(page: any): Promise<void> {
  await page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      const request = indexedDB.open('GoldenSquirrelPOS');
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const tx = db.transaction('offline_queue', 'readwrite');
          const store = tx.objectStore('offline_queue');
          store.clear();
          resolve();
        } catch (e) {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  });
}

// ============================================================================
// Helper: navigate and clean queue — clears the queue AFTER the app loads
// ============================================================================
async function navigateWithCleanQueue(page: any, url: string, cartItems?: any[]) {
  await navigateWithAuth(page, url, cartItems);
  // navigateWithAuth already landed on the page — IndexedDB is accessible
  await clearOfflineQueue(page);
  // Reload so the app re-reads the (now empty) queue
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
}

// ============================================================================
// Offline Transaction Sync Tests
// ============================================================================
test.describe('Offline Sync — Transaction Queueing', () => {

  test('Offline checkout queues transaction in IndexedDB offline_queue', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // Verify cart items are loaded
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Go to checkout
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Verify on checkout page
    await expect(page.locator('text=Checkout').first()).toBeVisible({ timeout: 15000 });

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Enter payment amount (enough to cover total: 130,000 LL)
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.fill('130000');

    // Process payment
    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
    await processBtn.click();

    // Should show "Payment Complete" screen
    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Verify the transaction was queued in IndexedDB offline_queue
    const count = await getQueuedCount(page);
    expect(count).toBeGreaterThanOrEqual(1);

    // Go back online
    await page.context().setOffline(false);
  });

  test('Offline checkout processes payment and shows success', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // Go to checkout
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Enter payment and process
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.fill('130000');

    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
    await processBtn.click();

    // The payment complete screen should be visible regardless of offline/online
    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Verify a transaction was queued
    const count = await getQueuedCount(page);
    expect(count).toBeGreaterThanOrEqual(1);

    // Go back online
    await page.context().setOffline(false);
  });
});

test.describe('Offline Sync — Auto-Sync When Back Online', () => {

  test('Queued transaction is pushed to API when coming back online', async ({ page }) => {
    // Track POSTs to /api/transactions
    let postCount = 0;

    await page.route('**/api/transactions', async (route, request) => {
      if (request.method() === 'POST') {
        postCount++;
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        route.continue();
      }
    });

    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // Go to checkout
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Process offline transaction
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.fill('130000');
    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
    await processBtn.click();
    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Verify queued
    const count = await getQueuedCount(page);
    expect(count).toBeGreaterThanOrEqual(1);

    // Go back online — the sync engine listens for 'online' event and calls syncNow()
    await page.context().setOffline(false);

    // Wait for sync engine to process (pushQueuedTransactions POSTs to /api/transactions)
    await page.waitForTimeout(8000);

    // The sync engine should have pushed the queued transaction
    expect(postCount).toBeGreaterThanOrEqual(1);

    // Verify the queue is now empty (or at least has fewer — sync was attempted)
    const remaining = await getQueuedCount(page);
    expect(remaining).toBe(0);
  });

  test('SyncIndicator shows "Connected" badge when online with no pending syncs', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos');

    // The SyncIndicator desktop version shows "Connected" badge when online and no pending
    await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 15000 });
  });

  test('SyncIndicator shows pending count badge when transactions are queued', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos');
    await page.waitForTimeout(2000);

    // Manually queue a pending transaction in the IndexedDB store
    await page.evaluate(async () => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.open('GoldenSquirrelPOS');
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            const tx = db.transaction('offline_queue', 'readwrite');
            const store = tx.objectStore('offline_queue');
            store.add({
              id: crypto.randomUUID(),
              store_id: 'test-store-id',
              transaction_number: 'TXN-TEST-001',
              subtotal: 100000,
              total_amount: 130000,
              amount_paid: 130000,
              change_given: 0,
              payment_method: 'cash',
              subtotal_usd: 3.34,
              total_usd: 4.34,
              amount_paid_usd: 0,
              change_given_usd: 0,
              items: [
                {
                  product_id: 'test-1',
                  product_name: 'Test Item',
                  quantity: 1,
                  unit_price: 100000,
                  total_price: 100000,
                  currency: 'LL',
                  unit_price_usd: 0,
                  total_price_usd: 0,
                },
              ],
              created_at: new Date().toISOString(),
            });
          } catch (e) {
            // Ignore errors
          }
          resolve();
        };
        request.onerror = () => resolve();
      });
    });

    // Reload to trigger SyncIndicator to re-read pending count from IndexedDB
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // The SyncIndicator should show a badge with "1 pending" text
    await expect(page.locator('text=1 pending').first()).toBeVisible({ timeout: 10000 });

    // Clean up the queued transaction
    await clearOfflineQueue(page);
  });
});

test.describe('Offline Sync — End-to-End Flow', () => {

  test('Go offline → checkout → come online → POS is functional', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // Go to checkout
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Process payment offline
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.fill('130000');

    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
    await processBtn.click();

    // Transaction completed
    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Click "New Transaction" to go back to POS
    const newTxnBtn = page.locator('button:has-text("New Transaction")').first();
    await expect(newTxnBtn).toBeVisible({ timeout: 10000 });
    await newTxnBtn.click();
    await page.waitForTimeout(2000);

    // Come back online
    await page.context().setOffline(false);
    await page.waitForTimeout(1000);

    // Reload to ensure the page fully initializes after coming back online
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Should be on POS page and functional
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('Offline checkout clears cart when returning to POS', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // Go to checkout
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Process payment
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.fill('130000');

    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
    await processBtn.click();

    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Return to POS
    const newTxnBtn = page.locator('button:has-text("New Transaction")').first();
    await expect(newTxnBtn).toBeVisible({ timeout: 10000 });
    await newTxnBtn.click();
    await page.waitForTimeout(2000);

    // Come back online and reload to ensure full initialization
    await page.context().setOffline(false);
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Cart should be empty — "Scan items to add" prompt visible
    await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Offline Sync — Multiple Queued Transactions', () => {

  test('Two queued transactions are preserved in IndexedDB offline_queue', async ({ page }) => {
    await navigateWithCleanQueue(page, '/pos', DEFAULT_CART_ITEMS);

    // --- First offline transaction ---
    const checkoutBtn1 = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn1).toBeVisible({ timeout: 15000 });
    await checkoutBtn1.click();
    await page.waitForTimeout(3000);

    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    const llInput1 = page.locator('input#amountLL');
    await expect(llInput1).toBeVisible({ timeout: 10000 });
    await llInput1.fill('130000');
    const processBtn1 = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn1).toBeVisible({ timeout: 10000 });
    await processBtn1.click();
    await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });

    // Verify first transaction queued
    const count1 = await getQueuedCount(page);
    expect(count1).toBeGreaterThanOrEqual(1);

    // --- Manually add a second transaction directly to IndexedDB ---
    await page.evaluate(async () => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.open('GoldenSquirrelPOS');
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            const tx = db.transaction('offline_queue', 'readwrite');
            const store = tx.objectStore('offline_queue');
            store.add({
              id: crypto.randomUUID(),
              store_id: 'test-store-id',
              transaction_number: 'TXN-MANUAL-002',
              subtotal: 90000,
              total_amount: 120000,
              amount_paid: 120000,
              change_given: 0,
              payment_method: 'cash',
              subtotal_usd: 2.00,
              total_usd: 2.50,
              amount_paid_usd: 0,
              change_given_usd: 0,
              items: [
                {
                  product_id: 'manual-1',
                  product_name: 'Manual Item',
                  quantity: 1,
                  unit_price: 90000,
                  total_price: 90000,
                  currency: 'LL',
                  unit_price_usd: 2.00,
                  total_price_usd: 2.00,
                },
              ],
              created_at: new Date().toISOString(),
            });
          } catch (e) { // ignore
          }
          resolve();
        };
        request.onerror = () => resolve();
      });
    });

    // Verify 2 transactions now queued
    const count2 = await getQueuedCount(page);
    expect(count2).toBeGreaterThanOrEqual(2);

    // Go back online
    await page.context().setOffline(false);
  });
});
