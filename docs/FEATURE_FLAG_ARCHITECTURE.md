# Feature Flag Architecture — Store-Level Feature Toggles

> ## ⚠️ Corrections — verified against source 2026-08-16
>
> **The design in this document is accurate and still describes what's built.** The *file paths and code listings* have drifted. Trust §1, §2, §5 (the playbook), §6, and §7. Verify §3 (file tree), §4 (code listings), and §9 (file status table) against source, applying these corrections:
>
> | This doc says | Actual |
> |---|---|
> | migration `016_store_feature_flags.sql` | **`017_store_feature_flags.sql`** (`016` is `016_transaction_unique_number.sql`) |
> | `src/components/FeatureFlagGuard.tsx` (§3) | **`src/lib/auth/featureGuard.tsx`** (§4.4 has this right; §3 does not) |
> | `src/app/api/admin/stores/[id]/features/route.ts` | **`src/app/api/admin/stores/features/route.ts`** |
> | `PATCH /api/admin/stores/{id}/features` | **`GET`/`PATCH /api/admin/stores/features?store_id=…`** — query param, not a path segment |
> | `src/app/pos/settings/features/page.tsx` (§3) | Does not exist |
> | `FEATURES` has 6 keys | **8 keys** — the doc omits `desktop_shortcuts` and `cash_register` |
> | preset `product_discount: true` | **`false`** (`src/lib/features.ts:100`) |
> | the `useFeatureFlags` listing | The real hook also uses `mergeFeaturesWithDefaults()` and `connectivity.isOnline` |
>
> `src/lib/features.ts` is the authoritative registry. See also `CLAUDE.md` §7.

> **Purpose**: This document defines the architecture for a store-level feature flagging system. All new features added to this codebase must be registered in the feature bank and gated behind feature flags. The admin manages which features are enabled per store via the admin panel.
>
> **Audience**: AI agents, developers, and maintainers adding features to TableMind POS.

---

## 1. Overview

TableMind POS is a multi-tenant PWA serving different types of stores. This document describes a **store-level feature flag system** that allows the admin to enable/disable features per store.

### Two Layers of Control

| Layer | Purpose | Who Controls | Storage |
|-------|---------|-------------|---------|
| **Store-level flags** | Whether a feature exists for a store at all | Admin (via admin panel) | `stores.features` JSONB column |
| **Employee-level permissions** | Which employees can access enabled features | Admin (existing system) | `store_users.permissions` JSONB column |

**Rule**: Store-level flags are the gate. If a feature is disabled at the store level, it does not exist. Employee permissions then control who within that store can use it.

---

## 2. Core Concepts

### 2.1 Feature Definitions

All features are defined in a central registry: `src/lib/features.ts`. Each feature has:

```typescript
interface FeatureDefinition {
  key: string;                    // Unique identifier (e.g., "product_discount")
  label: string;                  // Human-readable name (e.g., "Product Discount %")
  description: string;            // What it does
  category: FeatureCategory;      // "core"
  default: boolean;               // Default state for new stores
  dependencies?: string[];        // Other features this requires
}
```

**Current categories**:
- `core` — Universal features every store needs (POS, inventory, transactions, receipts, product_discount)

### 2.2 Feature Presets

Presets are pre-configured bundles of features for common store types. They solve the "testing pieces together" problem by providing known-good combinations.

```typescript
interface FeaturePreset {
  key: string;                    // e.g., "general"
  name: string;                   // e.g., "General Store"
  description: string;            // e.g., "Standard features for all stores"
  features: Record<string, boolean>;  // Feature key -> enabled/disabled
}
```

Available presets:
- `general` — Standard features for all stores

**When a new store is created**, the admin selects a preset. The preset's feature configuration is stored in `stores.features`.

### 2.3 Feature Flags Storage

Feature flags are stored as a JSONB column on the `stores` table:

```sql
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'general';
```

