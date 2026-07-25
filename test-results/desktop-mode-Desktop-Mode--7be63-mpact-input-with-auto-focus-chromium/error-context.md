# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-mode.spec.ts >> Desktop Mode — BarcodeScanner >> BarcodeScanner desktop mode renders compact input with auto-focus
- Location: tests\desktop-mode.spec.ts:86:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - img [ref=e8]
          - generic [ref=e12]:
            - heading "GoldenSquirrel" [level=1] [ref=e13]
            - paragraph [ref=e14]: Point of Sale
        - generic [ref=e15]:
          - generic [ref=e17]:
            - img [ref=e18]
            - text: Connected
          - button "History" [ref=e22]:
            - img
            - text: History
          - button "Inventory" [ref=e23]:
            - img
            - text: Inventory
          - button [ref=e24]:
            - img
    - generic [ref=e25]:
      - generic [ref=e29]:
        - img [ref=e30]
        - paragraph [ref=e35]: Scan items to add
        - paragraph [ref=e36]: Use the scanner on the right
      - generic [ref=e42]:
        - textbox "Scan barcode..." [active] [ref=e43]
        - button "Add" [ref=e44]
  - generic [ref=e49] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e50]:
      - img [ref=e51]
    - generic [ref=e54]:
      - button "Open issues overlay" [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]: "0"
          - generic [ref=e58]: "1"
        - generic [ref=e59]: Issue
      - button "Collapse issues badge" [ref=e60]:
        - img [ref=e61]
  - alert [ref=e63]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import {
  3   |   navigateWithFlags,
  4   |   injectAuth,
  5   |   injectFeatureFlags,
  6   |   mockSupabaseApi,
  7   |   setMobileViewport,
  8   |   DEFAULT_FEATURE_FLAGS,
  9   | } from './integration/test-utils';
  10  | 
  11  | // ============================================================================
  12  | // Desktop Mode Tests — BarcodeScanner desktopMode prop
  13  | // ============================================================================
  14  | test.describe('Desktop Mode — BarcodeScanner', () => {
  15  | 
  16  |   test('POS page renders compact barcode input (no camera) when desktop_shortcuts is enabled', async ({ page }) => {
  17  |     // Use desktop viewport (default in Playwright is 1280x720)
  18  |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });
  19  | 
  20  |     // The scanner toggle should be visible
  21  |     await expect(page.locator('text=Turn Off Scanner').first()).toBeHidden({ timeout: 15000 });
  22  | 
  23  |     // The camera view (bg-zinc-950 h-[200px]) should NOT be present in desktop mode
  24  |     // Instead, we should see the compact barcode input
  25  |     const compactInput = page.locator('input[placeholder="Scan barcode..."]');
  26  |     await expect(compactInput).toBeVisible({ timeout: 10000 });
  27  | 
  28  |     // The "Manual barcode..." input should NOT be visible (desktop mode uses "Scan barcode...")
  29  |     const manualInput = page.locator('input[placeholder="Manual barcode..."]');
  30  |     await expect(manualInput).toHaveCount(0, { timeout: 5000 });
  31  |   });
  32  | 
  33  |   test('POS page renders camera view when desktop_shortcuts is disabled', async ({ page }) => {
  34  |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });
  35  | 
  36  |     // The scanner toggle should be visible
  37  |     await expect(page.locator('text=Turn Off Scanner').first()).toBeVisible({ timeout: 15000 });
  38  | 
  39  |     // The camera view should be present (bg-zinc-950)
  40  |     // In mobile mode, the "Manual barcode..." input should be visible
  41  |     const manualInput = page.locator('input[placeholder="Manual barcode..."]');
  42  |     await expect(manualInput).toBeVisible({ timeout: 10000 });
  43  |   });
  44  | 
  45  |   test('POS page shows saved product buttons in desktop mode', async ({ page }) => {
  46  |     // Inject products with no barcode via mocked API
  47  |     await mockSupabaseApi(page);
  48  |     await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 15000 });
  49  |     await injectAuth(page);
  50  |     await injectFeatureFlags(page, { desktop_shortcuts: true });
  51  | 
  52  |     // Mock Supabase to return products without barcodes
  53  |     await page.route('**/rest/v1/products*', (route) => {
  54  |       route.fulfill({
  55  |         status: 200,
  56  |         contentType: 'application/json',
  57  |         body: JSON.stringify([
  58  |           {
  59  |             id: 'no-barcode-1',
  60  |             store_id: 'test-store-id',
  61  |             name: 'No Barcode Item',
  62  |             barcode: null,
  63  |             cost_price: 10000,
  64  |             selling_price: 20000,
  65  |             currency: 'LL',
  66  |             profit_percentage: 100,
  67  |             discount_percentage: 0,
  68  |             stock_quantity: 50,
  69  |             min_stock_threshold: 5,
  70  |             parent_id: null,
  71  |             variant_name: null,
  72  |           },
  73  |         ]),
  74  |       });
  75  |     });
  76  | 
  77  |     await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  78  | 
  79  |     // Wait for products to load
  80  |     await page.waitForTimeout(2000);
  81  | 
  82  |     // The saved product button should be visible
  83  |     await expect(page.locator('text=No Barcode Item').first()).toBeVisible({ timeout: 10000 });
  84  |   });
  85  | 
  86  |   test('BarcodeScanner desktop mode renders compact input with auto-focus', async ({ page }) => {
  87  |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });
  88  | 
  89  |     // The compact barcode input should be visible
  90  |     const compactInput = page.locator('input[placeholder="Scan barcode..."]');
  91  |     await expect(compactInput).toBeVisible({ timeout: 10000 });
  92  | 
  93  |     // The input should have autoFocus attribute
  94  |     const hasAutoFocus = await compactInput.evaluate((el: HTMLInputElement) => el.hasAttribute('autofocus'));
