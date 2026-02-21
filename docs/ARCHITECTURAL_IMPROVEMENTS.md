# GoldenSquirrel Architectural Improvements

## Overview

This document summarizes the architectural improvements implemented based on expert feedback. These changes enhance the database schema for better multi-tenancy, allergy management, and reservation reliability tracking.

---

## 1. "Ghost" Tables - RESOLVED ✅

**Issue:** The feedback mentioned that `table_id` was referenced in reservations and customer_visit_logs but no `tables` table was defined.

**Resolution:** The `tables` table already exists in the schema with:
- Core fields: `id`, `restaurant_id`, `name`, `capacity`, `shape`, `sort_order`
- Multi-tenancy: Proper `restaurant_id` foreign key
- RLS policies: Tenant isolation

**Enhancement Added:** Floor plan positioning support
```sql
ALTER TABLE tables 
ADD COLUMN room_name TEXT,      -- e.g., 'Patio', 'Main Dining', 'Bar'
ADD COLUMN section TEXT,         -- e.g., 'North Wing', 'VIP Area'
ADD COLUMN position_x DECIMAL,   -- X coordinate for floor plan
ADD COLUMN position_y DECIMAL;   -- Y coordinate for floor plan
```

**Benefits:**
- Visual floor plan layout support
- Room-based filtering (e.g., "Show all patio tables")
- Section-based table management

---

## 2. Analytics Redundancy - OPTIMIZED ✅

**Issue:** The feedback mentioned potential redundancy between `customers` and `customer_analytics` tables.

**Resolution:** The `customer_analytics` is actually a **VIEW**, not a table - this is the correct architecture:

```sql
CREATE VIEW customer_analytics AS
SELECT 
    c.*,
    -- Calculated reliability score (0-100)
    (c.total_visits / NULLIF(c.total_visits + c.no_show_count + c.cancellation_count, 0)) * 100 as reliability_score,
    -- Risk level classification
    CASE 
        WHEN c.no_show_count >= 2 OR c.cancellation_count >= 3 THEN 'High'
        WHEN c.no_show_count >= 1 OR c.cancellation_count >= 2 THEN 'Medium'
        ELSE 'Low'
    END as risk_level
FROM customers c;
```

**Single Source of Truth:**
- The `customers` table holds the raw data (`total_visits`, `no_show_count`, `cancellation_count`)
- Postgres **TRIGGERS** automatically update these stats when reservations change status
- The VIEW provides calculated metrics without data duplication

**Note:** Uses `current_setting('app.current_restaurant_id')` for tenant isolation (consistent with existing schema)

**Triggers in Place:**
- `reservation_status_change` - Updates customer stats on status changes
- `update_customer_punctuality` - Updates punctuality metrics

---

## 3. Allergy Management - RESTRUCTURED ✅

**Issue:** `dietary_restrictions` was a text field, making it hard to query (e.g., "Show all customers with Nut allergies")

**Solution:** Implemented a proper allergy management system

### New Tables

#### 1. `allergies` - Master Allergy List
```sql
CREATE TABLE allergies (
    id UUID PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,           -- e.g., 'Peanuts', 'Gluten'
    category TEXT,                        -- 'food', 'environmental', 'medical'
    severity_level TEXT,                  -- 'mild', 'moderate', 'severe', 'life_threatening'
    description TEXT
);
```

**Pre-populated with common allergens:**
- Peanuts, Tree Nuts, Milk/Dairy, Eggs
- Wheat/Gluten, Soy, Fish, Shellfish
- Sesame, Mustard, Sulfites, Nightshades

#### 2. `customer_allergies` - Junction Table
```sql
CREATE TABLE customer_allergies (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id),
    allergy_id UUID REFERENCES allergies(id),  -- NULL for custom allergies
    custom_allergy_name TEXT,                   -- For custom allergies not in master list
    severity TEXT,                              -- 'mild', 'moderate', 'severe', 'life_threatening'
    notes TEXT
);
```

**Key Features:**
- Supports both standard and custom allergies
- Per-customer severity levels
- Queryable structure for filtering

### Helper Functions

#### `get_customers_by_allergy(restaurant_id, allergy_name)`
```sql
-- Find all customers with a specific allergy
SELECT * FROM get_customers_by_allergy(
    'restaurant-uuid',
    'Peanuts'
);
```

#### `add_customer_allergy(customer_id, allergy_name, severity, notes)`
```sql
-- Add allergy to customer with auto-tagging
SELECT add_customer_allergy(
    'customer-uuid',
    'Peanuts',
    'life_threatening',
    'EpiPen required'
);
```

### Enhanced customer_analytics View
The view now includes an `allergies` array for quick access:
```sql
SELECT 
    c.*,
    COALESCE(
        (SELECT array_agg(DISTINCT COALESCE(a.name, ca.custom_allergy_name))
         FROM customer_allergies ca
         LEFT JOIN allergies a ON ca.allergy_id = a.id
         WHERE ca.customer_id = c.id),
        ARRAY[]::text[]
    ) as allergies
FROM customers c;
```

---

## 4. Reservation Flow Refinement - ENHANCED ✅

### Reservation Status Enum
Already includes all recommended statuses:
```sql
CREATE TYPE reservation_status AS ENUM (
    'booked',      -- Initial booking
    'confirmed',   -- Confirmed by staff/customer
    'seated',      -- Guest has arrived and been seated
    'finished',    -- Meal completed
    'cancelled',   -- Cancelled by guest or staff
    'no_show'      -- Guest didn't show up
);
```

### New: Punctuality Tracking (`minutes_early_late`)
Added the "genius" reliability metric mentioned in feedback:

```sql
ALTER TABLE reservations 
ADD COLUMN minutes_early_late INTEGER,  -- Positive = late, Negative = early
ADD COLUMN actual_seated_at TIMESTAMPTZ;
```