Example `features` value:
```json
{
  "pos": true,
  "inventory": true,
  "transactions": true,
  "receipts": true,
  "product_discount": true
}
```

The `store_type` column stores the preset key (e.g., `"general"`) for reference.

---

## 3. File Structure

```
src/
├── lib/
│   ├── features.ts              # Feature definitions, presets, types
│   └── auth/
│       ├── permissions.ts       # Existing employee-level permissions (SECTIONS)
│       └── featureGuard.ts      # FeatureFlagGuard component (mirrors PermissionGuard)
├── hooks/
│   ├── useFeatureFlags.ts       # Hook to read/check feature flags
│   └── useOnlineStatus.ts       # Existing (keep as-is)
├── components/
│   ├── FeatureFlagGuard.tsx     # Wraps content, shows fallback if feature disabled
│   └── ui/                      # Existing shadcn/ui components
├── app/
│   ├── admin/
│   │   ├── page.tsx             # Modified: add feature toggle UI per store
│   │   └── store-users/         # Existing (keep as-is)
│   ├── pos/
│   │   ├── page.tsx             # Modified: wrap feature-specific buttons in guards
│   │   └── settings/
│   │       └── features/
│   │           └── page.tsx     # Admin-only: view store's feature configuration
│   └── api/
│       ├── admin/
│       │   └── stores/
│       │       └── features/
│       │           └── route.ts # New: feature flag API for stores
│       └── ...                  # Existing API routes
supabase/
└── migrations/
    └── 016_store_feature_flags.sql  # New: adds features JSONB column to stores
src/
├── components/
│   ├── TransactionAnalytics.tsx    # New: analytics dashboard component
│   └── charts/
│       └── TransactionCharts.tsx   # New: recharts visualizations
└── app/
    └── api/
        └── transactions/
            └── analytics/
                └── route.ts        # New: analytics aggregations API
```

---

## 4. Implementation Guide

### 4.1 Step 1: Create Feature Definitions

**File**: `src/lib/features.ts`

```typescript
// =============================================
// Feature Flag Definitions — Central Registry
// =============================================
// When adding a new feature:
// 1. Add it to FEATURES below with a unique key
// 2. Add it to the appropriate preset(s) in FEATURE_PRESETS
// 3. Wrap the feature's UI in <FeatureFlagGuard feature="your_key">
// 4. Add unit tests for the feature module

export type FeatureCategory = "core" | "fashion" | "retail" | "premium";

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  category: FeatureCategory;
  default: boolean;
  dependencies?: string[];
}

export const FEATURES: Record<string, FeatureDefinition> = {
  pos: {
    key: "pos",
    label: "Point of Sale",
    description: "Ring up sales and manage cart",
    category: "core",
    default: true,
  },
  inventory: {
    key: "inventory",
    label: "Inventory Management",
    description: "View and manage products, prices, stock",
    category: "core",
    default: true,
  },
  transactions: {
    key: "transactions",
    label: "Transaction History",
    description: "View past sales and receipts",
    category: "core",
    default: true,
  },
  receipts: {
    key: "receipts",
    label: "View Receipts",
    description: "Access individual transaction receipts",
    category: "core",
    default: true,
  },
  product_discount: {
    key: "product_discount",
    label: "Product Discount %",
    description: "Set percentage discounts per product (applied at POS)",
    category: "core",
    default: true,
  },
  transaction_analytics: {
    key: "transaction_analytics",
    label: "Transaction Analytics",
    description: "Dashboard with PnL, revenue, and audit metrics",
    category: "core",
    default: false,
  },
};

export type FeatureKey = keyof typeof FEATURES;

export interface FeaturePreset {
  key: string;
  name: string;
  description: string;
  features: Record<string, boolean>;
}

export const FEATURE_PRESETS: Record<string, FeaturePreset> = {
  general: {
    key: "general",
    name: "General Store",
    description: "Standard features for all stores",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: true,
      transaction_analytics: false,
    },
  },
};

/**
 * Get default feature flags for a given preset
 */
export function getDefaultFeaturesForPreset(presetKey: string): Record<string, boolean> {
  const preset = FEATURE_PRESETS[presetKey];
  if (preset) return { ...preset.features };
  return { ...FEATURE_PRESETS.general.features };
}

/**
 * Get all features that are enabled in a flags object
 */
export function getEnabledFeatures(flags: Record<string, boolean>): string[] {
  return Object.entries(flags)
    .filter(([_, enabled]) => enabled === true)
    .map(([key]) => key);
}
```

