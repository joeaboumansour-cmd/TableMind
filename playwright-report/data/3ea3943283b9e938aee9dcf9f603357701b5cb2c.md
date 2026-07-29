# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fierce-e2e-nightmare.spec.ts >> Nightmare E2E — Scenario 3: Star Products Journey >> Desktop: star products → add product dialog → saved grid reacts → checkout → unstar
- Location: tests\fierce-e2e-nightmare.spec.ts:409:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/pos/products" until "load"
  navigated to "http://localhost:3000/pos"
  navigated to "http://localhost:3000/pos"
============================================================
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
  150 |   {
  151 |     product_id: 'test-product-1',
  152 |     product_name: 'Test Coffee',
  153 |     barcode: 'COFFEE001',
  154 |     quantity: 2,
  155 |     unit_price: 45000,       // 50,000 - 10% discount
  156 |     total_price: 90000,      // 2 × 45,000
  157 |     unit_price_usd: 1.50,    // 1.67 - 10% discount
  158 |     total_price_usd: 3.00,   // 2 × 1.50
  159 |     stock_quantity: 50,
  160 |     discount_percentage: 10,
  161 |   },
  162 |   {
  163 |     product_id: 'test-product-2',
  164 |     product_name: 'Test Tea',
  165 |     barcode: 'TEA001',
  166 |     quantity: 1,
  167 |     unit_price: 30000,
  168 |     total_price: 30000,
  169 |     unit_price_usd: 1.00,
  170 |     total_price_usd: 1.00,
  171 |     stock_quantity: 100,
  172 |     discount_percentage: 0,
  173 |   },
  174 | ];
  175 | 
  176 | export { DISCOUNT_CART_ITEMS };
  177 | 
  178 | /**
  179 |  * Mocks Supabase REST API to return empty results.
  180 |  */
  181 | export async function mockSupabaseApi(page: Page) {
  182 |   await page.route('**/rest/v1/**', (route) => {
  183 |     const method = route.request().method();
  184 |     if (method === 'GET') {
  185 |       route.fulfill({
  186 |         status: 200,
  187 |         contentType: 'application/json',
  188 |         body: JSON.stringify([]),
  189 |       });
  190 |     } else {
  191 |       route.fulfill({
  192 |         status: 201,
  193 |         contentType: 'application/json',
  194 |         body: JSON.stringify({}),
  195 |       });
  196 |     }
  197 |   });
  198 | }
  199 | 
  200 | /**
  201 |  * Navigate to a page with auth and optionally cart items pre-injected.
  202 |  */
  203 | export async function navigateWithAuth(page: Page, url: string, cartItems?: any[]) {
  204 |   await mockSupabaseApi(page);
  205 |   await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  206 |   await injectAuth(page);
  207 |   if (cartItems) {
  208 |     await injectCartItems(page, cartItems);
  209 |   }
  210 |   await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  211 | }
  212 | 
  213 | /**
  214 |  * Navigate to a page with auth, feature flags, and optionally cart items.
  215 |  * Feature flags are injected into localStorage before the page renders,
  216 |  * so useFeatureFlags() reads the desired state immediately.
  217 |  *
  218 |  * Usage:
  219 |  *   // Test with discounts OFF
  220 |  *   await navigateWithFlags(page, '/pos', { product_discount: false });
  221 |  *
  222 |  *   // Test with analytics ON and discounted cart items
  223 |  *   await navigateWithFlags(page, '/transactions', { transaction_analytics: true }, DISCOUNT_CART_ITEMS);
  224 |  */
  225 | export async function navigateWithFlags(
  226 |   page: Page,
  227 |   url: string,
  228 |   featureOverrides?: Record<string, boolean>,
  229 |   cartItems?: any[]
  230 | ) {
  231 |   await mockSupabaseApi(page);
  232 |   await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  233 |   await injectAuth(page);
  234 |   await injectFeatureFlags(page, featureOverrides);
  235 |   if (cartItems) {
  236 |     await injectCartItems(page, cartItems);
  237 |   }
  238 |   await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  239 | }
  240 | 
  241 | /**
  242 |  * Click a button by its text and verify the URL changes to the expected path.
  243 |  * This is the core "button-first" navigation assertion.
  244 |  */
  245 | export async function clickButtonAndVerifyUrl(page: Page, buttonText: string, expectedUrlContains: string, options?: { timeout?: number }) {
  246 |   const timeout = options?.timeout ?? 15000;
  247 |   const btn = page.locator(`button:has-text("${buttonText}")`).first();
  248 |   await expect(btn).toBeVisible({ timeout });
  249 |   await btn.click();
> 250 |   await page.waitForURL(`**${expectedUrlContains}`, { timeout });
      |              ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  251 |   expect(page.url()).toContain(expectedUrlContains);
  252 | }
  253 | 
  254 | /**
  255 |  * Assert the current URL contains the expected path.
  256 |  */
  257 | export async function expectUrlToContain(page: Page, expected: string) {
  258 |   expect(page.url()).toContain(expected);
  259 | }
  260 | 
  261 | /**
  262 |  * Click a mobile menu item and verify navigation.
  263 |  */
  264 | export async function clickMobileMenuItemAndVerifyUrl(page: Page, itemText: string, expectedUrlContains: string) {
  265 |   // Open mobile menu
  266 |   const hamburger = page.locator('button[aria-label="Open menu"]').first();
  267 |   await expect(hamburger).toBeVisible({ timeout: 10000 });
  268 |   await hamburger.click();
  269 |   await page.waitForTimeout(300);
  270 | 
  271 |   // Click the menu item
  272 |   const menuItem = page.locator(`button:has-text("${itemText}"), span:has-text("${itemText}")`).first();
  273 |   await expect(menuItem).toBeVisible({ timeout: 5000 });
  274 |   await menuItem.click();
  275 |   await page.waitForURL(`**${expectedUrlContains}`, { timeout: 15000 });
  276 |   expect(page.url()).toContain(expectedUrlContains);
  277 | }
  278 | 
  279 | /**
  280 |  * Set the viewport to mobile size for mobile-specific tests.
  281 |  * Also overrides navigator.userAgent via init script so isDesktop() detection returns false.
  282 |  */
  283 | export async function setMobileViewport(page: Page) {
  284 |   await page.setViewportSize({ width: 375, height: 812 });
  285 |   await page.addInitScript(() => {
  286 |     Object.defineProperty(navigator, "userAgent", {
  287 |       get() {
  288 |         return "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  289 |       },
  290 |     });
  291 |   });
  292 | }
  293 | 
  294 | /**
  295 |  * Go offline by disabling network requests.
  296 |  */
  297 | export async function goOffline(page: Page) {
  298 |   await page.context().setOffline(true);
  299 |   await page.route('**/*', (route) => {
  300 |     route.abort();
  301 |   });
  302 | }
  303 | 
  304 | /**
  305 |  * Go back online.
  306 |  */
  307 | export async function goOnline(page: Page) {
  308 |   await page.context().setOffline(false);
  309 |   await page.unrouteAll({ behavior: 'wait' });
  310 | }
```