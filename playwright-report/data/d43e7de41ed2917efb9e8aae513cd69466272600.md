# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fierce-e2e-nightmare.spec.ts >> Nightmare E2E — Scenario 2: Mobile Offline Adventure >> Mobile POS: scanner toggle → cart → offline → checkout → IndexedDB queue → come online
- Location: tests\fierce-e2e-nightmare.spec.ts:306:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=GoldenSquirrel').first()
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('text=GoldenSquirrel').first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - img [ref=e8]
          - generic [ref=e12]:
            - heading "GoldenSquirrel" [level=1] [ref=e13]
            - paragraph [ref=e14]: Point of Sale
        - button "Open menu" [ref=e16]:
          - img
    - generic [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]:
          - button "Turn Off Scanner" [ref=e20]:
            - img
            - text: Turn Off Scanner
          - generic [ref=e21]: "ON"
        - generic [ref=e28]:
          - textbox "Manual barcode..." [ref=e29]
          - button "Add" [ref=e30]
      - generic [ref=e33]:
        - img [ref=e34]
        - paragraph [ref=e39]: Scan items to add
        - paragraph [ref=e40]: Use the camera above to scan barcodes
  - button "Open Next.js Dev Tools" [ref=e46] [cursor=pointer]:
    - img [ref=e47]
  - alert [ref=e50]
```

# Test source

```ts
  296 |     const compactInputAgain = page.locator('input[placeholder="Scan barcode..."]');
  297 |     await expect(compactInputAgain).toBeVisible({ timeout: 5000 });
  298 |   });
  299 | });
  300 | 
  301 | // ============================================================================
  302 | // SCENARIO 2: Mobile Offline Adventure
  303 | // ============================================================================
  304 | test.describe('Nightmare E2E — Scenario 2: Mobile Offline Adventure', () => {
  305 | 
  306 |   test('Mobile POS: scanner toggle → cart → offline → checkout → IndexedDB queue → come online', async ({ page }) => {
  307 |     // ── Step 1: Set mobile viewport and launch POS ──
  308 |     await setMobileViewport(page);
  309 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });
  310 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  311 | 
  312 |     // ── Step 2: Verify scanner toggle is visible ──
  313 |     const toggleBtn = page.locator('button:has-text("Scanner")').first();
  314 |     await expect(toggleBtn).toBeVisible({ timeout: 10000 });
  315 | 
  316 |     // Scanner should be ON by default — button says "Turn Off Scanner"
  317 |     await expect(toggleBtn).toContainText('Turn Off', { timeout: 5000 });
  318 | 
  319 |     // ── Step 3: Toggle scanner OFF → verify button text changes ──
  320 |     await toggleBtn.click();
  321 |     await page.waitForTimeout(300);
  322 |     await expect(toggleBtn).toContainText('Turn On', { timeout: 5000 });
  323 | 
  324 |     // ── Step 4: Toggle scanner back ON ──
  325 |     await toggleBtn.click();
  326 |     await page.waitForTimeout(300);
  327 |     await expect(toggleBtn).toContainText('Turn Off', { timeout: 5000 });
  328 | 
  329 |     // ── Step 5: Inject cart items and reload ──
  330 |     await injectCartItems(page, TWO_ITEM_CART);
  331 |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  332 |     await page.waitForTimeout(2000);
  333 | 
  334 |     // ── Step 6: Verify cart items visible with prices ──
  335 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 10000 });
  336 |     await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
  337 | 
  338 |     // Check LL prices
  339 |     await expect(page.locator('text=40,000').first()).toBeVisible({ timeout: 5000 });
  340 |     await expect(page.locator('text=15,000').first()).toBeVisible({ timeout: 3000 });
  341 | 
  342 |     // Check USD prices
  343 |     await expect(page.locator('text=1.34').first()).toBeVisible({ timeout: 5000 });
  344 |     await expect(page.locator('text=0.50').first()).toBeVisible({ timeout: 3000 });
  345 | 
  346 |     // ── Step 7: Click Checkout → navigate to checkout page (while still online) ──
  347 |     const checkoutBtn = page.locator('button:has-text("Checkout")').first();
  348 |     await expect(checkoutBtn).toBeVisible({ timeout: 5000 });
  349 |     await checkoutBtn.click();
  350 |     await page.waitForURL('**/checkout**', { timeout: 15000 });
  351 |     await page.waitForTimeout(1000);
  352 | 
  353 |     // Verify on checkout page
  354 |     await expect(page.locator('text=Cash Payment').first()).toBeVisible({ timeout: 10000 });
  355 | 
  356 |     // ── Step 8: Go offline (now on checkout page, like real scenario) ──
  357 |     await goOffline(page);
  358 |     await page.waitForTimeout(500);
  359 | 
  360 |     // ── Step 9: Enter LL payment amount offline ──
  361 |     const llInput = page.locator('input#amountLL');
  362 |     await expect(llInput).toBeVisible({ timeout: 5000 });
  363 |     await llInput.click();
  364 |     await llInput.fill('80000');
  365 |     await page.waitForTimeout(300);
  366 | 
  367 |     // Should show remaining/change display
  368 |     const totalPaidText = page.locator('text=Total Paid').first();
  369 |     await expect(totalPaidText).toBeVisible({ timeout: 3000 });
  370 | 
  371 |     // ── Step 10: Process payment offline ──
  372 |     const processBtn = page.locator('button:has-text("Process Payment")').first();
  373 |     await expect(processBtn).toBeVisible({ timeout: 5000 });
  374 |     await processBtn.click();
  375 |     await page.waitForTimeout(2000);
  376 | 
  377 |     await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });
  378 | 
  379 |     // ── Step 11: Verify transaction queued in IndexedDB ──
  380 |     const queueCount = await getQueuedCount(page);
  381 |     expect(queueCount).toBeGreaterThanOrEqual(1);
  382 | 
  383 |     // ── Step 12: "New Transaction" → click to go back to POS (offline) ──
  384 |     const newTxnBtn = page.locator('button:has-text("New Transaction")').first();
  385 |     await expect(newTxnBtn).toBeVisible({ timeout: 5000 });
  386 |     await newTxnBtn.click();
  387 |     await page.waitForTimeout(2000);
  388 | 
  389 |     // ── Step 13: Go back online first, then verify POS state ──
  390 |     await goOnline(page);
  391 |     await page.waitForTimeout(1000);
  392 | 
  393 |     // ── Step 14: Reload → POS functional with empty cart ──
  394 |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  395 |     await page.waitForTimeout(2000);
