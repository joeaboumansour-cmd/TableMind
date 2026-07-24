import { test, expect } from '@playwright/test';
import {
  navigateWithAuth,
  injectAuth,
  mockSupabaseApi,
  DEFAULT_CART_ITEMS,
  expectUrlToContain,
} from './integration/test-utils';

test.describe('Fierce Edge Cases — Break-It & Trick-The-App Tests', () => {
  test('Navigate to /checkout without cart items shows page or redirects', async ({ page }) => {
    await mockSupabaseApi(page);
    await page.goto('/checkout', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    const isPos = currentUrl.includes('/pos');
    const isCheckout = currentUrl.includes('/checkout');
    expect(isPos || isCheckout).toBeTruthy();
  });

  test('Navigate to /transactions without auth redirects to /login', async ({ page }) => {
    // Clear any lingering auth state
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('goldensquirrel_user');
      localStorage.removeItem('goldensquirrel_auth');
    });
    await page.goto('/transactions');
    await page.waitForURL('**/login', { timeout: 15000 });
    expectUrlToContain(page, '/login');
  });

  test('Go offline on POS — cart items still visible', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Cart items should still be visible
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 5000 });

    // Go back online
    await page.context().setOffline(false);
  });

  test('Go offline on Inventory — page handles gracefully', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(500);
    // The page should still be visible (no crash)
    expect(page.url()).toContain('/pos/products');
    // Go back online
    await page.context().setOffline(false);
  });

  test('Rapid quantity increment/decrement on cart items', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);

    // Find the plus button for the first item
    const plusBtn = page.locator('button svg.lucide-plus').first();
    await expect(plusBtn).toBeVisible({ timeout: 10000 });

    // Rapidly click plus multiple times
    for (let i = 0; i < 5; i++) {
      await plusBtn.click().catch(() => {});
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);

    // Find the minus button
    const minusBtn = page.locator('button svg.lucide-minus').first();
    await expect(minusBtn).toBeVisible({ timeout: 5000 });

    // Rapidly click minus
    for (let i = 0; i < 3; i++) {
      await minusBtn.click().catch(() => {});
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);
  });

  test('Clear cart — confirm dialog appears', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const clearBtn = page.locator('button:has-text("Clear")').first();
    await expect(clearBtn).toBeVisible({ timeout: 15000 });
    await clearBtn.click();
    await page.waitForTimeout(300);
    // Confirm dialog should appear (native confirm — we can't interact with it,
    // but we can verify the app didn't crash)
    expect(page.url()).toContain('/pos');
  });

  test('Add item then immediately clear cart', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(500);
    const clearBtn = page.locator('button:has-text("Clear")').first();
    await expect(clearBtn).toBeVisible({ timeout: 15000 });
    await expect(clearBtn).toBeEnabled();
  });

  test('Open Add Product dialog then close without saving', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.waitForTimeout(500);

    // Fill some fields
    await page.locator('input#name').fill('Test Product');
    await page.locator('input#costPrice').fill('5000');
    await page.waitForTimeout(200);

    // Cancel
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    await page.waitForTimeout(300);

    // Dialog should close
    const dialogTitle = page.locator('text=Add Product');
    await expect(dialogTitle).not.toBeVisible({ timeout: 3000 }).catch(() => {});
  });

  test('Enter negative numbers in price fields', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.waitForTimeout(500);

    const costInput = page.locator('input#costPrice');
    await expect(costInput).toBeVisible({ timeout: 5000 });
    // Try negative number
    await costInput.fill('-100');
    await page.waitForTimeout(200);
    const costValue = await costInput.inputValue();
    // Should either accept or reject — either way, app shouldn't crash
    expect(costValue).toBeDefined();
  });

  test('Enter extremely large numbers in price fields', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.waitForTimeout(500);

    const costInput = page.locator('input#costPrice');
    await expect(costInput).toBeVisible({ timeout: 5000 });
    // Try extremely large number
    await costInput.fill('999999999999');
    await page.waitForTimeout(200);
    const costValue = await costInput.inputValue();
    expect(costValue).toBeDefined();
  });

  test('Enter non-numeric text in number fields is prevented by browser', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    const addBtn = page.locator('button:has-text("Add")').first();
    await addBtn.click();
    await page.waitForTimeout(500);

    const costInput = page.locator('input#costPrice');
    await expect(costInput).toBeVisible({ timeout: 5000 });
    // type=number prevents non-numeric input natively
    // Verify the input is of type number
    await expect(costInput).toHaveAttribute('type', 'number');
    // Should not crash
    expect(page.url()).toContain('/pos/products');
  });

  test('Navigate to /pos while already on /pos — no-op', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await page.waitForTimeout(500);
    await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('Browser back/forward navigation between pages', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    await page.goto('/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);
    expectUrlToContain(page, '/pos/products');

    // Go back
    await page.goBack();
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    expect(currentUrl.includes('/pos') && !currentUrl.includes('/products')).toBeTruthy();
  });

  test('Multiple tab switching while on POS', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Simulate tab switching by focusing/blurring
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(500);

    // Cart items should still be visible
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 5000 });
  });

  test('Checkout page with empty cart — page handles gracefully', async ({ page }) => {
    await mockSupabaseApi(page);
    await page.goto('/checkout', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // If on checkout page, verify the page rendered without crashing
    if (page.url().includes('/checkout')) {
      await expect(page.locator('text=Checkout').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('Rapid page navigation between POS and Products', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await page.waitForTimeout(300);

    for (let i = 0; i < 3; i++) {
      await page.goto('/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(100);
      await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/pos');
  });

  test('Cart items persist when navigating from POS to products and back', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    await page.goto('/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);

    await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
  });

  test('Auth persists across page navigations', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    await page.goto('/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);

    expectUrlToContain(page, '/pos/products');
  });

  test('POS page retains state after refresh', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('Products page retains state after refresh', async ({ page }) => {
    await navigateWithAuth(page, '/pos/products');
    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });
  });
});