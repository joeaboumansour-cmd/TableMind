// =============================================
// Reservation Utilities
// =============================================

import type { Reservation, ReservationStatus } from "@/lib/types";

// =============================================
// Internal Helpers
// =============================================

/**
 * Convert time string to slot index (15-min slots starting at 8 AM)
 * Internal version to avoid circular dependencies
 */
function timeToSlotIndexInternal(timeString: string): number {
  const match = timeString.match(/T?(\d{2}):(\d{2})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return Math.max(0, (hours - 8) * 4 + Math.floor(minutes / 15));
}

// =============================================
// Status Helpers
// =============================================

/**
 * Get CSS color classes for reservation status
 */
export function getStatusColor(status: ReservationStatus): string {
  switch (status) {
    case "booked":
      return "bg-blue-500 hover:bg-blue-600 border-blue-400";
    case "confirmed":
      return "bg-indigo-500 hover:bg-indigo-600 border-indigo-400";
    case "seated":
      return "bg-green-500 hover:bg-green-600 border-green-400";
    case "finished":
      return "bg-gray-500 hover:bg-gray-600 border-gray-400";
    case "cancelled":
      return "bg-red-500 hover:bg-red-600 border-red-400";
    case "no_show":
      return "bg-amber-500 hover:bg-amber-600 border-amber-400";
    default:
      return "bg-blue-500 hover:bg-blue-600 border-blue-400";
  }
}

/**
 * Get badge color class for reservation status
 */
export function getStatusBadgeColor(status: ReservationStatus): string {
  switch (status) {
    case "booked":
      return "bg-blue-500";
    case "confirmed":
      return "bg-blue-600";
    case "seated":
      return "bg-green-500";
    case "finished":
      return "bg-gray-500";
    case "cancelled":
      return "bg-red-500";
    case "no_show":
      return "bg-amber-500";
    default:
      return "bg-blue-500";
  }
}

/**
 * Get icon/emoji for reservation status
 */
export function getStatusIcon(status: ReservationStatus): string {
  switch (status) {
    case "seated":
      return "🪑";
    case "finished":
      return "✓";
    case "cancelled":
      return "✕";
    case "no_show":
      return "⚠";
    default:
      return "";
  }
}

/**
 * Format status for display (e.g., "no_show" -> "No Show")
 */
export function formatStatus(status: ReservationStatus): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// =============================================
// Status Categories
// =============================================

/**
 * Check if reservation is active (booked, confirmed, or seated)
 */
export function isActiveReservation(status: ReservationStatus): boolean {
  return status === "booked" || status === "confirmed" || status === "seated";
}

/**
 * Check if reservation is completed
 */
export function isCompletedReservation(status: ReservationStatus): boolean {
  return status === "finished";
}

/**
 * Check if reservation is cancelled or no-show
 */
export function isCancelledReservation(status: ReservationStatus): boolean {
  return status === "cancelled" || status === "no_show";
}

// =============================================
// Table Availability
// =============================================

export interface AvailabilityCheck {
  available: boolean;
  conflictingReservation: Reservation | null;
}

/**
 * Check if a table is available for a given time slot
 */
export function checkTableAvailability(
  reservations: Reservation[],
  tableId: string,
  startSlot: number,
  durationSlots: number,
  excludeReservationId?: string
): AvailabilityCheck {
  const endSlot = startSlot + durationSlots;

  for (const res of reservations) {
    if (res.table_id !== tableId) continue;
    if (excludeReservationId && res.id === excludeReservationId) continue;
    if (res.status === "cancelled" || res.status === "no_show") continue;

    const resStart = timeToSlotIndexInternal(res.start_time);
    const resEnd = timeToSlotIndexInternal(res.end_time);

    if (startSlot < resEnd && endSlot > resStart) {
      return { available: false, conflictingReservation: res };
    }
  }

  return { available: true, conflictingReservation: null };
}

// =============================================
// Metrics & Analytics
// =============================================

export interface ReservationMetrics {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  noShows: number;
  totalGuests: number;
  avgPartySize: number;
  avgDuration: number;
  utilization: number;
  tablesUsed: number;
}

/**
 * Calculate metrics from a list of reservations
 */
export function calculateReservationMetrics(
  reservations: Reservation[],
  totalTables: number = 1
): ReservationMetrics {
  const total = reservations.length;
  const active = reservations.filter((r) => isActiveReservation(r.status)).length;
  const completed = reservations.filter((r) => isCompletedReservation(r.status)).length;
  const cancelled = reservations.filter((r) => r.status === "cancelled").length;
  const noShows = reservations.filter((r) => r.status === "no_show").length;
  const totalGuests = reservations.reduce((acc, r) => acc + r.party_size, 0);
  const avgPartySize = total > 0 ? Math.round(totalGuests / total) : 0;

  // Calculate average duration
  let totalDuration = 0;
  reservations.forEach((r) => {
    const start = new Date(r.start_time).getTime();
    const end = new Date(r.end_time).getTime();
    totalDuration += end - start;
  });
  const avgDuration = total > 0 ? Math.round(totalDuration / total / 60000) : 0;

  // Calculate table utilization
  const tablesUsed = new Set(reservations.map((r) => r.table_id)).size;
  const utilization = totalTables > 0 ? Math.round((tablesUsed / totalTables) * 100) : 0;

  return {
    total,
    active,
    completed,
    cancelled,
    noShows,
    totalGuests,
    avgPartySize,
    avgDuration,
    utilization,
    tablesUsed,
  };
}

// =============================================
// Export Helpers
// =============================================

/**
 * Format reservation data for CSV export
 */
export function formatReservationForExport(reservation: Reservation): string {
  const formatTime = (timeString: string) => {
    const match = timeString.match(/T(\d{2}):(\d{2})/);
    if (!match) return "--:--";
    const hours = parseInt(match[1], 10);
    const mins = match[2];
    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHour}:${mins} ${period}`;
  };

  const formatDate = (timeString: string) => {
    const date = new Date(timeString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return [
    reservation.customer_name,
    reservation.customer_phone || "",
    reservation.party_size,
    reservation.table_name || "",
    formatDate(reservation.start_time),
    formatTime(reservation.start_time),
    reservation.status,
    reservation.notes || "",
  ].join(",");
}

/**
 * Generate CSV header for reservations
 */
export function getReservationCsvHeader(): string {
  return ["Name", "Phone", "Party Size", "Table", "Date", "Time", "Status", "Notes"].join(",");
}