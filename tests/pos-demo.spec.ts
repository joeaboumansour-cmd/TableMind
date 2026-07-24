import { test, expect } from '@playwright/test';

test.describe('POS Demo Test', () => {
  test('login page loads and accepts inputs', async ({ page }) => {
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
});