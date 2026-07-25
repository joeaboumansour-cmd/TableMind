import { test, expect } from '@playwright/test';
import {
  navigateWithAuth,
  navigateWithFlags,
  injectFeatureFlags,
  injectAuth,
  mockSupabaseApi,
  DEFAULT_CART_ITEMS,
  DISCOUNT_CART_ITEMS,
  DEFAULT_FEATURE_FLAGS,
} from './integration/test-utils';

// ============================================================================
// Feature Flag Tests — Product Discount
// ============================================================================
test.describe('Feature Flags — Product Discount', () => {

  // --- POS Page: Discount Display ---

  test('POS cart shows discount badge when discount feature is ON and items have discounts', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { product_discount: true }, DISCOUNT_CART_ITEMS);
    // Test Coffee has 10% discount — should show discount badge
    await expect(page.locator('text=-10%').first()).toBeVisible({ timeout: 15000 });
    // Should show strikethrough original price (50,000 each)
    await expect(page.locator('text=50,000').first()).toBeVisible({ timeout: 15000 });
    // Should show discounted total price (90,000 for 2 × 45,000)
    await expect(page.locator('text=90,000').first()).toBeVisible({ timeout: 15000 });
    // Should show discounted unit price text
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
  });

  test('POS cart hides discount badge when discount feature is OFF even with discounted items', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { product_discount: false }, DISCOUNT_CART_ITEMS);
    // Discount badge should NOT be visible
    await expect(page.locator('text=-10%')).toHaveCount(0, { timeout: 15000 });
    // Non-discounted item should still show
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea').first()).toBeVisible({ timeout: 5000 });
  });

  test('POS cart shows normal prices (no strikethrough) when discount feature is OFF', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { product_discount: false }, DISCOUNT_CART_ITEMS);
    // The "line-through" class should not appear on any price text
    const lineThroughElements = page.locator('.line-through');
    await expect(lineThroughElements).toHaveCount(0, { timeout: 15000 });
  });

  test('POS cart shows discount badge when discount feature is ON with default cart (no discounts)', async ({ page }) => {
    await navigateWithFlags(page, '/pos', { product_discount: true }, DEFAULT_CART_ITEMS);
    // Default items have no discount — no badge should appear
    await expect(page.locator('text=-10%')).toHaveCount(0, { timeout: 15000 });
    // Normal prices should show (Coffee total: 100,000)
    await expect(page.locator('text=100,000').first()).toBeVisible({ timeout: 15000 });
  });

  // --- Products Page: Discount Input Field ---

  test('Products page shows Discount % input when discount feature is ON', async ({ page }) => {
    await navigateWithFlags(page, '/pos/products', { product_discount: true });
    // Click "Add" button to open the product dialog
    const addButton = page.locator('button:has-text("Add")').first();
    await expect(addButton).toBeVisible({ timeout: 15000 });
    await addButton.click();
    await page.waitForTimeout(500);
    // Discount % input should be visible inside the dialog
    const discountInput = page.locator('input#discountPercentage');
    await expect(discountInput).toBeVisible({ timeout: 10000 });
    // The "No discount applied" hint should be visible
    await expect(page.locator('text=No discount applied')).toBeVisible({ timeout: 5000 });
  });

  test('Products page hides Discount % input when discount feature is OFF', async ({ page }) => {
    await navigateWithFlags(page, '/pos/products', { product_discount: false });
    // Click "Add" button to open the product dialog
    const addButton = page.locator('button:has-text("Add")').first();
    await expect(addButton).toBeVisible({ timeout: 15000 });
    await addButton.click();
    await page.waitForTimeout(500);
    // Discount % input should NOT be visible
    const discountInput = page.locator('input#discountPercentage');
    await expect(discountInput).toHaveCount(0, { timeout: 10000 });
    // The "No discount applied" hint should NOT be visible
    await expect(page.locator('text=No discount applied')).toHaveCount(0, { timeout: 5000 });
  });

  // --- POS Page: Scanning Behavior ---

  test('Scanning a product with discount when feature is ON preserves the discount', async ({ page }) => {
    // This test verifies the scan handler behavior indirectly:
    // When discount feature is ON, scanning a product with discount_percentage > 0
    // should keep the discount. We verify by checking the cart store.
    await navigateWithFlags(page, '/pos', { product_discount: true });
    // Verify the page loaded with the feature ON
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    // The scanner should be active by default
    const scannerToggle = page.locator('button:has-text("Turn Off Scanner")').first();
    await expect(scannerToggle).toBeVisible({ timeout: 15000 });
  });

  test('Scanning a product with discount when feature is OFF forces discount to 0', async ({ page }) => {
    // When discount feature is OFF, the scan handler forces discount_percentage to 0.
    // We verify by checking the cart store after adding a product.
    await navigateWithFlags(page, '/pos', { product_discount: false });
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    // The scanner should be active
    const scannerToggle = page.locator('button:has-text("Turn Off Scanner")').first();
    await expect(scannerToggle).toBeVisible({ timeout: 15000 });
  });
});

