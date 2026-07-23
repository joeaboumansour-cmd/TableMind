# Feature Flag Architecture — Store-Level Feature Toggles

> **Purpose**: This document defines the architecture for a store-level feature flagging system. All new features added to this codebase must be registered in the feature bank and gated behind feature flags. The admin manages which features are enabled per store via the admin panel.
>
> **Audience**: AI agents, developers, and maintainers adding features to TableMind POS.

---

## 1. Overview

TableMind POS is a multi-tenant PWA serving different types of stores (retail, fashion boutiques, general stores). Different store types need different features. This document describes a **tiered feature flag system** that allows the admin to enable/disable features per store, with presets for common store types.

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
  key: string;                    // Unique identifier (e.g., "size_variants")
  label: string;                  // Human-readable name (e.g., "Size Variants")
  description: string;            // What it does
  category: FeatureCategory;      // "core" | "fashion" | "retail" | "premium"
  default: boolean;               // Default state for new stores
  dependencies?: string[];        // Other features this requires
}
```

**Categories**:
- `core` — Universal features every store needs (POS, inventory, transactions)
- `fashion` — Features specific to fashion stores (size variants, seasonal collections, lookbook)
- `retail` — Features specific to retail stores (wholesale pricing, bulk scanning)
- `premium` — Advanced features (AI reports, e-commerce sync)

### 2.2 Feature Presets

Presets are pre-configured bundles of features for common store types. They solve the "testing pieces together" problem by providing known-good combinations.

```typescript
interface FeaturePreset {
  key: string;                    // e.g., "fashion"
  name: string;                   // e.g., "Fashion Boutique"
  description: string;            // e.g., "Fashion-focused with size/color variants"
  features: Record<string, boolean>;  // Feature key -> enabled/disabled
}
```

Available presets:
- `retail` — Standard retail with bulk scanning and wholesale pricing
- `fashion` — Fashion boutique with size/color variants, seasonal collections, lookbook
- `general` — Minimal feature set for small general stores

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
  "size_variants": true,
  "color_variants": true,
  "seasonal_collections": false,
  "lookbook_view": true,
  "wholesale_pricing": false,
  "bulk_scanning": false
}
```

