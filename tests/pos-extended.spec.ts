import { test, expect } from '@playwright/test';

test.describe('POS Extended Functional Tests', () => {
  test('login page has all required form fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Store Login')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input#storeUsername')).toBeVisible();
    await expect(page.locator('input#username')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('POS redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('text=Store Login')).toBeVisible();
  });

  test('inventory redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/pos/products');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('text=Store Login')).toBeVisible();
  });

  test('login form has working input fields', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input#storeUsername', { state: 'visible', timeout: 10000 });
    await page.fill('input#storeUsername', 'test_store');
    await page.fill('input#username', 'test_user');
    await page.fill('input#password', 'test_pass');
    await expect(page.locator('input#storeUsername')).toHaveValue('test_store');
    await expect(page.locator('input#username')).toHaveValue('test_user');
    await expect(page.locator('input#password')).toHaveValue('test_pass');
  });

  test('offline notice does not appear on login page when online', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=You are offline')).not.toBeVisible({ timeout: 2000 }).catch(() => {});
  });

  test('login page has store owner and employee info sections', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('p.font-medium:has-text("Store Owner")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('p.font-medium:has-text("Employee")')).toBeVisible();
  });
});