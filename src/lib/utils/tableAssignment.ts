import type { Table, Reservation, Customer } from "@/lib/types";

// ============================================
// Smart Table Assignment Algorithm
// Inspired by Servme's auto-assign feature
// ============================================

export interface TableAssignmentCriteria {
  partySize: number;
  preferredSection?: string;
  customerId?: string;
  customerTags?: string[];
  reservationTime?: string;
  duration?: number; // in minutes
  isVip?: boolean;
  accessibilityNeeded?: boolean;
  preferredTableIds?: string[]; // Customer's preferred tables
  avoidTableIds?: string[]; // Tables to avoid
}

export interface TableScore {
  table: Table;
  score: number;
  reasons: string[];
  isOptimal: boolean;
}

export interface AssignmentResult {
  recommendedTable: Table | null;
  alternatives: Table[];
  score: number;
  explanation: string;
}

// ============================================
// Scoring Factors
// ============================================
const SCORE_WEIGHTS = {
  CAPACITY_MATCH: 30,      // Exact capacity match is best
  PREFERRED_TABLE: 25,     // Customer's preferred table
  SECTION_PREFERENCE: 15,  // Preferred section
  VIP_TREATMENT: 15,       // VIP customers get better tables
  ROTATION_FAIRNESS: 10,   // Fair rotation among servers/sections
  ACCESSIBILITY: 5,        // Accessibility needs
  PROXIMITY: 5,            // Proximity to kitchen/bar/entrance
};

// ============================================
// Main Assignment Algorithm
// ============================================
export function findOptimalTable(
  availableTables: Table[],
  criteria: TableAssignmentCriteria,
  recentAssignments: Map<string, number> = new Map() // table_id -> count today
): AssignmentResult {
  
  if (availableTables.length === 0) {
    return {
      recommendedTable: null,
      alternatives: [],
      score: 0,
      explanation: "No tables available"
    };
  }

  // Score each table
  const scoredTables: TableScore[] = availableTables.map(table => {
    const scoreResult = calculateTableScore(table, criteria, recentAssignments);
    return {
      table,
      score: scoreResult.score,
      reasons: scoreResult.reasons,
      isOptimal: false
    };
  });

  // Sort by score descending
  scoredTables.sort((a, b) => b.score - a.score);

  // Mark top tables as optimal (within 10% of highest score)
  const maxScore = scoredTables[0].score;
  const optimalThreshold = maxScore * 0.9;
  
  scoredTables.forEach(st => {
    st.isOptimal = st.score >= optimalThreshold;
  });

  // Get recommended and alternatives
  const recommended = scoredTables[0];
  const alternatives = scoredTables
    .slice(1, 4)
    .filter(st => st.score > 0)
    .map(st => st.table);

  return {
    recommendedTable: recommended.table,
    alternatives,
    score: recommended.score,
    explanation: generateExplanation(recommended)
  };
}

