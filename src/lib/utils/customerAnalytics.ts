// =============================================
// Customer Analytics & Retention Utilities
// =============================================

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags: string[];
  total_visits: number;
  no_show_count: number;
  cancellation_count: number;
  last_visit_date?: string;
  created_at?: string;
  reliability_score?: number;
}

// =============================================
// RFM Analysis (Recency, Frequency, Monetary)
// =============================================

export type RFMSegment = 
  | "Champions" 
  | "Loyal Customers" 
  | "Potential Loyalists" 
  | "At Risk" 
  | "Cannot Lose Them"
  | "Lost";

export interface RFMScore {
  recency: number; // 1-5, higher = more recent
  frequency: number; // 1-5, higher = more frequent
  segment: RFMSegment;
  description: string;
}

/**
 * Calculate RFM segment for a customer
 * Based on visit recency and frequency patterns
 */
export function calculateRFMSegment(customer: Customer): RFMScore {
  const now = new Date();
  const lastVisit = customer.last_visit_date ? new Date(customer.last_visit_date) : null;
  
  // Calculate days since last visit
  const daysSinceLastVisit = lastVisit 
    ? Math.floor((now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  
  // Calculate recency score (1-5)
  let recency = 1;
  if (daysSinceLastVisit <= 7) recency = 5;
  else if (daysSinceLastVisit <= 30) recency = 4;
  else if (daysSinceLastVisit <= 60) recency = 3;
  else if (daysSinceLastVisit <= 90) recency = 2;
  
  // Calculate frequency score based on visits per month
  const accountAgeDays = customer.created_at 
    ? Math.max(30, Math.floor((now.getTime() - new Date(customer.created_at).getTime()) / (1000 * 60 * 60 * 24)))
    : 365;
  
  const visitsPerMonth = (customer.total_visits / accountAgeDays) * 30;
  
  let frequency = 1;
  if (visitsPerMonth >= 4) frequency = 5;
  else if (visitsPerMonth >= 2.5) frequency = 4;
  else if (visitsPerMonth >= 1.5) frequency = 3;
  else if (visitsPerMonth >= 0.5) frequency = 2;
  
  // Determine segment based on RFM scores
  let segment: RFMSegment;
  let description: string;
  
  if (recency >= 4 && frequency >= 4) {
    segment = "Champions";
    description = "Your best customers - visit often and recently";
  } else if (recency >= 3 && frequency >= 4) {
    segment = "Loyal Customers";
    description = "Regular visitors who might need a nudge to return";
  } else if (recency >= 4 && frequency <= 3) {
    segment = "Potential Loyalists";
    description = "Recent customers who could become regulars";
  } else if (recency <= 2 && frequency >= 4) {
    segment = "Cannot Lose Them";
    description = "High-value customers who haven't visited recently - URGENT";
  } else if (recency <= 2 && frequency >= 2) {
    segment = "At Risk";
    description = "Customers showing signs of churning";
  } else {
    segment = "Lost";
    description = "Haven't visited in a long time";
  }
  
  return { recency, frequency, segment, description };
}

export function getRFMSegmentColor(segment: RFMSegment): string {
  switch (segment) {
    case "Champions":
      return "bg-green-100 text-green-800 border-green-200";
    case "Loyal Customers":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "Potential Loyalists":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Cannot Lose Them":
      return "bg-red-100 text-red-800 border-red-200";
    case "At Risk":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "Lost":
      return "bg-gray-100 text-gray-800 border-gray-200";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// =============================================
// Customer Health Score
// =============================================

export interface HealthScore {
  score: number; // 0-100
  status: "Healthy" | "At Risk" | "Critical";
  breakdown: {
    recency: number; // 0-40 points
    frequency: number; // 0-30 points
    reliability: number; // 0-20 points
    engagement: number; // 0-10 points
  };
}

/**
 * Calculate comprehensive health score for customer retention
 */
export function calculateHealthScore(customer: Customer): HealthScore {
  const now = new Date();
  const lastVisit = customer.last_visit_date ? new Date(customer.last_visit_date) : null;
  
  // Recency Score (40 points max)
  let recency = 0;
  if (lastVisit) {
    const daysSince = Math.floor((now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 14) recency = 40;
    else if (daysSince <= 30) recency = 35;
    else if (daysSince <= 60) recency = 25;
    else if (daysSince <= 90) recency = 15;
    else if (daysSince <= 180) recency = 5;
  }
  
  // Frequency Score (30 points max)
  let frequency = 0;
  if (customer.total_visits >= 20) frequency = 30;
  else if (customer.total_visits >= 10) frequency = 25;
  else if (customer.total_visits >= 5) frequency = 20;
  else if (customer.total_visits >= 3) frequency = 15;
  else if (customer.total_visits >= 1) frequency = 10;
  
  // Reliability Score (20 points max)
  const reliabilityScore = customer.reliability_score || 100;
  let reliability = Math.round((reliabilityScore / 100) * 20);
  
  // Engagement Score (10 points max) - based on having notes/tags
  let engagement = 5; // Base score
  if (customer.tags && customer.tags.length > 0) engagement += 3;
  if (customer.total_visits > 0) engagement += 2;
  
  const totalScore = recency + frequency + reliability + engagement;
  
  let status: "Healthy" | "At Risk" | "Critical";
  if (totalScore >= 70) status = "Healthy";
  else if (totalScore >= 40) status = "At Risk";
  else status = "Critical";
  
  return {
    score: totalScore,
    status,
    breakdown: { recency, frequency, reliability, engagement }
  };
}

export function getHealthScoreColor(score: number): string {
  if (score >= 70) return "text-green-600 bg-green-50";
  if (score >= 40) return "text-yellow-600 bg-yellow-50";
  return "text-red-600 bg-red-50";
}

// =============================================
// Customer Lifecycle Stages
// =============================================

export type LifecycleStage = 
  | "New" 
  | "Onboarding" 
  | "Establishing" 
  | "Regular" 
  | "VIP" 
  | "Dormant" 
  | "Reactivated";

export interface LifecycleInfo {
  stage: LifecycleStage;
  description: string;
  nextAction: string;
}

/**
 * Determine customer lifecycle stage for targeted engagement
 */
export function calculateLifecycleStage(customer: Customer): LifecycleInfo {
  const now = new Date();
  const lastVisit = customer.last_visit_date ? new Date(customer.last_visit_date) : null;
  const daysSinceLastVisit = lastVisit 
    ? Math.floor((now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  
  const accountAgeDays = customer.created_at 
    ? Math.floor((now.getTime() - new Date(customer.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 365;
  
  // Check for VIP first
  if (customer.tags?.includes("VIP") && daysSinceLastVisit < 60) {
    return {
      stage: "VIP",
      description: "High-value loyal customer",
      nextAction: "Reward loyalty, exclusive offers"
    };
  }
  
  // Check for Dormant
  if (daysSinceLastVisit > 90) {
    return {
      stage: "Dormant",
      description: "No visit in 3+ months",
      nextAction: "Win-back campaign with incentive"
    };
  }
  
  // Check for New (first 30 days)
  if (accountAgeDays <= 30 && customer.total_visits <= 2) {
    return {
      stage: "New",
      description: "First visit within last month",
      nextAction: "Welcome message, invite back soon"
    };
  }
  
  // Onboarding (2-3 visits, within first 90 days)
  if (customer.total_visits >= 2 && customer.total_visits <= 3 && accountAgeDays <= 90) {
    return {
      stage: "Onboarding",
      description: "Building relationship",
      nextAction: "Encourage 4th visit (makes them sticky)"
    };
  }
  
  // Check for Reactivated
  if (customer.tags?.includes("Reactivated") || 
      (daysSinceLastVisit < 30 && customer.total_visits > 3)) {
    return {
      stage: "Reactivated",
      description: "Returned after being dormant",
      nextAction: "Welcome back, ensure great experience"
    };
  }
  
  // Establishing (4-9 visits)
  if (customer.total_visits >= 4 && customer.total_visits <= 9) {
    return {
      stage: "Establishing",
      description: "Becoming a regular",
      nextAction: "VIP program invitation"
    };
  }
  
  // Regular (10+ visits, recent)
  return {
    stage: "Regular",
    description: "Consistent customer",
    nextAction: "Maintain relationship, upsell"
  };
}

export function getLifecycleColor(stage: LifecycleStage): string {
  switch (stage) {
    case "New":
      return "bg-cyan-100 text-cyan-800";
    case "Onboarding":
      return "bg-blue-100 text-blue-800";
    case "Establishing":
      return "bg-indigo-100 text-indigo-800";
    case "Regular":
      return "bg-green-100 text-green-800";
    case "VIP":
      return "bg-purple-100 text-purple-800";
    case "Dormant":
      return "bg-red-100 text-red-800";
    case "Reactivated":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// =============================================
// Win-Back Campaign Tags
// =============================================

export interface WinBackRecommendation {
  tag: string;
  discountLevel: number; // suggested discount %
  urgency: "Low" | "Medium" | "High" | "Critical";
  message: string;
}

/**
 * Generate win-back campaign recommendations based on customer status
 */
export function generateWinBackRecommendation(customer: Customer): WinBackRecommendation | null {
  const rfm = calculateRFMSegment(customer);
  const health = calculateHealthScore(customer);
  const lifecycle = calculateLifecycleStage(customer);
  
  // Skip healthy customers
  if (health.status === "Healthy" && lifecycle.stage !== "Dormant") {
    return null;
  }
  
  const daysSinceLastVisit = customer.last_visit_date 
    ? Math.floor((new Date().getTime() - new Date(customer.last_visit_date).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  
  // Determine discount level and urgency
  let discountLevel = 10;
  let urgency: "Low" | "Medium" | "High" | "Critical" = "Low";
  let tag = "";
  let message = "";
  
  if (rfm.segment === "Cannot Lose Them") {
    discountLevel = 25;
    urgency = "Critical";
    tag = "Win-Back: VIP Recovery";
    message = "We miss you! Your table is waiting with 25% off your next visit.";
  } else if (rfm.segment === "At Risk" && customer.total_visits >= 5) {
    discountLevel = 20;
    urgency = "High";
    tag = "Win-Back: Loyal Customer";
    message = "Come back and enjoy 20% off - we'd love to see you again!";
  } else if (daysSinceLastVisit > 90 && daysSinceLastVisit <= 180) {
    discountLevel = 15;
    urgency = "Medium";
    tag = "Win-Back: 3+ Months";
    message = "It's been a while! Here's 15% off to welcome you back.";
  } else if (daysSinceLastVisit > 180) {
    discountLevel = 25;
    urgency = "High";
    tag = "Win-Back: 6+ Months";
    message = "We haven't seen you in 6 months! Come back with 25% off.";
  } else if (health.status === "At Risk") {
    discountLevel = 15;
    urgency = "Medium";
    tag = "Win-Back: At Risk";
    message = "Special 15% off just for you - don't miss out!";
  } else {
    return null;
  }
  
  return { tag, discountLevel, urgency, message };
}

// =============================================
// Visit Pattern Analysis
// =============================================

export type VisitPattern = 
  | "Weekend Warrior" 
  | "Weekday Regular" 
  | "Special Occasion" 
  | "Consistent" 
  | "Irregular";

export interface PatternInfo {
  pattern: VisitPattern;
  description: string;
  bestOfferDay: string;
}

/**
 * Analyze customer visit patterns for targeted offers
 * Note: This is a simplified version - for full implementation, 
 * you'd need visit history data
 */
export function analyzeVisitPattern(customer: Customer): PatternInfo {
  // Simplified pattern detection based on available data
  if (customer.total_visits === 0) {
    return {
      pattern: "Irregular",
      description: "No visits recorded",
      bestOfferDay: "Weekend"
    };
  }
  
  if (customer.total_visits === 1) {
    return {
      pattern: "Special Occasion",
      description: "One-time visitor",
      bestOfferDay: "Weekend"
    };
  }
  
  // For customers with more visits, we'd need historical data
  // This is a placeholder that categorizes based on visit frequency
  const reliability = customer.reliability_score || 100;
  
  if (reliability >= 90 && customer.total_visits >= 5) {
    return {
      pattern: "Consistent",
      description: "Reliable, regular visitor",
      bestOfferDay: "Any day"
    };
  } else if (customer.total_visits >= 3) {
    return {
      pattern: "Weekend Warrior",
      description: "Likely visits on weekends",
      bestOfferDay: "Friday-Sunday"
    };
  } else {
    return {
      pattern: "Weekday Regular",
      description: "Visits during week",
      bestOfferDay: "Tuesday-Thursday"
    };
  }
}

// =============================================
// Export all for use in components
// =============================================

export const CustomerAnalytics = {
  calculateRFMSegment,
  getRFMSegmentColor,
  calculateHealthScore,
  getHealthScoreColor,
  calculateLifecycleStage,
  getLifecycleColor,
  generateWinBackRecommendation,
  analyzeVisitPattern
};

export default CustomerAnalytics;
