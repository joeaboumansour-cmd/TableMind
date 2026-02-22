# Unified Data Synchronization System

## Overview

This document describes the unified data synchronization system that ensures **ALL views** (Floor Plan, Timeline, Reservations List, and Waiter View) display the **same data from the same source of truth** with **full real-time synchronization**.

## The Problem (Before)

Previously, each view had its own data fetching logic with different query keys:
- **Floor Plan**: `["floor-plan-tables", restaurantId]`, `["floor-plan-reservations", restaurantId, date]`
- **Timeline View**: `["timeline-tables", restaurantId]`, `["timeline-reservations", restaurantId, date]`
- **Reservations List**: `["list-tables", restaurantId]`, `["list-reservations", restaurantId]`
- **Waiter View**: `["table-statuses", restaurantId]`, `["active-reservations", restaurantId]`

This caused:
1. **Data inconsistency** - Different views showed different data
2. **Stale data** - Changes in one view didn't reflect in others
3. **Multiple API calls** - Inefficient data fetching
4. **Race conditions** - Updates could overwrite each other

## The Solution (After)

### Single Source of Truth

The `useUnifiedData` hook (`src/lib/hooks/useUnifiedData.ts`) provides a centralized data store:

```typescript
// All views use the same hook
const { tables, reservations, tableStatuses } = useUnifiedData({
  date: selectedDate,           // optional - filter by date
  includeServiceStatus: true,   // optional - for waiter view
  enableRealtime: true,         // default - real-time sync
});
```

### Shared Query Keys

All views now use unified query keys:
- Tables: `["unified", "tables", restaurantId]`
- Reservations: `["unified", "reservations", restaurantId, date]`
- Table Statuses: `["unified", "table-statuses", restaurantId]`

### Real-time Synchronization

The system subscribes to **ALL** database changes:

```typescript
// Subscriptions set up automatically by useUnifiedData
- reservations table (INSERT, UPDATE, DELETE)
- tables table (INSERT, UPDATE, DELETE)  
- table_service_status table (INSERT, UPDATE, DELETE)
```

When ANY change occurs:
1. All related queries are invalidated
2. All active views refetch automatically
3. UI updates instantly across all tabs/windows

## Usage

### Floor Plan View

```typescript
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";

function FloorPlan({ selectedDate }) {
  const { tablesWithReservations, isLoading } = useUnifiedData({
    date: selectedDate,
  });

  // tablesWithReservations includes both table and current reservation
  return tablesWithReservations.map(({ table, reservation }) => (
    <TableCard 
      table={table} 
      reservation={reservation}
      status={reservation?.status || table.current_status}
    />
  ));
}
```

### Timeline View

```typescript
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";

function TimelineView({ selectedDate }) {
  const { tables, reservations, createReservation, updateReservation } = useUnifiedData({
    date: selectedDate,
  });

  // Reservations and tables are automatically synced
  // Mutations invalidate all relevant queries
}
```

### Reservations List

```typescript
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";

function ReservationsPage() {
  const { reservations, deleteReservation } = useUnifiedData();

  // Shows ALL reservations (no date filter)
  // Deleting a reservation updates ALL views instantly
}
```

### Waiter View

```typescript
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";

function WaiterView() {
  const { 
    tableStatuses, 
    activeReservations,
    updateTableStatus,
    seatReservation 
  } = useUnifiedData({
    date: today,
    includeServiceStatus: true, // Includes service status data
  });

  // Table statuses poll every 3 seconds for "live" feel
  // Plus real-time updates via subscriptions
}
```

## Mutations

All mutations automatically invalidate ALL related queries:

```typescript
const {
  createReservation,    // Creates reservation + updates all views
  updateReservation,    // Updates reservation + updates all views
  deleteReservation,    // Deletes reservation + updates all views
  updateTableStatus,    // Updates service status + updates all views
  seatReservation,      // Seats a guest + updates all views
} = useUnifiedData();
```

## Migration Guide

### For New Components

Always use `useUnifiedData`:

```typescript
import { useUnifiedData } from "@/lib/hooks/useUnifiedData";

function MyComponent() {
  const { tables, reservations, isLoading } = useUnifiedData({
    date: selectedDate, // optional
  });
  
  if (isLoading) return <Loading />;
  
  return (...);
}
```

### For Existing Components

Replace individual queries with `useUnifiedData`:

**Before:**
```typescript
const { data: tables } = useQuery({
  queryKey: ["floor-plan-tables", restaurantId],
  queryFn: fetchTables,
});

const { data: reservations } = useQuery({
  queryKey: ["floor-plan-reservations", restaurantId, date],
  queryFn: fetchReservations,
});
```

**After:**
```typescript
const { tables, reservations } = useUnifiedData({ date });
```

## Benefits

1. **Consistency**: All views show identical data
2. **Real-time**: Changes reflect instantly everywhere
3. **Efficiency**: Shared cache reduces API calls
4. **Simplicity**: Single hook for all data needs
5. **Reliability**: No more race conditions or stale data
6. **Maintainability**: One place to update data logic

## Technical Details

### Query Keys

The unified query keys are mapped to legacy keys for backward compatibility:

```typescript
export const QUERY_KEYS = {
  tables: (restaurantId) => ["unified", "tables", restaurantId],
  reservations: (restaurantId, date) => ["unified", "reservations", restaurantId, date],
  
  // Legacy compatibility
  floorPlanTables: (restaurantId) => ["unified", "tables", restaurantId],
  timelineTables: (restaurantId) => ["unified", "tables", restaurantId],
  listTables: (restaurantId) => ["unified", "tables", restaurantId],
  // ... etc
};
```

### Real-time Subscriptions

Three channels are monitored:

1. **reservations** channel: Watches for reservation changes
2. **tables** channel: Watches for table configuration changes
3. **table_service_status** channel: Watches for service status changes

Each subscription invalidates ALL relevant queries on change.

### Optimistic Updates

The hook supports optimistic updates for better UX:

```typescript
// Data is transformed with computed fields
const tablesWithStatus = tables.map(table => ({
  ...table,
  current_status: serviceStatusMap.get(table.id)?.status,
  availability_status: serviceStatusMap.get(table.id)?.availability_status,
}));
```

## Testing

To verify the unified system works:

1. Open **Floor Plan** in one browser tab
2. Open **Timeline View** in another tab
3. Create a reservation in Timeline
4. **Expected**: Floor Plan updates automatically within seconds
5. Seat the guest in Waiter View
6. **Expected**: Both Floor Plan and Timeline show "seated" status

## Future Improvements

1. **Optimistic Updates**: Add optimistic updates for mutations
2. **Offline Support**: Sync changes when coming back online
3. **Conflict Resolution**: Handle concurrent edits gracefully
4. **Partial Updates**: Only refetch changed data, not everything
