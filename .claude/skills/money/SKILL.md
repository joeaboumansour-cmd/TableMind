---
name: money
description: Dual-currency (Lebanese Pound / USD) money rules for this POS — rounding to 5,000 LL, which exchange rate to use when, and which helper to call. Load before writing or changing ANY code that touches a price, total, subtotal, discount, change, payment, cash drawer amount, revenue figure, or currency conversion. Triggers on - price, total, subtotal, discount, change, payment, amount_paid, cash drawer, LL, LBP, USD, exchange rate, SELL_RATE, RETURN_RATE, formatLL, formatUSD, convertUsdToLl, roundToNearest5k, cart total, receipt amount.
---

# Money rules

This is a live POS handling real cash in Lebanon. Getting this wrong loses the store money on every transaction and is invisible until reconciliation.

**`src/lib/utils/format.ts` is the single source of truth. Never inline a conversion or a rounding calculation.**

## The five rules

### 1. LL is the base currency

Prices, totals, and revenue are stored and computed in **Lebanese Pounds**. USD is a derived display and payment currency. `products.selling_price` may be denominated in either — check `product.currency` (`'LL'` or `'USD'`) before doing anything with it.

### 2. Every LL amount the customer sees or pays is a multiple of 5,000

Lebanon has no bill smaller than 5,000 LL. Use `roundToNearest5k()`. Never `Math.round`, never `toFixed`, never a hand-written multiple-of calculation.

```ts
import { roundToNearest5k } from "@/lib/utils/format";
```

### 3. Round at the total — never per line item

Per-item rounding compounds across a basket and drifts from the true price. Line items carry **exact, unrounded** values; `cartStore.getTotal()` is the only place `roundToNearest5k` is applied to a cart.

```ts
// ✅ correct — cartStore.ts
getSubtotal: () => items.reduce((sum, item) => sum + item.total_price, 0),
getTotal:    () => roundToNearest5k(get().getSubtotal()),

// ❌ wrong — rounds each line
unit_price: roundToNearest5k(product.selling_price * quantity)
```

Discounts are likewise applied **exact and unrounded** at the item level.

### 4. There are two exchange rates and they are NOT interchangeable

| Rate | Value | Use when |
|---|---|---|
| `SELL_RATE` | 90,000 | The customer is **paying**. Converting a price into what they owe. |
| `RETURN_RATE` | 89,000 | Money goes **back** to the customer (change), or a USD payment is being valued in LL. |

The 1,000 LL spread is the store's margin on currency handling. **Using the wrong direction silently gives that margin away on every transaction.** If you are unsure which applies, ask — do not guess.

### 5. Call the named helpers, never raw arithmetic

```ts
convertUsdToLl(usd)           // USD → LL at SELL_RATE,   rounded to 5k
convertUsdToLlForReturn(usd)  // USD → LL at RETURN_RATE, rounded to 5k
convertLlToUsdForSale(ll)     // LL → USD at SELL_RATE
convertLlToUsdForReturn(ll)   // LL → USD at RETURN_RATE
```

```ts
// ❌ wrong — bypasses the 5k rounding that convertUsdToLl exists to apply
const ll = usdPrice * SELL_RATE;

// ✅ correct
const ll = convertUsdToLl(usdPrice);
```

`convertLlToUsd()` is **deprecated**. Do not use it in new code.

## Display

Always `formatLL(amount)` → `"185,000 LL"` and `formatUSD(amount)` → `"$2.07"`. Never hand-build a currency string.

Double-check the branch: there is a known live bug where these two are **swapped** inside a `currency === 'LL'` conditional (audit P0-6). When you touch a currency conditional, verify the LL branch calls `formatLL`.

## Known landmines in this area

Do not treat surrounding code as correct — several places here are known-wrong and being fixed:

- **Four conversion paths disagree** (audit P1-6). `cartStore` uses the return rate, `TransactionAnalytics` uses the sell rate, `ProductSearchBar` and `products/page` multiply raw, and `checkout` computes a blended weighted rate. The same product shows different USD on different screens. **Fix toward these rules, don't match the neighbour.**
- **Rates are hardcoded** (audit P1-7). `stores.usd_rate_sell` / `usd_rate_return` columns exist from migration `004` with unused SQL helpers — that's the intended fix. Transactions carry no rate stamp, so historical receipts re-price when a rate changes. Fix both together or neither.
- **USD payments are double-counted in the drawer** (audit P1-2) — `amount_paid` already contains the USD portion converted to LL, and `usd_amount_paid` holds the same dollars again.
- **Money columns overflow** (audit P1-3) — `DECIMAL(10,2)` caps at 99,999,999.99 while amounts are in LL. A basket over ~1,100 USD throws.
- Money is JS floats end-to-end. Don't compare amounts with `===`; don't assume a sum is exact.

## Before you finish

- [ ] Did you use a helper from `format.ts` rather than raw arithmetic?
- [ ] Is rounding applied at the total only, not per item?
- [ ] Is the rate direction right — is money going *to* the store (SELL) or *back to* the customer (RETURN)?
- [ ] Does `formatLL` wrap the LL branch and `formatUSD` the USD branch?
- [ ] **There is no automated test suite** — it was removed at the owner's direction and QA is done by humans. Nothing will catch a rounding or rate mistake for you, so hand-check the arithmetic on a real example (e.g. $2.07 × 90,000 = 186,300 → rounds to 185,000) and state in your summary exactly what you verified and how.
