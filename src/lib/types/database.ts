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
          transaction_retention_days: number | null;
          max_transactions: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          license_expires_at: string;
          transaction_retention_days?: number | null;
          max_transactions?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          license_expires_at?: string;
          transaction_retention_days?: number | null;
          max_transactions?: number | null;
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
          currency: string;
          profit_percentage: number;
          discount_percentage: number;
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
          currency?: string;
          profit_percentage?: number;
          discount_percentage?: number;
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
          currency?: string;
          profit_percentage?: number;
          discount_percentage?: number;
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
          payment_method: string | null;
          usd_subtotal: number | null;
          usd_total_amount: number | null;
          usd_amount_paid: number | null;
          usd_change_given: number | null;
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
          payment_method?: string | null;
          usd_subtotal?: number | null;
          usd_total_amount?: number | null;
          usd_amount_paid?: number | null;
          usd_change_given?: number | null;
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
          payment_method?: string | null;
          usd_subtotal?: number | null;
          usd_total_amount?: number | null;
          usd_amount_paid?: number | null;
          usd_change_given?: number | null;
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
          currency: string;
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
          currency?: string;
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
          currency?: string;
        };
      };
      cash_shifts: {
        Row: {
          id: string;
          store_id: string;
          business_date: string;
          status: string;
          opened_by: string | null;
          opened_by_name: string;
          opened_at: string;
          opening_ll: number;
          opening_usd: number;
          closed_by: string | null;
          closed_by_name: string | null;
          closed_at: string | null;
          closing_ll: number | null;
          closing_usd: number | null;
          verified: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          business_date: string;
          status?: string;
          opened_by?: string | null;
          opened_by_name?: string;
          opened_at?: string;
          opening_ll?: number;
          opening_usd?: number;
          closed_by?: string | null;
          closed_by_name?: string | null;
          closed_at?: string | null;
          closing_ll?: number | null;
          closing_usd?: number | null;
          verified?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          business_date?: string;
          status?: string;
          opened_by?: string | null;
          opened_by_name?: string;
          opened_at?: string;
          opening_ll?: number;
          opening_usd?: number;
          closed_by?: string | null;
          closed_by_name?: string | null;
          closed_at?: string | null;
          closing_ll?: number | null;
          closing_usd?: number | null;
          verified?: boolean;
          notes?: string | null;
          created_at?: string;
        };
      };
      cash_adjustments: {
        Row: {
          id: string;
          store_id: string;
          shift_id: string;
          adjustment_type: string;
          amount_ll: number;
          amount_usd: number;
          reason: string;
          created_by: string | null;
          created_by_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          shift_id: string;
          adjustment_type: string;
          amount_ll?: number;
          amount_usd?: number;
          reason: string;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          shift_id?: string;
          adjustment_type?: string;
          amount_ll?: number;
          amount_usd?: number;
          reason?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
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
      cleanup_old_transactions_for_store: {
        Args: {
          p_store_id: string;
        };
        Returns: { deleted_count: number; reason: string }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
}