import { test, expect } from '@playwright/test';
import { navigateWithAuth, injectAuth, setMobileViewport } from './test-utils';

test.describe('Inventory to POS Integration', () => {
  test('POS page loads with auth and shows header', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Point of Sale')).toBeVisible();
  });

  test('Inventory page loads and shows product management UI', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos/products');
    await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 15000 });
  });

  test('search input works on products page', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos/products');

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('Test Product');
    await expect(searchInput).toHaveValue('Test Product');
    await searchInput.fill('');
    await expect(searchInput).toHaveValue('');
  });

  test('POS page shows empty cart state', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, 'http://localhost:3000/pos');

    await expect(page.locator('text=Scan items to add')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Use the camera above to scan barcodes')).toBeVisible();
  });

  test('navigation from POS to Inventory works', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });

    // Navigate directly to verify route exists
    await page.goto('http://localhost:3000/pos/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    const currentUrl = page.url();
    expect(currentUrl).toContain('/pos/products');
  });

  test('stats row visible on products page', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos/products');

    // Stats should be visible (items count, low stock, cost/sell values)
    const statsSection = page.locator('text=items').first();
    await expect(statsSection).toBeVisible({ timeout: 10000 });
  });

  test('manual barcode input exists and can be interacted with', async ({ page }) => {
    await navigateWithAuth(page, 'http://localhost:3000/pos');

    // The page has a manual barcode input
    const barcodeInput = page.locator('input[placeholder*="barcode"], input[placeholder*="Barcode"]').first();
    await expect(barcodeInput).toBeVisible({ timeout: 15000 });
    await barcodeInput.fill('123456');
    await expect(barcodeInput).toHaveValue('123456');
  });
});