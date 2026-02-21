// =============================================
// Hook Exports - Centralized React Query hooks
// =============================================

// NOTE: useRestaurant/useRestaurantId removed - use RestaurantContext instead
// The hooks in useRestaurant.ts fetch from DB (.limit(1)) which returns wrong tenant
export * from "./useTables";
export * from "./useCustomers";
export * from "./useReservations";
export * from "./useDebounce";
