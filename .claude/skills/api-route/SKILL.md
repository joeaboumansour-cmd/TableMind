---
name: api-route
description: The required shape for an API route in this POS — authentication, multi-tenant store scoping, input validation, and error contract. Load before creating or modifying anything under src/app/api/. Triggers on - API route, route handler, endpoint, src/app/api, NextResponse, GET/POST/PATCH/DELETE handler, x-auth-data, service role, createServiceRoleClient, store_id scoping, "add an endpoint", request validation.
---

# Writing an API route

This app is **multi-tenant with real paying stores**. A route that leaks or accepts the wrong `store_id` exposes one customer's data to another.

## ⚠️ Read this before copying an existing route

**The current authentication pattern in this codebase is broken and is being replaced.** Every existing route reads tenancy from an unsigned client header and then queries with the service-role key, bypassing RLS:

```ts
// ❌ DO NOT COPY — audit P0-1
const authData = request.headers.get('x-auth-data');
const store_id = JSON.parse(authData).store_id;
```

Anyone can set that header to any UUID. Three routes have **no auth at all** (audit P0-2). Two treat a *missing* `user_id` as "this caller is the owner" (audit P0-3).

**When you touch a route, move it toward the target below — do not replicate the neighbours.**

## Target shape

### 1. Authenticate — server-verified, not client-claimed

Tenancy must come from a **signed token the server verifies**, never from a request body or an unsigned header. The primitive already exists and is currently imported by nothing:

```ts
import { getAuthenticatedUser } from "@/lib/auth/jwt";

const user = await getAuthenticatedUser(request.headers.get("authorization"));
if (!user) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

`JWT_SECRET` must be set in the environment. `src/lib/auth/jwt.ts:11` currently falls back to a hardcoded default — that fallback must throw before this is relied on (audit P0-8).

### 2. Authorize — prove the caller may act, don't infer it from absence

```ts
// ❌ absence is not authorization
if (!userId) return { isOwner: true };

// ✅ look it up
const { data: employee } = await supabase
  .from("store_users").select("permissions, is_active")
  .eq("id", user.userId).eq("store_id", user.storeId).single();
if (!employee?.is_active) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Ownership and permissions are **server-side facts**. Look them up; never accept them as claims.

### 3. Validate input — every field, every time

**No route in this codebase currently validates anything.** `POST /api/transactions` writes `body.total_amount` and `item.quantity` straight to the database. A negative quantity *increments* stock (audit P1-5).

Validate types, ranges, and signs before touching the DB:

```ts
const qty = Number(item.quantity);
if (!Number.isInteger(qty) || qty <= 0) {
  return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
}
```

Money fields must be finite, non-negative, and within the column's range — see the `money` skill; the columns overflow at 99,999,999.99 while amounts are in LL (audit P1-3).

### 4. Scope every query by `store_id` — from the token, never the body

```ts
// ✅
.eq("store_id", user.storeId)

// ❌ caller controls this
.eq("store_id", body.storeId)
```

This applies to **every** verb. `PATCH /api/admin/store-users` currently updates by `id` alone with no store scoping — that's the full-takeover bug (audit P0-2).

### 5. Multi-step writes must be atomic

Don't do insert → insert → loop-of-RPCs across separate round-trips. `POST /api/transactions:229-267` does exactly that and swallows both failure branches while still returning `201`, producing header-only sales with no line items (audit P1-4). Use a single plpgsql function.

### 6. Error contract

```ts
return NextResponse.json({ error: "Human readable message" }, { status: 4xx|5xx });
```

`401` unauthenticated · `403` authenticated but not permitted · `400` bad input · `404` not found *or* not yours (don't leak existence across tenants) · `500` server fault.

**Never log secrets.** `api/admin/login/route.ts:28` logs the submitted password and the stored credential (audit P0-4). Never put a password, token, or `password_hash` in a `console.log`, and never select `password_hash` into a response.

## Client-side calls

The client is offline-first. Any route the POS calls during a sale needs a queueing fallback — see the `offline-write` skill. Make the route **idempotent**, because retries will duplicate requests.

## Checklist

- [ ] Auth verified server-side from a signed token
- [ ] Permission looked up, not inferred from a missing field
- [ ] Every input validated for type, range, and sign
- [ ] Every query scoped by `store_id` from the token
- [ ] Multi-step writes atomic
- [ ] Idempotent under retry
- [ ] No secrets logged, no `password_hash` in any response
- [ ] Errors use the standard shape and correct status

## Verify

There is **no automated test suite** — it was removed at the owner's direction and QA is done by humans. Exercise the route manually with `curl`, and explicitly check the **cross-tenant case**: authenticate as store A, request store B's data, confirm `403`/`404`. Report what you actually ran.
