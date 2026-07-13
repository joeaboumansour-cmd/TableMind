// Cart store for GoldenSquirrel Mobile POS

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartStore, CartItem } from '@/lib/types/cart';
import { Product } from '@/lib/types/product';
import { convertLlToUsdForSale, SELL_RATE } from '@/lib/utils/format';

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      // State
      items: [],
      store_id: null,

      // Actions
      addItem: (product: Product, quantity: number = 1) => {
        const { items } = get();
        const existingItem = items.find(item => item.product_id === product.id);

        // Idempotent: scanning the same product must NOT increment quantity.
        // Quantity is only ever increased via the manual "+" button (incrementQuantity).
        // Returns true only if the item was actually added (not already present).
        if (existingItem) {
          return false;
        }

        // Normalize prices based on the currency dropdown value from the DB
        let unitPriceUsd: number;
        let unitPriceLl: number;

        if (product.currency === 'USD') {
          // If base price is USD, calculate LL by multiplying by the SELL_RATE
          unitPriceUsd = product.selling_price;
          unitPriceLl = product.selling_price * SELL_RATE;
        } else {
          // If base price is LL (default), calculate USD using the utility function
          unitPriceLl = product.selling_price;
          unitPriceUsd = convertLlToUsdForSale(product.selling_price);
        }

        // Add new item at the top of the cart
        const newItem: CartItem = {
          product_id: product.id,
          product_name: product.name,
          barcode: product.barcode,
          quantity,
          unit_price: unitPriceLl,
          total_price: quantity * unitPriceLl,
          unit_price_usd: unitPriceUsd,
          total_price_usd: quantity * unitPriceUsd,
          stock_quantity: product.stock_quantity,
          currency: product.currency || 'LL',
        };
        set({ items: [newItem, ...items] });
        return true;
      },

      removeItem: (productId: string) => {
        const { items } = get();
        set({ items: items.filter(item => item.product_id !== productId) });
      },

      updateQuantity: (productId: string, quantity: number) => {
        const { items } = get();
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }

        set({
          items: items.map(item =>
            item.product_id === productId
              ? {
                  ...item,
                  quantity,
                  total_price: quantity * item.unit_price,
                  total_price_usd: quantity * item.unit_price_usd,
                }
              : item
          ),
        });
      },

      incrementQuantity: (productId: string) => {
        const { items } = get();
        const item = items.find(i => i.product_id === productId);
        const maxStock = item?.stock_quantity ?? Infinity;
        if (item && item.quantity < maxStock) {
          get().updateQuantity(productId, item.quantity + 1);
          return true;
        }
        return false;
      },

      decrementQuantity: (productId: string) => {
        const { items } = get();
        const item = items.find(i => i.product_id === productId);
        if (item && item.quantity > 1) {
          get().updateQuantity(productId, item.quantity - 1);
        } else if (item) {
          get().removeItem(productId);
        }
      },

      clearCart: () => {
        set({
          items: [],
        });
      },

      setStoreId: (storeId: string) => {
        set({ store_id: storeId });
      },

      getSubtotal: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.total_price, 0);
      },

      getSubtotalUsd: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.total_price_usd, 0);
      },

      getTotal: () => {
        return get().getSubtotal();
      },

      getTotalUsd: () => {
        return get().getSubtotalUsd();
      },

      getItemCount: () => {
        const { items } = get();
        return items.reduce((count, item) => count + item.quantity, 0);
      },

      isEmpty: () => {
        const { items } = get();
        return items.length === 0;
      },
    }),
    {
      name: 'goldensquirrel-cart',
      partialize: (state) => ({
        items: state.items,
        store_id: state.store_id,
      }),
      migrate: (persistedState: any, version: number) => {
        if (persistedState && persistedState.items) {
          persistedState.items = persistedState.items.map((item: any) => ({
            ...item,
            stock_quantity: item.stock_quantity ?? 9999,
          }));
        }
        return persistedState as any;
      },
    }
  )
);