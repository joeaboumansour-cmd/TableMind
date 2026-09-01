# Moving the database to Europe — runbook

**Status:** ready to run · **Written:** 2026-09-01 · **Owner runs it; this
document is the plan.**

Supabase is in **Seoul (`ap-northeast-2`)**. The shops are in **Lebanon**. That
is the single largest performance fact in this application, and it is the reason
every API call sits where it does.

---

## 1. Why — measured, not assumed

Supabase reports its own processing time in `x-envoy-upstream-service-time`,
which separates *time inside the database* from *time on the wire*. On an
**already-open keep-alive connection**, so no TCP or TLS setup is counted:

| Probe | Total | Inside Supabase | Network |
|---|---:|---:|---:|
| one row by primary key | 279 ms | **19 ms** | ~260 ms |
| 50 rows | 277 ms | 6 ms | ~271 ms |
| `get_cash_overview` RPC | 280 ms | 9 ms | ~271 ms |

**The database does its work in 3–19 ms. Everything else is distance.**

Round-trip times measured from Beirut, warm connections, AWS regional endpoints:

| Region | RTT |
|---|---:|
| Paris `eu-west-3` | 55 ms |
| Frankfurt `eu-central-1` | 61 ms |
| **Ireland `eu-west-1`** | **67 ms** |
| N. Virginia `us-east-1` | 127 ms |
| **Seoul `ap-northeast-2`** | **246 ms** |

Seoul at 246 ms matches the ~260 ms measured against Supabase itself, which is
what makes the model trustworthy rather than a guess.

### The production path today

There is **no `vercel.json` and no `preferredRegion` anywhere**, so every route
except `/api/health` runs Node in Vercel's default region, `iad1` (Washington).

```
  shop (Beirut) ──127ms──> Vercel iad1 ──~180ms──> Supabase Seoul
                                                   ~19ms of actual work
  ≈ 307 ms per API call
```

### After

```
  shop (Beirut) ──67ms──> Vercel dub1 ──~5ms──> Supabase eu-west-1 (Ireland)
  ≈ 72 ms per API call
```

**≈ 235 ms saved on every API call** — larger than the sum of every server-side
saving in the whole performance refactor.

> **Ireland is the right target and Frankfurt is not worth redoing it for.**
> 67 ms vs 61 ms is 6 ms; colocating Vercel with the database is worth more than
> that difference, and the Ireland project already exists.

---

## 2. The three traps

### 2.1 Do NOT rebuild the schema by replaying migrations

`supabase/migrations/` **does not describe production.** `001_initial_schema.sql`
gates every core table on `store_id = auth.uid()`, and this app has never used
Supabase Auth — so `auth.uid()` is always NULL and those policies would block
everything. The app works today, which means RLS was disabled or overridden
directly in production. `024_fix_stock_decrement_security.sql` documents exactly
that discovery for the stock RPC.

Replaying migrations into the new project would faithfully reproduce a schema
that **does not work**.

**Dump and restore the live database instead.** The migrations are history, not
a specification.

### 2.2 The client bundle has the OLD project baked into it

`NEXT_PUBLIC_SUPABASE_URL` is inlined at build time. Verified: the project ref
appears in a built client chunk, and that chunk is precached by the service
worker.

So at the moment of cutover:

- **The server** switches immediately — API routes read the URL and service key
  from environment variables at runtime.
- **A till** keeps using the OLD url until its service worker updates *and* the
  page reloads.

The browser talks to Supabase directly for three things: **login**
(`AuthContext`), the **product catalogue pull** (`syncEngine` →
`products/refresh`), and **favourites**. So a till on a stale bundle would push
sales to the NEW database through the API while pulling its catalogue from the
OLD one.

**Therefore: keep the old project alive and reachable until the fleet has
updated.** It costs nothing to leave running and it is the difference between a
slow rollover and a split brain.

### 2.3 Pinning Vercel to Europe BEFORE the database moves makes things worse

`dub1` while the database is still in Seoul is
`67 ms + Dublin→Seoul (~250 ms)` — worse than today. **The region pin is the
last step, not the first.**

---

## 3. What is NOT a problem

Worth stating, because each of these normally dominates a Supabase migration:

- **No Supabase Auth.** Login is hand-rolled against `stores` / `store_users`.
  There is no `auth.users` schema to migrate and no JWT audience to rotate.
- **No Supabase Storage.** No buckets, no objects.
- **No Realtime.** The cash page polls; nothing subscribes.
- **The tills keep selling throughout.** This is an offline-first POS: with the
  API unreachable, sales go to `offline_queue` and sync when it returns. A
  cutover window is survivable by design — that is what the queue is for.

---

## 4. The runbook

### Before you start

- [ ] The new project exists in `eu-west-1` (Ireland). ✅ done
- [ ] You have the connection string for **both** projects
      (Dashboard → Connect → Session pooler / direct).
- [ ] `pg_dump` and `psql` v15+ available locally.
- [ ] Pick a window when the shops are **closed**. The queue makes selling safe,
      but a quiet window makes verification honest.

### Step 1 — Dump the live database

