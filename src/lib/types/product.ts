// Product types for GoldenSquirrel Mobile POS

export interface Product {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  cost_price_usd: number;
  selling_price_usd: number;
  profit_percentage: number | null;
  stock_quantity: number;
  min_stock_threshold: number;
}

export interface ProductInput {
  name: string;
  barcode?: string;
  cost_price: number;
  selling_price?: number;
  cost_price_usd?: number;
  selling_price_usd?: number;
  profit_percentage?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
}

export interface ProductUpdate {
  name?: string;
  barcode?: string;
  cost_price?: number;
  selling_price?: number;
  cost_price_usd?: number;
  selling_price_usd?: number;
  profit_percentage?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
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