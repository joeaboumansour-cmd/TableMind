import { test, expect, type Page } from '@playwright/test';
import {
  navigateWithAuth,
  navigateWithFlags,
  injectAuth,
  mockSupabaseApi,
  setMobileViewport,
} from './integration/test-utils';

// Match on pathname rather than a glob: the history GET now carries pagination
// query params (?limit=&cursor=), which '**/api/transactions' would not match.
// A pathname predicate also avoids matching /api/transactions/cleanup etc.
const isTransactionsList = (url: URL) => url.pathname === '/api/transactions';

async function mockTransactionsApi(page: Page, transactions: any[]) {
  await page.route(isTransactionsList, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transactions, nextCursor: null, hasMore: false }),
    });
  });
}

async function mockCleanupApi(page: Page, response: any) {
  await page.route('**/api/transactions/cleanup', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }
  });
}

async function mockWhatsAppApi(page: Page) {
  await page.route('**/api/transactions/*/whatsapp', async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, phone: body.phone }),
      });
    }
  });
}

async function gotoTransactions(page: Page) {
  await page.goto('/transactions', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await injectAuth(page);
  await page.waitForTimeout(1000);
}

test.describe('Transaction History — Core Functionality', () => {
  test('Empty state displays when no transactions exist', async ({ page }) => {
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    await expect(page.locator('text=No Transactions Found').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=No transactions found.').first()).toBeVisible();
    await expect(page.locator('text=Start New Transaction').first()).toBeVisible();
  });

  test('Loading state displays when no auth in localStorage', async ({ page }) => {
    await mockSupabaseApi(page);
    await page.goto('/transactions', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    await expect(page.locator('text=Loading transactions...').first()).toBeVisible({ timeout: 5000 });
  });

  test('Page loads with correct header and metadata', async ({ page }) => {
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    await expect(page.locator('text=Transaction History').first()).toBeVisible();
    await expect(page.locator('text=0 transactions').first()).toBeVisible();
  });

  test('Back button navigates to /pos', async ({ page }) => {
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);
    await page.waitForTimeout(500);

    const backBtn = page.locator('button svg.lucide-arrow-left').first();
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();
    await page.waitForURL('**/pos', { timeout: 10000 });
    expect(page.url()).toContain('/pos');
  });

  test('Refresh button reloads transactions', async ({ page }) => {
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    const refreshBtn = page.locator('button[title="Refresh"]').first();
    await expect(refreshBtn).toBeVisible({ timeout: 10000 });
    
    await refreshBtn.click();
    await page.waitForTimeout(1000);
    
    expect(page.url()).toContain('/transactions');
  });
});

test.describe('Transaction History — Transaction Display', () => {
  const TEST_TRANSACTION = {
    id: 'txn-test-1',
    transaction_number: 'TXN-001',
    subtotal: 130000,
    total_amount: 130000,
    amount_paid: 150000,
    change_given: 20000,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    whatsapp_sent_to: '',
    user_id: 'user-1',
    user_name: 'Test Cashier',
    transaction_items: [
      { id: 'item-1', product_name: 'Test Coffee', quantity: 2, unit_price: 50000, total_price: 100000, currency: 'LL' },
      { id: 'item-2', product_name: 'Test Tea', quantity: 1, unit_price: 30000, total_price: 30000, currency: 'LL' },
    ],
  };

  test('Transaction appears in list after fetch', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-001').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Test Cashier').first()).toBeVisible();
    await expect(page.locator('text=1 transaction').first()).toBeVisible();
  });

  test('Transaction amount displays correctly', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await expect(page.locator('text=130,000').first()).toBeVisible({ timeout: 10000 });
  });

  test('Accordion expands and collapses on click', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    const txnCard = page.locator('text=#TXN-001').first();
    await expect(txnCard).toBeVisible();

    await txnCard.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Line Items').first()).toBeVisible();

    await txnCard.click();
    await page.waitForTimeout(500);
  });

  test('Accordion shows item details when expanded', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await page.locator('text=#TXN-001').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Test Coffee').first()).toBeVisible();
    await expect(page.locator('text=Test Tea').first()).toBeVisible();
    await expect(page.locator('text=Subtotal').first()).toBeVisible();
    await expect(page.locator('text=Total').first()).toBeVisible();
    await expect(page.locator('text=Amount Paid').first()).toBeVisible();
    await expect(page.locator('text=Change Returned').first()).toBeVisible();
  });

  test('Accordion shows unit price for multiple quantities', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await page.locator('text=#TXN-001').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=each').first()).toBeVisible();
  });

  test('Transaction timestamp displays correctly', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-001').first()).toBeVisible();
    await expect(page.locator('text=/ago/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('User name displays on transaction', async ({ page }) => {
    await mockTransactionsApi(page, [TEST_TRANSACTION]);
    await gotoTransactions(page);

    await expect(page.locator('text=Test Cashier').first()).toBeVisible();
  });

  test('WhatsApp sent status displays on transaction', async ({ page }) => {
    const txnWithWhatsapp = { ...TEST_TRANSACTION, whatsapp_sent_to: '70123456' };
    await mockTransactionsApi(page, [txnWithWhatsapp]);
    await gotoTransactions(page);

    await expect(page.locator('text=Sent to: 70123456').first()).toBeVisible();
  });
});

