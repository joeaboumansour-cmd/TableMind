// =============================================
// Input Validation Utilities
// =============================================

/**
 * Validates a phone number
 * Allows digits, hyphens, plus signs, and spaces
 * Minimum 7 digits, maximum 20 characters
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || phone.trim() === "") return true; // Optional field
  const phoneRegex = /^[\d\-\+\s]{7,20}$/;
  return phoneRegex.test(phone);
}

/**
 * Validates that a string contains only valid phone characters
 */
export function sanitizePhoneNumber(phone: string): string {
  return phone.replace(/[^\d\-\+\s]/g, "");
}

/**
 * Validates customer name
 * Must be at least 2 characters and not only whitespace
 */
export function isValidCustomerName(name: string): boolean {
  return name.trim().length >= 2;
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.trim() === "") return true; // Optional field
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates party size
 */
export function isValidPartySize(size: number): boolean {
  return size >= 1 && size <= 50;
}

/**
 * Validates that a date string is valid and not in the past
 */
export function isValidFutureDate(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !isNaN(date.getTime()) && date >= today;
}

/**
 * Validates time format (HH:MM)
 */
export function isValidTime(timeString: string): boolean {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(timeString);
}

/**
 * Gets validation error message for phone number
 */
export function getPhoneValidationError(phone: string): string | null {
  if (!phone || phone.trim() === "") return null;
  if (phone.length < 7) return "Phone number must be at least 7 digits";
  if (phone.length > 20) return "Phone number must be no more than 20 characters";
  if (!isValidPhoneNumber(phone)) return "Phone number can only contain digits, hyphens, plus signs, and spaces";
  return null;
}

/**
 * Gets validation error message for customer name
 */
export function getNameValidationError(name: string): string | null {
  if (!name || name.trim() === "") return "Name is required";
  if (name.trim().length < 2) return "Name must be at least 2 characters";
  return null;
}
