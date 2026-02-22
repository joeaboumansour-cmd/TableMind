# TableMind Enhancement Implementation Plan

Based on the Servme analysis, this document outlines the implementation of high-priority features to achieve competitive parity.

---

## Phase 1: Core Revenue & Guest Experience Features

### 1. Live Spend Tracking (RevPASH)
**Priority: HIGH | Effort: Medium | Impact: High Revenue**

RevPASH = Revenue per Available Seat Hour

**Implementation:**
- [x] Database schema: `live_spend_tracking` table
- [x] Real-time spend entry interface for waiters
- [x] RevPASH calculation API
- [x] Dashboard widget for live monitoring
- [x] Integration with table status

**Files to Create:**
- `src/app/api/live-spend/route.ts` - API endpoint
- `src/components/live-spend/LiveSpendTracker.tsx` - Real-time tracker
- `src/components/live-spend/RevPASHDashboard.tsx` - Dashboard widget
- `supabase/migration_live_spend_tracking.sql` - Database migration

---

### 2. Guest Rating & Feedback System
**Priority: HIGH | Effort: Medium | Impact: High Satisfaction**

**Implementation:**
- [x] Database schema: `guest_ratings` table
- [x] Post-visit feedback collection
- [x] Rating analytics dashboard
- [x] Low rating alerts for managers
- [x] Guest satisfaction trends

**Files to Create:**
- `src/app/api/guest-feedback/route.ts` - API endpoint
- `src/components/feedback/GuestFeedbackModal.tsx` - Feedback UI
- `src/components/feedback/RatingAnalytics.tsx` - Analytics view
- `supabase/migration_guest_ratings.sql` - Database migration

---

### 3. Auto-Assign Tables Algorithm
**Priority: HIGH | Effort: Medium | Impact: Operational Efficiency**

**Implementation:**
- [x] Smart table assignment algorithm
- [x] Consider party size, preferences, history
- [x] Section rotation for fairness
- [x] VIP priority handling
- [x] Manual override option

**Files to Create:**
- `src/lib/utils/tableAssignment.ts` - Algorithm
- `src/app/api/tables/auto-assign/route.ts` - API endpoint
- `src/components/tables/AutoAssignButton.tsx` - UI component

---

### 4. Email Marketing Platform
**Priority: HIGH | Effort: High | Impact: High Retention**

**Implementation:**
- [x] Database schema: `email_campaigns`, `email_templates`
- [x] Campaign builder UI
- [x] Template library
- [x] Guest segmentation for targeting
- [x] Campaign performance tracking
- [x] Email service integration (SendGrid)

**Files to Create:**
- `src/app/(dashboard)/marketing/page.tsx` - Marketing dashboard
- `src/app/api/marketing/campaigns/route.ts` - Campaign API
- `src/app/api/marketing/templates/route.ts` - Templates API
- `src/components/marketing/CampaignBuilder.tsx` - Campaign builder
- `src/components/marketing/TemplateLibrary.tsx` - Template library
- `src/components/marketing/EmailPreview.tsx` - Preview component
- `supabase/migration_email_marketing.sql` - Database migration

---

### 5. Event Management Module
**Priority: MEDIUM-HIGH | Effort: High | Impact: New Revenue Stream**

**Implementation:**
- [x] Database schema: `events`, `event_bookings`
- [x] Event creation wizard
- [x] Ticket/pre-payment handling
- [x] Event templates (brunch, NYE, etc.)
- [x] Guest list management
- [x] Event analytics

**Files to Create:**
- `src/app/(dashboard)/events/page.tsx` - Events dashboard
- `src/app/api/events/route.ts` - Events API
- `src/components/events/EventWizard.tsx` - Creation wizard
- `src/components/events/EventTemplateSelector.tsx` - Templates
- `supabase/migration_events_management.sql` - Database migration

---

## Phase 2: Enhancement Features

### 6. Deposit & Pre-payment System
**Priority: MEDIUM | Effort: Medium | Impact: Reduce No-shows**

**Implementation:**
- [x] Database schema: `reservation_payments`
- [x] Payment rules configuration
- [x] Deposit collection at booking
- [x] No-show charge handling
- [x] Refund workflow

