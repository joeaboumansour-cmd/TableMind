import { test, expect } from '@playwright/test';

test.describe('Inventory to POS Flow Regression Suite', () => {
  test('login page loads with all form fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Store Login')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input#storeUsername')).toBeVisible();
    await expect(page.locator('input#username')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('POS redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('text=Store Login')).toBeVisible();
  });

  test('inventory redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/pos/products');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('text=Store Login')).toBeVisible();
  });

  test('login form accepts input values', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input#storeUsername', { state: 'visible', timeout: 10000 });
    await page.fill('input#storeUsername', 'test_store_test');
    await page.fill('input#username', 'test_owner');
    await page.fill('input#password', 'test_pass_123');
    await expect(page.locator('input#storeUsername')).toHaveValue('test_store_test');
    await expect(page.locator('input#username')).toHaveValue('test_owner');
    await expect(page.locator('input#password')).toHaveValue('test_pass_123');
  });

  test('login page shows golden squirrel branding', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1:has-text("GoldenSquirrel")').first()).toBeVisible();
    await expect(page.locator('text=Point of Sale System')).toBeVisible();
  });
});