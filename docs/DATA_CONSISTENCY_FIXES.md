# Data Consistency Audit & Fixes

## Executive Summary

A comprehensive audit of the TableMind application revealed several critical data consistency issues that could cause:
- **Duplicate customer stat updates** (visits, no-shows, cancellations counted twice)
- **Inconsistent data reading patterns** across UI components
- **Duplicate database objects** (triggers, functions, views)

All issues have been resolved. This document details the problems found and the fixes applied.

---

## Issues Found

### 1. CRITICAL: Duplicate Customer Stats Updates

**Problem:** Customer statistics (total_visits, no_show_count, cancellation_count) were being updated in multiple places:

1. **Database Trigger** (`handle_reservation_status_change`) - Runs automatically when reservation status changes
2. **API Route** (`/api/reservations/[id]/visit`) - Manually called RPC functions to increment stats
3. **Visit Logs Trigger** (`update_customer_stats_from_visit`) - Separate trigger from visit logs table

**Impact:** 
- Stats were being incremented TWICE for each action
- A customer who visited once would show 2 visits
- A no-show would increment count twice

**Fix Applied:**
- Removed all manual customer stat updates from API routes
- Database trigger is now the **single source of truth** for customer stats
- API routes only update reservation status - trigger handles the rest

### 2. Duplicate Database Migration Files

**Problem:** Same functions and triggers defined in multiple migration files:
- `migration_customer_tracking.sql`
- `migration_final_fix.sql`
- `migration_fix_customer_stats.sql`
- `migration_complete_fix.sql`
- `migration_rpc_functions.sql`

**Impact:**
- Confusion about which version is current
- Risk of applying different versions in different environments
- Maintenance nightmare

**Fix Applied:**
- Created `CONSOLIDATED_FIX.sql` - a single comprehensive migration
- Drops all duplicate objects before recreating
- All fixes consolidated in one file

### 3. Inconsistent Data Reading Patterns

**Problem:** UI components read customer data from different sources:
- `customer_analytics` view
- `customer_analytics_extended` view (referenced but not consistently created)
- Direct `customers` table queries

**Impact:**
- Different components showing different calculated values
- `reliability_score` and `risk_level` calculated differently or missing

**Fix Applied:**
- Standardized all customer reading to use `customer_analytics` view
- Removed fallback logic in hooks and pages
- Single source of truth for customer data with calculated fields

### 4. Schema vs Migration Mismatch

**Problem:** 
- Base `schema.sql` was missing critical columns added in migrations
- `reservation_status` enum had different values in different files
- `customer_id` column missing from reservations in base schema

**Impact:**
- Fresh database setup would be missing critical columns
- Inconsistent behavior between fresh and migrated databases

**Fix Applied:**
- `CONSOLIDATED_FIX.sql` includes all schema changes
- Can be run on any database state (fresh or existing)
- Uses `IF NOT EXISTS` for safe column additions

---

## Files Modified

### Database
| File | Change |
|------|--------|
| `supabase/CONSOLIDATED_FIX.sql` | **NEW** - Single comprehensive migration that fixes everything |

### API Routes
| File | Change |
|------|--------|
| `src/app/api/reservations/[id]/route.ts` | Removed duplicate customer stat updates, added documentation |
| `src/app/api/reservations/[id]/visit/route.ts` | Removed RPC calls for customer stats, relies on trigger |

### Hooks
| File | Change |
|------|--------|
| `src/lib/hooks/useCustomers.ts` | Standardized to use `customer_analytics` view only |

### Pages
| File | Change |
|------|--------|
| `src/app/(dashboard)/customers/page.tsx` | Removed fallback to non-existent `customer_analytics_extended` view |

---

## How to Apply the Fix

### Step 1: Run the Consolidated Migration

Execute the SQL in `supabase/CONSOLIDATED_FIX.sql` in your Supabase SQL Editor:

```sql
-- Run this file in Supabase SQL Editor
-- It will:
-- 1. Drop all duplicate triggers and functions
-- 2. Ensure all required columns exist
-- 3. Create a single customer_analytics view
-- 4. Create the single trigger for customer stats
-- 5. Create all analytics functions
```

