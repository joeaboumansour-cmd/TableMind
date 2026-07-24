/**
 * Global setup for Playwright.
 * Creates a storage state file with auth credentials injected into localStorage
 * so each test starts already logged in.
 */
import { chromium } from 'playwright';

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to any page on the app domain to set localStorage
  await page.goto('http://localhost:3000');
  
  // Inject a store owner user into localStorage so the app thinks we're authenticated
  await page.evaluate(() => {
    const storeUser = {
      id: 'test-store-id',
      storeId: 'test-store-id',
      username: 'teststore',
      displayName: 'teststore',
      isOwner: true,
      permissions: {
        pos: true,
        inventory: true,
        transactions: true,
        receipts: true,
      },
    };
    localStorage.setItem('goldensquirrel_user', JSON.stringify(storeUser));
    
    // Also set legacy auth for backward compatibility
    localStorage.setItem('goldensquirrel_auth', JSON.stringify({
      store_id: 'test-store-id',
      username: 'teststore',
      license_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      timestamp: Date.now(),
    }));
  });

  // Save storage state for use in tests
  await context.storageState({ path: 'tests/.auth/user.json' });
  await browser.close();
}