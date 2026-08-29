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