> 95  |     expect(hasAutoFocus).toBe(true);
      |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  96  |   });
  97  | 
  98  |   test('BarcodeScanner desktop mode has Add button', async ({ page }) => {
  99  |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });
  100 | 
  101 |     // The Add button should be visible
  102 |     await expect(page.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 10000 });
  103 |   });
  104 | 
  105 |   test('BarcodeScanner desktop mode has Cancel button when onClose is provided', async ({ page }) => {
  106 |     await navigateWithFlags(page, '/pos/products', { desktop_shortcuts: true });
  107 | 
  108 |     // Open the barcode scanner dialog via the scan icon button
  109 |     const scanButton = page.locator('button svg.lucide-scan').first();
  110 |     await expect(scanButton).toBeVisible({ timeout: 15000 });
  111 |     await scanButton.click();
  112 |     await page.waitForTimeout(500);
  113 | 
  114 |     // In the scanner dialog, Cancel should be visible because onClose is provided
  115 |     await expect(page.locator('button:has-text("Cancel")').first()).toBeVisible({ timeout: 10000 });
  116 |   });
  117 | 
  118 |   test('Products page uses desktop mode for barcode scanner dialog', async ({ page }) => {
  119 |     await navigateWithFlags(page, '/pos/products', { desktop_shortcuts: true });
  120 | 
  121 |     // Click the scan icon button to open the barcode scanner dialog
  122 |     const scanButton = page.locator('button svg.lucide-scan').first();
  123 |     await expect(scanButton).toBeVisible({ timeout: 15000 });
  124 | 
  125 |     // The products page should detect desktop mode internally
  126 |     // (isDesktop is called in useEffect, so it should be true in Playwright's desktop viewport)
  127 |     // We can't easily verify the desktopMode prop directly, but we can verify the dialog opens
  128 |     await scanButton.click();
  129 |     await page.waitForTimeout(500);
  130 | 
  131 |     // The barcode scanner dialog should be open
  132 |     // In desktop mode, it should show the compact input instead of camera
  133 |     const compactInput = page.locator('input[placeholder="Scan barcode..."]');
  134 |     await expect(compactInput).toBeVisible({ timeout: 10000 });
  135 |   });
  136 | 
  137 |   test('Mobile viewport uses camera mode (not desktop mode)', async ({ page }) => {
  138 |     // Set mobile viewport
  139 |     await setMobileViewport(page);
  140 | 
  141 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: true });
  142 | 
  143 |     // On mobile, the camera view should be present (not the compact input)
  144 |     const manualInput = page.locator('input[placeholder="Manual barcode..."]');
  145 |     await expect(manualInput).toBeVisible({ timeout: 15000 });
  146 | 
  147 |     // The compact "Scan barcode..." input should NOT be visible
  148 |     const compactInput = page.locator('input[placeholder="Scan barcode..."]');
  149 |     await expect(compactInput).toHaveCount(0, { timeout: 5000 });
  150 |   });
  151 | 
  152 |   test('Desktop mode with desktop_shortcuts disabled shows camera', async ({ page }) => {
  153 |     // Even on desktop, if the feature flag is off, camera should be used
  154 |     await navigateWithFlags(page, '/pos', { desktop_shortcuts: false });
  155 | 
  156 |     // The "Manual barcode..." input should be visible (camera mode)
  157 |     const manualInput = page.locator('input[placeholder="Manual barcode..."]');
  158 |     await expect(manualInput).toBeVisible({ timeout: 15000 });
  159 |   });
  160 | });
  161 | 
```