### 4.2 Step 2: Database Migration

**File**: `supabase/migrations/016_store_feature_flags.sql`

```sql
-- Store-Level Feature Flags
-- Adds per-store feature toggle support

-- ============================================================================
-- ADD COLUMNS TO STORES TABLE
-- ============================================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'general';

COMMENT ON COLUMN stores.features IS 'Feature flags for this store';
COMMENT ON COLUMN stores.store_type IS 'Store type preset: general';

-- ============================================================================
-- INDEX FOR QUERYING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_stores_features_gin ON stores USING GIN (features);
CREATE INDEX IF NOT EXISTS idx_stores_type ON stores(store_type);

-- ============================================================================
-- HELPER FUNCTION: Get store feature flags
-- ============================================================================

CREATE OR REPLACE FUNCTION get_store_features(p_store_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_features JSONB;
BEGIN
  SELECT features INTO v_features
  FROM stores
  WHERE id = p_store_id;

  IF v_features IS NULL THEN
    RETURN '{}'::JSONB;
  END IF;

  RETURN v_features;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_store_features(UUID) TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: Check if a feature is enabled for a store
-- ============================================================================

CREATE OR REPLACE FUNCTION is_feature_enabled(p_store_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT (features->>p_feature_key)::BOOLEAN INTO v_enabled
  FROM stores
  WHERE id = p_store_id;

  RETURN COALESCE(v_enabled, FALSE);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION is_feature_enabled(UUID, TEXT) TO authenticated;
```

### 4.3 Step 3: Create `useFeatureFlags` Hook

**File**: `src/hooks/useFeatureFlags.ts`

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { getDefaultFeaturesForPreset } from "@/lib/features";

interface FeatureFlagsState {
  flags: Record<string, boolean>;
  storeType: string;
  isLoading: boolean;
}

