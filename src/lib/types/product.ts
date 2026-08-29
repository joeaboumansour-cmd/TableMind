// Product types for GoldenSquirrel Mobile POS

export interface Product {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: 'LL' | 'USD';
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  /** product_categories.id, or null/undefined when uncategorised. */
  category_id?: string | null;
  /**
   * 'sellable' (default) or 'ingredient'. Use isSellable() from
   * lib/products/kind.ts to test this — never `=== 'sellable'`.
   */
  kind?: string | null;
  /** The unit stock_quantity is counted in: 'unit', 'g', 'ml', 'piece'… */
  stock_unit?: string | null;
  /**
   * For an ingredient: how much ONE portion is, in its own stock_unit.
   * Hummus at stock_unit 'g' and serving_qty 30 means one scoop is 30 g.
   * Used when an ingredient is added to a line that has no recipe row for it.
   */
  serving_qty?: number | null;
  parent_id?: string;
  variant_name?: string;
}

export interface ProductInput {
  name: string;
  barcode?: string;
  cost_price: number;
  selling_price?: number;
  currency?: 'LL' | 'USD';
  profit_percentage?: number;
  discount_percentage?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
  category_id?: string | null;
  kind?: string | null;
  stock_unit?: string | null;
  serving_qty?: number | null;
}

export interface ProductUpdate {
  name?: string;
  barcode?: string;
  cost_price?: number;
  selling_price?: number;
  currency?: 'LL' | 'USD';
  profit_percentage?: number;
  discount_percentage?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
  category_id?: string | null;
  kind?: string | null;
  stock_unit?: string | null;
  serving_qty?: number | null;
}

export type ProductCategory =
  | 'food'
  | 'beverage'
  | 'alcohol'
  | 'dessert'
  | 'appetizer'
  | 'main_course'
  | 'side'
  | 'condiment'
  | 'other';

export interface ProductFilters {
  search?: string;
}