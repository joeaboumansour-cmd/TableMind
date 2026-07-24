"use client";

import React from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

interface FeatureFlagGuardProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Wraps content that requires a specific store-level feature flag.
 * If the feature is disabled for the current store, shows fallback or null.
 *
 * This is the store-level gate. Employee-level permissions are handled
 * by the existing PermissionGuard.
 *
 * Usage:
 *   <FeatureFlagGuard feature="product_discount">
 *     <DiscountInput />
 *   </FeatureFlagGuard>
 *
 *   <FeatureFlagGuard
 *     feature="bulk_scanning"
 *     fallback={<Button disabled>Bulk Scan (upgrade required)</Button>}
 *   >
 *     <Button onClick={handleBulkScan}>Bulk Scan</Button>
 *   </FeatureFlagGuard>
 */
export function FeatureFlagGuard({
  feature,
  children,
  fallback,
}: FeatureFlagGuardProps) {
  const { isEnabled } = useFeatureFlags();

  if (!isEnabled(feature)) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return null;
  }

  return <>{children}</>;
}

/**
 * Hook version for inline checks
 */
export function useFeatureFlag(feature: string): boolean {
  const { isEnabled } = useFeatureFlags();
  return isEnabled(feature);
}