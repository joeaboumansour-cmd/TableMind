# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fierce-e2e-nightmare.spec.ts >> Nightmare E2E — Scenario 4: Multi-Transaction & History Flow >> Desktop: first txn exact payment → second txn overpayment → history page → search → back
- Location: tests\fierce-e2e-nightmare.spec.ts:607:7

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
        - button [ref=e25]:
          - img
        - generic [ref=e26]:
          - heading "Checkout" [level=1] [ref=e27]
          - paragraph [ref=e28]: Cash Payment
    - generic [ref=e30]:
      - generic [ref=e31]:
        - generic [ref=e32]:
          - heading "Order Summary" [level=3] [ref=e33]
          - paragraph [ref=e34]: 1 item
        - generic [ref=e35]:
          - generic [ref=e37]:
            - generic [ref=e38]:
              - generic [ref=e39]: Croissant × 3
              - generic [ref=e40]: LL
            - generic [ref=e41]:
              - generic [ref=e42]: 75,000 LL
              - generic [ref=e43]: $2.49
          - generic [ref=e45]:
            - generic [ref=e46]: Total
            - generic [ref=e47]:
              - generic [ref=e48]: 75,000 LL
              - generic [ref=e49]: $2.49
      - generic [ref=e50]:
        - generic [ref=e51]:
          - heading "WhatsApp Receipt" [level=3] [ref=e52]
          - paragraph [ref=e53]: "Optional: Send receipt via WhatsApp"
        - generic [ref=e55]:
          - text: WhatsApp Number
          - textbox "WhatsApp Number" [ref=e56]
          - paragraph [ref=e57]: Enter Lebanese number starting with 70, 71, 76, etc. (no +961 or 00961 prefix)
      - generic [ref=e58]:
        - heading "Payment Method" [level=3] [ref=e60]
        - generic [ref=e62]:
          - generic [ref=e63]:
            - generic [ref=e64]:
              - text: Amount Received (LL)
              - spinbutton "Amount Received (LL)" [ref=e65]: "50000"
            - generic [ref=e66]:
              - text: Amount Received (USD)
              - spinbutton "Amount Received (USD)" [active] [ref=e67]: "1"
          - generic [ref=e68]:
            - generic [ref=e69]:
              - generic [ref=e70]: Paid in LL
              - generic [ref=e71]: 50,000 LL
            - generic [ref=e72]:
              - generic [ref=e73]: Paid in USD
              - generic [ref=e74]: $1.00
            - generic [ref=e75]:
              - generic [ref=e76]: USD rate applied
              - generic [ref=e77]: $1 = 89,000 LL
            - generic [ref=e78]:
              - generic [ref=e79]: Total Paid (LL equivalent)
              - generic [ref=e80]: 139,000 LL
          - generic [ref=e81]:
            - generic [ref=e82]: Change Due
            - generic [ref=e83]:
              - generic [ref=e84]: in LL
              - generic [ref=e85]: 64,000 LL
            - generic [ref=e86]:
              - generic [ref=e87]: in USD
              - generic [ref=e88]: $0.72
            - generic [ref=e89]:
              - generic [ref=e90]: Rate applied for this transaction
              - generic [ref=e91]: blended $1 ≈ 89,360 LL
          - generic [ref=e92]:
            - img [ref=e93]
            - generic [ref=e95]: "Total: 75,000 LL / $2.49"
      - button "Process Payment • 75,000 LL" [ref=e96]:
        - img
        - text: Process Payment • 75,000 LL
