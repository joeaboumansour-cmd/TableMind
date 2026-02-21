// =============================================
// Date & Time Utilities
// =============================================

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
export function getTodayString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

/**
 * Get current time as ISO string
 */
export function getCurrentTimeISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
}

/**
 * Format time from 24h to 12h format
 * Input: "2024-01-15T19:30:00" or "19:30"
 * Output: "7:30 PM"
 */
export function formatTime12h(timeString: string): string {
  const match = timeString.match(/T?(\d{2}):(\d{2})/);
  if (!match) return "--:--";
  
  const hours = parseInt(match[1], 10);
  const mins = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${mins} ${period}`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric", 
    year: "numeric" 
  });
}

/**
 * Format date with weekday
 */
export function formatDateWithWeekday(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Calculate duration in minutes between two ISO timestamps
 */
export function calculateDurationMinutes(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Navigate to a date relative to current date
 */
export function navigateDate(currentDate: string, days: number): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

/**
 * Check if a date is in the past
 */
export function isPastDate(dateString: string): boolean {
  const today = getTodayString();
  return dateString < today;
}

/**
 * Check if a time slot is in the past for today
 */
export function isPastTimeSlot(dateString: string, slotHour: number, slotMinute: number): boolean {
  const today = getTodayString();
  if (dateString !== today) return false;
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  return slotHour < currentHour || (slotHour === currentHour && slotMinute < currentMinute);
}

// =============================================
// Time Slot Generation
// =============================================

export interface TimeSlot {
  time: string;    // Display format: "7:30 PM"
  value: string;   // 24h format: "19:30"
  hour: number;
  minute: number;
  key: string;     // Unique key: "19:30"
}

/**
 * Generate time slots from start hour to end hour with given increment
 */
export function generateTimeSlots(
  startHour: number = 8,
  endHour: number = 23,
  incrementMinutes: number = 15
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  
  for (let hour = startHour; hour <= endHour; hour++) {
    for (let minute = 0; minute < 60; minute += incrementMinutes) {
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const time = `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
      const value = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
      
      slots.push({ 
        time, 
        value, 
        hour, 
        minute, 
        key: value 
      });
    }
  }
  
  return slots;
}

/**
 * Generate time slots for restaurant hours (8 AM to 12 AM, 15-min increments)
 */
export function generateRestaurantTimeSlots(): TimeSlot[] {
  return generateTimeSlots(8, 23, 15);
}

/**
 * Convert slot index to time string
 * Assumes 15-minute slots starting at 8 AM
 */
export function slotIndexToTime(slotIndex: number): string {
  const totalMinutes = 8 * 60 + slotIndex * 15; // Start from 8 AM
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Convert time string to slot index
 * Assumes 15-minute slots starting at 8 AM
 */
export function timeToSlotIndex(timeString: string): number {
  const match = timeString.match(/T?(\d{2}):(\d{2})/);
  if (!match) return 0;
  
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return Math.max(0, (hours - 8) * 4 + Math.floor(minutes / 15));
}