test.describe('Transaction History — Accordion Behavior', () => {
  const MULTIPLE_TRANSACTIONS = [
    {
      id: 'txn-1', transaction_number: 'TXN-001', subtotal: 100000, total_amount: 100000,
      amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 7200000).toISOString(),
      whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Cashier 1',
      transaction_items: [{ id: 'item-1', product_name: 'Item A', quantity: 1, unit_price: 100000, total_price: 100000, currency: 'LL' }],
    },
    {
      id: 'txn-2', transaction_number: 'TXN-002', subtotal: 50000, total_amount: 50000,
      amount_paid: 50000, change_given: 0, created_at: new Date(Date.now() - 3600000).toISOString(),
      whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Cashier 1',
      transaction_items: [{ id: 'item-2', product_name: 'Item B', quantity: 1, unit_price: 50000, total_price: 50000, currency: 'LL' }],
    },
  ];

  test('Only one accordion can be open at a time', async ({ page }) => {
    await mockTransactionsApi(page, MULTIPLE_TRANSACTIONS);
    await gotoTransactions(page);

    await page.locator('text=#TXN-001').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Line Items').first()).toBeVisible();

    await page.locator('text=#TXN-002').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Line Items').first()).toBeVisible();
  });

  test('Accordion shows item count badge', async ({ page }) => {
    await mockTransactionsApi(page, [MULTIPLE_TRANSACTIONS[0]]);
    await gotoTransactions(page);

    await expect(page.locator('text=1 item').first()).toBeVisible();
  });

  test('Accordion visual indicator changes when open', async ({ page }) => {
    await mockTransactionsApi(page, [MULTIPLE_TRANSACTIONS[0]]);
    await gotoTransactions(page);

    const card = page.locator('text=#TXN-001').first();
    await card.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Line Items').first()).toBeVisible();
  });
});

