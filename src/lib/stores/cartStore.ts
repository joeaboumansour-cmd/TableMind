// Cart store for GoldenSquirrel Mobile POS

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartStore, CartItem } from '@/lib/types/cart';
import { Product } from '@/lib/types/product';

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

        if (existingItem) {
          // Update existing item
          set({
            items: items.map(item =>
              item.product_id === product.id
                ? {
                    ...item,
                    quantity: item.quantity + quantity,
                    total_price: (item.quantity + quantity) * item.unit_price,
                  }
                : item
            ),
          });
        } else {
          // Add new item at the top of the cart
          const newItem: CartItem = {
            product_id: product.id,
            product_name: product.name,
            barcode: product.barcode,
            quantity,
            unit_price: product.selling_price,
            total_price: quantity * product.selling_price,
            stock_quantity: product.stock_quantity,
          };
          set({ items: [newItem, ...items] });
        }

        // Play beep sound if enabled
        if (typeof window !== 'undefined') {
          try {
            const audio = new Audio('/sounds/beep.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {
              // Ignore audio play errors (user hasn't interacted yet)
            });
          } catch (error) {
            // Ignore audio errors
          }
        }
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
                }
              : item
          ),
        });
      },

      incrementQuantity: (productId: string) => {
        const { items } = get();
        const item = items.find(i => i.product_id === productId);
        // Use Infinity as default if stock_quantity is undefined (backward compatibility)
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

      getTotal: () => {
        return get().getSubtotal();
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
        // Migrate persisted cart items to include stock_quantity
        if (persistedState && persistedState.items) {
          persistedState.items = persistedState.items.map((item: any) => ({
            ...item,
            stock_quantity: item.stock_quantity ?? 9999, // Default to large number for old items
          }));
        }
        return persistedState as any;
      },
    }
  )
);