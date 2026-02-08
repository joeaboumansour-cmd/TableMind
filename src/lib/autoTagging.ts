// Auto-Tagging System for TableMind
// Analyzes customer behavior and automatically assigns intelligent tags

export interface Customer {
  id: string;
  name: string;
  total_visits: number;
  no_show_count: number;
  cancellations_count?: number;
  average_spend?: number;
  preferred_days?: string[];
  preferred_tables?: string[];
  average_party_size?: number;
  visit_history: Visit[];
  existing_tags: string[];
}

export interface Visit {
  id: string;
  visit_date: string;
  day_of_week: string;
  table_id: string;
  table_name: string;
  party_size: number;
  total_spend?: number;
  items_ordered?: string[];
  status: "completed" | "no_show" | "cancelled";
  notes?: string;
}

export interface AutoTag {
  tag: string;
  description: string;
  confidence: number; // 0-100
  criteria: string;
  color: string;
}

// Tag definitions with criteria
export const TAG_DEFINITIONS = {
  // Visit-based tags
  VIP: {
    description: "High-value frequent customer",
    criteria: (c: Customer) => c.total_visits >= 15,
    color: "bg-yellow-500",
  },
  Regular: {
    description: "Comes in frequently",
    criteria: (c: Customer) => c.total_visits >= 5 && c.total_visits < 15,
    color: "bg-blue-500",
  },
  NewCustomer: {
    description: "First-time guest",
    criteria: (c: Customer) => c.total_visits === 1,
    color: "bg-green-500",
  },

  // Risk-based tags
  HighCancellationRisk: {
    description: "History of cancellations",
    criteria: (c: Customer) => (c.cancellations_count || 0) >= 2,
    color: "bg-red-500",
  },
  NoShowRisk: {
    description: "Has missed reservations before",
    criteria: (c: Customer) => c.no_show_count >= 1,
    color: "bg-orange-500",
  },
  Reliable: {
    description: "Always shows up",
    criteria: (c: Customer) => c.total_visits >= 5 && c.no_show_count === 0,
    color: "bg-emerald-500",
  },

  // Pattern-based tags
  FrequentFridayDiner: {
    description: "Often visits on Fridays",
    criteria: (c: Customer) => {
      if (!c.visit_history || c.visit_history.length < 3) return false;
      const fridayVisits = c.visit_history.filter(
        (v) => v.day_of_week === "Friday" && v.status === "completed"
      ).length;
      return fridayVisits >= 3;
    },
    color: "bg-purple-500",
  },
  WeekendWarrior: {
    description: "Prefers weekend dining",
    criteria: (c: Customer) => {
      if (!c.visit_history || c.visit_history.length < 3) return false;
      const weekendVisits = c.visit_history.filter(
        (v) =>
          (v.day_of_week === "Friday" ||
            v.day_of_week === "Saturday" ||
            v.day_of_week === "Sunday") &&
          v.status === "completed"
      ).length;
      return weekendVisits / c.visit_history.length >= 0.7;
    },
    color: "bg-indigo-500",
  },
  WeekdayRegular: {
    description: "Prefers weekday dining",
    criteria: (c: Customer) => {
      if (!c.visit_history || c.visit_history.length < 3) return false;
      const weekdayVisits = c.visit_history.filter(
        (v) =>
          !["Friday", "Saturday", "Sunday"].includes(v.day_of_week) &&
          v.status === "completed"
      ).length;
      return weekdayVisits / c.visit_history.length >= 0.7;
    },
    color: "bg-cyan-500",
  },

  // Party size tags
  LargePartyOrganizer: {
    description: "Brings big groups",
    criteria: (c: Customer) =>
      c.average_party_size !== undefined && c.average_party_size >= 6,
    color: "bg-pink-500",
  },
  IntimateDiner: {
    description: "Prefers small tables",
    criteria: (c: Customer) =>
      c.average_party_size !== undefined &&
      c.average_party_size <= 2 &&
      c.total_visits >= 3,
    color: "bg-rose-500",
  },

  // Spending-based tags
  HighSpender: {
    description: "Above-average spending",
    criteria: (c: Customer) =>
      c.average_spend !== undefined && c.average_spend >= 100,
    color: "bg-amber-500",
  },
  ValueSeeker: {
    description: "Prefers budget-friendly options",
    criteria: (c: Customer) =>
      c.average_spend !== undefined &&
      c.average_spend <= 40 &&
      c.total_visits >= 3,
    color: "bg-lime-500",
  },

  // Order preference tags (based on order history)
  WineLover: {
    description: "Frequently orders wine",
    criteria: (c: Customer) => {
      if (!c.visit_history) return false;
      const wineOrders = c.visit_history.filter(
        (v) => v.items_ordered && v.items_ordered.some((item) =>
          item.toLowerCase().includes("wine")
        )
      ).length;
      return wineOrders >= 3;
    },
    color: "bg-violet-500",
  },
  DessertSkipper: {
    description: "Rarely orders dessert",
    criteria: (c: Customer) => {
      if (!c.visit_history || c.visit_history.length < 3) return false;
      const withDessert = c.visit_history.filter(
        (v) => v.items_ordered && v.items_ordered.some((item) =>
          item.toLowerCase().includes("dessert")
        )
      ).length;
      return withDessert / c.visit_history.length <= 0.2;
    },
    color: "bg-teal-500",
  },
  AppetizerFan: {
    description: "Always starts with appetizers",
    criteria: (c: Customer) => {
      if (!c.visit_history) return false;
      const withAppetizer = c.visit_history.filter(
        (v) => v.items_ordered && v.items_ordered.some((item) =>
          item.toLowerCase().includes("appetizer")
        )
      ).length;
      return withAppetizer >= 3;
    },
    color: "bg-sky-500",
  },

  // Special occasion tags
  AnniversaryRegular: {
    description: "Celebrates anniversaries here",
    criteria: (c: Customer) => {
      if (!c.visit_history) return false;
      return c.visit_history.some(
        (v) => v.notes && v.notes.toLowerCase().includes("anniversary")
      );
    },
    color: "bg-red-400",
  },
  BirthdayCelebrator: {
    description: "Celebrates birthdays here",
    criteria: (c: Customer) => {
      if (!c.visit_history) return false;
      return c.visit_history.some(
        (v) => v.notes && v.notes.toLowerCase().includes("birthday")
      );
    },
    color: "bg-fuchsia-500",
  },
} as const;