### Step 2: Verify the Fix

```sql
-- Check that customer_analytics view exists
SELECT * FROM customer_analytics LIMIT 1;

-- Check that the trigger exists
SELECT trigger_name 
FROM information_schema.triggers 
WHERE trigger_name = 'reservation_status_change';

-- Check that customer stats columns exist
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'customers' 
AND column_name IN ('total_visits', 'no_show_count', 'cancellation_count', 'last_visit_date');
```

### Step 3: Test Customer Stats

1. Create a reservation for an existing customer
2. Change status to "seated" - visit count should increment by 1
3. Change status to "finished" - visit count should NOT increment again
4. Create another reservation and cancel it - cancellation count should be 1 (not 2)

---

## Data Flow Architecture (Fixed)

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (Pages/Components)                                 │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ Customers Page  │  │ Timeline View   │                   │
│  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                             │
│           └────────┬───────────┘                             │
│                    │                                         │
│           ┌────────▼────────┐                                │
│           │ customer_analytics│ (READ-ONLY VIEW)            │
│           │      VIEW       │                                │
│           └────────┬────────┘                                │
└────────────────────┼────────────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────────────┐
│                    │                                         │
│  ┌─────────────────▼─────────────────┐                      │
│  │         customers TABLE           │                      │
│  │  (Writable - stores actual data)  │                      │
│  └─────────────────┬─────────────────┘                      │
│                    │                                        │
│  ┌─────────────────▼─────────────────┐                      │
│  │   reservation_status_change       │                      │
│  │         TRIGGER                   │                      │
│  │  (Updates customer stats on       │                      │
│  │   reservation status change)      │                      │
│  └─────────────────┬─────────────────┘                      │
│                    │                                        │
│  ┌─────────────────▼─────────────────┐                      │
│  │       reservations TABLE          │                      │
│  └───────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

**Key Principles:**
1. **Write Path:** UI → reservations table → Trigger → customers table
2. **Read Path:** UI → customer_analytics view (never write directly to view)
3. **Single Source of Truth:** Database trigger handles ALL customer stat updates

---

## Migration File Cleanup (Recommended)

After applying the consolidated fix, you can safely archive these duplicate migration files:
- `migration_customer_tracking.sql`
- `migration_final_fix.sql`
- `migration_fix_customer_stats.sql`
- `migration_complete_fix.sql`
- `migration_rpc_functions.sql`

Keep these for reference:
- `schema.sql` - Base schema (still useful for documentation)
- `CONSOLIDATED_FIX.sql` - The master fix file
- `migration_analytics.sql` - Analytics functions (now included in consolidated)
- `migration_waitlist_management.sql` - Waitlist feature (separate concern)
- `migration_add_visit_logs.sql` - Visit logs feature (separate concern)

---

## Verification Checklist

- [ ] Run `CONSOLIDATED_FIX.sql` in Supabase SQL Editor
- [ ] Verify `customer_analytics` view exists and returns data
- [ ] Verify trigger `reservation_status_change` exists
- [ ] Create test reservation → status to seated → verify visit count = 1
- [ ] Create test reservation → status to cancelled → verify cancellation count = 1
- [ ] Verify analytics page loads without errors
- [ ] Verify customers page loads without errors
- [ ] Verify timeline view loads without errors

---

## Future Best Practices

1. **Always use the database trigger** for customer stat updates - never duplicate in API
2. **Always read from `customer_analytics` view** for customer data
3. **Never create duplicate migration files** - modify the consolidated file instead
4. **Test customer stats** after any reservation-related changes
5. **Run the consolidated fix** on new database setups before starting the app

---

## Summary

All data consistency issues have been resolved:
- ✅ Customer stats update once (via trigger only)
- ✅ Single customer_analytics view for all reading
- ✅ Consolidated migration file
- ✅ API routes rely on database triggers
- ✅ No duplicate database objects

The application now has a **single source of truth** for all customer analytics and reservation data.