// ============================================
// Score Calculation
// ============================================
function calculateTableScore(
  table: Table,
  criteria: TableAssignmentCriteria,
  recentAssignments: Map<string, number>
): { score: number; reasons: string[] } {
  
  let score = 0;
  const reasons: string[] = [];

  // 1. Capacity Match (highest weight)
  const capacityScore = calculateCapacityScore(table, criteria.partySize);
  score += capacityScore.score;
  if (capacityScore.reason) reasons.push(capacityScore.reason);

  // 2. Preferred Table
  if (criteria.preferredTableIds?.includes(table.id)) {
    score += SCORE_WEIGHTS.PREFERRED_TABLE;
    reasons.push("Customer's preferred table");
  }

  // 3. Section Preference
  if (criteria.preferredSection && table.section === criteria.preferredSection) {
    score += SCORE_WEIGHTS.SECTION_PREFERENCE;
    reasons.push(`In preferred ${table.section} section`);
  }

  // 4. VIP Treatment - VIPs get best tables (higher capacity, better location)
  if (criteria.isVip) {
    const vipBonus = calculateVipBonus(table);
    score += vipBonus.score;
    if (vipBonus.reason) reasons.push(vipBonus.reason);
  }

  // 5. Rotation Fairness - Don't overuse the same tables
  const usageCount = recentAssignments.get(table.id) || 0;
  if (usageCount > 0) {
    const rotationPenalty = Math.min(usageCount * 2, SCORE_WEIGHTS.ROTATION_FAIRNESS);
    score -= rotationPenalty;
    if (rotationPenalty > 0) {
      reasons.push(`Used ${usageCount} times today (rotation)`);
    }
  } else {
    score += SCORE_WEIGHTS.ROTATION_FAIRNESS;
    reasons.push("Available for rotation");
  }

  // 6. Avoid tables
  if (criteria.avoidTableIds?.includes(table.id)) {
    score -= 50; // Heavy penalty
    reasons.push("Table in avoid list");
  }

  // 7. Accessibility
  if (criteria.accessibilityNeeded && isAccessibleTable(table)) {
    score += SCORE_WEIGHTS.ACCESSIBILITY;
    reasons.push("Accessibility friendly");
  }

  return { score: Math.max(0, score), reasons };
}

// ============================================
// Capacity Scoring
// ============================================
function calculateCapacityScore(table: Table, partySize: number): { score: number; reason: string | null } {
  const capacity = table.capacity || 4;
  const minCapacity = table.min_capacity || 1;
  const maxCapacity = table.max_capacity || capacity;

  // Too small
  if (capacity < partySize) {
    return { score: 0, reason: null };
  }

  // Perfect match
  if (capacity === partySize) {
    return { 
      score: SCORE_WEIGHTS.CAPACITY_MATCH, 
      reason: "Perfect capacity match" 
    };
  }

  // Slightly larger (good)
  if (capacity <= partySize + 2) {
    const efficiency = 1 - ((capacity - partySize) / capacity);
    return { 
      score: Math.round(SCORE_WEIGHTS.CAPACITY_MATCH * efficiency),
      reason: `Good fit (${capacity} seats for ${partySize})`
    };
  }

  // Much larger (less efficient)
  const efficiency = Math.max(0.3, 1 - ((capacity - partySize) / capacity));
  return { 
    score: Math.round(SCORE_WEIGHTS.CAPACITY_MATCH * efficiency * 0.5),
    reason: `Roomy but less efficient`
  };
}

// ============================================
// VIP Bonus Calculation
// ============================================
function calculateVipBonus(table: Table): { score: number; reason: string | null } {
  let bonus = 0;
  const reasons: string[] = [];

  // VIPs prefer tables with capacity for comfortable dining
  if ((table.capacity || 4) >= 4) {
    bonus += 8;
    reasons.push("VIP suitable capacity");
  }

  // VIPs get priority on "prime" tables (can be marked in metadata)
  if (table.section?.toLowerCase().includes('vip') || 
      table.section?.toLowerCase().includes('window') ||
      table.section?.toLowerCase().includes('patio')) {
    bonus += 7;
    reasons.push("VIP/Prime location");
  }

  return { 
    score: Math.min(bonus, SCORE_WEIGHTS.VIP_TREATMENT),
    reason: reasons.join(', ') || null
  };
}

// ============================================
// Accessibility Check
// ============================================
function isAccessibleTable(table: Table): boolean {
  // Can be extended with actual accessibility data
  // For now, assume ground floor or main dining area is accessible
  return !table.room_name?.toLowerCase().includes('upstairs') &&
         !table.room_name?.toLowerCase().includes('basement');
}

// ============================================
// Generate Human-readable Explanation
// ============================================
function generateExplanation(scoredTable: TableScore): string {
  if (scoredTable.reasons.length === 0) {
    return "Selected based on availability";
  }
  
  const topReasons = scoredTable.reasons.slice(0, 3);
  return `Selected: ${topReasons.join("; ")}`;
}

