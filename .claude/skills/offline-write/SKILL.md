---
name: offline-write
description: How to make a write operation survive being offline in this POS — the queue tables, the sync engine handler, idempotency, and retry caps. Load before adding or changing any operation that writes to the server and must work with no internet. Triggers on - offline, sync, syncEngine, queue, offline_queue, pending_writes, IndexedDB, Dexie, localDB, connectivity, retry, PendingWrite, QueuedTransaction, "works offline", "queue it", flush, reconnect.
---

# Adding an offline-capable write

The app must keep selling with no internet. Any new server write needs to survive a dead connection, and be safe when the same write is retried.

## First: which queue?

| Queue | Use for | Guarantees |
|---|---|---|
| **`offline_queue`** | **Completed sales only.** | Full idempotency via `UNIQUE (store_id, transaction_number)`. Pushed by `pushQueuedTransactions`. |
| **`pending_writes`** | Everything else — favourites, cash shift open/close, cash adjustments, legacy stock decrements. | Typed by `PendingWrite.type`. Retry counter, capped at `MAX_PENDING_WRITE_RETRIES = 5`. |

Both live in `src/lib/db/localDB.ts` (Dexie DB `GoldenSquirrelPOS`).

**Do not add a new top-level Dexie table** unless the data genuinely doesn't fit either. Adding one means a new `db.version(n).stores({...})` block, and the existing versions must be preserved verbatim.

## The recipe for a `pending_writes` operation

### 1. Add the type

`src/lib/db/localDB.ts` — extend the union:

```ts
export interface PendingWrite {
  id: string;
  type: "transaction" | "stock_decrement" | "favorite_add" | /* … */ | "your_new_type";
  payload: unknown;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}
```

### 2. Enqueue at the call site, always — not only when offline

Attempt the network call; on **any** failure, enqueue. Don't branch on `connectivity.isOnline` to decide whether to try — a request can fail after the check.

```ts
try {
  const res = await fetch("/api/your-route", { method: "POST", headers, body });
  if (!res.ok) throw new Error(`failed (${res.status})`);
} catch {
  await addPendingWrite({ type: "your_new_type", payload: { /* … */ } });
}
```

**Capture `created_at` in the payload at the moment of the action**, and make the server honour it. There is a live bug (audit P1-1) where offline sales are stamped with the sync time instead of the sale time, corrupting reconciliation and analytics. Don't repeat it.

### 3. Handle it in the sync engine

`src/lib/sync/engine.ts` → `processPendingWrites()`. Filter your type out alongside the existing groups, then process it in a loop that:

1. **Checks the retry cap first** and drops + reports if exceeded:
   ```ts
   if (write.retry_count >= MAX_PENDING_WRITE_RETRIES) {
     await removePendingWrite(write.id);
     result.failed++;
     result.errors.push(`your_new_type ${write.id}: dropped after ${write.retry_count} retries`);
     continue;
   }
   ```
   Cash and favourite writes currently skip this check (audit P2-9) — they retry forever. Don't copy them.
2. Performs the call.
3. `await removePendingWrite(write.id)` **only** on success.
4. On failure, increments `retry_count` and records `last_error`.

Follow `processCashShiftWrite` (`engine.ts:410`) as the shape to copy — but add the cap it's missing.

### 4. Make the server side idempotent

The same write **will** arrive twice — a response can be lost after the server committed. Design so a duplicate is harmless:

- A natural unique key plus a duplicate branch (how transactions do it: `UNIQUE (store_id, transaction_number)` + a `23505` catch returning the existing row).
- Or a client-generated idempotency key stored server-side.

**Never** rely on "it only sends once."

Note the existing trap: the transaction duplicate branch (`api/transactions/route.ts:125`) returns early and **skips the stock decrement**. If your handler does side effects after the main insert, a duplicate arrival will skip them too.

## Rules that are easy to get wrong

- **Stock decrements are server-side only.** Do not re-add client-side stock queuing — it was removed deliberately to prevent double-decrement. `queueStockDecrement` in `localDB.ts` is dead legacy.
- **Connectivity is heartbeat-based**, not `navigator.onLine`. Use the `connectivity` singleton (`src/lib/connectivity.ts`). `navigator.onLine` reports "online" for a wifi with no internet.
- **`/api/health` must stay `NetworkOnly`** in `next.config.ts`. If the service worker caches it, the app believes it's online forever, banners never show, and sync never fires.
- **Sync can run in two tabs at once.** `syncInProgress` is per-instance; two tabs share one IndexedDB. Your handler must tolerate a concurrent duplicate.
- **Surface failures.** Dropped writes currently go into an `errors[]` array that nothing displays, so inventory silently drifts (audit P2-3). If you add a drop path, show the operator something.

## Verify

1. `npm run dev`, then DevTools → Network → **Offline**.
2. Perform the action. Confirm the row lands in IndexedDB (`Application` → IndexedDB → `GoldenSquirrelPOS` → `pending_writes`).
3. Go back online. Confirm it flushes within 30s (or immediately on tab focus) and the row disappears.
4. **Test the duplicate path**: replay the same write twice and confirm the server state is identical to sending it once.
5. Relevant E2E: `tests/fierce-offline-sync.spec.ts`, `tests/integration/offline-flow.spec.ts`.
