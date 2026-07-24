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

/**
 * Merge stored features with defaults — ensures new features always have a value
 */
export function mergeFeaturesWithDefaults(
  stored: Record<string, boolean> | null | undefined
): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURES)) {
    if (stored && typeof stored[key] === "boolean") {
      merged[key] = stored[key];
    } else {
      merged[key] = FEATURES[key].default;
    }
  }
  return merged;
}