// ============================================
// Batch Assignment for Multiple Reservations
// ============================================
export interface BatchAssignment {
  reservation: Reservation;
  assignedTable: Table | null;
  score: number;
  alternatives: Table[];
}

export function batchAssignTables(
  reservations: Reservation[],
  availableTables: Table[],
  customers: Map<string, Customer>,
  recentAssignments: Map<string, number> = new Map()
): BatchAssignment[] {
  
  const assignments: BatchAssignment[] = [];
  const remainingTables = [...availableTables];
  
  // Sort reservations by priority (VIP first, then by time)
  const sortedReservations = [...reservations].sort((a, b) => {
    const aCustomer = a.customer_id ? customers.get(a.customer_id) : null;
    const bCustomer = b.customer_id ? customers.get(b.customer_id) : null;
    
    const aIsVip = aCustomer?.tags?.includes('VIP') || false;
    const bIsVip = bCustomer?.tags?.includes('VIP') || false;
    
    if (aIsVip && !bIsVip) return -1;
    if (!aIsVip && bIsVip) return 1;
    
    // Then by time
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  for (const reservation of sortedReservations) {
    const customer = reservation.customer_id ? customers.get(reservation.customer_id) : null;
    
    const criteria: TableAssignmentCriteria = {
      partySize: reservation.party_size,
      customerId: reservation.customer_id || undefined,
      customerTags: customer?.tags,
      isVip: customer?.tags?.includes('VIP') || false,
      preferredTableIds: customer?.preferred_table_id ? [customer.preferred_table_id] : undefined,
      reservationTime: reservation.start_time,
    };

    const result = findOptimalTable(remainingTables, criteria, recentAssignments);
    
    assignments.push({
      reservation,
      assignedTable: result.recommendedTable,
      score: result.score,
      alternatives: result.alternatives
    });

    // Remove assigned table from available pool
    if (result.recommendedTable) {
      const index = remainingTables.findIndex(t => t.id === result.recommendedTable!.id);
      if (index > -1) {
        remainingTables.splice(index, 1);
      }
      
      // Update usage count
      const currentCount = recentAssignments.get(result.recommendedTable.id) || 0;
      recentAssignments.set(result.recommendedTable.id, currentCount + 1);
    }
  }

  return assignments;
}

// ============================================
// Section Rotation for Fairness
// ============================================
export function calculateSectionRotation(
  tables: Table[],
  assignments: Map<string, number>
): Map<string, number> {
  const sectionCounts = new Map<string, number>();
  
  // Count assignments per section
  tables.forEach(table => {
    const section = table.section || 'Main';
    const count = assignments.get(table.id) || 0;
    sectionCounts.set(section, (sectionCounts.get(section) || 0) + count);
  });

  return sectionCounts;
}

export function suggestUnderutilizedSection(
  tables: Table[],
  assignments: Map<string, number>
): string | null {
  const sectionCounts = calculateSectionRotation(tables, assignments);
  
  if (sectionCounts.size === 0) return null;
  
  // Find section with fewest assignments
  let minSection: string | null = null;
  let minCount = Infinity;
  
  sectionCounts.forEach((count, section) => {
    if (count < minCount) {
      minCount = count;
      minSection = section;
    }
  });

  return minSection;
}

// ============================================
// Quick Suggest for Real-time Use
// ============================================
export function quickSuggestTable(
  partySize: number,
  availableTables: Table[],
  customer?: Customer
): Table | null {
  
  const criteria: TableAssignmentCriteria = {
    partySize,
    customerId: customer?.id,
    customerTags: customer?.tags,
    isVip: customer?.tags?.includes('VIP') || false,
    preferredTableIds: customer?.preferred_table_id ? [customer.preferred_table_id] : undefined,
  };

  const result = findOptimalTable(availableTables, criteria);
  return result.recommendedTable;
}
