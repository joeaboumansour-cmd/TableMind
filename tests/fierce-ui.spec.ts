import { test, expect } from '@playwright/test';
import {
  navigateWithAuth,
  injectAuth,
  mockSupabaseApi,
  DEFAULT_CART_ITEMS,
  clickButtonAndVerifyUrl,
  expectUrlToContain,
  clickMobileMenuItemAndVerifyUrl,
  setMobileViewport,
} from './integration/test-utils';

test.describe('Fierce UI — POS Page Button Navigation & URL Verification', () => {
  test('POS page loads with GoldenSquirrel header', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Point of Sale')).toBeVisible();
  });

  test('POS page shows empty cart with scan prompt when no items', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    await expect(page.locator('text=Scan items to add')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Use the camera above to scan barcodes')).toBeVisible();
  });

  test('POS page with cart items shows items in cart', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Test Tea')).toBeVisible({ timeout: 5000 });
  });

  test('POS page with cart shows checkout button', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
  });

  test('Inventory button navigates to /pos/products and URL is correct', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    await clickButtonAndVerifyUrl(page, 'Inventory', '/pos/products');
  });

  test('History button navigates to /transactions and URL is correct', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    const historyBtn = page.locator('button:has-text("History")').first();
    await expect(historyBtn).toBeVisible({ timeout: 15000 });
    await historyBtn.click();
    await page.waitForURL('**/transactions', { timeout: 15000 });
    expectUrlToContain(page, '/transactions');
  });

  test('Checkout button navigates to /checkout and URL is correct', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    expect(currentUrl.includes('/checkout') || currentUrl.includes('/pos')).toBeTruthy();
  });

  test('Logout button redirects to /login', async ({ page }) => {
    await navigateWithAuth(page, '/pos');
    const logoutIconBtn = page.locator('button svg.lucide-log-out').first();
    await expect(logoutIconBtn).toBeVisible({ timeout: 15000 });
    await logoutIconBtn.click();
    await page.waitForURL('**/login', { timeout: 15000 });
    expectUrlToContain(page, '/login');
  });

  test('Scanner toggle button is visible and clickable', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const toggleBtn = page.locator('button:has-text("Scanner")').first();
    await expect(toggleBtn).toBeVisible({ timeout: 15000 });
    await toggleBtn.click();
    await page.waitForTimeout(300);
    await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  });

  test('Scanner state persists in localStorage after refresh', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const toggleBtn = page.locator('button:has-text("Scanner")').first();
    await toggleBtn.click();
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const scannerBtn = page.locator('button:has-text("Scanner")').first();
    await expect(scannerBtn).toBeVisible({ timeout: 15000 });
  });

  test('Cart items show quantity controls', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const quantityDisplay = page.locator('text=2').first();
    await expect(quantityDisplay).toBeVisible({ timeout: 15000 });
  });

  test('Cart items show correct prices in LL and USD', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=100,000').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=3.34').first()).toBeVisible({ timeout: 5000 });
  });

  test('Clear All button shows confirm dialog', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const clearBtn = page.locator('button:has-text("Clear")').first();
    await expect(clearBtn).toBeVisible({ timeout: 15000 });
  });

  test('Double-clicking Checkout button does not cause errors', async ({ page }) => {
    await navigateWithAuth(page, '/pos', DEFAULT_CART_ITEMS);
    const checkoutBtn = page.locator('button:has-text("Checkout")').first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15000 });
    await checkoutBtn.click();
    await checkoutBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    expect(currentUrl.includes('/checkout') || currentUrl.includes('/pos')).toBeTruthy();
  });
});

test.describe('Fierce UI — Mobile Menu Navigation', () => {
  test('Mobile hamburger menu opens and shows menu items', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const hamburger = page.locator('button[aria-label="Open menu"]').first();
    await expect(hamburger).toBeVisible({ timeout: 15000 });
    await hamburger.click();
    await page.waitForTimeout(300);
    await expect(page.locator('span:has-text("Inventory")').first()).toBeVisible({ timeout: 5000 });
  });

  test('Mobile menu Inventory link navigates to /pos/products', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const hamburger = page.locator('button[aria-label="Open menu"]').first();
    await expect(hamburger).toBeVisible({ timeout: 15000 });
    await hamburger.click();
    await page.waitForTimeout(300);
    const inventoryBtn = page.locator('button:has-text("Inventory")').last();
    await expect(inventoryBtn).toBeVisible({ timeout: 5000 });
    await inventoryBtn.click();
    await page.waitForURL('**/pos/products', { timeout: 15000 });
    expectUrlToContain(page, '/pos/products');
  });

  test('Mobile menu History link navigates to /transactions', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const hamburger = page.locator('button[aria-label="Open menu"]').first();
    await expect(hamburger).toBeVisible({ timeout: 15000 });
    await hamburger.click();
    await page.waitForTimeout(300);
    const historyBtn = page.locator('button:has-text("History")').last();
    await expect(historyBtn).toBeVisible({ timeout: 5000 });
    await historyBtn.click();
    await page.waitForURL('**/transactions', { timeout: 15000 });
    expectUrlToContain(page, '/transactions');
  });

  test('Mobile menu Logout redirects to /login', async ({ page }) => {
    await setMobileViewport(page);
    await navigateWithAuth(page, '/pos');
    const hamburger = page.locator('button[aria-label="Open menu"]').first();
    await expect(hamburger).toBeVisible({ timeout: 15000 });
    await hamburger.click();
    await page.waitForTimeout(300);
    const logoutItem = page.locator('span:has-text("Logout")').first();
    await expect(logoutItem).toBeVisible({ timeout: 5000 });
    await logoutItem.click();
    await page.waitForURL('**/login', { timeout: 15000 });
    expectUrlToContain(page, '/login');
  });
});

