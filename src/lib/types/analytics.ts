export interface CustomerSegmentation {
  new_customers: number;
  returning_customers: number;
  total_customers: number;
  new_percentage: number;
  returning_percentage: number;
}

export interface LeadTimeDistribution {
  same_day: number;
  one_day: number;
  two_days: number;
  one_week: number;
  two_weeks: number;
  month_plus: number;
  average_days: number;
}

export interface DayOfWeekPatterns {
  sunday: number;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
}

export interface MonthlyData {
  month: number;
  month_name: string;
  reservations: number;
  avg_party_size: number;
  total_guests: number;
}

export interface YearComparison {
  current_year: {
    reservations: number;
    total_guests: number;
    avg_party_size: number;
    completed_reservations: number;
  };
  previous_year: {
    reservations: number;
    total_guests: number;
    avg_party_size: number;
    completed_reservations: number;
  };
  reservation_growth: number;
  guest_growth: number;
}

export interface GrowthRates {
  current_period: {
    reservations: number;
    guests: number;
  };
  previous_period: {
    reservations: number;
    guests: number;
  };
  reservation_growth: number;
  guest_growth: number;
}

export interface TablePopularity {
  table_id: string;
  table_name: string;
  reservations: number;
  utilization_pct: number;
}

export interface DiningTimesHeatmap {
  hour: number;
  reservations: number;
  avg_party_size: number;
}

export interface ComprehensiveAnalytics {
  period: {
    start: string;
    end: string;
  };
  overview: {
    total_reservations: number;
    total_guests: number;
    avg_party_size: number;
    completed: number;
    cancelled: number;
  };
  customer_segmentation: CustomerSegmentation;
  lead_time: LeadTimeDistribution;
  day_of_week: DayOfWeekPatterns;
  dining_times: DiningTimesHeatmap[];
  table_popularity: TablePopularity[];
}

export interface AnalyticsData {
  overview?: ComprehensiveAnalytics;
  segmentation?: CustomerSegmentation;
  lead_time?: LeadTimeDistribution;
  day_of_week?: DayOfWeekPatterns;
  seasonal?: MonthlyData[];
  year_comparison?: YearComparison;
  growth?: GrowthRates;
  table_popularity?: TablePopularity[];
  dining_times?: DiningTimesHeatmap[];
  period?: {
    start: string;
    end: string;
  };
  year?: number;
  current_year?: number;
  previous_year?: number;
}

export interface AnalyticsResponse {
  success: boolean;
  data: AnalyticsData;
  meta: {
    restaurant_id: string;
    period: string;
    action: string;
  };
}

// =============================================
// New Analytics Types for Enhanced Dashboard
// =============================================

export interface RevenueMetrics {
  totalRevenue: number;
  avgSpendPerVisit: number;
  avgSpendPerGuest: number;
  revenueByDay: Record<string, number>;
  revenueByHour: Record<number, number>;
}

export interface WaitlistMetrics {
  total: number;
  seated: number;
  cancelled: number;
  noShows: number;
  conversionRate: number;
  avgWaitTime: number;
  estimatedVsActual: number;
}

export interface CustomerHealthMetrics {
  healthy: number;
  atRisk: number;
  critical: number;
  totalLifetimeValue: number;
  avgLifetimeValue: number;
}

export interface OperationalMetrics {
  tableUtilization: number;
  walkInRate: number;
  avgTurnTime: number;
  seatingEfficiency: number;
}

export interface PainPoint {
  type: "warning" | "danger" | "info" | "success";
  category: string;
  title: string;
  description: string;
  recommendation: string;
  severity: number; // 1-10
}

export interface TablePerformance {
  tableId: string;
  tableName: string;
  capacity: number;
  reservations: number;
  revenue: number;
  completionRate: number;
  avgPartySize: number;
  utilizationPct: number;
}

export interface SatisfactionMetrics {
  avgRating: number;
  totalReviews: number;
  ratingDistribution: Record<number, number>;
  npsScore: number; // Net Promoter Score
}

export interface TrendAnalysis {
  direction: "up" | "down" | "stable";
  percentage: number;
  period: string;
  insight: string;
}
