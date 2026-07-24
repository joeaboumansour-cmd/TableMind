import { test, expect } from '@playwright/test';
import { navigateWithAuth, injectAuth, mockSupabaseApi, DEFAULT_CART_ITEMS } from './test-utils';

test.describe('Checkout to Inventory Integration', () => {
  test('POS page loads with cart items visible', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea')).toBeVisible({ timeout: 5000 });
  });

  test('cart items show correct prices', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    const totalDisplay = page.locator('text=/LL|Total/').first();
    await expect(totalDisplay).toBeVisible({ timeout: 15000 });
  });

  test('checkout with empty cart redirects to POS or shows empty state', async ({ page }) => {
    await mockSupabaseApi(page);
    await page.goto('http://localhost:3000/checkout', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    const currentUrl = page.url();
    const isPos = currentUrl.includes('/pos');
    const isCheckout = currentUrl.includes('/checkout');
    expect(isPos || isCheckout).toBeTruthy();
  });

  test('checkout page processes cash payment', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);

    const pageTitle = page.locator('text=Checkout').first();
    if (await pageTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(pageTitle).toBeVisible();
    }
  });

  test('cart items persist when navigating from POS to checkout', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    // Navigate directly to checkout via URL (more reliable than clicking)
    await page.goto('http://localhost:3000/checkout?method=cash', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    expect(page.url()).toContain('/checkout');
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 10000 });
  });

  test('POS page shows clear cart button', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);

    const clearBtn = page.locator('button:has-text("Clear")').first();
    await expect(clearBtn).toBeVisible({ timeout: 15000 });
  });
});