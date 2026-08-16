> # ⚠️ ARCHIVED — DO NOT USE
>
> **Archived 2026-08-16. Superseded, and factually contradicts shipped behaviour.**
>
> A manual QA checklist from April 2026. It describes a **48-hour** retention policy throughout — that was replaced by migration `011_store_controlled_retention.sql` (90-day / max-5000, store-configurable). It also documents a WhatsApp send flow that migration `023_remove_whatsapp_send.sql` removed. Every checkbox is unticked, so it's unclear it was ever run.
>
> Superseded by the real Playwright suite: `tests/transaction-history.spec.ts` (42 tests).

---

# Transaction History Module - Test Guide

## Overview
This document provides a comprehensive test guide for the Transaction History module implementation.

## Database Queries

### 1. 48-Hour Retention Query (GET)
```sql
-- Fetch transactions from last 48 hours with items
SELECT 
  t.id,
  t.transaction_number,
  t.subtotal,
  t.total_amount,
  t.amount_paid,
  t.change_given,
  t.created_at,
  ti.product_name,
  ti.quantity,
  ti.unit_price,
  ti.total_price
FROM transactions t
LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
WHERE t.store_id = 'STORE_ID'
  AND t.created_at >= NOW() - INTERVAL '48 hours'
ORDER BY t.created_at DESC;
```

### 2. 48-Hour Cleanup Query (DELETE)
```sql
-- Delete transactions older than 48 hours
DELETE FROM transactions 
WHERE store_id = 'STORE_ID'
  AND created_at < NOW() - INTERVAL '48 hours';
```

### 3. Manual Cleanup Function
```sql
-- Call the cleanup function
SELECT cleanup_old_transactions_for_store('STORE_ID');

-- View cleanup statistics
SELECT * FROM transaction_retention_stats WHERE store_id = 'STORE_ID';

-- Preview what will be deleted
SELECT * FROM get_transactions_for_cleanup();
```

## Test Scenarios

### 1. Basic Functionality
- [ ] Navigate to Transaction History from POS page
- [ ] Verify empty state when no transactions exist
- [ ] Verify loading states work correctly
- [ ] Test refresh functionality

### 2. Data Display
- [ ] Create a test transaction via checkout
- [ ] Verify transaction appears in history
- [ ] Check transaction details display correctly:
  - Transaction ID and timestamp
  - Line items with quantities and prices
  - Financials (subtotal, total, amount paid, change)
- [ ] Test accordion functionality (expand/collapse)

### 3. 48-Hour Filtering
- [ ] Create transactions with different timestamps
- [ ] Verify only transactions from last 48 hours are shown
- [ ] Test with transactions older than 48 hours (should not appear)

### 4. WhatsApp Integration
- [ ] Test "Send to WhatsApp" button
- [ ] Verify number validation (8 digits)
- [ ] Check receipt format in WhatsApp
- [ ] Test with invalid numbers

### 5. Cleanup Functionality
- [ ] Test manual cleanup button
- [ ] Verify old transactions are removed
- [ ] Check that cleanup respects store isolation
- [ ] Test cleanup statistics view

### 6. Mobile Responsiveness
- [ ] Test on mobile devices
- [ ] Verify accordion works on touch
- [ ] Check layout adapts to small screens
- [ ] Test WhatsApp button on mobile

## Edge Cases

### 1. Data Integrity
- [ ] Test with missing transaction items
- [ ] Test with zero quantities
- [ ] Test with negative amounts (should not occur)
- [ ] Test with very large transaction amounts

### 2. Network Issues
- [ ] Test with slow network connections
- [ ] Test with network failures
- [ ] Verify error handling and user feedback

### 3. Authentication
- [ ] Test without authentication (should redirect to login)
- [ ] Test with expired licenses
- [ ] Verify store isolation (users can't see other stores' data)

## Performance Tests

### 1. Large Data Sets
- [ ] Test with 100+ transactions
- [ ] Verify loading performance
- [ ] Test scrolling performance
- [ ] Check memory usage

### 2. Database Performance
- [ ] Test query performance with large datasets
- [ ] Verify index usage
- [ ] Test cleanup performance

## Security Tests

### 1. Data Access
- [ ] Verify RLS policies work correctly
- [ ] Test that users can't access other stores' data
- [ ] Verify cleanup only affects user's own data

### 2. Input Validation
- [ ] Test SQL injection attempts
- [ ] Test XSS prevention
- [ ] Verify WhatsApp number validation

## Implementation Notes

### Database Schema
The existing schema already supports the required functionality:
- `transactions` table stores transaction metadata
- `transaction_items` table stores line items (with CASCADE delete)
- RLS policies ensure store isolation

### API Endpoints
- `GET /api/transactions` - Fetch transactions (48-hour filter)
- `DELETE /api/transactions` - Cleanup old transactions

### Frontend Components
- `src/app/transactions/page.tsx` - Main transaction history page
- Uses accordion UI for mobile responsiveness
- Includes WhatsApp integration
- Implements 48-hour filtering

### Cleanup Strategy
- Manual cleanup via API endpoint
- Database functions for automated cleanup
- TTL index for performance optimization
- Statistics view for monitoring

## Rollback Plan
If issues are found:
1. Disable cleanup functionality
2. Revert to manual data management
3. Fix issues in development
4. Deploy fixes with proper testing

## Success Criteria
- [ ] All test scenarios pass
- [ ] Performance meets requirements
- [ ] Security vulnerabilities addressed
- [ ] Mobile experience is smooth
- [ ] Users can easily access transaction history
- [ ] 48-hour retention policy works correctly
- [ ] WhatsApp integration functions properly