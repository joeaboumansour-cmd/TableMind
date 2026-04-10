// Cart types for GoldenSquirrel Mobile POS

import { Product } from './product';

export interface CartItem {
  product_id: string;
  product_name: string;
  barcode: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_price_usd: number;
  total_price_usd: number;
  stock_quantity: number;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  total_amount: number;
  item_count: number;
}

export interface CartState {
  items: CartItem[];
  store_id: string | null;
}

export interface CartActions {
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  incrementQuantity: (productId: string) => boolean;
  decrementQuantity: (productId: string) => void;
  clearCart: () => void;
  setStoreId: (storeId: string) => void;
  getSubtotal: () => number;
  getSubtotalUsd: () => number;
  getTotal: () => number;
  getTotalUsd: () => number;
  getItemCount: () => number;
  isEmpty: () => boolean;
}

export type CartStore = CartState & CartActions;

export interface AddToCartOptions {
  quantity?: number;
  playSound?: boolean;
}

export interface CartSummary {
  subtotal: number;
  total_amount: number;
  item_count: number;
  items: CartItem[];
}