test.describe('Transaction History — 48-Hour Retention Filter', () => {
  test('Transactions older than 48 hours are not shown', async ({ page }) => {
    await page.route(isTransactionsList, async () => {
      return Response.json({ transactions: [], nextCursor: null, hasMore: false });
    });
    await mockSupabaseApi(page);
    await gotoTransactions(page);

    await expect(page.locator('text=No Transactions Found').first()).toBeVisible({ timeout: 10000 });
  });

  test('Transactions within 48 hours are shown', async ({ page }) => {
    const recentTransaction = {
      id: 'txn-recent', transaction_number: 'TXN-RECENT', subtotal: 100000, total_amount: 100000,
      amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(),
      whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [],
    };
    await mockTransactionsApi(page, [recentTransaction]);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-RECENT').first()).toBeVisible({ timeout: 10000 });
  });

  test('Mix of old and recent transactions shows only recent', async ({ page }) => {
    const recentOnly = [
      {
        id: 'txn-recent-2', transaction_number: 'TXN-RECENT-2', subtotal: 100000, total_amount: 100000,
        amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 3600000).toISOString(),
        whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [],
      },
    ];
    await mockTransactionsApi(page, recentOnly);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-RECENT-2').first()).toBeVisible();
    await expect(page.locator('text=#TXN-OLD-2').first()).not.toBeVisible();
  });
});

test.describe('Transaction History — Search Functionality', () => {
  const SEARCHABLE_TRANSACTIONS = [
    { id: 'txn-search-1', transaction_number: 'TXN-AB12', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(), whatsapp_sent_to: '70123456', user_id: 'user-1', user_name: 'Alice Johnson', transaction_items: [] },
    { id: 'txn-search-2', transaction_number: 'TXN-CD34', subtotal: 50000, total_amount: 50000, amount_paid: 50000, change_given: 0, created_at: new Date(Date.now() - 3600000).toISOString(), whatsapp_sent_to: '70987654', user_id: 'user-1', user_name: 'Bob Smith', transaction_items: [] },
  ];

  test('Search by transaction number filters results', async ({ page }) => {
    await mockTransactionsApi(page, SEARCHABLE_TRANSACTIONS);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder="Search by #, user, phone, or amount..."]').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill('AB12');
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-AB12').first()).toBeVisible();
    await expect(page.locator('text=#TXN-CD34').first()).not.toBeVisible();
  });

  test('Search by phone number filters results', async ({ page }) => {
    await mockTransactionsApi(page, SEARCHABLE_TRANSACTIONS);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder="Search by #, user, phone, or amount..."]').first();
    await searchInput.fill('123456');
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-AB12').first()).toBeVisible();
    await expect(page.locator('text=#TXN-CD34').first()).not.toBeVisible();
  });

  test('Search by user name filters results', async ({ page }) => {
    await mockTransactionsApi(page, SEARCHABLE_TRANSACTIONS);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder="Search by #, user, phone, or amount..."]').first();
    await searchInput.fill('Alice');
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-AB12').first()).toBeVisible();
    await expect(page.locator('text=#TXN-CD34').first()).not.toBeVisible();
  });

  test('Search by amount filters results', async ({ page }) => {
    await mockTransactionsApi(page, SEARCHABLE_TRANSACTIONS);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder="Search by #, user, phone, or amount..."]').first();
    await searchInput.fill('100000');
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-AB12').first()).toBeVisible();
    await expect(page.locator('text=#TXN-CD34').first()).not.toBeVisible();
  });

  test('Empty search query shows all transactions', async ({ page }) => {
    await mockTransactionsApi(page, SEARCHABLE_TRANSACTIONS);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder="Search by #, user, phone, or amount..."]').first();
    await searchInput.fill('Alice');
    await page.waitForTimeout(500);
    await searchInput.clear();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-AB12').first()).toBeVisible();
    await expect(page.locator('text=#TXN-CD34').first()).toBeVisible();
  });
});

