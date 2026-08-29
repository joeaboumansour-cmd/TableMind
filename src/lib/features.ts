// =============================================
// Feature Flag Definitions — Central Registry
// =============================================
// When adding a new feature:
// 1. Add it to FEATURES below with a unique key
// 2. Add it to EVERY preset in FEATURE_PRESETS (see the note there — an omitted
//    key does not mean "off", it means "whatever FEATURES says", which makes a
//    preset silently mean something other than what it looks like)
// 3. Wrap the UI in <FeatureFlagGuard feature="your_key">
//
// NOTE ON STORE TYPES: `stores.store_type` is a PROVISIONING LABEL — it records
// which preset an admin picked. Nothing reads it at runtime and nothing should.
// All behaviour gates on the flags below, because mergeFeaturesWithDefaults()
// back-fills a new key for every existing store with no data migration, while
// store_type would leave every live store on 'general' until touched by hand.
// A store is also allowed to be a mix (a pharmacy with a coffee counter), which
// a type switch cannot express and flags can.

export type FeatureCategory = "core" | "fashion" | "retail" | "food" | "premium";

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  category: FeatureCategory;
  /**
   * Value used for any store whose `features` JSONB has no entry for this key.
   * Keep it in step with what the presets say — see the drift warning below.
   */
  default: boolean;
  /**
   * Documentation only. NOTHING enforces this: check both keys defensively at
   * the call site, e.g. isEnabled("menu_items") && isEnabled("recipe_stock_depletion").
   */
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
  desktop_shortcuts: {
    key: "desktop_shortcuts",
    label: "Desktop Shortcuts",
    description: "Quick-access buttons for products without barcodes + frequently used items on desktop POS (replaces camera view)",
    category: "retail",
    default: true,
  },
  cash_register: {
    key: "cash_register",
    label: "Cash Register",
    description: "Daily cash shift tracking: opening float, sales, adjustments, and end-of-day reconciliation",
    category: "core",
    default: false,
  },
  // The kill switch for the admin activity trail. Defaults ON, because the
  // whole point is fleet-wide coverage — but the trail is high volume, so a
  // store can be taken out of it from the admin feature dialog without a
  // deploy if it ever costs more than it is worth.
  activity_logging: {
    key: "activity_logging",
    label: "Activity Logging",
    description: "Record store actions to the admin activity trail (kept 3 days)",
    category: "core",
    default: true,
  },

  // === Categories and made-to-order ===
  product_categories: {
    key: "product_categories",
    label: "Product Categories",
    description: "Group products into categories: a category rail on the till and a category column in inventory",
    category: "retail",
    default: false,
  },
  menu_items: {
    key: "menu_items",
    label: "Menu Items & Modifiers",
    description: "Build products from a recipe of ingredients, and let the cashier change a line at the counter (no pickles, extra cheese)",
    category: "food",
    default: false,
    dependencies: ["product_categories"],
  },
  // Deliberately separate from menu_items: this is the only half of the feature
  // that MUTATES STOCK, and it needs a per-store kill switch that does not take
  // the menu down with it.
  recipe_stock_depletion: {
    key: "recipe_stock_depletion",
    label: "Ingredient Stock Depletion",
    description: "Selling a menu item deducts its recipe components from stock instead of the menu item itself",
    category: "food",
    default: true,
    dependencies: ["menu_items"],
  },
  kitchen_display: {
    key: "kitchen_display",
    label: "Kitchen Display",
    description: "A kitchen screen showing paid orders and their preparation progress",
    category: "food",
    default: false,
    dependencies: ["menu_items"],
  },
};

export type FeatureKey = keyof typeof FEATURES;

export interface FeaturePreset {
  key: string;
  name: string;
  description: string;
  features: Record<string, boolean>;
}

/**
 * Provisioning bundles. `handlePresetChange` in the admin console OVERWRITES the
 * whole flags object from the preset it is given, so every preset must enumerate
 * EVERY key in FEATURES. An omitted key is not "off" — it falls through to
 * FEATURES[key].default at read time, which makes the preset mean something
 * other than what it looks like here.
 *
 * KNOWN DRIFT, not fixed here: `general.product_discount` is false while
 * FEATURES.product_discount.default is true. A store provisioned from the preset
 * gets discounts off; a store with no stored flags at all gets them on. Changing
 * it changes what new stores get, so it belongs in its own commit.
 */
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
      product_discount: false,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: false,
      activity_logging: true,
      product_categories: false,
      menu_items: false,
      recipe_stock_depletion: false,
      kitchen_display: false,
    },
  },
  retail: {
    key: "retail",
    name: "Retail Store",
    description: "Barcode-driven selling with discounts and categories",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: true,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: false,
      activity_logging: true,
      product_categories: true,
      menu_items: false,
      recipe_stock_depletion: false,
      kitchen_display: false,
    },
  },
  pharmacy: {
    key: "pharmacy",
    name: "Pharmacy",
    description: "Barcode-driven selling organised by aisle. No recipes.",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: true,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: true,
      activity_logging: true,
      product_categories: true,
      menu_items: false,
      recipe_stock_depletion: false,
      kitchen_display: false,
    },
  },
  bakery: {
    key: "bakery",
    name: "Bakery",
    description: "Counter service with recipes and ingredient stock. No kitchen screen — the counter is the kitchen.",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: false,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: true,
      activity_logging: true,
      product_categories: true,
      menu_items: true,
      recipe_stock_depletion: true,
      kitchen_display: false,
    },
  },
  coffee_shop: {
    key: "coffee_shop",
    name: "Coffee Shop",
    description: "Made-to-order drinks with modifiers, ingredient stock, and a kitchen screen",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: false,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: true,
      activity_logging: true,
      product_categories: true,
      menu_items: true,
      recipe_stock_depletion: true,
      kitchen_display: true,
    },
  },
  snack: {
    key: "snack",
    name: "Snack Shop",
    description: "Made-to-order food with modifiers, ingredient stock, and a kitchen screen",
    features: {
      pos: true,
      inventory: true,
      transactions: true,
      receipts: true,
      product_discount: false,
      transaction_analytics: false,
      desktop_shortcuts: true,
      cash_register: true,
      activity_logging: true,
      product_categories: true,
      menu_items: true,
      recipe_stock_depletion: true,
      kitchen_display: true,
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