```bash
# Schema AND data, no owners, no privileges (the new project owns its roles).
pg_dump "postgresql://postgres:PASSWORD@OLD-HOST:5432/postgres" \
  --schema=public \
  --no-owner --no-privileges \
  --format=custom \
  --file=gs-seoul-$(date +%Y%m%d-%H%M).dump
```

Keep this file. It is the rollback.

### Step 2 — Restore into Ireland

```bash
pg_restore \
  --dbname="postgresql://postgres:PASSWORD@NEW-HOST:5432/postgres" \
  --no-owner --no-privileges \
  --single-transaction \
  gs-seoul-TIMESTAMP.dump
```

`--single-transaction` so a partial restore cannot leave a half-built database.

### Step 3 — Verify the restore before switching anything

Row counts must match exactly on the tables that carry money and stock:

```sql
SELECT 'transactions'      t, count(*) FROM transactions
UNION ALL SELECT 'transaction_items', count(*) FROM transaction_items
UNION ALL SELECT 'products',          count(*) FROM products
UNION ALL SELECT 'stores',            count(*) FROM stores
UNION ALL SELECT 'store_users',       count(*) FROM store_users
UNION ALL SELECT 'cash_shifts',       count(*) FROM cash_shifts
UNION ALL SELECT 'cash_adjustments',  count(*) FROM cash_adjustments
UNION ALL SELECT 'cash_registers',    count(*) FROM cash_registers
UNION ALL SELECT 'recipe_components', count(*) FROM recipe_components
UNION ALL SELECT 'combo_components',  count(*) FROM combo_components
UNION ALL SELECT 'product_categories',count(*) FROM product_categories
UNION ALL SELECT 'product_favorites', count(*) FROM product_favorites
UNION ALL SELECT 'register_requests', count(*) FROM register_requests
UNION ALL SELECT 'kitchen_ticket_state', count(*) FROM kitchen_ticket_state
UNION ALL SELECT 'admin_users',       count(*) FROM admin_users;
```

Then the things a data dump silently drops:

- [ ] **Functions** — 42 of them. The ones the app breaks without:
      `create_sale`, `decrement_stock`, `decrement_stock_batch`,
      `get_cash_overview`, `get_shift_totals`, `get_unassigned_totals`,
      `get_register_performance`, `get_transaction_analytics`,
      `maintain_activity_log_partitions`.
      ```sql
      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' ORDER BY 1;
      ```
- [ ] **Views** — `store_transaction_health`, `transaction_retention_stats`.
- [ ] **Triggers** — especially the `profit_percentage` trigger on `products`.
      Insert a product with a cost and a price and check the column is computed.
- [ ] **`activity_logs` partitions.** The table is range-partitioned by day.
      Run `SELECT maintain_activity_log_partitions(3);` and confirm partitions
      exist for today and tomorrow, or every activity insert fails.
- [ ] **Sequences and identity columns** are at the right value.
- [ ] **RLS** matches the OLD project's *actual* state, not the repo's. Compare:
      ```sql
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1;
      ```

### Step 4 — Point the app at Ireland

In Vercel → Settings → Environment Variables, change **all three**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Then **redeploy** — `NEXT_PUBLIC_*` values are compiled in, so an env change
without a rebuild changes nothing on the client.

Update `.env.test` too, or the harness will keep testing Seoul.

### Step 5 — Verify against the real app, before the region pin

- [ ] Sign in.
- [ ] Scan and complete one sale; confirm the row in the **Ireland** database.
- [ ] Cash page loads with the correct drawer figures.
- [ ] Create a product; confirm it appears in Ireland.
- [ ] `npm run harness:verify` → 17/17.
- [ ] `npm run harness:contract` → 124/124.

### Step 6 — Only now, pin Vercel to Ireland

Create `vercel.json`:

```json
{
  "regions": ["dub1"]
}
```

`dub1` is Dublin — the same region as `eu-west-1`, so the function-to-database
hop becomes single-digit milliseconds. Redeploy.

> `/api/health` is an **Edge** function and is unaffected: Edge runs at every
> PoP, and it must stay Edge (see `CLAUDE.md` §4 — as a Node function it was the
> app's RTT floor).

### Step 7 — Let the fleet roll over, then retire Seoul

- Keep the Seoul project **running** for at least a week (see trap 2.2).
- A till picks up the new bundle when its service worker updates and the reload
  guard is clear — `PWAUpdateListener` forces a check on foreground.
- Watch `/admin/activity`: sales, cart events and `sync.durability` all arrive
  through the API, so the new database receiving traffic from every store is the
  signal the fleet has moved.
- Only then pause or delete the Seoul project.

---

## 5. Rollback

Before step 4 there is nothing to roll back — the old project is still live and
serving.

After step 4: put the three environment variables back and redeploy. Sales
written to Ireland in the interval would need moving across by hand, which is
the reason step 5 is a real verification and not a formality, and the reason to
do this while the shops are closed.

---

## 6. Expected result

| | Before | After |
|---|---:|---:|
| Per API call, Beirut | ~307 ms | **~72 ms** |
| `/api/cash-shifts` | 291 ms *(measured from Beirut, direct)* | ~75 ms |
| `/api/transactions` | 544 ms | ~90 ms |
| Every other route | ~270 ms | **~72 ms** |

The performance refactor removed the *extra* round trips. This removes most of
what one round trip costs.