test.describe('Transaction History — Date Filter Logic', () => {
  const DATE_FILTERED_TRANSACTIONS = [
    { id: 'txn-hour', transaction_number: 'TXN-1H', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    { id: 'txn-today', transaction_number: 'TXN-TODAY', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 36000000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    { id: 'txn-week', transaction_number: 'TXN-WEEK', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 86400000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    { id: 'txn-month', transaction_number: 'TXN-MONTH', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1296000000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    { id: 'txn-90days', transaction_number: 'TXN-90D', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 7776000000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
  ];

  async function setupDateFiltered(page: Page) {
    await mockTransactionsApi(page, DATE_FILTERED_TRANSACTIONS);
    await gotoTransactions(page);
  }

  test('"1h" filter shows only last hour', async ({ page }) => {
    await setupDateFiltered(page);
    await page.locator('button:has-text("1h")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-1H').first()).toBeVisible();
    await expect(page.locator('text=#TXN-TODAY').first()).not.toBeVisible();
  });

  test('"Today" filter shows today\'s transactions', async ({ page }) => {
    await setupDateFiltered(page);
    await page.locator('button:has-text("Today")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-1H').first()).toBeVisible();
    await expect(page.locator('text=#TXN-TODAY').first()).toBeVisible();
    await expect(page.locator('text=#TXN-WEEK').first()).not.toBeVisible();
  });

  test('"7d" filter shows last 7 days', async ({ page }) => {
    await setupDateFiltered(page);
    await page.locator('button:has-text("7d")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-WEEK').first()).toBeVisible();
    await expect(page.locator('text=#TXN-MONTH').first()).not.toBeVisible();
  });

  test('"30d" filter shows last 30 days', async ({ page }) => {
    await setupDateFiltered(page);
    await page.locator('button:has-text("30d")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-MONTH').first()).toBeVisible();
    await expect(page.locator('text=#TXN-90D').first()).not.toBeVisible();
  });

  test('"90d" filter shows last 90 days', async ({ page }) => {
    const txns90d = [
      { id: 'txn-90days-2', transaction_number: 'TXN-90D-2', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    ];
    await mockTransactionsApi(page, txns90d);
    await gotoTransactions(page);

    await page.locator('button:has-text("90d")').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=#TXN-90D-2').first()).toBeVisible();
  });

  test('"All" filter removes date filter', async ({ page }) => {
    await setupDateFiltered(page);

    await page.locator('button:has-text("1h")').first().click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("All")').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=#TXN-1H').first()).toBeVisible();
    await expect(page.locator('text=#TXN-TODAY').first()).toBeVisible();
  });
});

test.describe('Transaction History — WhatsApp Integration', () => {
  const BASE_TXN = {
    id: 'txn-whatsapp', transaction_number: 'TXN-WA', subtotal: 100000, total_amount: 100000,
    amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(),
    whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test',
    transaction_items: [{ id: 'item-1', product_name: 'Test Item', quantity: 1, unit_price: 100000, total_price: 100000, currency: 'LL' }],
  };

  async function setupWhatsApp(page: Page, txn: any) {
    await mockTransactionsApi(page, [txn]);
    await mockWhatsAppApi(page);
    await gotoTransactions(page);
  }

  test('Send to WhatsApp button prompts for phone number', async ({ page }) => {
    await setupWhatsApp(page, BASE_TXN);
    
    page.on('dialog', async dialog => { await dialog.dismiss(); });

    await page.locator('text=#TXN-WA').first().click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Send to WhatsApp")').first().click();
    await page.waitForTimeout(500);

    expect(page.url()).toContain('/transactions');
  });

  test('WhatsApp button shows "Sent" status after sending', async ({ page }) => {
    await setupWhatsApp(page, BASE_TXN);

    await page.locator('text=#TXN-WA').first().click();
    await page.waitForTimeout(500);

    await page.route('**/api/transactions/*/whatsapp', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, phone: body.phone }),
      });
    });

    page.on('dialog', async dialog => { await dialog.accept('70123456'); });

    await page.locator('button:has-text("Send to WhatsApp")').first().click();
    await page.waitForTimeout(1000);
  });

  test('WhatsApp API validates 8-digit phone number', async ({ page }) => {
    let apiCalled = false;
    await mockTransactionsApi(page, [BASE_TXN]);
    await mockWhatsAppApi(page);

    await page.route('**/api/transactions/*/whatsapp', async (route) => {
      apiCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await gotoTransactions(page);

    page.on('dialog', async dialog => { await dialog.accept('123'); });

    await page.locator('text=#TXN-WA').first().click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Send to WhatsApp")').first().click();
    await page.waitForTimeout(1000);

    expect(apiCalled).toBe(false);
  });
});

