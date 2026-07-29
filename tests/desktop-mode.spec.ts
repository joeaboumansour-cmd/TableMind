import { test, expect } from '@playwright/test';
import {
  navigateWithFlags,
  injectAuth,
  injectFeatureFlags,
  mockSupabaseApi,
  setMobileViewport,
  DEFAULT_FEATURE_FLAGS,
} from './integration/test-utils';

// ============================================================================
// Desktop Mode Tests — BarcodeScanner desktopMode prop
// ============================================================================
test.describe('Desktop Mode — BarcodeScanner', () => {

  test('POS page renders compact barcode input (no camera) when desktop_shortcuts is enabled', async ({ page }) => {
    // Use desktop viewport (default in Playwright is 1280x720)
    await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });

    // The scanner toggle should be visible
    await expect(page.locator('text=Turn Off Scanner').first()).toBeHidden({ timeout: 15000 });

    // The camera view (bg-zinc-950 h-[200px]) should NOT be present in desktop mode
    // Instead, we should see the compact barcode input
    const compactInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(compactInput).toBeVisible({ timeout: 10000 });

    // The "Manual barcode..." input should NOT be visible (desktop mode uses "Scan barcode...")
    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toHaveCount(0, { timeout: 5000 });
  });

  test('POS page renders camera view when desktop_shortcuts is disabled', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });

    // The scanner toggle should be visible
    await expect(page.locator('text=Turn Off Scanner').first()).toBeVisible({ timeout: 15000 });

    // The camera view should be present (bg-zinc-950)
    // In mobile mode, the "Manual barcode..." input should be visible
    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 10000 });
  });

  test('POS page shows saved product buttons in desktop mode', async ({ page }) => {
    // Inject products with no barcode via mocked API
    await mockSupabaseApi(page);
    await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await injectFeatureFlags(page, { desktop_shortcuts: true });

    // Mock Supabase to return products without barcodes
    await page.route('**/rest/v1/products*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'no-barcode-1',
            store_id: 'test-store-id',
            name: 'No Barcode Item',
            barcode: null,
            cost_price: 10000,
            selling_price: 20000,
            currency: 'LL',
            profit_percentage: 100,
            discount_percentage: 0,
            stock_quantity: 50,
            min_stock_threshold: 5,
            parent_id: null,
            variant_name: null,
          },
        ]),
      });
    });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for products to load
    await page.waitForTimeout(2000);

    // The saved product button should be visible
    await expect(page.locator('text=No Barcode Item').first()).toBeVisible({ timeout: 10000 });
  });

  test('BarcodeScanner desktop mode renders compact input with auto-focus', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });

    // The compact barcode input should be visible
    const compactInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(compactInput).toBeVisible({ timeout: 10000 });

    // The input should receive focus (React autoFocus may not set HTML attribute)
    await expect(compactInput).toBeFocused({ timeout: 5000 });
  });

  test('BarcodeScanner desktop mode has Add button', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });

    // The Add button should be visible
    await expect(page.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 10000 });
  });

  test('BarcodeScanner desktop mode has Cancel button when onClose is provided', async ({ page }) => {
    await navigateWithFlags(page, '/pos/products', { desktop_shortcuts: true });

    // Open the barcode scanner dialog via the scan icon button
    const scanButton = page.locator('button svg.lucide-scan').first();
    await expect(scanButton).toBeVisible({ timeout: 15000 });
    await scanButton.click();
    await page.waitForTimeout(500);

    // In the scanner dialog, Cancel should be visible because onClose is provided
    await expect(page.locator('button:has-text("Cancel")').first()).toBeVisible({ timeout: 10000 });
  });

  test('Products page uses desktop mode for barcode scanner dialog', async ({ page }) => {
    await navigateWithFlags(page, '/pos/products', { desktop_shortcuts: true });

    // Click the scan icon button to open the barcode scanner dialog
    const scanButton = page.locator('button svg.lucide-scan').first();
    await expect(scanButton).toBeVisible({ timeout: 15000 });

    // The products page should detect desktop mode internally
    // (isDesktop is called in useEffect, so it should be true in Playwright's desktop viewport)
    // We can't easily verify the desktopMode prop directly, but we can verify the dialog opens
    await scanButton.click();
    await page.waitForTimeout(500);

    // The barcode scanner dialog should be open
    // In desktop mode, it should show the compact input instead of camera
    const compactInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(compactInput).toBeVisible({ timeout: 10000 });
  });

  test('Mobile viewport uses camera mode (not desktop mode)', async ({ page }) => {
    // Set mobile viewport
    await setMobileViewport(page);

    await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });

    // On mobile, the camera view should be present (not the compact input)
    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 15000 });

    // The compact "Scan barcode..." input should NOT be visible
    const compactInput = page.locator('input[placeholder="Scan barcode..."]');
    await expect(compactInput).toHaveCount(0, { timeout: 5000 });
  });

  test('Desktop mode with desktop_shortcuts disabled shows camera', async ({ page }) => {
    // Even on desktop, if the feature flag is off, camera should be used
    await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });

    // The "Manual barcode..." input should be visible (camera mode)
    const manualInput = page.locator('input[placeholder="Manual barcode..."]');
    await expect(manualInput).toBeVisible({ timeout: 15000 });
  });
});
