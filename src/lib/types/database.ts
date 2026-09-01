// =============================================
// Generated from the live database schema. Do not hand-edit.
//
// Regenerate after every migration. It reads the schema directly, so it takes a
// database connection string rather than a Supabase access token — the URL is
// in the dashboard under Connect -> Session pooler:
//
//   npx supabase gen types typescript --db-url "<conn>" > src/lib/types/database.ts
//
// > If `npm run verify:invariants` fails on invariant 14 (`restaurant_id`)
// > after you regenerate, the DATABASE is what is stale, not this file. It
// > means migration 041 has not been applied there — the dropped TableMind
// > functions still exist and their `p_restaurant_id` arguments come through
// > into the generated types. That is exactly how this was caught once.
//
// ## Why this file was regenerated (Phase 2.3)
//
// It used to be hand-maintained, and audit P2-7 recorded it as stale. It was
// worse than stale: it declared **16 tables against the database's 21**, and
// its only other export was
//
//     export type UserRole = "waiter" | "host" | "manager" | "admin" | "owner"
//
// — the TableMind restaurant hierarchy, the same dead scaffolding `CLAUDE.md`
// flags in `src/lib/auth/roles.ts`. A stale type file is a trap precisely
// because it looks authoritative.
//
// ## Nothing imports this yet, and that is not an oversight
//
// The Supabase client is created untyped (`createBrowserClient()` with no type
// argument). Passing `Database` to it is the obvious next step and is
// deliberately NOT done here: it would surface type errors across every query
// in the app at once, which is a correctness change wearing a performance
// refactor's clothes. This file being accurate is what makes that change
// possible later; doing both at once is what makes it unreviewable.
// =============================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          category: string
          client_event_id: string
          details: Json
          device_id: string | null
          id: number
          is_offline: boolean
          occurred_at: string
          received_at: string
          route: string | null
          session_id: string
          store_id: string
          target: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          category: string
          client_event_id: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at: string
          received_at?: string
          route?: string | null
          session_id: string
          store_id: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          category?: string
          client_event_id?: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at?: string
          received_at?: string
          route?: string | null
          session_id?: string
          store_id?: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "activity_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs_20260830: {
        Row: {
          action: string
          category: string
          client_event_id: string
          details: Json
          device_id: string | null
          id: number
          is_offline: boolean
          occurred_at: string
          received_at: string
          route: string | null
          session_id: string
          store_id: string
          target: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          category: string
          client_event_id: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at: string
          received_at?: string
          route?: string | null
          session_id: string
          store_id: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          category?: string
          client_event_id?: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at?: string
          received_at?: string
          route?: string | null
          session_id?: string
          store_id?: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      activity_logs_20260831: {
        Row: {
          action: string
          category: string
          client_event_id: string
          details: Json
          device_id: string | null
          id: number
          is_offline: boolean
          occurred_at: string
          received_at: string
          route: string | null
          session_id: string
          store_id: string
          target: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          category: string
          client_event_id: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at: string
          received_at?: string
          route?: string | null
          session_id: string
          store_id: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          category?: string
          client_event_id?: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at?: string
          received_at?: string
          route?: string | null
          session_id?: string
          store_id?: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      activity_logs_20260901: {
        Row: {
          action: string
          category: string
          client_event_id: string
          details: Json
          device_id: string | null
          id: number
          is_offline: boolean
          occurred_at: string
          received_at: string
          route: string | null
          session_id: string
          store_id: string
          target: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          category: string
          client_event_id: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at: string
          received_at?: string
          route?: string | null
          session_id: string
          store_id: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          category?: string
          client_event_id?: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at?: string
          received_at?: string
          route?: string | null
          session_id?: string
          store_id?: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      activity_logs_20260902: {
        Row: {
          action: string
          category: string
          client_event_id: string
          details: Json
          device_id: string | null
          id: number
          is_offline: boolean
          occurred_at: string
          received_at: string
          route: string | null
          session_id: string
          store_id: string
          target: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          category: string
          client_event_id: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at: string
          received_at?: string
          route?: string | null
          session_id: string
          store_id: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          category?: string
          client_event_id?: string
          details?: Json
          device_id?: string | null
          id?: never
          is_offline?: boolean
          occurred_at?: string
          received_at?: string
          route?: string | null
          session_id?: string
          store_id?: string
          target?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string | null
          id: string
          password_hash: string
          username: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          password_hash: string
          username: string
        }
        Update: {
          created_at?: string | null
          id?: string
          password_hash?: string
          username?: string
        }
        Relationships: []
      }
      cash_adjustments: {
        Row: {
          adjustment_type: string
          amount_ll: number
          amount_usd: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          reason: string
          shift_id: string
          store_id: string
        }
        Insert: {
          adjustment_type: string
          amount_ll?: number
          amount_usd?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          reason: string
          shift_id: string
          store_id: string
        }
        Update: {
          adjustment_type?: string
          amount_ll?: number
          amount_usd?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          reason?: string
          shift_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_adjustments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_adjustments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "cash_adjustments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "cash_registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          assigned_to_owner: boolean
          assigned_user_id: string | null
          assigned_user_name: string | null
          business_date: string
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          closing_ll: number | null
          closing_usd: number | null
          created_at: string
          id: string
          label: string | null
          notes: string | null
          opened_at: string
          opened_by: string | null
          opened_by_name: string
          opening_ll: number
          opening_usd: number
          register_id: string
          status: string
          store_id: string
          verified: boolean
        }
        Insert: {
          assigned_to_owner?: boolean
          assigned_user_id?: string | null
          assigned_user_name?: string | null
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_ll?: number | null
          closing_usd?: number | null
          created_at?: string
          id?: string
          label?: string | null
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string
          opening_ll?: number
          opening_usd?: number
          register_id: string
          status?: string
          store_id: string
          verified?: boolean
        }
        Update: {
          assigned_to_owner?: boolean
          assigned_user_id?: string | null
          assigned_user_name?: string | null
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          closing_ll?: number | null
          closing_usd?: number | null
          created_at?: string
          id?: string
          label?: string | null
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string
          opening_ll?: number
          opening_usd?: number
          register_id?: string
          status?: string
          store_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cash_shifts_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "cash_shifts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_components: {
        Row: {
          combo_product_id: string
          created_at: string
          id: string
          item_product_id: string
          quantity: number
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          combo_product_id: string
          created_at?: string
          id?: string
          item_product_id: string
          quantity?: number
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          combo_product_id?: string
          created_at?: string
          id?: string
          item_product_id?: string
          quantity?: number
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_components_combo_product_id_fkey"
            columns: ["combo_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_components_item_product_id_fkey"
            columns: ["item_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_components_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "combo_components_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          currency: string
          description: string | null
          expense_date: string
          id: string
          recurrence: string
          store_id: string
          type: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          recurrence?: string
          store_id: string
          type: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          description?: string | null
          expense_date?: string
          id?: string
          recurrence?: string
          store_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "expenses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      import_export_audit: {
        Row: {
          created_at: string | null
          created_by: string | null
          errors_summary: Json | null
          failed_rows: number | null
          file_name: string | null
          file_size: number | null
          id: string
          import_mode: string | null
          operation_type: string
          store_id: string
          successful_rows: number | null
          total_rows: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          errors_summary?: Json | null
          failed_rows?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_mode?: string | null
          operation_type: string
          store_id: string
          successful_rows?: number | null
          total_rows?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          errors_summary?: Json | null
          failed_rows?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          import_mode?: string | null
          operation_type?: string
          store_id?: string
          successful_rows?: number | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_export_audit_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "import_export_audit_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_ticket_state: {
        Row: {
          claimed_by: string | null
          ready_at: string | null
          served_at: string | null
          started_at: string | null
          status: string
          store_id: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          claimed_by?: string | null
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          status?: string
          store_id: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          claimed_by?: string | null
          ready_at?: string | null
          served_at?: string | null
          started_at?: string | null
          status?: string
          store_id?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_ticket_state_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "kitchen_ticket_state_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_ticket_state_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "product_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_change_requests: {
        Row: {
          created_at: string
          decline_reason: string | null
          id: string
          previous: Json | null
          product_id: string | null
          proposed: Json
          request_type: string
          requested_by: string | null
          requested_by_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          store_id: string
        }
        Insert: {
          created_at: string
          decline_reason?: string | null
          id: string
          previous?: Json | null
          product_id?: string | null
          proposed: Json
          request_type: string
          requested_by?: string | null
          requested_by_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          store_id: string
        }
        Update: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          previous?: Json | null
          product_id?: string | null
          proposed?: Json
          request_type?: string
          requested_by?: string | null
          requested_by_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_change_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_change_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "product_change_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_favorites: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          store_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          store_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_favorites_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "product_favorites_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          cost_price: number
          currency: string | null
          discount_percentage: number
          id: string
          kind: string
          min_stock_threshold: number | null
          name: string
          parent_id: string | null
          product_group_id: string | null
          profit_percentage: number | null
          selling_price: number
          serving_qty: number
          stock_quantity: number | null
          stock_unit: string
          store_id: string
          updated_at: string | null
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          currency?: string | null
          discount_percentage?: number
          id?: string
          kind?: string
          min_stock_threshold?: number | null
          name: string
          parent_id?: string | null
          product_group_id?: string | null
          profit_percentage?: number | null
          selling_price?: number
          serving_qty?: number
          stock_quantity?: number | null
          stock_unit?: string
          store_id: string
          updated_at?: string | null
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          currency?: string | null
          discount_percentage?: number
          id?: string
          kind?: string
          min_stock_threshold?: number | null
          name?: string
          parent_id?: string | null
          product_group_id?: string | null
          profit_percentage?: number | null
          selling_price?: number
          serving_qty?: number
          stock_quantity?: number | null
          stock_unit?: string
          store_id?: string
          updated_at?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fkey"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "products_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          currency: string
          id: string
          notes: string | null
          product_id: string | null
          product_name: string
          quantity: number
          receipt_date: string
          store_id: string
          supplier: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name: string
          quantity?: number
          receipt_date?: string
          store_id: string
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          receipt_date?: string
          store_id?: string
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "purchase_receipts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_components: {
        Row: {
          created_at: string
          id: string
          ingredient_product_id: string
          is_default: boolean
          is_removable: boolean
          max_quantity: number
          menu_product_id: string
          price_delta_ll: number
          quantity: number
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_product_id: string
          is_default?: boolean
          is_removable?: boolean
          max_quantity?: number
          menu_product_id: string
          price_delta_ll?: number
          quantity: number
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_product_id?: string
          is_default?: boolean
          is_removable?: boolean
          max_quantity?: number
          menu_product_id?: string
          price_delta_ll?: number
          quantity?: number
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_components_ingredient_product_id_fkey"
            columns: ["ingredient_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_components_menu_product_id_fkey"
            columns: ["menu_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_components_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "recipe_components_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      register_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          expires_at: string
          id: string
          kind: string
          payload: Json
          reason: string | null
          register_id: string
          requested_by: string | null
          requested_by_name: string
          shift_id: string | null
          status: string
          store_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          expires_at: string
          id?: string
          kind: string
          payload?: Json
          reason?: string | null
          register_id: string
          requested_by?: string | null
          requested_by_name?: string
          shift_id?: string | null
          status?: string
          store_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          reason?: string | null
          register_id?: string
          requested_by?: string | null
          requested_by_name?: string
          shift_id?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "register_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_requests_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "register_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "register_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_users: {
        Row: {
          created_at: string | null
          display_name: string
          id: string
          is_active: boolean
          password_hash: string
          permissions: Json
          store_id: string
          username: string
        }
        Insert: {
          created_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          password_hash: string
          permissions?: Json
          store_id: string
          username: string
        }
        Update: {
          created_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          password_hash?: string
          permissions?: Json
          store_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "store_users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          created_at: string | null
          features: Json | null
          id: string
          is_active: boolean
          license_expires_at: string
          max_transactions: number | null
          menu_published: boolean
          menu_token: string | null
          password_hash: string
          phone_whatsapp: string | null
          store_type: string | null
          transaction_retention_days: number | null
          usd_rate_return: number | null
          usd_rate_sell: number | null
          username: string
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean
          license_expires_at: string
          max_transactions?: number | null
          menu_published?: boolean
          menu_token?: string | null
          password_hash: string
          phone_whatsapp?: string | null
          store_type?: string | null
          transaction_retention_days?: number | null
          usd_rate_return?: number | null
          usd_rate_sell?: number | null
          username: string
        }
        Update: {
          address?: string | null
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean
          license_expires_at?: string
          max_transactions?: number | null
          menu_published?: boolean
          menu_token?: string | null
          password_hash?: string
          phone_whatsapp?: string | null
          store_type?: string | null
          transaction_retention_days?: number | null
          usd_rate_return?: number | null
          usd_rate_sell?: number | null
          username?: string
        }
        Relationships: []
      }
      transaction_items: {
        Row: {
          combo_children: Json | null
          currency: string | null
          id: string
          modifiers: Json | null
          note: string | null
          product_id: string | null
          product_name: string
          quantity: number
          store_id: string
          total_price: number
          transaction_id: string
          unit_price: number
        }
        Insert: {
          combo_children?: Json | null
          currency?: string | null
          id?: string
          modifiers?: Json | null
          note?: string | null
          product_id?: string | null
          product_name: string
          quantity?: number
          store_id: string
          total_price: number
          transaction_id: string
          unit_price: number
        }
        Update: {
          combo_children?: Json | null
          currency?: string | null
          id?: string
          modifiers?: Json | null
          note?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          store_id?: string
          total_price?: number
          transaction_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "transaction_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_paid: number | null
          change_given: number | null
          created_at: string | null
          id: string
          payment_method: string | null
          receipt_token: string | null
          register_id: string | null
          shift_id: string | null
          store_id: string
          subtotal: number
          total_amount: number
          transaction_number: string
          usd_amount_paid: number | null
          usd_change_given: number | null
          usd_subtotal: number | null
          usd_total_amount: number | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          amount_paid?: number | null
          change_given?: number | null
          created_at?: string | null
          id?: string
          payment_method?: string | null
          receipt_token?: string | null
          register_id?: string | null
          shift_id?: string | null
          store_id: string
          subtotal?: number
          total_amount?: number
          transaction_number: string
          usd_amount_paid?: number | null
          usd_change_given?: number | null
          usd_subtotal?: number | null
          usd_total_amount?: number | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount_paid?: number | null
          change_given?: number | null
          created_at?: string | null
          id?: string
          payment_method?: string | null
          receipt_token?: string | null
          register_id?: string | null
          shift_id?: string | null
          store_id?: string
          subtotal?: number
          total_amount?: number
          transaction_number?: string
          usd_amount_paid?: number | null
          usd_change_given?: number | null
          usd_subtotal?: number | null
          usd_total_amount?: number | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "cash_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "store_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      store_transaction_health: {
        Row: {
          current_transaction_count: number | null
          estimated_size: string | null
          max_transactions: number | null
          newest_transaction: string | null
          oldest_transaction: string | null
          status: string | null
          store_id: string | null
          transaction_retention_days: number | null
          username: string | null
        }
        Relationships: []
      }
      transaction_retention_stats: {
        Row: {
          estimated_size: string | null
          expired_transactions: number | null
          newest_transaction: string | null
          oldest_transaction: string | null
          store_id: string | null
          total_transactions: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "store_transaction_health"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "transactions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cleanup_all_old_transactions: {
        Args: never
        Returns: {
          deleted_count: number
          store_id: string
        }[]
      }
      cleanup_all_stores_transactions: {
        Args: never
        Returns: {
          deleted_count: number
          reason: string
          store_id: string
        }[]
      }
      cleanup_old_transactions: { Args: never; Returns: number }
      cleanup_old_transactions_for_store: {
        Args: { p_store_id: string }
        Returns: {
          deleted_count: number
          reason: string
        }[]
      }
      convert_ll_to_usd_return: {
        Args: { p_ll_amount: number; p_store_id: string }
        Returns: number
      }
      convert_ll_to_usd_sale: {
        Args: { p_ll_amount: number; p_store_id: string }
        Returns: number
      }
      convert_product_price_to_usd: {
        Args: { p_amount: number; p_currency: string; p_store_id: string }
        Returns: number
      }
      convert_usd_to_product_currency: {
        Args: { p_amount: number; p_currency: string; p_store_id: string }
        Returns: number
      }
      create_sale: { Args: { p_sale: Json; p_store_id: string }; Returns: Json }
      decrement_stock: {
        Args: { p_store_id?: string; product_id: string; quantity: number }
        Returns: undefined
      }
      decrement_stock_batch: {
        Args: { p_items: Json; p_store_id: string }
        Returns: number
      }
      find_product_by_barcode: {
        Args: { p_barcode: string; p_store_id: string }
        Returns: {
          barcode: string
          currency: string
          full_name: string
          id: string
          is_variant: boolean
          name: string
          selling_price: number
          stock_quantity: number
          variant_name: string
        }[]
      }
      get_cash_overview: { Args: { p_store_id: string }; Returns: Json }
      get_product_with_inheritance: {
        Args: { p_product_id: string }
        Returns: {
          barcode: string
          cost_price: number
          currency: string
          full_name: string
          id: string
          is_variant: boolean
          min_stock_threshold: number
          name: string
          parent_id: string
          profit_percentage: number
          selling_price: number
          stock_quantity: number
          store_id: string
          variant_name: string
        }[]
      }
      get_recent_import_logs: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          created_at: string
          errors_summary: Json
          failed_rows: number
          file_name: string
          id: string
          import_mode: string
          operation_type: string
          successful_rows: number
          total_rows: number
        }[]
      }
      get_register_performance: {
        Args: { p_from: string; p_store_id: string; p_to: string }
        Returns: {
          active_days: number
          adj_in_ll: number
          adj_in_usd: number
          adj_out_ll: number
          adj_out_usd: number
          avg_basket: number
          closed_shift_sales: number
          closing_ll: number
          closing_usd: number
          hours_open: number
          largest_sale: number
          opening_ll: number
          opening_usd: number
          peak_hour: number
          peak_hour_txns: number
          register_id: string
          register_name: string
          revenue: number
          shifts_closed: number
          txn_count: number
        }[]
      }
      get_shift_totals: {
        Args: { p_shift_ids: string[]; p_store_id: string }
        Returns: {
          amount_paid: number
          change_given: number
          shift_id: string
          txn_count: number
          usd_amount_paid: number
        }[]
      }
      get_store_features: { Args: { p_store_id: string }; Returns: Json }
      get_store_retention_settings: {
        Args: { p_store_id: string }
        Returns: {
          max_transactions: number
          retention_days: number
        }[]
      }
      get_store_return_rate: { Args: { p_store_id: string }; Returns: number }
      get_store_sell_rate: { Args: { p_store_id: string }; Returns: number }
      get_stores_near_limits: {
        Args: never
        Returns: {
          current_count: number
          max_limit: number
          oldest_transaction: string
          percentage_used: number
          retention_days: number
          store_id: string
          username: string
        }[]
      }
      get_transaction_analytics: {
        Args: { p_from?: string; p_store_id: string; p_tz?: string }
        Returns: Json
      }
      get_transactions_for_cleanup: {
        Args: never
        Returns: {
          created_at: string
          hours_old: number
          id: string
          store_id: string
          total_amount: number
          transaction_number: string
        }[]
      }
      get_unassigned_totals: {
        Args: { p_from: string; p_store_id: string }
        Returns: {
          total: number
          txn_count: number
        }[]
      }
      increment_product_stock: {
        Args: { p_delta: number; p_product_id: string; p_store_id: string }
        Returns: undefined
      }
      is_feature_enabled: {
        Args: { p_feature_key: string; p_store_id: string }
        Returns: boolean
      }
      is_license_valid: { Args: { store_id: string }; Returns: boolean }
      log_export_operation: {
        Args: {
          p_file_name: string
          p_file_size: number
          p_store_id: string
          p_total_rows: number
        }
        Returns: string
      }
      log_import_operation: {
        Args: {
          p_errors_summary: Json
          p_failed_rows: number
          p_file_name: string
          p_file_size: number
          p_import_mode: string
          p_store_id: string
          p_successful_rows: number
          p_total_rows: number
        }
        Returns: string
      }
      maintain_activity_log_partitions: {
        Args: { p_retention_days?: number }
        Returns: {
          action: string
          partition_name: string
        }[]
      }
      scheduled_transaction_cleanup: {
        Args: never
        Returns: {
          deleted_count: number
          reason: string
          store_id: string
        }[]
      }
    }
    Enums: {
      priority_level: "normal" | "vip" | "urgent"
      reservation_source: "phone" | "walk_in" | "online" | "third_party"
      reservation_status:
        | "booked"
        | "confirmed"
        | "seated"
        | "finished"
        | "cancelled"
        | "no_show"
      sms_status: "pending" | "sent" | "delivered" | "failed" | "undelivered"
      staff_role: "owner" | "manager" | "host" | "waiter"
      table_shape: "circle" | "rect"
      user_role: "owner" | "manager" | "host" | "waiter" | "admin"
      waitlist_status:
        | "waiting"
        | "arrived"
        | "notified"
        | "seated"
        | "left"
        | "completed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      priority_level: ["normal", "vip", "urgent"],
      reservation_source: ["phone", "walk_in", "online", "third_party"],
      reservation_status: [
        "booked",
        "confirmed",
        "seated",
        "finished",
        "cancelled",
        "no_show",
      ],
      sms_status: ["pending", "sent", "delivered", "failed", "undelivered"],
      staff_role: ["owner", "manager", "host", "waiter"],
      table_shape: ["circle", "rect"],
      user_role: ["owner", "manager", "host", "waiter", "admin"],
      waitlist_status: [
        "waiting",
        "arrived",
        "notified",
        "seated",
        "left",
        "completed",
        "cancelled",
      ],
    },
  },
} as const