> 396 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  397 |     await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 10000 });
  398 | 
  399 |     // Clean up the queued transaction
  400 |     await clearOfflineQueue(page);
  401 |   });
  402 | });
  403 | 
  404 | // ============================================================================
  405 | // SCENARIO 3: The Star Products Journey
  406 | // ============================================================================
  407 | test.describe('Nightmare E2E — Scenario 3: Star Products Journey', () => {
  408 | 
  409 |   test('Desktop: star products → add product dialog → saved grid reacts → checkout → unstar', async ({ page }) => {
  410 |     test.setTimeout(60000);
  411 |     
  412 |     // ── Step 1: Launch desktop mode POS ──
  413 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });
  414 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  415 | 
  416 |     // Isolate test: clear shared frequently-used localStorage after page load
  417 |     await page.evaluate(() => {
  418 |       try {
  419 |         localStorage.removeItem('tm_frequently_used_test-store-id');
  420 |       } catch (e) {
  421 |         // ignore
  422 |       }
  423 |     });
  424 | 
  425 |     // ── Step 2: Set up product route mocking BEFORE navigating to Products ──
  426 |     await page.route('**/rest/v1/products*', (route) => {
  427 |       route.fulfill({
  428 |         status: 200,
  429 |         contentType: 'application/json',
  430 |         body: JSON.stringify(MOCK_PRODUCTS),
  431 |       });
  432 |     });
  433 | 
  434 |     // ── Step 3: Navigate to Products page via Inventory button ──
  435 |     await clickButtonAndVerifyUrl(page, 'Inventory', '/pos/products');
  436 |     await page.waitForTimeout(500);
  437 |     await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 10000 });
  438 | 
  439 |     // Reload to trigger product fetch with our route handler
  440 |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  441 |     await page.waitForTimeout(2000);
  442 | 
  443 |     // ── Step 4: Verify star buttons on products ──
  444 |     const starIcons = page.locator('button svg.lucide-star');
  445 |     const starCount = await starIcons.count();
  446 |     // Should have at least 1 star button
  447 |     if (starCount === 0) {
  448 |       // If no stars visible, the product data might not have loaded.
  449 |       // Try force-adding products to localStorage and reload
  450 |       await page.evaluate(() => {
  451 |         localStorage.setItem('tm_frequently_used_test-store-id', JSON.stringify([]));
  452 |       });
  453 |       // Just skip star-dependent assertions and continue
  454 |     } else {
  455 |       // Star the first product
  456 |       await starIcons.first().click();
  457 |       await page.waitForTimeout(300);
  458 | 
  459 |       // Verify localStorage updated for first product
  460 |       let freqIds = await page.evaluate(() => {
  461 |         const stored = localStorage.getItem('tm_frequently_used_test-store-id');
  462 |         return stored ? JSON.parse(stored) : [];
  463 |       });
  464 |       expect(freqIds).toContain('prod-1');
  465 | 
  466 |       // Star the second product
  467 |       if (starCount >= 2) {
  468 |         await starIcons.nth(1).click();
  469 |         await page.waitForTimeout(300);
  470 | 
  471 |         freqIds = await page.evaluate(() => {
  472 |           const stored = localStorage.getItem('tm_frequently_used_test-store-id');
  473 |           return stored ? JSON.parse(stored) : [];
  474 |         });
  475 |         expect(freqIds).toContain('prod-2');
  476 |       }
  477 |     }
  478 | 
  479 |     // ── Step 5: Add a new product via the Add dialog ──
  480 |     // First ensure the Products page has loaded its data by waiting a bit
  481 |     await page.waitForTimeout(1000);
  482 | 
  483 |     // Look for an Add button that opens a dialog (on Products page)
  484 |     const addBtn = page.locator('button:has-text("Add Product"), button:has-text("New Product")').first();
  485 |     const addBtnExists = await addBtn.count();
  486 |     if (addBtnExists > 0) {
  487 |       await addBtn.click();
  488 |       await page.waitForTimeout(500);
  489 |     } else {
  490 |       // Fallback: just click any Add button present
  491 |       const anyAddBtn = page.locator('button:has-text("Add")').first();
  492 |       await expect(anyAddBtn).toBeVisible({ timeout: 5000 }).catch(() => {});
  493 |       await anyAddBtn.click().catch(() => {});
  494 |       await page.waitForTimeout(500);
  495 |     }
  496 | 
```