export function useFeatureFlags(): {
  isEnabled: (featureKey: string) => boolean;
  isDisabled: (featureKey: string) => boolean;
  flags: Record<string, boolean>;
  storeType: string;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const [state, setState] = useState<FeatureFlagsState>({
    flags: {},
    storeType: "general",
    isLoading: true,
  });

  const storeId = user?.storeId;

  const loadFromCache = useCallback(() => {
    if (!storeId) return null;
    try {
      const cached = localStorage.getItem(`store_features_${storeId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          flags: parsed.flags || {},
          storeType: parsed.storeType || "general",
        };
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }, [storeId]);

  const loadFromDb = useCallback(async () => {
    if (!storeId || !navigator.onLine) return null;
    try {
      const response = await fetch(`/api/admin/stores/${storeId}/features`);
      if (!response.ok) return null;

      const data = await response.json();
      const flags = data.features || {};
      const storeType = data.store_type || "general";

      localStorage.setItem(
        `store_features_${storeId}`,
        JSON.stringify({ flags, storeType })
      );

      return { flags, storeType };
    } catch {
      return null;
    }
  }, [storeId]);

  useEffect(() => {
    if (!storeId) {
      setState({ flags: {}, storeType: "general", isLoading: false });
      return;
    }

    const cached = loadFromCache();
    if (cached) {
      setState({ flags: cached.flags, storeType: cached.storeType, isLoading: false });
    } else {
      const defaults = getDefaultFeaturesForPreset("general");
      setState({ flags: defaults, storeType: "general", isLoading: false });
    }

    loadFromDb().then((dbData) => {
      if (dbData) {
        setState((prev) => ({
          ...prev,
          flags: dbData.flags,
          storeType: dbData.storeType,
        }));
      }
    });
  }, [storeId, loadFromCache, loadFromDb]);

  const isEnabled = useCallback(
    (featureKey: string): boolean => state.flags[featureKey] === true,
    [state.flags]
  );

  const isDisabled = useCallback(
    (featureKey: string): boolean => !isEnabled(featureKey),
    [isEnabled]
  );

  const refresh = useCallback(async () => {
    const dbData = await loadFromDb();
    if (dbData) {
      setState({ flags: dbData.flags, storeType: dbData.storeType, isLoading: false });
    }
  }, [loadFromDb]);

  return {
    isEnabled,
    isDisabled,
    flags: state.flags,
    storeType: state.storeType,
    isLoading: state.isLoading,
    refresh,
  };
}
```

### 4.4 Step 4: Create `FeatureFlagGuard` Component

**File**: `src/lib/auth/featureGuard.tsx`

```tsx
"use client";

import React from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

interface FeatureFlagGuardProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureFlagGuard({
  feature,
  children,
  fallback,
}: FeatureFlagGuardProps) {
  const { isEnabled } = useFeatureFlags();

  if (!isEnabled(feature)) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return null;
  }

  return <>{children}</>;
}

export function useFeatureFlag(feature: string): boolean {
  const { isEnabled } = useFeatureFlags();
  return isEnabled(feature);
}
```

### 4.5 Step 5: Modify Admin Panel — Add Feature Toggles

**File**: `src/app/admin/page.tsx` (modify existing)

Add a "Features" button next to each store. When clicked, opens a dialog showing:
1. The store's current preset
2. A list of all features with toggle switches
3. Save button to persist changes to `stores.features`

**New API endpoint**: `PATCH /api/admin/stores/{id}/features`
- Body: `{ store_type: "general", features: { "product_discount": true, ... } }`
- Updates `stores.features` and `stores.store_type` columns

### 4.6 Step 6: Modify Store Creation — Select Preset

**File**: `src/app/admin/page.tsx` (modify existing store creation dialog)

Add a "Store Type" dropdown to the "Create New Store" dialog. When creating the store, apply the preset's features:

```typescript
const features = getDefaultFeaturesForPreset(storeType);
const { data, error } = await supabase
  .from("stores")
  .insert({
    username: storeUsername,
    password_hash: storePassword,
    license_expires_at: new Date(licenseDate).toISOString(),
    store_type: storeType,
    features: features,
  })
  .select()
  .single();
```

### 4.7 Step 7: Modify POS Page — Wrap Feature-Specific UI

**File**: `src/app/pos/page.tsx` (modify existing)

Wrap any feature-specific buttons/components in `FeatureFlagGuard`:

```tsx
import { FeatureFlagGuard } from "@/lib/auth/featureGuard";

<FeatureFlagGuard feature="transactions">
  <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>
    <History className="h-4 w-4 mr-1" />
    History
  </Button>
</FeatureFlagGuard>
```

---

## 5. Future Feature Addition Playbook

Use this exact checklist when adding any new feature in the future:

1. **Register in `src/lib/features.ts`**:
   ```typescript
   new_feature: {
     key: "new_feature",
     label: "New Feature",
     description: "What it does",
     category: "core",
     default: false,
   },
   ```

2. **Add to preset(s) in `FEATURE_PRESETS`**:
   ```typescript
   general: {
     features: {
       ...
       new_feature: true,
     },
   },
   ```

3. **Create the feature component/module** under `src/components/` or `src/app/...`

4. **Wrap UI in `<FeatureFlagGuard feature="new_feature">`** wherever it renders

5. **Guard API routes** if the feature needs backend logic:
   ```typescript
   if (!(await checkFeature(storeId, "new_feature"))) {
     return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });
   }
   ```

6. **Add tests** for the feature module

7. **Never reference removed features** — if you see `size_variants`, `bulk_scanning`, etc. in old docs or code, treat them as deleted and do not reintroduce them without explicit user request

---

## 6. Key Design Decisions

1. **JSONB column on `stores`** (not a separate table) — matches your existing pattern with `store_users.permissions`. Simpler queries, already have the infrastructure.

2. **Presets over manual configuration** — eliminates combinatorial explosion. Admin picks a preset, then can fine-tune individual toggles.

3. **Features default to OFF** — new features are safe to deploy. Enable per-store when ready.

4. **Offline-first loading** — flags load from localStorage instantly, sync from DB in background. Critical for PWA use case.

5. **Admin-managed** — only the admin can toggle features per store.

6. **Mirror existing patterns** — `FeatureFlagGuard` mirrors `PermissionGuard`, `features.ts` mirrors `permissions.ts`.

7. **Feature flags are store-level gates, not employee permissions** — if a feature is off for a store, no one in that store can access it.

---

## 7. Quick Reference for AI Agents

### Adding a new feature:
1. Add to `FEATURES` in `src/lib/features.ts`
2. Add to preset(s) in `FEATURE_PRESETS`
3. Create feature component
4. Wrap in `<FeatureFlagGuard feature="key">`
5. Add tests

### Checking if a feature is enabled (in component):
```tsx
const { isEnabled } = useFeatureFlags();
if (isEnabled('product_discount')) { ... }
```

### Checking if a feature is enabled (inline):
```tsx
const hasFeature = useFeatureFlag('product_discount');
```

### Guarding a component:
```tsx
<FeatureFlagGuard feature="product_discount" fallback={<Button disabled>Discounts</Button>}>
  <DiscountButton />
</FeatureFlagGuard>
```

### Toggling a feature for a store (admin):
- Use the admin panel's "Features" dialog
- Or call `PATCH /api/admin/stores/{id}/features`

---

## 8. Migration Path for Existing Stores

When this system is first deployed:

1. Run migration `016_store_feature_flags.sql` — adds `features` and `store_type` columns with defaults (`{}` and `"general"`)
2. Backfill existing stores: set `store_type` based on their characteristics, populate `features` from the `general` preset
3. Existing stores continue to work with the `general` preset (core features only)

---

## 9. File Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/features.ts` | Feature definitions, presets, types | **Implemented** |
| `src/hooks/useFeatureFlags.ts` | Hook to read/check flags | **Implemented** |
| `src/lib/auth/featureGuard.tsx` | FeatureFlagGuard component | **Implemented** |
| `supabase/migrations/016_store_feature_flags.sql` | DB migration | **Implemented** |
| `src/app/admin/page.tsx` | Modified: add feature toggle UI | **Implemented** |
| `src/app/api/admin/stores/[id]/features/route.ts` | API for feature management | **Implemented** |
| `src/app/pos/page.tsx` | Modified: wrap feature-specific UI | **Implemented** |
| `src/components/TransactionAnalytics.tsx` | Transaction analytics dashboard | **Implemented** |
| `src/components/charts/TransactionCharts.tsx` | Recharts visualizations | **Implemented** |
| `src/app/api/transactions/analytics/route.ts` | Analytics aggregations API | **Implemented** |
| `src/components/ui/tabs.tsx` | Tabs UI for analytics/list toggle | **Implemented** |

---

## 10. Glossary

- **Feature**: A discrete piece of functionality (e.g., "product_discount")
- **Feature Flag**: A boolean toggle that controls whether a feature is enabled for a store
- **Preset**: A pre-configured bundle of feature flags for a store type
- **Store-level flag**: Controls whether a feature exists for a store at all
- **Employee-level permission**: Controls which employees can access an enabled feature (existing system)
- **Feature Guard**: A component that wraps content and only renders it if the feature is enabled