```

# Test source

```ts
  603 | // SCENARIO 4: Multi-Transaction & History Flow
  604 | // ============================================================================
  605 | test.describe('Nightmare E2E — Scenario 4: Multi-Transaction & History Flow', () => {
  606 | 
  607 |   test('Desktop: first txn exact payment → second txn overpayment → history page → search → back', async ({ page }) => {
  608 |     // ════════════════════════════════════════════════════════
  609 |     // TRANSACTION 1: Exact payment with 3 items
  610 |     // ════════════════════════════════════════════════════════
  611 |     // ── Step 1: Launch POS in desktop mode ──
  612 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true }, THREE_ITEM_CART);
  613 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  614 | 
  615 |     // ── Step 2: Verify all 3 items visible ──
  616 |     await expect(page.locator('text=Morning Coffee').first()).toBeVisible({ timeout: 10000 });
  617 |     await expect(page.locator('text=Green Tea').first()).toBeVisible({ timeout: 5000 });
  618 |     await expect(page.locator('text=Croissant').first()).toBeVisible({ timeout: 5000 });
  619 | 
  620 |     // Verify total shown (60,000 + 30,000 + 25,000 = 115,000)
  621 |     await expect(page.locator('text=115,000').first()).toBeVisible({ timeout: 5000 });
  622 | 
  623 |     // ── Step 3: Checkout ──
  624 |     const checkoutBtn1 = page.locator('button:has-text("Checkout")').first();
  625 |     await expect(checkoutBtn1).toBeVisible({ timeout: 5000 });
  626 |     await checkoutBtn1.click();
  627 |     await page.waitForTimeout(2000);
  628 | 
  629 |     await expect(page.locator('text=Checkout').first()).toBeVisible({ timeout: 10000 });
  630 | 
  631 |     // ── Step 4: Enter EXACT payment in LL ──
  632 |     const llInput1 = page.locator('input#amountLL');
  633 |     await expect(llInput1).toBeVisible({ timeout: 5000 });
  634 |     await llInput1.click();
  635 |     await llInput1.fill('115000');
  636 |     await page.waitForTimeout(500);
  637 | 
  638 |     // ── Step 5: Process payment ──
  639 |     const processBtn1 = page.locator('button:has-text("Process Payment")').first();
  640 |     await expect(processBtn1).toBeVisible({ timeout: 5000 });
  641 |     await processBtn1.click();
  642 |     await page.waitForTimeout(2000);
  643 | 
  644 |     await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });
  645 | 
  646 |     // Verify transaction number displayed
  647 |     await expect(page.locator('text=TXN-').first()).toBeVisible({ timeout: 5000 });
  648 | 
  649 |     // Capture transaction number for later comparison
  650 |     const txn1Text = await page.locator('text=TXN-').first().textContent();
  651 | 
  652 |     // ════════════════════════════════════════════════════════
  653 |     // TRANSACTION 2: Different items + overpayment (LL + USD)
  654 |     // ════════════════════════════════════════════════════════
  655 |     // ── Step 6: New Transaction → back to POS ──
  656 |     const newTxnBtn1 = page.locator('button:has-text("New Transaction")').first();
  657 |     await expect(newTxnBtn1).toBeVisible({ timeout: 5000 });
  658 |     await newTxnBtn1.click();
  659 |     await page.waitForTimeout(2000);
  660 | 
  661 |     expect(page.url()).toContain('/pos');
  662 | 
  663 |     // ── Step 7: Inject different cart (just 1 item) ──
  664 |     const SINGLE_ITEM = [
  665 |       {
  666 |         product_id: 'prod-3',
  667 |         product_name: 'Croissant',
  668 |         barcode: 'BARCODE003',
  669 |         quantity: 3,
  670 |         unit_price: 25000,
  671 |         total_price: 75000,
  672 |         unit_price_usd: 0.83,
  673 |         total_price_usd: 2.49,
  674 |         stock_quantity: 30,
  675 |       },
  676 |     ];
  677 |     await injectCartItems(page, SINGLE_ITEM);
  678 |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  679 |     await page.waitForTimeout(2000);
  680 | 
  681 |     // Verify item in cart
  682 |     await expect(page.locator('text=Croissant').first()).toBeVisible({ timeout: 10000 });
  683 |     await expect(page.locator('text=75,000').first()).toBeVisible({ timeout: 5000 });
  684 | 
  685 |     // ── Step 8: Checkout #2 ──
  686 |     const checkoutBtn2 = page.locator('button:has-text("Checkout")').first();
  687 |     await expect(checkoutBtn2).toBeVisible({ timeout: 5000 });
  688 |     await checkoutBtn2.click();
  689 |     await page.waitForTimeout(2000);
  690 | 
  691 |     await expect(page.locator('text=Checkout').first()).toBeVisible({ timeout: 10000 });
  692 | 
  693 |     // ── Step 9: Enter OVERPAYMENT — both LL and USD ──
  694 |     const llInput2 = page.locator('input#amountLL');
  695 |     await expect(llInput2).toBeVisible({ timeout: 5000 });
  696 |     await llInput2.click();
  697 |     await llInput2.fill('50000');
  698 | 
  699 |     const usdInput2 = page.locator('input#amountUSD');
  700 |     await expect(usdInput2).toBeVisible({ timeout: 5000 });
  701 |     await usdInput2.click();
  702 |     await usdInput2.fill('1');