**Files to Create:**
- `src/app/api/payments/deposits/route.ts` - Deposit API
- `src/components/payments/DepositConfig.tsx` - Configuration
- `src/components/payments/PaymentModal.tsx` - Payment UI
- `supabase/migration_deposit_system.sql` - Database migration

---

### 7. Manager's Notes & Shift Communication
**Priority: MEDIUM | Effort: Low | Impact: Staff Communication**

**Implementation:**
- [x] Database schema: `manager_notes`
- [x] Daily shift notes
- [x] Guest-specific alerts
- [x] Staff notification system
- [x] Notes history

**Files to Create:**
- `src/app/api/manager-notes/route.ts` - API endpoint
- `src/components/manager/ManagerNotesPanel.tsx` - Notes UI
- `supabase/migration_manager_notes.sql` - Database migration

---

### 8. Profile Merging & Deduplication
**Priority: MEDIUM | Effort: Low | Impact: Data Quality**

**Implementation:**
- [x] Duplicate detection algorithm
- [x] Profile merge UI
- [x] Data consolidation logic
- [x] Merge history tracking

**Files to Create:**
- `src/app/api/customers/merge/route.ts` - Merge API
- `src/components/customers/DuplicateDetector.tsx` - Detection UI
- `src/components/customers/ProfileMergeModal.tsx` - Merge UI

---

## Phase 3: Advanced Integrations

### 9. POS Integration Framework
**Priority: LOWER | Effort: High | Impact: Data Sync**

**Implementation:**
- [ ] Generic POS adapter interface
- [ ] Webhook handling
- [ ] Order synchronization
- [ ] Guest spend import

**Files to Create:**
- `src/lib/integrations/pos/PosAdapter.ts` - Adapter interface
- `src/lib/integrations/pos/providers/` - Provider implementations
- `src/app/api/integrations/pos/webhook/route.ts` - Webhook handler

---

### 10. Google Reserve Integration
**Priority: LOWER | Effort: Medium | Impact: Discovery**

**Implementation:**
- [ ] Google Reserve API integration
- [ ] Availability sync
- [ ] Booking widget
- [ ] Google Business Profile connection

**Files to Create:**
- `src/lib/integrations/google-reserve/client.ts` - Client
- `src/app/api/integrations/google-reserve/route.ts` - API endpoint

---

## Database Migration Summary

### Migration Files to Create:
1. `supabase/migration_live_spend_tracking.sql`
2. `supabase/migration_guest_ratings.sql`
3. `supabase/migration_email_marketing.sql`
4. `supabase/migration_events_management.sql`
5. `supabase/migration_deposit_system.sql`
6. `supabase/migration_manager_notes.sql`
7. `supabase/migration_enhanced_analytics.sql`

---

## UI/UX Enhancements

### New Dashboard Components:
- [x] Live RevPASH widget
- [x] Guest satisfaction score
- [x] Marketing campaign performance
- [x] Event calendar integration
- [x] Shift notes panel

### Navigation Updates:
- [x] Add "Marketing" to main nav
- [x] Add "Events" to main nav
- [x] Add "Live Spend" quick access

---

## Testing Strategy

### Unit Tests:
- Table assignment algorithm
- RevPASH calculations
- Email template rendering

### Integration Tests:
- End-to-end reservation flow with deposits
- Marketing campaign creation and sending
- Event booking and payment

### E2E Tests:
- Complete guest journey
- Staff workflow optimization

---

## Rollout Plan

### Week 1-2: Foundation
- Database migrations
- Core APIs
- Basic UI components

### Week 3-4: Guest Experience
- Live spend tracking
- Guest feedback system
- Auto-assign tables

### Week 5-6: Marketing
- Email platform
- Campaign builder
- Template library

### Week 7-8: Advanced Features
- Event management
- Deposit system
- Manager notes

---

## Success Metrics

### Feature Adoption:
- Live Spend usage: Target 80% of reservations
- Guest feedback collection: Target 30% response rate
- Email campaign creation: Target 2 campaigns/week
- Auto-assign usage: Target 60% of reservations

### Business Impact:
- Average guest spend increase: Target +15%
- No-show reduction: Target -25%
- Repeat guest rate: Target +20%
- Marketing campaign ROI: Target 300%

---

*Document created: 2026-02-22*
*Status: Implementation in progress*
