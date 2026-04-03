// =============================================
// Database Types - Supabase Generated Types
// =============================================

// User roles for the restaurant management system
export type UserRole = "waiter" | "host" | "manager" | "admin" | "owner";

// Database schema types
export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          license_expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          license_expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          license_expires_at?: string;
          created_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          barcode: string | null;
          cost_price: number;
          selling_price: number;
          profit_percentage: number;
          stock_quantity: number;
          min_stock_threshold: number;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          barcode?: string | null;
          cost_price?: number;
          selling_price?: number;
          profit_percentage?: number;
          stock_quantity?: number;
          min_stock_threshold?: number;
        };
        Update: {
          id?: string;
          store_id?: string;
          name?: string;
          barcode?: string | null;
          cost_price?: number;
          selling_price?: number;
          profit_percentage?: number;
          stock_quantity?: number;
          min_stock_threshold?: number;
        };
      };
      transactions: {
        Row: {
          id: string;
          store_id: string;
          transaction_number: string;
          subtotal: number;
          total_amount: number;
          amount_paid: number | null;
          change_given: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          transaction_number: string;
          subtotal?: number;
          total_amount?: number;
          amount_paid?: number | null;
          change_given?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          transaction_number?: string;
          subtotal?: number;
          total_amount?: number;
          amount_paid?: number | null;
          change_given?: number;
          created_at?: string;
        };
      };
      transaction_items: {
        Row: {
          id: string;
          store_id: string;
          transaction_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          unit_price: number;
          total_price: number;
        };
        Insert: {
          id?: string;
          store_id: string;
          transaction_id: string;
          product_id?: string | null;
          product_name: string;
          quantity?: number;
          unit_price: number;
          total_price: number;
        };
        Update: {
          id?: string;
          store_id?: string;
          transaction_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_license_valid: {
        Args: {
          store_id: string;
        };
        Returns: boolean;
      };
      decrement_stock: {
        Args: {
          product_id: string;
          quantity: number;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
}