// =============================================
// Core Database Entity Types - Host App Optimized
// =============================================

// =============================================
// Enums (matching database)
// =============================================

export type ReservationStatus = 
  | "booked" 
  | "confirmed" 
  | "seated" 
  | "finished" 
  | "cancelled" 
  | "no_show";

export type TableShape = "circle" | "rect";

export type AllergySeverity = "mild" | "moderate" | "severe" | "life_threatening";

export type PunctualityRating = "Unknown" | "Early" | "On Time" | "Late" | "Often Late" | "Sometimes Late" | "Punctual";

export type RiskLevel = "Low" | "Medium" | "High";

export type ReservationSource = "phone" | "walk_in" | "online" | "third_party";

export type NoteType = "general" | "dietary" | "special_occasion" | "complaint" | "vip_request";

export type VisitStatus = "completed" | "no_show" | "cancelled" | "no_show_charge";

export type VisitType = "dine_in" | "takeout" | "delivery" | "event";

export type UserRole = "owner" | "manager" | "host" | "waiter" | "admin";

// =============================================
// Core Entities
// =============================================

export interface Restaurant {
  id: string;
  private_id: string;
  name: string;
  slug: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  timezone: string;
  subscription_tier?: "trial" | "starter" | "pro" | "enterprise";
  license_start_date?: string;
  license_end_date?: string;
  trial_ends_at?: string;
  is_active: boolean;
  settings: {
    opening_time: string;
    closing_time: string;
    slot_duration_minutes: number;
    default_reservation_duration: number;
    max_party_size: number;
  };
  created_at: string;
  updated_at: string;
}

export interface RestaurantUser {
  id: string;
  restaurant_id: string;
  username: string;
  display_name?: string;
  role: UserRole;
  is_active: boolean;
  last_login_at?: string;
  login_count: number;
  created_at: string;
  updated_at: string;
}

export interface Table {
  id: string;
  restaurant_id: string;
  name: string;
  capacity: number;
  min_capacity: number;
  max_capacity: number;
  shape: TableShape;
  sort_order: number;
  is_active: boolean;
  // Floor plan positioning
  x_position?: number;
  y_position?: number;
  // Floor plan sizing (in pixels)
  width?: number;
  height?: number;
  room_name?: string;
  section?: string;
  created_at: string;
  updated_at: string;
}

export interface Reservation {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  party_size: number;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  source?: ReservationSource;
  is_walk_in?: boolean;
  notes?: string | null;
  // Visit tracking
  actual_arrival_time?: string | null;
  seated_at?: string | null;
  finished_at?: string | null;
  minutes_early_late?: number | null;
  visit_completed?: boolean;
  no_show?: boolean;
  // User tracking
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (not in database)
  table_name?: string;
  room_name?: string;
  customer_tags?: string[];
  reliability_score?: number;
  punctuality_status?: PunctualityRating;
  duration_minutes?: number;
  urgency?: "overdue" | "arriving_soon" | "upcoming";
  minutes_until?: number;
}

export interface Customer {
  id: string;
  restaurant_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  tags: string[];
  total_visits: number;
  no_show_count: number;
  cancellation_count: number;
  reliability_score: number;
  average_spend?: number | null;
  preferred_table_id?: string | null;
  dietary_restrictions?: string | null;
  notes?: string | null;
  last_visit_date?: string | null;
  // Auto-calculated
  risk_level?: RiskLevel;
  created_at: string;
  updated_at: string;
}

// =============================================
// Allergy Management
// =============================================

export interface Allergy {
  id: string;
  name: string;
  category?: string;
  severity_level?: AllergySeverity;
  description?: string;
  created_at: string;
}

export interface CustomerAllergy {
  id: string;
  customer_id: string;
  allergy_id?: string | null;
  custom_allergy_name?: string | null;
  severity?: AllergySeverity;
  notes?: string;
  created_at: string;
  // Joined fields
  allergy_name?: string;
}

// =============================================
// Visit Logs (Simplified for Host Entry)
// =============================================