// Calculate auto-tags for a customer
export function calculateAutoTags(customer: Customer): AutoTag[] {
  const tags: AutoTag[] = [];

  for (const [tagName, definition] of Object.entries(TAG_DEFINITIONS)) {
    try {
      if (definition.criteria(customer)) {
        // Check if not already manually tagged
        if (!customer.existing_tags.includes(tagName)) {
          tags.push({
            tag: tagName,
            description: definition.description,
            confidence: calculateConfidence(customer, tagName),
            criteria: getCriteriaDescription(tagName),
            color: definition.color,
          });
        }
      }
    } catch (e) {
      console.error(`Error calculating tag ${tagName}:`, e);
    }
  }

  // Sort by confidence (highest first)
  return tags.sort((a, b) => b.confidence - a.confidence);
}

// Calculate confidence score based on data quality
function calculateConfidence(customer: Customer, tagName: string): number {
  const baseConfidence = 80;
  let adjustments = 0;

  // More visits = higher confidence for pattern-based tags
  if (customer.total_visits >= 10) adjustments += 10;
  else if (customer.total_visits >= 5) adjustments += 5;
  else if (customer.total_visits < 3) adjustments -= 10;

  // Recent activity increases confidence
  if (customer.visit_history && customer.visit_history.length > 0) {
    const lastVisit = new Date(customer.visit_history[0].visit_date);
    const daysSinceLastVisit =
      (Date.now() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastVisit < 30) adjustments += 5;
    else if (daysSinceLastVisit > 90) adjustments -= 5;
  }

  // Risk-based tags are more confident with more data
  if (tagName.includes("Risk") && customer.total_visits >= 5) {
    adjustments += 10;
  }

  return Math.min(100, Math.max(0, baseConfidence + adjustments));
}