The `store_type` column stores the preset key (e.g., `"fashion"`) for reference.

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
│       │       └── route.ts     # Modified: add feature flag update endpoints
│       └── ...                  # Existing API routes
supabase/
└── migrations/
    └── 016_store_feature_flags.sql  # New: adds features JSONB column to stores
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
  // === Core (universal) ===
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

  // === Fashion-specific ===
  size_variants: {
    key: "size_variants",
    label: "Size Variants",
    description: "Track inventory by clothing sizes (S/M/L, numeric sizes)",
    category: "fashion",
    default: false,
  },
  color_variants: {
    key: "color_variants",
    label: "Color Variants",
    description: "Track inventory by color",
    category: "fashion",
    default: false,
  },
  seasonal_collections: {
    key: "seasonal_collections",
    label: "Seasonal Collections",
    description: "Group products by season (Spring/Summer, Fall/Winter)",
    category: "fashion",
    default: false,
  },
  lookbook_view: {
    key: "lookbook_view",
    label: "Lookbook View",
    description: "Visual product showcase for fashion items",
    category: "fashion",
    default: false,
  },

  // === Retail-specific ===
  wholesale_pricing: {
    key: "wholesale_pricing",
    label: "Wholesale Pricing",
    description: "Tiered pricing for bulk orders",
    category: "retail",
    default: false,
  },
  bulk_scanning: {
    key: "bulk_scanning",
    label: "Bulk Scanning",
    description: "Scan multiple items at once for faster checkout",
    category: "retail",
    default: false,
  },

  // === Premium ===
  advanced_reports: {
    key: "advanced_reports",
    label: "Advanced Reports",
    description: "AI-powered insights and sales forecasting",
    category: "premium",
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
    description: "Minimal feature set for small shops",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      size_variants: false,
      color_variants: false,
      seasonal_collections: false,
      lookbook_view: false,
      wholesale_pricing: false,
      bulk_scanning: false,
      advanced_reports: false,
    },
  },
  retail: {
    key: "retail",
    name: "Retail Store",
    description: "Standard retail with bulk scanning and wholesale pricing",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      size_variants: false,
      color_variants: false,
      seasonal_collections: false,
      lookbook_view: false,
      wholesale_pricing: true,
      bulk_scanning: true,
      advanced_reports: false,
    },
  },
  fashion: {
    key: "fashion",
    name: "Fashion Boutique",
    description: "Fashion-focused with size/color variants and lookbook",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      size_variants: true,
      color_variants: true,
      seasonal_collections: true,
      lookbook_view: true,
      wholesale_pricing: false,
      bulk_scanning: false,
      advanced_reports: false,
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

COMMENT ON COLUMN stores.features IS 'Feature flags for this store (e.g., {"size_variants": true})';
COMMENT ON COLUMN stores.store_type IS 'Store type preset: retail, fashion, general';

-- ============================================================================
-- INDEX FOR QUERYING
-- ============================================================================

-- GIN index for efficient JSONB feature queries
CREATE INDEX IF NOT EXISTS idx_stores_features_gin ON stores USING GIN (features);

-- Index for filtering by store type
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

/**
 * Hook to read and check store-level feature flags.
 *
 * Loads flags from localStorage first (instant, offline-capable),
 * then syncs from the database in the background.
 *
 * Usage:
 *   const { isEnabled, isDisabled } = useFeatureFlags();
 *   if (isEnabled('size_variants')) { ... }
 */
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

  // Load from localStorage (offline-first)
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

  // Load from database (online sync)
  const loadFromDb = useCallback(async () => {
    if (!storeId || !navigator.onLine) return null;

    try {
      const response = await fetch(`/api/admin/stores/${storeId}/features`);
      if (!response.ok) return null;

      const data = await response.json();
      const flags = data.features || {};
      const storeType = data.store_type || "general";

      // Cache to localStorage
      localStorage.setItem(
        `store_features_${storeId}`,
        JSON.stringify({ flags, storeType })
      );

      return { flags, storeType };
    } catch {
      return null;
    }
  }, [storeId]);

  // Initialize
  useEffect(() => {
    if (!storeId) {
      setState({ flags: {}, storeType: "general", isLoading: false });
      return;
    }

    // 1. Load from cache immediately
    const cached = loadFromCache();
    if (cached) {
      setState({ flags: cached.flags, storeType: cached.storeType, isLoading: false });
    } else {
      // 2. No cache — use preset defaults
      const defaults = getDefaultFeaturesForPreset("general");
      setState({ flags: defaults, storeType: "general", isLoading: false });
    }

    // 3. Sync from database in background
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
    (featureKey: string): boolean => {
      return state.flags[featureKey] === true;
    },
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

/**
 * Wraps content that requires a specific store-level feature flag.
 * If the feature is disabled for the current store, shows fallback or null.
 *
 * This is the store-level gate. Employee-level permissions are handled
 * by the existing PermissionGuard.
 *
 * Usage:
 *   <FeatureFlagGuard feature="size_variants">
 *     <SizeVariantSelector />
 *   </FeatureFlagGuard>
 *
 *   <FeatureFlagGuard
 *     feature="bulk_scanning"
 *     fallback={<Button disabled>Bulk Scan (upgrade required)</Button>}
 *   >
 *     <Button onClick={handleBulkScan}>Bulk Scan</Button>
 *   </FeatureFlagGuard>
 */
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

/**
 * Hook version for inline checks
 */
export function useFeatureFlag(feature: string): boolean {
  const { isEnabled } = useFeatureFlags();
  return isEnabled(feature);
}
```

### 4.5 Step 5: Modify Admin Panel — Add Feature Toggles

**File**: `src/app/admin/page.tsx` (modify existing)

Add a "Features" button next to each store (next to the existing "Employees" button). When clicked, opens a dialog showing:

1. The store's current preset (dropdown to change: General, Retail, Fashion)
2. A list of all features with toggle switches (mirroring the existing employee permission toggle UI)
3. Save button to persist changes to `stores.features`

The dialog reuses the existing `Switch` component and `SECTION_KEYS` pattern from the employee management section.

**New API endpoint**: `PATCH /api/admin/stores/{id}/features`
- Body: `{ store_type: "fashion", features: { "size_variants": true, ... } }`
- Updates `stores.features` and `stores.store_type` columns

### 4.6 Step 6: Modify Store Creation — Select Preset

**File**: `src/app/admin/page.tsx` (modify existing store creation dialog)

Add a "Store Type" dropdown to the "Create New Store" dialog:

```tsx
<Select value={storeType} onValueChange={setStoreType}>
  <SelectTrigger>
    <SelectValue placeholder="Select store type" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="general">General Store</SelectItem>
    <SelectItem value="retail">Retail Store</SelectItem>
    <SelectItem value="fashion">Fashion Boutique</SelectItem>
  </SelectContent>
</Select>
```

When creating the store, apply the preset's features:

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

// In the POS header:
<FeatureFlagGuard feature="transactions">
  <Button variant="ghost" size="sm" onClick={() => router.push("/transactions")}>
    <History className="h-4 w-4 mr-1" />
    History
  </Button>
</FeatureFlagGuard>

// New feature-specific buttons:
<FeatureFlagGuard feature="bulk_scanning">
  <Button variant="ghost" size="sm" onClick={handleBulkScan}>
    <Scan className="h-4 w-4 mr-1" />
    Bulk Scan
  </Button>
</FeatureFlagGuard>
```

### 4.8 Step 8: New Feature Implementation Pattern

When adding a **new feature** (e.g., "size_variants"):

1. **Register the feature** in `src/lib/features.ts`:
   ```typescript
   size_variants: {
     key: "size_variants",
     label: "Size Variants",
     description: "Track inventory by clothing sizes",
     category: "fashion",
     default: false,
   },
   ```

2. **Add to presets** in `FEATURE_PRESETS`:
   ```typescript
   fashion: {
     ...
     features: {
       ...
       size_variants: true,  // Enable for fashion stores
     },
   },
   ```

3. **Create the feature component**:
   ```tsx
   // src/components/pos/SizeVariantSelector.tsx
   export function SizeVariantSelector({ product }: { product: Product }) {
     // Feature-specific UI
   }
   ```

4. **Wrap in FeatureFlagGuard** wherever it's used:
   ```tsx
   <FeatureFlagGuard feature="size_variants">
     <SizeVariantSelector product={product} />
   </FeatureFlagGuard>
   ```

5. **Guard API routes** (if the feature has backend logic):
   ```typescript
   // In API route
   import { isFeatureEnabled } from "@/lib/features";
   if (!(await checkFeature(storeId, "size_variants"))) {
     return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });
   }
   ```

6. **Add tests** for the feature module.

---

## 5. Testing Strategy

### 5.1 Unit Testing
Each feature module is tested in isolation:
- Test the feature component renders correctly
- Test the feature's business logic
- Test with the feature flag enabled and disabled

### 5.2 Preset Testing
Each preset is a known-good combination. Test:
- All features in the preset work together
- No conflicts between features in the same preset

### 5.3 Integration Testing
Test feature interactions only between features that appear in the same preset:
- Fashion preset: `size_variants` + `color_variants` + `seasonal_collections` + `lookbook_view`
- Retail preset: `wholesale_pricing` + `bulk_scanning`

### 5.4 Rollout Strategy
- New features default to `false` (off)
- Enable for one store first (canary deployment)
- Monitor for issues
- Expand to more stores

---

## 6. Key Design Decisions

1. **JSONB column on `stores`** (not a separate table) — matches your existing pattern with `store_users.permissions`. Simpler queries, already have the infrastructure.

2. **Presets over manual configuration** — eliminates combinatorial explosion. Admin picks a preset, then can fine-tune individual toggles.

3. **Features default to OFF** — new features are safe to deploy. Enable per-store when ready.

4. **Offline-first loading** — flags load from localStorage instantly, sync from DB in background. Critical for PWA use case.

5. **Admin-managed** — only the admin can toggle features per store. Store owners cannot modify their own feature set.

6. **Mirror existing patterns** — `FeatureFlagGuard` mirrors `PermissionGuard`, `features.ts` mirrors `permissions.ts`. Minimal learning curve.

7. **Feature flags are store-level gates, not employee permissions** — if a feature is off for a store, no one in that store can access it. Employee permissions (existing `SECTIONS` system) then control who within the store can use enabled features.

---

## 7. Quick Reference for AI Agents

### Adding a new feature:
1. Add to `FEATURES` in `src/lib/features.ts`
2. Add to appropriate preset(s) in `FEATURE_PRESETS`
3. Create feature component
4. Wrap in `<FeatureFlagGuard feature="key">`
5. Add tests

### Checking if a feature is enabled (in component):
```tsx
const { isEnabled } = useFeatureFlags();
if (isEnabled('size_variants')) { ... }
```

### Checking if a feature is enabled (inline):
```tsx
const hasFeature = useFeatureFlag('size_variants');
```

### Guarding a component:
```tsx
<FeatureFlagGuard feature="bulk_scanning" fallback={<Button disabled>Bulk Scan</Button>}>
  <BulkScanButton />
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
4. Admin can then upgrade stores to `retail` or `fashion` presets as needed

---

## 9. File Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/features.ts` | Feature definitions, presets, types | **New** |
| `src/hooks/useFeatureFlags.ts` | Hook to read/check flags | **New** |
| `src/lib/auth/featureGuard.tsx` | FeatureFlagGuard component | **New** |
| `supabase/migrations/016_store_feature_flags.sql` | DB migration | **New** |
| `src/app/admin/page.tsx` | Modified: add feature toggle UI | **Modify** |
| `src/app/api/admin/stores/[id]/features/route.ts` | API for feature management | **New** |
| `src/app/pos/page.tsx` | Modified: wrap feature-specific UI | **Modify** |

---

## 10. Glossary

- **Feature**: A discrete piece of functionality (e.g., "size variants", "bulk scanning")
- **Feature Flag**: A boolean toggle that controls whether a feature is enabled for a store
- **Preset**: A pre-configured bundle of feature flags for a store type (retail, fashion, general)
- **Store-level flag**: Controls whether a feature exists for a store at all
- **Employee-level permission**: Controls which employees can access an enabled feature (existing system)
- **Feature Guard**: A component that wraps content and only renders it if the feature is enabled