**Automatic Calculation:**
```sql
CREATE TRIGGER calculate_reservation_punctuality
    BEFORE UPDATE ON reservations
    WHEN (NEW.actual_seated_at IS DISTINCT FROM OLD.actual_seated_at)
    EXECUTE FUNCTION calculate_punctuality();

-- Function automatically calculates:
-- minutes_early_late = EXTRACT(EPOCH FROM (actual_seated_at - start_time)) / 60
```

### Customer Punctuality Stats
New columns in `customers` table:
```sql
ALTER TABLE customers 
ADD COLUMN avg_minutes_late DECIMAL(10,2),
ADD COLUMN early_count INTEGER DEFAULT 0,
ADD COLUMN late_count INTEGER DEFAULT 0;
```

**Automatic Updates:**
- When a reservation gets an `actual_seated_at` timestamp
- System recalculates customer's average punctuality
- Updates early/late counts

**Customer Analytics View Enhancement:**
```sql
SELECT 
    c.*,
    CASE 
        WHEN c.late_count::NUMERIC / NULLIF(c.total_visits, 0) > 0.3 THEN 'Often Late'
        WHEN c.late_count::NUMERIC / NULLIF(c.total_visits, 0) > 0.1 THEN 'Sometimes Late'
        ELSE 'Punctual'
    END as punctuality_rating
FROM customers c;
```

---

## 5. Enhanced Views

### `reservation_details` View
Complete reservation information with joins:
```sql
SELECT 
    r.*,
    t.name as table_name,
    t.room_name,
    c.name as customer_full_name,
    ca.allergies as customer_allergies,
    EXTRACT(EPOCH FROM (r.end_time - r.start_time)) / 60 as duration_minutes,
    CASE 
        WHEN r.minutes_early_late < -5 THEN 'Early'
        WHEN r.minutes_early_late <= 5 THEN 'On Time'
        ELSE 'Late'
    END as punctuality_status
FROM reservations r
LEFT JOIN tables t ON r.table_id = t.id
LEFT JOIN customers c ON r.customer_id = c.id
LEFT JOIN customer_analytics ca ON c.id = ca.id;
```

### `customer_analytics` View
Comprehensive customer insights:
- Basic info + stats
- Reliability score (0-100)
- Risk level (Low/Medium/High)
- Punctuality metrics
- Allergies array

---

## 6. TypeScript Types Updated

### New Types Added to `src/lib/types/database.ts`:

```typescript
// Allergy Management
export type AllergySeverity = "mild" | "moderate" | "severe" | "life_threatening";
export type PunctualityRating = "Unknown" | "Early" | "On Time" | "Late" | "Often Late" | "Sometimes Late" | "Punctual";
export type RiskLevel = "Low" | "Medium" | "High";

// Enhanced Entities
export interface Allergy { ... }
export interface CustomerAllergy { ... }
export interface CustomerAnalytics extends Customer { ... }
export interface ReservationDetails extends Reservation { ... }
```

### Enhanced Interfaces:
- `Table` - Added `room_name`, `section`, `position_x`, `position_y`
- `Reservation` - Added `minutes_early_late`, `actual_seated_at`, `no_show`
- `Customer` - Added `avg_minutes_late`, `early_count`, `late_count`, `allergies`

---

## 7. New Service: Allergy Management

Created `src/lib/allergies/service.ts` with:

### CRUD Operations
- `getAllAllergies()` - Fetch master allergy list
- `searchAllergies(query)` - Search allergies
- `getCustomerAllergies(customerId)` - Get customer's allergies
- `addAllergyToCustomer(customerId, formData)` - Add allergy via RPC
- `removeCustomerAllergy(customerAllergyId)` - Remove allergy
- `updateAllergySeverity(id, severity, notes)` - Update severity

### Reporting
- `getCustomersByAllergy(restaurantId, allergyName)` - Find customers by allergy
- `getMostCommonAllergies(restaurantId, limit)` - Analytics on common allergies

### UI Helpers
- `getSeverityColor(severity)` - Color coding for severity levels
- `getSeverityLabel(severity)` - Emoji + label (🚨 Life Threatening)
- `formatAllergiesForDisplay(allergies)` - Format for lists
- `hasLifeThreateningAllergy(allergies)` - Safety check

---

## 8. Migration File

**File:** `supabase/migration_architectural_improvements.sql`

Run this in Supabase SQL Editor to apply all improvements:

```bash
# All changes are in a single migration file
supabase/migration_architectural_improvements.sql
```

**Includes:**
1. Table enhancements (room_name, section, positioning)
2. Allergies table creation
3. Customer allergies junction table
4. Reservation punctuality tracking
5. Customer punctuality stats
6. Enhanced analytics views
7. Helper functions (RPC)
8. RLS policies
9. Indexes for performance

---

## Summary of Benefits

| Feature | Before | After |
|---------|--------|-------|
| **Table Organization** | Flat list | Rooms + Sections + Floor plan positions |
| **Allergy Tracking** | Text field (unqueryable) | Structured tables with severity levels |
| **Reliability Scoring** | Basic visit count | Punctuality tracking + Risk assessment |
| **Analytics** | Potential redundancy | Single source of truth with VIEWs |
| **Reservation Status** | Basic statuses | Full lifecycle + no_show tracking |

---

## Next Steps

1. **Run the migration** in Supabase SQL Editor
2. **Update API routes** to use new views (`reservation_details`, `customer_analytics`)
3. **Add UI components** for allergy management
4. **Implement floor plan** visualization using `position_x`, `position_y`
5. **Add punctuality indicators** in reservation UI
6. **Create allergy alerts** for life-threatening allergies
