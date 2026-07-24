import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export default async function saveAuth(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('text=Store Login', { state: 'visible', timeout: 10000 });
  await page.fill('input#storeUsername', 'teststore');
  await page.fill('input#username', 'teststore');
  await page.fill('input#password', 'testpassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/pos', { timeout: 15000 });
  await expect(page.locator('text=GoldenSquirrel')).toBeVisible({ timeout: 10000 });
  await page.context().storageState({ path: 'tests/.auth/user.json' });
}