export interface CustomerVisitLog {
  id: string;
  restaurant_id: string;
  customer_id: string;
  reservation_id?: string | null;
  visit_date: string;
  visit_type: VisitType;
  party_size?: number;
  status: VisitStatus;
  // Simplified for manual host entry
  total_spend?: number | null;
  top_items_ordered?: string | null; // Host types: "Steak, Wine, Salad"
  // Staff & Service
  server_name?: string | null;
  table_id?: string | null;
  // Notes
  customer_notes?: string | null;
  host_notes?: string | null; // Quick notes for host
  feedback_rating?: number | null;
  feedback_text?: string | null;
  // Metadata
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerVisitSummary {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  visit_date: string;
  party_size?: number;
  total_spend?: number;
  top_items_ordered?: string;
  customer_notes?: string;
  host_notes?: string;
  feedback_rating?: number;
  status: VisitStatus;
  table_name?: string;
  created_at: string;
}

// =============================================
// Reservation Notes History
// =============================================

export interface ReservationNoteHistory {
  id: string;
  reservation_id: string;
  restaurant_id: string;
  note_text: string;
  note_type: NoteType;
  created_by?: string | null;
  created_at: string;
  // Joined fields
  created_by_name?: string;
}

// =============================================
// Analytics Views
// =============================================

export interface CustomerAnalytics extends Customer {
  risk_level: RiskLevel;
  avg_minutes_late?: number | null;
  early_count?: number;
  late_count?: number;
  punctuality_rating?: PunctualityRating;
  allergies: string[];
}

export interface ReservationDetails extends Reservation {
  table_capacity?: number;
  customer_full_name?: string;
  customer_email?: string;
  customer_allergies?: string[];
}

// Host Dashboard View
export interface HostDashboardItem {
  reservation_id: string;
  restaurant_id: string;
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  source: ReservationSource;
  is_walk_in?: boolean;
  table_id?: string;
  table_name?: string;
  room_name?: string;
  customer_tags?: string[];
  reliability_score?: number;
  total_visits?: number;
  no_show_count?: number;
  urgency: "overdue" | "arriving_soon" | "upcoming";
  minutes_until: number;
  notes?: string;
}

// Waiter Table Status View
export interface TableStatusWithDetails {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_name: string;
  table_capacity: number;
  room_name?: string;
  section?: string;
  reservation_id?: string;
  status: ServiceStatus;
  current_customer_name?: string;
  current_customer_id?: string;
  current_party_size?: number;
  seated_at?: string;
  order_taken_at?: string;
  food_served_at?: string;
  check_requested_at?: string;
  cleared_at?: string;
  estimated_turnover_minutes?: number;
  actual_duration_minutes?: number;
  server_id?: string;
  server_name?: string;
  session_notes?: string;
  created_at: string;
  updated_at: string;
  guest_source: "empty" | "reservation" | "walk-in" | "unknown";
  availability_status: "available" | "occupied" | "finishing";
  minutes_seated?: number;
  status_color: string;
}

type ServiceStatus = 
  | "empty" 
  | "seated" 
  | "order_taken" 
  | "appetizer_served" 
  | "main_served" 
  | "dessert_served" 
  | "check_requested" 
  | "ready_to_clear";

// Waiter view combined status - includes upcoming reservations
export interface WaiterTableView {
  table_id: string;
  table_name: string;
  table_capacity: number;
  room_name?: string;
  section?: string;
  current_status: ServiceStatus | "empty";
  current_customer_name?: string;
  current_party_size?: number;
  minutes_seated?: number;
  guest_source?: "empty" | "reservation" | "walk-in" | "unknown";
  // Upcoming reservation info (even if table is currently empty)
  upcoming_reservation_id?: string;
  upcoming_customer_name?: string;
  upcoming_party_size?: number;
  upcoming_time?: string;
  upcoming_status?: "booked" | "confirmed" | "seated";
  minutes_until?: number;
  urgency?: "overdue" | "arriving_soon" | "upcoming" | "later";
  // For seated reservations
  reservation_id?: string;
  session_notes?: string;
  status_color?: string;
}

// =============================================
// Form/Input Types
// =============================================

export interface ReservationFormData {
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  table_id: string;
  date: string;
  time: string;
  duration: number;
  status: ReservationStatus;
  notes?: string;
  source?: ReservationSource;
  is_walk_in?: boolean;
}

export interface WalkInFormData {
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  table_id?: string;
  notes?: string;
}

export interface CustomerFormData {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  tags?: string[];
  dietary_restrictions?: string;
}

export interface CustomerSearchResult {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  tags: string[];
  total_visits: number;
  reliability_score: number;
  similarity: number;
}

export interface CustomerUpsertResult {
  customer_id: string;
  is_new: boolean;
  name: string;
  phone?: string;
}

export interface TableFormData {
  name: string;
  capacity: number;
  min_capacity?: number;
  max_capacity?: number;
  shape: TableShape;
  room_name?: string;
  section?: string;
  x_position?: number;
  y_position?: number;
  width?: number;
  height?: number;
}

export interface AvailableTable {
  table_id: string;
  table_name: string;
  min_capacity: number;
  max_capacity: number;
  room_name?: string;
  shape: TableShape;
}

export interface AllergyFormData {
  allergy_name: string;
  severity?: AllergySeverity;
  notes?: string;
}

export interface VisitLogFormData {
  customer_id: string;
  reservation_id?: string;
  visit_date: string;
  visit_type?: VisitType;
  party_size?: number;
  status?: VisitStatus;
  total_spend?: number;
  top_items_ordered?: string;
  server_name?: string;
  table_id?: string;
  customer_notes?: string;
  host_notes?: string;
  feedback_rating?: number;
  feedback_text?: string;
}

export interface ReservationNoteFormData {
  note_text: string;
  note_type?: NoteType;
}

// =============================================
// API Response Types
// =============================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// Reservation with full note history
export interface ReservationWithNotes {
  reservation: Reservation;
  notes_history: Array<{
    id: string;
    note_text: string;
    note_type: NoteType;
    created_at: string;
    created_by?: string;
  }>;
}

// =============================================
// Component Props Types
// =============================================

export interface WithRestaurantId {
  restaurantId: string | null;
}

export interface WithLoadingState {
  isLoading: boolean;
}

export interface WithErrorState {
  error: Error | null;
}

// =============================================
// Utility Types
// =============================================

export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Type for creating new records (omits auto-generated fields)
export type CreateInput<T> = Omit<T, "id" | "created_at" | "updated_at">;

// Type for updating records (makes all fields optional except id)
export type UpdateInput<T> = Partial<Omit<T, "id" | "created_at" | "updated_at">>;