> 703 |     await page.waitForTimeout(500);
      |                ^ Error: page.waitForTimeout: Test timeout of 30000ms exceeded.
  704 | 
  705 |     // Should show "Change Due" (overpayment)
  706 |     const changeDue2 = page.locator('text=Change Due').first();
  707 |     await expect(changeDue2).toBeVisible({ timeout: 3000 });
  708 | 
  709 |     // Verify change amount shown in both LL and USD
  710 |     await expect(page.locator('text=in LL').first()).toBeVisible({ timeout: 3000 });
  711 |     await expect(page.locator('text=in USD').first()).toBeVisible({ timeout: 3000 });
  712 | 
  713 |     // ── Step 10: Process payment #2 ──
  714 |     const processBtn2 = page.locator('button:has-text("Process Payment")').first();
  715 |     await expect(processBtn2).toBeVisible({ timeout: 5000 });
  716 |     await processBtn2.click();
  717 |     await page.waitForTimeout(2000);
  718 | 
  719 |     await expect(page.locator('text=Payment Complete').first()).toBeVisible({ timeout: 15000 });
  720 | 
  721 |     // Verify a DIFFERENT transaction number
  722 |     await expect(page.locator('text=TXN-').first()).toBeVisible({ timeout: 5000 });
  723 |     const txn2Text = await page.locator('text=TXN-').first().textContent();
  724 | 
  725 |     // Transaction numbers should be different
  726 |     if (txn1Text && txn2Text) {
  727 |       expect(txn1Text).not.toBe(txn2Text);
  728 |     }
  729 | 
  730 |     // Verify change amount shows (not zero)
  731 |     await expect(page.locator('text=Change').first()).toBeVisible({ timeout: 3000 });
  732 | 
  733 |     // ════════════════════════════════════════════════════════
  734 |     // TRANSACTION HISTORY NAVIGATION
  735 |     // ════════════════════════════════════════════════════════
  736 |     // ── Step 11: New Transaction → back to POS ──
  737 |     const newTxnBtn2 = page.locator('button:has-text("New Transaction")').first();
  738 |     await expect(newTxnBtn2).toBeVisible({ timeout: 5000 });
  739 |     await newTxnBtn2.click();
  740 |     await page.waitForTimeout(2000);
  741 | 
  742 |     // ── Step 12: Click History button → navigate to transactions page ──
  743 |     const historyBtn = page.locator('button:has-text("History")').first();
  744 |     await expect(historyBtn).toBeVisible({ timeout: 5000 });
  745 |     await historyBtn.click();
  746 |     await page.waitForURL('**/transactions', { timeout: 15000 });
  747 | 
  748 |     await expect(page.locator('text=Transaction History').first()).toBeVisible({ timeout: 10000 });
  749 | 
  750 |     // ── Step 13: Search input is visible and accepts text ──
  751 |     const searchInput = page.locator('input[placeholder*="Search"]').first();
  752 |     await expect(searchInput).toBeVisible({ timeout: 5000 });
  753 |     await searchInput.fill('TXN-');
  754 |     await page.waitForTimeout(300);
  755 |     await expect(searchInput).toHaveValue('TXN-');
  756 | 
  757 |     // ── Step 14: Refresh button is visible ──
  758 |     const refreshBtn = page.locator('button[title="Refresh"]').first();
  759 |     await expect(refreshBtn).toBeVisible({ timeout: 5000 });
  760 | 
  761 |     // ── Step 15: Click back button → back to POS ──
  762 |     const backBtn = page.locator('button svg.lucide-arrow-left').first();
  763 |     await expect(backBtn).toBeVisible({ timeout: 5000 });
  764 |     await backBtn.click();
  765 |     await page.waitForURL('**/pos', { timeout: 15000 });
  766 | 
  767 |     // ── Step 16: Verify cart is empty (clean state) ──
  768 |     await expect(page.locator('text=Scan items to add').first()).toBeVisible({ timeout: 10000 });
  769 |   });
  770 | });
  771 | 
  772 | // ============================================================================
  773 | // SCENARIO 5: The Everything Bagel — Full App Tour (Mobile)
  774 | // ============================================================================
  775 | test.describe('Nightmare E2E — Scenario 5: The Everything Bagel — Full App Tour', () => {
  776 | 
  777 |   test('Mobile: scanner → add item → products → star → history → checkout → offline resilience → logout', async ({ page }) => {
  778 |     test.setTimeout(60000);
  779 |     
  780 |     // Set up product route mocking BEFORE any navigation
  781 |     await page.route('**/rest/v1/products*', (route) => {
  782 |       route.fulfill({
  783 |         status: 200,
  784 |         contentType: 'application/json',
  785 |         body: JSON.stringify(MOCK_PRODUCTS),
  786 |       });
  787 |     });
  788 | 
  789 |     // ════════════════════════════════════════════════════════
  790 |     // PART 1: Mobile POS — Scanner toggle, items, add product
  791 |     // ════════════════════════════════════════════════════════
  792 |     // ── Step 1: Set mobile viewport and launch POS ──
  793 |     await setMobileViewport(page);
  794 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });
  795 |     await expect(page.locator('text=GoldenSquirrel').first()).toBeVisible({ timeout: 15000 });
  796 | 
  797 |     // Isolate test: clear shared frequently-used localStorage after page load
  798 |     await page.evaluate(() => {
  799 |       try {
  800 |         localStorage.removeItem('tm_frequently_used_test-store-id');
  801 |       } catch (e) {
  802 |         // ignore
  803 |       }
```