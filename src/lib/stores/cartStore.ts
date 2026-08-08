// Cart store for GoldenSquirrel Mobile POS

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartStore, CartItem } from '@/lib/types/cart';
import { Product } from '@/lib/types/product';
import { convertLlToUsdForReturn, convertUsdToLl, roundToNearest5k } from '@/lib/utils/format';


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
          // If base price is USD, convert to LL using sell rate and round to
          // nearest 5,000 LL (smallest physical bill denomination).
          unitPriceUsd = product.selling_price;
          unitPriceLl = convertUsdToLl(product.selling_price);
        } else {
          // If base price is LL (default), calculate USD using the utility function
          unitPriceLl = product.selling_price;
          unitPriceUsd = convertLlToUsdForReturn(product.selling_price);
        }

        // Calculate discount — round discounted LL price to nearest 5k so that
        // every LL value in the system stays a clean multiple of 5,000.
        const discountPercentage = product.discount_percentage || 0;
        let discountedUnitPriceLl = unitPriceLl;
        let discountedUnitPriceUsd = unitPriceUsd;

        if (discountPercentage > 0) {
          discountedUnitPriceLl = roundToNearest5k(unitPriceLl * (1 - discountPercentage / 100));
          discountedUnitPriceUsd = unitPriceUsd * (1 - discountPercentage / 100);
        }

        const unitPriceDiscountAmount = roundToNearest5k(unitPriceLl - discountedUnitPriceLl);


        // Add new item at the top of the cart
        const newItem: CartItem = {
          product_id: product.id,
          product_name: product.name,
          barcode: product.barcode,
          quantity,
          unit_price: discountedUnitPriceLl,
          total_price: quantity * discountedUnitPriceLl,
          unit_price_usd: discountedUnitPriceUsd,
          total_price_usd: quantity * discountedUnitPriceUsd,
          stock_quantity: product.stock_quantity,
          currency: product.currency || 'LL',
          // Discount fields
          discount_percentage: discountPercentage,
          original_unit_price: unitPriceLl,
          original_total_price: quantity * unitPriceLl,
          original_unit_price_usd: unitPriceUsd,
          original_total_price_usd: quantity * unitPriceUsd,
          unit_price_discount_amount: unitPriceDiscountAmount,
          total_discount_amount: quantity * unitPriceDiscountAmount,
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
                  original_total_price: quantity * item.original_unit_price,
                  original_total_price_usd: quantity * item.original_unit_price_usd,
                  total_discount_amount: quantity * item.unit_price_discount_amount,
                }
              : item
          ),
        });
      },

      incrementQuantity: (productId: string) => {
        const { items } = get();
        const item = items.find(i => i.product_id === productId);
        if (item) {
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

      getTotalDiscount: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.total_discount_amount, 0);
      },

      getTotalDiscountUsd: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + (item.original_total_price_usd - item.total_price_usd), 0);
      },

      getTotalOriginal: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.original_total_price, 0);
      },

      getTotalOriginalUsd: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.original_total_price_usd, 0);
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
            // Add discount fields for backward compatibility with existing cart data
            discount_percentage: item.discount_percentage ?? 0,
            original_unit_price: item.original_unit_price ?? item.unit_price,
            original_total_price: item.original_total_price ?? item.total_price,
            original_unit_price_usd: item.original_unit_price_usd ?? item.unit_price_usd,
            original_total_price_usd: item.original_total_price_usd ?? item.total_price_usd,
            unit_price_discount_amount: item.unit_price_discount_amount ?? 0,
            total_discount_amount: item.total_discount_amount ?? 0,
          }));
        }
        return persistedState as any;
      },
    }
  )
);