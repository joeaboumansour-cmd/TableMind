# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fierce-e2e-nightmare.spec.ts >> Nightmare E2E — Scenario 1: Full Desktop POS Workflow >> Desktop POS: barcode scan → saved products → qty adjust → clear dismiss → checkout → new txn
- Location: tests\fierce-e2e-nightmare.spec.ts:192:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForTimeout: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e7]:
      - img [ref=e8]
    - generic [ref=e11]:
      - button "Open issues overlay" [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: "0"
          - generic [ref=e15]: "1"
        - generic [ref=e16]: Issue
      - button "Collapse issues badge" [ref=e17]:
        - img [ref=e18]
  - alert [ref=e20]
  - generic [ref=e21]:
    - banner [ref=e22]:
      - generic [ref=e24]:
        - generic [ref=e25]:
          - img [ref=e27]
          - generic [ref=e31]:
            - heading "GoldenSquirrel" [level=1] [ref=e32]
            - paragraph [ref=e33]: Point of Sale
        - generic [ref=e34]:
          - generic [ref=e36]:
            - img [ref=e37]
            - text: Connected
          - button "History" [ref=e41]:
            - img
            - text: History
          - button "Inventory" [ref=e42]:
            - img
            - text: Inventory
          - button [ref=e43]:
            - img
    - generic [ref=e44]:
      - generic [ref=e48]:
        - img [ref=e49]
        - paragraph [ref=e54]: Scan items to add
        - paragraph [ref=e55]: Use the scanner on the right
      - generic [ref=e61]:
        - textbox "Scan barcode..." [active] [ref=e62]
        - button "Add" [ref=e63]
```

# Test source

```ts
  186 | 
  187 | // ============================================================================
  188 | // SCENARIO 1: The Full Desktop POS Workflow
  189 | // ============================================================================
  190 | test.describe('Nightmare E2E — Scenario 1: Full Desktop POS Workflow', () => {
  191 | 
  192 |   test('Desktop POS: barcode scan → saved products → qty adjust → clear dismiss → checkout → new txn', async ({ page }) => {
  193 |     // ── Step 1: Launch POS in desktop mode ──
  194 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true, product_discount: true });
  195 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  196 | 
  197 |     // Desktop mode specific elements
  198 |     const compactInput = page.locator('input[placeholder="Scan barcode..."]');
  199 |     await expect(compactInput).toBeVisible({ timeout: 10000 });
  200 | 
  201 |     // ── Step 2: Inject cart items into the store directly (reliable, no backend needed) ──
  202 |     await injectCartItems(page, TWO_ITEM_CART);
  203 |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  204 |     await page.waitForTimeout(2000);
  205 | 
  206 |     // Verify items appeared in cart
  207 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 10000 });
  208 |     await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
  209 | 
  210 |     // Verify prices
  211 |     await expect(page.locator('text=40,000').first()).toBeVisible({ timeout: 5000 });
  212 |     await expect(page.locator('text=15,000').first()).toBeVisible({ timeout: 3000 });
  213 | 
  214 |     // ── Step 3: Increase quantity via + button ──
  215 |     const plusButtons = page.locator('button svg.lucide-plus');
  216 |     const plusCount = await plusButtons.count();
  217 |     expect(plusCount).toBeGreaterThanOrEqual(1);
  218 | 
  219 |     await plusButtons.first().click();
  220 |     await page.waitForTimeout(300);
  221 | 
  222 |     // Item still visible after quantity change
  223 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 3000 });
  224 | 
  225 |     // ── Step 5: Click Inventory button → navigate to products page ──
  226 |     await clickButtonAndVerifyUrl(page, 'Inventory', '/pos/products');
  227 |     await page.waitForTimeout(500);
  228 |     await expect(page.locator('text=Products').first()).toBeVisible({ timeout: 10000 });
  229 | 
  230 |     // ── Step 6: Click back button → return to POS ──
  231 |     const backBtn = page.locator('button svg.lucide-arrow-left').first();
  232 |     await expect(backBtn).toBeVisible({ timeout: 5000 });
  233 |     await backBtn.click();
  234 |     await page.waitForTimeout(2000);
  235 | 
  236 |     // Verify we're back on POS
  237 |     const currentUrl = page.url();
  238 |     expect(currentUrl.includes('/pos') && !currentUrl.includes('/products')).toBeTruthy();
  239 | 
  240 |     // ── Step 7: Verify cart items persisted ──
  241 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
  242 |     await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 3000 });
  243 | 
  244 |     // ── Step 8: Verify Clear button is visible ──
  245 |     const clearBtn = page.locator('button:has-text("Clear")').first();
  246 |     await expect(clearBtn).toBeVisible({ timeout: 5000 });
  247 | 
  248 |     // ── Step 9: Click Checkout → verify on checkout page ──
  249 |     const checkoutBtn = page.locator('button:has-text("Checkout")').first();
  250 |     await expect(checkoutBtn).toBeVisible({ timeout: 5000 });
  251 |     await checkoutBtn.click();
  252 |     await page.waitForTimeout(2000);
  253 | 
  254 |     await expect(page.locator('text=Checkout').first()).toBeVisible({ timeout: 10000 });
  255 |     await page.waitForTimeout(500);
  256 |     await expect(page.locator('text=Order Summary').first()).toBeVisible({ timeout: 8000 });
  257 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 5000 });
  258 |     await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 3000 });
  259 | 
  260 |     // ── Step 10: Enter LL payment and verify change calculation ──
  261 |     const llInput = page.locator('input#amountLL');
  262 |     await expect(llInput).toBeVisible({ timeout: 5000 });
  263 |     await llInput.click();
  264 |     await llInput.fill('100000');
  265 |     await page.waitForTimeout(800);
  266 | 
  267 |     // Should show change due (overpayment) — wait up to 5s for live calculation
  268 |     const changeDisplay = page.locator('text=Change Due').first();
  269 |     await expect(changeDisplay).toBeVisible({ timeout: 5000 });
  270 | 
  271 |     // ── Step 11: Process payment → verify Payment Complete ──
  272 |     const processBtn = page.locator('button:has-text("Process Payment")').first();
  273 |     await expect(processBtn).toBeVisible({ timeout: 5000 });
  274 |     await processBtn.click();
  275 |     await page.waitForTimeout(2000);
  276 | 
  277 |     await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });
  278 | 
  279 |     // Verify transaction number is shown
  280 |     await expect(page.locator('text=TXN-').first()).toBeVisible({ timeout: 5000 });
  281 | 
  282 |     // ── Step 12: Click "New Transaction" → back to POS with empty cart ──
  283 |     const newTxnBtn = page.locator('button:has-text("New Transaction")').first();
  284 |     await expect(newTxnBtn).toBeVisible({ timeout: 5000 });
  285 |     await newTxnBtn.click();
> 286 |     await page.waitForTimeout(2000);
      |                ^ Error: page.waitForTimeout: Test timeout of 30000ms exceeded.
  287 | 
  288 |     // Verify back on POS with empty cart
  289 |     const posUrl = page.url();
  290 |     expect(posUrl.includes('/pos')).toBeTruthy();
  291 | 
  292 |     // Empty cart should show "Scan items to add"
  293 |     await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 10000 });
  294 | 
  295 |     // Verify desktop mode is still active (layout not broken)
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
```