// Get human-readable criteria description
function getCriteriaDescription(tagName: string): string {
  const descriptions: Record<string, string> = {
    VIP: "15+ visits",
    Regular: "5-14 visits",
    NewCustomer: "First visit",
    HighCancellationRisk: "2+ cancellations",
    NoShowRisk: "1+ no-shows",
    Reliable: "5+ visits, 0 no-shows",
    FrequentFridayDiner: "3+ Friday visits",
    WeekendWarrior: "70%+ weekend visits",
    WeekdayRegular: "70%+ weekday visits",
    LargePartyOrganizer: "Average party 6+",
    IntimateDiner: "Average party 2 or less",
    HighSpender: "$100+ average spend",
    ValueSeeker: "$40 or less average spend",
    WineLover: "Orders wine 3+ times",
    DessertSkipper: "Skips dessert 80%+ of time",
    AppetizerFan: "Orders appetizers 3+ times",
    AnniversaryRegular: "Celebrated anniversary here",
    BirthdayCelebrator: "Celebrated birthday here",
  };

  return descriptions[tagName] || "Based on dining patterns";
}

// Get suggested actions based on tags
export function getTagInsights(customer: Customer, tags: AutoTag[]): string[] {
  const insights: string[] = [];

  // VIP insights
  if (tags.some((t) => t.tag === "VIP")) {
    insights.push("🌟 VIP guest - Offer complimentary appetizer or dessert");
    insights.push("💡 Consider offering preferred seating");
  }

  // Risk insights
  if (tags.some((t) => t.tag === "HighCancellationRisk")) {
    insights.push("⚠️ High cancellation risk - Send reminder 24h before");
    insights.push("📞 Consider calling to confirm reservation");
  }

  if (tags.some((t) => t.tag === "NoShowRisk")) {
    insights.push("⚠️ No-show history - May require deposit for large parties");
  }

  // Pattern insights
  if (tags.some((t) => t.tag === "FrequentFridayDiner")) {
    insights.push("📅 Regular Friday diner - Save their favorite table");
  }

  if (tags.some((t) => t.tag === "WineLover")) {
    insights.push("🍷 Wine enthusiast - Offer wine pairing suggestions");
    insights.push("💡 Consider wine specials for this guest");
  }

  if (tags.some((t) => t.tag === "DessertSkipper")) {
    insights.push("🍰 Rarely orders dessert - Don't push dessert menu");
  }

  if (tags.some((t) => t.tag === "LargePartyOrganizer")) {
    insights.push("👥 Brings large groups - Ensure adequate staffing");
    insights.push("💡 Perfect for group dining promotions");
  }

  if (tags.some((t) => t.tag === "HighSpender")) {
    insights.push("💰 High spender - Upsell premium options");
  }

  // Combined insights
  if (
    tags.some((t) => t.tag === "AnniversaryRegular") ||
    tags.some((t) => t.tag === "BirthdayCelebrator")
  ) {
    insights.push("🎉 Special occasion guest - Prepare celebration dessert");
  }

  return insights;
}

// Batch process all customers
export async function batchProcessAutoTags(
  customers: Customer[],
  onProgress?: (processed: number, total: number) => void
): Promise<Map<string, AutoTag[]>> {
  const results = new Map<string, AutoTag[]>();

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const tags = calculateAutoTags(customer);
    results.set(customer.id, tags);

    if (onProgress) {
      onProgress(i + 1, customers.length);
    }

    // Small delay to prevent blocking
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}

// Export tag suggestions for a customer
export function exportTagSuggestions(customer: Customer): {
  customer: string;
  suggestedTags: AutoTag[];
  insights: string[];
  actionItems: string[];
} {
  const tags = calculateAutoTags(customer);
  const insights = getTagInsights(customer, tags);

  return {
    customer: customer.name,
    suggestedTags: tags,
    insights,
    actionItems: insights.filter((i) =>
      i.startsWith("⚠️") || i.startsWith("💡")
    ),
  };
}
