import { test, expect } from '@playwright/test';
import { navigateWithAuth, DEFAULT_CART_ITEMS } from './test-utils';

test.describe('Data Persistence Integration', () => {
  test('POS page loads consistently', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('auth persists across page navigations', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    // Navigate to products
    await page.goto('http://localhost:3000/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should still be authenticated (not redirected to login)
    const currentUrl = page.url();
    expect(currentUrl).toContain('/pos/products');
  });

  test('POS page retains state after refresh', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should still show POS content
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });

  test('Products page retains state after refresh', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos/products');
    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should still show products page
    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });
  });

  test('cart items persist after page refresh', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Cart items should still be visible (persisted in localStorage)
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
  });

  test('cart items persist when navigating from POS to products and back', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });

    // Navigate to products
    await page.goto('http://localhost:3000/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Navigate back to POS
    await page.goto('http://localhost:3000/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Cart items should still be visible
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
  });
});