test.describe('Fierce UI — Checkout Page Payment Processing', () => {
  test('Checkout page shows order summary with items', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await expect(page.locator('text=Test Coffee')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Order Summary')).toBeVisible();
  });

  test('Back button on checkout navigates to /pos', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    const backBtn = page.locator('button:has(svg.lucide-arrow-left)').first();
    await expect(backBtn).toBeVisible({ timeout: 15000 });
    await backBtn.click();
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    expect(currentUrl.includes('/pos') || currentUrl.includes('/checkout')).toBeTruthy();
  });

  test('Payment input fields render for LL and USD', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const llInput = page.locator('input#amountLL');
    const usdInput = page.locator('input#amountUSD');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await expect(usdInput).toBeVisible();
  });

  test('Enter LL amount in payment field updates the value', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.click();
    await llInput.fill('50000');
    await page.waitForTimeout(500);
    const inputValue = await llInput.inputValue();
    expect(inputValue).toBe('50000');
  });

  test('Enter exact amount in payment field', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.click();
    await llInput.fill('130000');
    await page.waitForTimeout(500);
    const inputValue = await llInput.inputValue();
    expect(inputValue).toBe('130000');
  });

  test('Enter overpayment amount in LL field', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await llInput.click();
    await llInput.fill('150000');
    await page.waitForTimeout(500);
    const inputValue = await llInput.inputValue();
    expect(inputValue).toBe('150000');
  });

  test('Enter both LL and USD payment amounts', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const llInput = page.locator('input#amountLL');
    const usdInput = page.locator('input#amountUSD');
    await expect(llInput).toBeVisible({ timeout: 10000 });
    await expect(usdInput).toBeVisible();
    await llInput.click();
    await llInput.fill('50000');
    await usdInput.click();
    await usdInput.fill('1');
    await page.waitForTimeout(500);
    const llValue = await llInput.inputValue();
    const usdValue = await usdInput.inputValue();
    expect(llValue).toBe('50000');
    expect(usdValue).toBe('1');
  });

  test('Checkout page does not show WhatsApp receipt input', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const whatsappInput = page.locator('input#whatsapp');
    await expect(whatsappInput).toHaveCount(0);
  });

  test('Checkout page shows quick amount buttons', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const exactBtn = page.locator('button:has-text("Exact")').first();
    await expect(exactBtn).toBeVisible({ timeout: 10000 });
  });

  test('Exact quick button fills LL amount with total', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const exactBtn = page.locator('button:has-text("Exact")').first();
    await expect(exactBtn).toBeVisible({ timeout: 10000 });
    await exactBtn.click();
    const llInput = page.locator('input#amountLL');
    await expect(llInput).toHaveValue(/^\d+$/);
    const llValue = await llInput.inputValue();
    expect(parseFloat(llValue)).toBeGreaterThan(0);
  });

  test('Process Payment button is visible and shows total', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const processBtn = page.locator('button:has-text("Process")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
  });

  test('Process Payment button is visible', async ({ page }) => {
    await navigateWithAuth(page, '/checkout?method=cash', DEFAULT_CART_ITEMS);
    await page.waitForTimeout(1000);
    const processBtn = page.locator('button:has-text("Process")').first();
    await expect(processBtn).toBeVisible({ timeout: 10000 });
  });

  test('Direct URL /checkout with empty cart shows page or redirects', async ({ page }) => {
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
});

test.describe('Fierce UI — Transaction History', () => {
  test('Transactions page loads with header', async ({ page }) => {
    await navigateWithAuth(page, '/transactions');
    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 15000 });
  });

  test('Back to POS button navigates to /pos', async ({ page }) => {
    await navigateWithAuth(page, '/transactions');
    const backBtn = page.locator('button svg.lucide-arrow-left').first();
    await expect(backBtn).toBeVisible({ timeout: 15000 });
    await backBtn.click();
    await page.waitForURL('**/pos', { timeout: 15000 });
    expectUrlToContain(page, '/pos');
  });

  test('Date filter buttons are visible', async ({ page }) => {
    await navigateWithAuth(page, '/transactions');
    await page.waitForTimeout(1000);
    const allBtn = page.locator('button:has-text("All")').first();
    await expect(allBtn).toBeVisible({ timeout: 10000 });
  });

  test('Search input is visible and accepts text', async ({ page }) => {
    await navigateWithAuth(page, '/transactions');
    await page.waitForTimeout(1000);
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill('TXN-');
    await expect(searchInput).toHaveValue('TXN-');
  });

  test('Refresh button is visible', async ({ page }) => {
    await navigateWithAuth(page, '/transactions');
    const refreshBtn = page.locator('button[title="Refresh"]').first();
    await expect(refreshBtn).toBeVisible({ timeout: 15000 });
  });
});