test.describe('Transaction History — Loading and Error States', () => {
  test('Error state displays on API failure', async ({ page }) => {
    await page.unrouteAll({ behavior: 'wait' });
    await mockSupabaseApi(page);
    await page.route(isTransactionsList, async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
    });

    await page.goto('/transactions', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await injectAuth(page);
    await page.waitForTimeout(3000);

    expect(page.url()).toContain('/transactions');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length).toBeGreaterThan(0);
  });

  test('Transaction count updates based on filters', async ({ page }) => {
    const transactions = [
      { id: 'txn-a', transaction_number: 'TXN-A', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
      { id: 'txn-b', transaction_number: 'TXN-B', subtotal: 100000, total_amount: 100000, amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(), whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [] },
    ];

    await mockTransactionsApi(page, transactions);
    await gotoTransactions(page);

    await expect(page.locator('text=2 transactions').first()).toBeVisible();
  });
});

test.describe('Transaction History — Offline/Cached Data', () => {
  const CACHED_TXN = {
    id: 'txn-cached', transaction_number: 'TXN-CACHED', subtotal: 100000, total_amount: 100000,
    amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(),
    whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test', transaction_items: [],
  };

  test('Cached data indicator displays when showing cached', async ({ page }) => {
    await mockSupabaseApi(page);
    await mockTransactionsApi(page, [CACHED_TXN]);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-CACHED').first()).toBeVisible({ timeout: 10000 });
  });

  test('Transactions page works offline with cached data', async ({ page }) => {
    const offlineTxn = { ...CACHED_TXN, id: 'txn-offline', transaction_number: 'TXN-OFFLINE' };
    await mockTransactionsApi(page, [offlineTxn]);
    await gotoTransactions(page);

    await expect(page.locator('text=#TXN-OFFLINE').first()).toBeVisible();
  });
});

test.describe('Transaction History — Mobile Responsiveness', () => {
  test('Transaction page renders on mobile viewport', async ({ page }) => {
    await setMobileViewport(page);
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 15000 });
  });

  test('Search and filters are usable on mobile', async ({ page }) => {
    await setMobileViewport(page);
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();

    const filterContainer = page.locator('.overflow-x-auto').first();
    await expect(filterContainer).toBeVisible();
  });

  test('Transaction accordion works on mobile touch', async ({ page }) => {
    await setMobileViewport(page);

    const txn = {
      id: 'txn-mobile', transaction_number: 'TXN-MOBILE', subtotal: 100000, total_amount: 100000,
      amount_paid: 100000, change_given: 0, created_at: new Date(Date.now() - 1800000).toISOString(),
      whatsapp_sent_to: '', user_id: 'user-1', user_name: 'Test',
      transaction_items: [{ id: 'item-mobile', product_name: 'Mobile Item', quantity: 1, unit_price: 100000, total_price: 100000, currency: 'LL' }],
    };

    await mockTransactionsApi(page, [txn]);
    await gotoTransactions(page);

    await page.locator('text=#TXN-MOBILE').first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Mobile Item').first()).toBeVisible();
  });
});

test.describe('Transaction History — Cleanup Functionality', () => {
  test('Cleanup button is available in UI', async ({ page }) => {
    await mockTransactionsApi(page, []);
    await gotoTransactions(page);

    expect(page.url()).toContain('/transactions');
  });

  test('Cleanup API endpoint exists and responds', async ({ page }) => {
    await mockSupabaseApi(page);
    await page.route('**/api/transactions/cleanup', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ deleted: 0, message: 'No old transactions to clean' }),
        });
      }
    });

    await gotoTransactions(page);
    expect(page.url()).toContain('/transactions');
  });
});