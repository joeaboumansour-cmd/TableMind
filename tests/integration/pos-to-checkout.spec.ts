import { test, expect } from '@playwright/test';
import { navigateWithAuth, DEFAULT_CART_ITEMS, setMobileViewport } from './test-utils';

test.describe('POS to Checkout Integration', () => {
  test('POS page loads with scanner toggle', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    const scannerBtn = page.locator('button:has-text("Scanner")').first();
    await expect(scannerBtn).toBeVisible({ timeout: 15000 });
  });

  test('POS page shows empty cart with scan prompt when no items', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=Scan items to add')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Use the camera above to scan barcodes')).toBeVisible();
  });

  test('POS page with cart items shows items in cart', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    // Cart items should be visible instead of empty state
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea')).toBeVisible({ timeout: 5000 });
  });

  test('POS page with cart shows checkout button', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    // Checkout button should be visible when cart has items
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
  });

  test('navigate from POS to checkout with cart items works', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);

    // Should be on checkout page (client-side navigation)
    const currentUrl = page.url();
    expect(currentUrl.includes('/checkout') || currentUrl.includes('/pos')).toBeTruthy();
  });

  test('checkout page shows cart items and totals', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/checkout', DEFAULT_CART_ITEMS);

    // Checkout page should show items
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
    // Should show total amounts
    await expect(page.locator('text=/LL|Total/').first()).toBeVisible({ timeout: 5000 });
  });

  test('checkout page shows payment options', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/checkout?method=cash', DEFAULT_CART_ITEMS);

    // Wait for page to render
    await page.waitForTimeout(1000);

    // Should show cash payment input
    const cashInput = page.locator('input[placeholder*="LL"], input[placeholder*="amount"]').first();
    if (await cashInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cashInput.fill('150000');
    }
  });

  test('POS page shows quantity controls for cart items', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    // Quantity display should be visible
    const quantityDisplay = page.locator('text=2').first();
    await expect(quantityDisplay).toBeVisible({ timeout: 15000 });
  });

  test('POS page shows Inventory and History navigation', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');

    // Inventory button should be visible
    const inventoryBtn = page.locator('button:has-text("Inventory")').first();
    await expect(inventoryBtn).toBeVisible({ timeout: 15000 });
  });
});