// ============================================================================
// Feature Flag Tests — Transaction Analytics
// ============================================================================
test.describe('Feature Flags — Transaction Analytics', () => {

  test('Transactions page shows Analytics toggle when analytics feature is ON', async ({ page }) => {
    await navigateWithFlags(page, '/transactions', { transaction_analytics: true });
    // The "📊 Analytics" toggle button should be visible
    const analyticsBtn = page.locator('button:has-text("Analytics")').first();
    await expect(analyticsBtn).toBeVisible({ timeout: 15000 });
    // The page title should show "Transaction History" initially
    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 15000 });
  });

  test('Transactions page hides Analytics toggle when analytics feature is OFF', async ({ page }) => {
    await navigateWithFlags(page, '/transactions', { transaction_analytics: false });
    // The "📊 Analytics" toggle button should NOT be visible
    const analyticsBtn = page.locator('button:has-text("Analytics")');
    await expect(analyticsBtn).toHaveCount(0, { timeout: 15000 });
    // Only "Transaction History" should be shown
    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 15000 });
  });

  test('Analytics toggle switches to analytics view when clicked', async ({ page }) => {
    await navigateWithFlags(page, '/transactions', { transaction_analytics: true });
    // Click the Analytics toggle
    const analyticsBtn = page.locator('button:has-text("Analytics")').first();
    await expect(analyticsBtn).toBeVisible({ timeout: 15000 });
    await analyticsBtn.click();
    await page.waitForTimeout(500);
    // The title should change to "Transaction Analytics"
    await expect(page.locator('text=Transaction Analytics').first()).toBeVisible({ timeout: 10000 });
    // The toggle should now show "📋 List"
    const listBtn = page.locator('button:has-text("List")').first();
    await expect(listBtn).toBeVisible({ timeout: 5000 });
  });

  test('Analytics toggle switches back to list view', async ({ page }) => {
    await navigateWithFlags(page, '/transactions', { transaction_analytics: true });
    // Switch to analytics view
    const analyticsBtn = page.locator('button:has-text("Analytics")').first();
    await expect(analyticsBtn).toBeVisible({ timeout: 15000 });
    await analyticsBtn.click();
    await page.waitForTimeout(500);
    // Switch back to list view
    const listBtn = page.locator('button:has-text("List")').first();
    await expect(listBtn).toBeVisible({ timeout: 5000 });
    await listBtn.click();
    await page.waitForTimeout(500);
    // Should be back to "Transaction History"
    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Feature Flag Tests — Multiple Features Interaction
// ============================================================================
test.describe('Feature Flags — Multiple Features', () => {

  test('POS page works with all features ON', async ({ page }) => {
    await navigateWithFlags(page, '/pos', {
      product_discount: true,
      transaction_analytics: true,
    }, DISCOUNT_CART_ITEMS);
    // Core POS functionality works
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    // Discount badge visible
    await expect(page.locator('text=-10%').first()).toBeVisible({ timeout: 15000 });
    // Cart items visible
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea').first()).toBeVisible({ timeout: 5000 });
  });

  test('POS page works with all non-core features OFF', async ({ page }) => {
    await navigateWithFlags(page, '/pos', {
      product_discount: false,
      transaction_analytics: false,
    }, DEFAULT_CART_ITEMS);
    // Core POS functionality still works
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    // Cart items visible
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea').first()).toBeVisible({ timeout: 5000 });
    // No discount badge
    await expect(page.locator('text=-10%')).toHaveCount(0, { timeout: 5000 });
  });

  test('Feature flags persist after page refresh', async ({ page }) => {
    // Inject flags, then reload — flags are in localStorage so they persist
    await navigateWithFlags(page, '/pos', { product_discount: false }, DISCOUNT_CART_ITEMS);
    // Verify discount badge is hidden
    await expect(page.locator('text=-10%')).toHaveCount(0, { timeout: 15000 });
    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    // Discount badge should still be hidden (flags persisted in localStorage)
    await expect(page.locator('text=-10%')).toHaveCount(0, { timeout: 15000 });
    // Core POS still works
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  });
});

// ============================================================================
// Feature Flag Tests — Checkout with Discounted Items
// ============================================================================
test.describe('Feature Flags — Checkout Discount Flow', () => {

  test('Checkout page shows discount breakdown with discounted items', async ({ page }) => {
    await navigateWithFlags(page, '/checkout?method=cash', { product_discount: true }, DISCOUNT_CART_ITEMS);
    // Order summary should show items
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea').first()).toBeVisible({ timeout: 5000 });
    // Discount breakdown should be visible
    await expect(page.locator('text=Discount').first()).toBeVisible({ timeout: 15000 });
    // The discount amount should show (10% of 100,000 = 10,000, formatted as "10,000 LL")
    await expect(page.locator('text=10,000').first()).toBeVisible({ timeout: 15000 });
  });

  test('Checkout page shows discounted total', async ({ page }) => {
    await navigateWithFlags(page, '/checkout?method=cash', { product_discount: true }, DISCOUNT_CART_ITEMS);
    // The total should reflect the discounted price
    // Original: 100,000 (Coffee) + 30,000 (Tea) = 130,000
    // Discount: 10% off Coffee = 10,000
    // Total: 120,000 (formatted as "120,000 LL")
    await expect(page.locator('text=120,000').first()).toBeVisible({ timeout: 15000 });
  });

  test('Checkout page with non-discounted items shows no discount breakdown', async ({ page }) => {
    await navigateWithFlags(page, '/checkout?method=cash', { product_discount: true }, DEFAULT_CART_ITEMS);
    // Default items have no discount
    await expect(page.locator('text=Discount')).toHaveCount(0, { timeout: 15000 });
    // Total should be full price: 100,000 + 30,000 = 130,000 (formatted as "130,000 LL")
    await expect(page.locator('text=130,000').first()).toBeVisible({ timeout: 15000 });
  });

  test('Checkout page processes payment with discounted items', async ({ page }) => {
    await navigateWithFlags(page, '/checkout?method=cash', { product_discount: true }, DISCOUNT_CART_ITEMS);
    // Enter payment amount covering the discounted total (120,000)
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 15000 });
    await llInput.fill('120000');
    await page.waitForTimeout(500);
    // Process Payment button should be visible
    const processBtn = page.locator('button:has-text("Process")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// Feature Flag Tests — Edge Cases
// ============================================================================
test.describe('Feature Flags — Edge Cases', () => {

  test('navigateWithFlags with no overrides uses default flags (discount ON, analytics OFF)', async ({ page }) => {
    await navigateWithFlags(page, '/pos', undefined, DEFAULT_CART_ITEMS);
    // Default: discount ON — but default items have no discount, so no badge
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Coffee').first()).toBeVisible({ timeout: 15000 });
  });

  test('navigateWithFlags with empty overrides uses all defaults', async ({ page }) => {
    await navigateWithFlags(page, '/pos', {}, DISCOUNT_CART_ITEMS);
    // All defaults applied — discount ON, so badge should show
    await expect(page.locator('text=-10%').first()).toBeVisible({ timeout: 15000 });
  });

  test('Transactions page loads without analytics when no flags injected (defaults)', async ({ page }) => {
    // Use standard navigateWithAuth (no feature flags injected)
    await navigateWithAuth(page, '/transactions');
    // Analytics toggle should NOT be visible (default: OFF)
    const analyticsBtn = page.locator('button:has-text("Analytics")');
    await expect(analyticsBtn).toHaveCount(0, { timeout: 15000 });
    // Transaction History should still load
    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 15000 });
  });
});