import { test, expect } from '@playwright/test';
import { navigateWithAuth, DEFAULT_CART_ITEMS, setMobileViewport } from './test-utils';

test.describe('Offline Flow Integration', () => {
  test('POS page loads when authenticated', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('POS page shows scanner toggle', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    const scannerBtn = page.locator('button:has-text("Scanner")').first();
    await expect(scannerBtn).toBeVisible({ timeout: 15000 });
  });

  test('Inventory page loads when authenticated', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos/products');
    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });
  });

  test('cart items persist when going offline', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Cart items should still be visible
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 5000 });

    // Go back online
    await page.context().setOffline(false);
  });

  test('checkout page accessible with cart items', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);

    expect(page.url()).toContain('/checkout');
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 10000 });
  });
});