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
          /** Which shift this sale was rung into. Null = Unassigned. */
          shift_id: string | null;
          /** Which drawer the till claimed. Recorded even when no shift matched. */
          register_id: string | null;
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
          shift_id?: string | null;
          register_id?: string | null;
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
          shift_id?: string | null;
          register_id?: string | null;
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
      cash_registers: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          is_active: boolean;
          sort_order: number;
          created_by: string | null;
          created_by_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          is_active?: boolean;
          sort_order?: number;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          name?: string;
          is_active?: boolean;
          sort_order?: number;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
        };
      };
      register_requests: {
        Row: {
          id: string;
          store_id: string;
          register_id: string;
          shift_id: string | null;
          kind: string;
          status: string;
          requested_by: string | null;
          requested_by_name: string;
          reason: string | null;
          payload: Record<string, unknown>;
          decided_by: string | null;
          decided_by_name: string | null;
          decided_at: string | null;
          decision_note: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          register_id: string;
          shift_id?: string | null;
          kind: string;
          status?: string;
          requested_by?: string | null;
          requested_by_name?: string;
          reason?: string | null;
          payload?: Record<string, unknown>;
          decided_by?: string | null;
          decided_by_name?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          register_id?: string;
          shift_id?: string | null;
          kind?: string;
          status?: string;
          requested_by?: string | null;
          requested_by_name?: string;
          reason?: string | null;
          payload?: Record<string, unknown>;
          decided_by?: string | null;
          decided_by_name?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
          expires_at?: string;
          created_at?: string;
        };
      };
      cash_shifts: {
        Row: {
          id: string;
          store_id: string;
          register_id: string;
          label: string | null;
          assigned_user_id: string | null;
          assigned_to_owner: boolean;
          assigned_user_name: string | null;
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
          register_id: string;
          label?: string | null;
          assigned_user_id?: string | null;
          assigned_to_owner?: boolean;
          assigned_user_name?: string | null;
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
          register_id?: string;
          label?: string | null;
          assigned_user_id?: string | null;
          assigned_to_owner?: boolean;
          assigned_user_name?: string | null;
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
      // Migration 026. Daily range partitions on occurred_at, 3-day retention.
      // `id` is GENERATED ALWAYS AS IDENTITY, so it is absent from Insert.
      activity_logs: {
        Row: {
          id: number;
          store_id: string;
          user_id: string | null;
          user_name: string | null;
          session_id: string;
          device_id: string | null;
          category: string;
          action: string;
          target: string | null;
          details: Record<string, unknown>;
          route: string | null;
          is_offline: boolean;
          client_event_id: string;
          /** Client clock, set by the device. NOT the time the server saw it. */
          occurred_at: string;
          received_at: string;
        };
        Insert: {
          store_id: string;
          user_id?: string | null;
          user_name?: string | null;
          session_id: string;
          device_id?: string | null;
          category: string;
          action: string;
          target?: string | null;
          details?: Record<string, unknown>;
          route?: string | null;
          is_offline?: boolean;
          client_event_id: string;
          occurred_at: string;
          received_at?: string;
        };
        // Activity rows are append-only: nothing updates them, and they leave
        // by partition drop rather than by DELETE.
        Update: never;
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
      maintain_activity_log_partitions: {
        Args: {
          p_retention_days?: number;
        };
        Returns: { action: string; partition_name: string }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
}