// WhatsApp Integration Types

export interface WhatsAppMessage {
  to: string;
  body: string;
  templateName?: string;
  variables?: Record<string, string>;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  description: string;
  category: 'reservation' | 'reminder' | 'marketing' | 'custom';
  content: string;
  variables: string[];
  language: string;
  status: 'approved' | 'pending' | 'rejected';
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: string;
}

export interface WhatsAppBulkSendResult {
  total: number;
  successful: number;
  failed: number;
  results: WhatsAppSendResult[];
}

export interface WhatsAppConfig {
  provider: 'twilio' | 'meta' | '360dialog' | 'mock';
  apiKey: string;
  apiSecret?: string;  // For Twilio Auth Token
  phoneNumberId: string;
  businessAccountId?: string;
  webhookUrl?: string;
}

// Environment variable mapping for each provider
export const PROVIDER_ENV_VARS = {
  twilio: {
    accountSid: 'TWILIO_ACCOUNT_SID',
    authToken: 'TWILIO_AUTH_TOKEN',
    phoneNumber: 'TWILIO_WHATSAPP_PHONE_NUMBER',
  },
  meta: {
    apiKey: 'META_WHATSAPP_API_KEY',
    phoneNumberId: 'META_WHATSAPP_PHONE_NUMBER_ID',
    businessAccountId: 'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  },
  '360dialog': {
    apiKey: 'D360_API_KEY',
    phoneNumberId: 'D360_PHONE_NUMBER_ID',
  },
  mock: {}
} as const;

export interface WhatsAppMessageLog {
  id: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  message: string;
  templateName?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  errorMessage?: string;
}

// Template definitions for common restaurant scenarios
export const DEFAULT_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'reservation_confirmation',
    name: 'Reservation Confirmation',
    description: 'Sent when a new reservation is created',
    category: 'reservation',
    content: 'Hi {{customer_name}}! Your reservation at {{restaurant_name}} is confirmed for {{date}} at {{time}} for {{party_size}} guests. We look forward to seeing you!',
    variables: ['customer_name', 'restaurant_name', 'date', 'time', 'party_size'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'reservation_reminder_24h',
    name: '24-Hour Reminder',
    description: 'Reminder sent 24 hours before reservation',
    category: 'reminder',
    content: 'Hi {{customer_name}}! Reminder: You have a reservation at {{restaurant_name}} tomorrow at {{time}} for {{party_size}} guests. Reply CONFIRM to confirm or CANCEL to cancel.',
    variables: ['customer_name', 'restaurant_name', 'time', 'party_size'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'reservation_reminder_2h',
    name: '2-Hour Reminder',
    description: 'Reminder sent 2 hours before reservation',
    category: 'reminder',
    content: 'Hi {{customer_name}}! Your table at {{restaurant_name}} will be ready in 2 hours ({{time}}). We\'re excited to see you!',
    variables: ['customer_name', 'restaurant_name', 'time'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'waitlist_table_ready',
    name: 'Table Ready - Waitlist',
    description: 'Sent when table is ready for waitlist customer',
    category: 'reservation',
    content: 'Hi {{customer_name}}! Your table at {{restaurant_name}} is ready! Please check in with the host within 10 minutes.',
    variables: ['customer_name', 'restaurant_name'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'birthday_wish',
    name: 'Birthday Wish',
    description: 'Birthday greeting with special offer',
    category: 'marketing',
    content: '🎉 Happy Birthday {{customer_name}}! Wishing you a wonderful day from all of us at {{restaurant_name}}. Show this message for a complimentary dessert on your next visit!',
    variables: ['customer_name', 'restaurant_name'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'special_offer',
    name: 'Special Offer',
    description: 'Marketing message for special promotions',
    category: 'marketing',
    content: 'Hi {{customer_name}}! {{restaurant_name}} has a special offer for you: {{offer_details}}. Valid until {{expiry_date}}. Book now!',
    variables: ['customer_name', 'restaurant_name', 'offer_details', 'expiry_date'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'we_miss_you',
    name: 'We Miss You',
    description: 'Re-engagement message for inactive customers',
    category: 'marketing',
    content: 'Hi {{customer_name}}! We haven\'t seen you at {{restaurant_name}} in a while. We\'d love to welcome you back! Book your table and enjoy 10% off your meal.',
    variables: ['customer_name', 'restaurant_name'],
    language: 'en',
    status: 'approved'
  },
  {
    id: 'custom_message',
    name: 'Custom Message',
    description: 'Free-form custom message',
    category: 'custom',
    content: '{{message}}',
    variables: ['message'],
    language: 'en',
    status: 'approved'
  }
];

// Helper function to format phone number for WhatsApp
export function formatPhoneForWhatsApp(phone: string): string {
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Add country code if not present (assuming US/Canada +1)
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If already has country code
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }
  
  return cleaned;
}

// Helper function to replace template variables
export function fillTemplate(template: string, variables: Record<string, string>): string {
  let filled = template;
  Object.entries(variables).forEach(([key, value]) => {
    filled = filled.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });
  return filled;
}
