// =============================================
// Waitlist Management Types
// =============================================

// Enums (matching database)
export type WaitlistStatus = 
  | 'waiting' 
  | 'arrived' 
  | 'notified' 
  | 'seated' 
  | 'left' 
  | 'completed' 
  | 'cancelled';

export type PriorityLevel = 'normal' | 'vip' | 'urgent';

export type SMSStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'undelivered';

export type NotificationType = 
  | 'added' 
  | 'ready' 
  | 'reminder' 
  | 'cancelled' 
  | 'updated';

// =============================================
// Core Interfaces
// =============================================

export interface WaitlistEntry {
  id: string;
  restaurant_id: string;
  customer_name: string;
  phone?: string | null;
  party_size: number;
  notes?: string | null;
  status: WaitlistStatus;
  priority: PriorityLevel;
  estimated_wait_minutes?: number | null;
  actual_wait_minutes?: number | null;
  position: number;
  preferences: string[];
  sms_notifications_sent: SMSNotificationRecord[];
  notified_at?: string | null;
  arrived_at?: string | null;
  seated_at?: string | null;
  left_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SMSNotificationRecord {
  id: string;
  type: NotificationType;
  sent_at: string;
  status: SMSStatus;
  message: string;
}

export interface SMSNotification {
  id: string;
  restaurant_id: string;
  waitlist_id?: string | null;
  reservation_id?: string | null;
  customer_phone: string;
  message: string;
  notification_type: NotificationType;
  provider: string;
  provider_message_id?: string | null;
  status: SMSStatus;
  error_message?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
}

export interface WaitlistSettings {
  id: string;
  restaurant_id: string;
  is_enabled: boolean;
  default_estimated_wait_minutes: number;
  max_party_size: number;
  max_waitlist_length: number;
  auto_sms_notifications: boolean;
  notification_reminder_minutes: number;
  table_ready_timeout_minutes: number;
  average_turnover_minutes: number;
  sms_template_added: string;
  sms_template_ready: string;
  sms_template_reminder: string;
  sms_template_cancelled: string;
  created_at: string;
  updated_at: string;
}

export interface WaitlistAnalytics {
  total_in_queue: number;
  average_wait_time: number;
  longest_wait_time: number;
  shortest_wait_time: number;
  average_party_size: number;
  status_breakdown: {
    waiting: number;
    arrived: number;
    notified: number;
    seated: number;
  };
  priority_breakdown: {
    normal: number;
    vip: number;
    urgent: number;
  };
  hourly_distribution: {
    hour: number;
    count: number;
  }[];
}

// =============================================
// API Request/Response Types
// =============================================

export interface CreateWaitlistEntryRequest {
  customer_name: string;
  phone?: string;
  party_size: number;
  notes?: string;
  priority?: PriorityLevel;
  preferences?: string[];
  estimated_wait_minutes?: number;
}

export interface UpdateWaitlistEntryRequest {
  customer_name?: string;
  phone?: string;
  party_size?: number;
  notes?: string;
  priority?: PriorityLevel;
  preferences?: string[];
  status?: WaitlistStatus;
}

export interface UpdateStatusRequest {
  status: WaitlistStatus;
  notes?: string;
}

export interface SeatFromWaitlistRequest {
  table_id: string;
  notes?: string;
}

export interface SendNotificationRequest {
  notification_type: NotificationType;
  custom_message?: string;
}

export interface UpdateWaitlistSettingsRequest {
  is_enabled?: boolean;
  default_estimated_wait_minutes?: number;
  max_party_size?: number;
  max_waitlist_length?: number;
  auto_sms_notifications?: boolean;
  notification_reminder_minutes?: number;
  table_ready_timeout_minutes?: number;
  average_turnover_minutes?: number;
  sms_template_added?: string;
  sms_template_ready?: string;
  sms_template_reminder?: string;
  sms_template_cancelled?: string;
}

// =============================================
// Frontend Component Types
// =============================================

export interface WaitlistCardProps {
  entry: WaitlistEntry;
  onStatusChange: (id: string, status: WaitlistStatus) => void;
  onSeat: (id: string) => void;
  onNotify: (id: string) => void;
  onEdit: (entry: WaitlistEntry) => void;
  onRemove: (id: string) => void;
  position: number;
}

export interface WaitlistFormProps {
  onSubmit: (data: CreateWaitlistEntryRequest) => void;
  onCancel: () => void;
  initialData?: WaitlistEntry;
  isEditing?: boolean;
}

export interface WaitlistSettingsFormProps {
  settings: WaitlistSettings;
  onSave: (data: UpdateWaitlistSettingsRequest) => void;
}

export interface NotificationManagerProps {
  entry: WaitlistEntry;
  onSendNotification: (id: string, type: NotificationType) => void;
}

export interface WaitlistStatsProps {
  analytics: WaitlistAnalytics;
}

// =============================================
// Utility Types
// =============================================

export type TablePreference = 
  | 'window' 
  | 'quiet_zone' 
  | 'outdoor' 
  | 'booth' 
  | 'wheelchair_accessible';

export interface TableWithPreferences {
  id: string;
  name: string;
  capacity: number;
  is_window: boolean;
  is_quiet_zone: boolean;
  is_outdoor: boolean;
  wait_priority: number;
}

export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^[\d\-\+\s]{7,20}$/;
  return phoneRegex.test(phone);
}

export function isValidPartySize(size: number): boolean {
  return size >= 1 && size <= 20;
}

export function isValidPriority(priority: string): priority is PriorityLevel {
  return ['normal', 'vip', 'urgent'].includes(priority);
}

export function isValidStatus(status: string): status is WaitlistStatus {
  return ['waiting', 'arrived', 'notified', 'seated', 'left', 'completed', 'cancelled'].includes(status);
}
